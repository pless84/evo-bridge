#!/usr/bin/python3
"""Evo companion: a small settings and status app for the computer bridge.

Shows what the Evo is displaying, sets brightness, sends text, previews the
animations, edits the bridge's settings (Evo device, timings) and controls
the evo-bridge systemd user service. Lives in the system tray; the tray icon
takes the pet's colour for the current state.

    evo-companion.py [--hidden]     --hidden: start in the tray only

"Start minimized in the tray" (Service tab) makes every launch behave like
--hidden; it is kept in ~/.config/evo-bridge/companion.conf.

Talks to the bridge at EVO_URL (default http://127.0.0.1:8787) with the token
from EVO_TOKEN or ~/.config/evo-bridge/token, like the hook. Needs PySide6
(Fedora: python3-pyside6).
"""
import json
import os
import re
import sys
from pathlib import Path

from PySide6.QtCore import QByteArray, QProcess, QSettings, QSize, Qt, QTimer, QUrl
from PySide6.QtGui import QAction, QColor, QIcon, QImage, QPainter, QPixmap
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkReply, QNetworkRequest
from PySide6.QtWidgets import (
    QApplication, QButtonGroup, QCheckBox, QColorDialog, QComboBox, QDoubleSpinBox, QFormLayout,
    QGridLayout, QGroupBox, QHBoxLayout, QHeaderView, QLabel, QLineEdit, QMainWindow,
    QMenu, QMessageBox, QPlainTextEdit, QPushButton, QSlider, QSystemTrayIcon,
    QScrollArea, QTableWidget, QTableWidgetItem, QTabWidget, QToolButton, QVBoxLayout, QWidget,
)

URL = os.environ.get("EVO_URL", "http://127.0.0.1:8787").rstrip("/")
TOKEN_FILE = Path(os.environ.get("EVO_TOKEN_FILE", Path.home() / ".config/evo-bridge/token"))
SERVICE = "evo-bridge"
AUTOSTART = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "autostart/evo-companion.desktop"
HERE = Path(__file__).resolve().parent
THEME_COLUMNS = 5  # the character picker's grid
MAC_RE = re.compile(r"([0-9A-F]{2}(?::[0-9A-F]{2}){5})", re.I)

# The pet's body colour per state (tools/art/sprites.js).
COLORS = {
    "idle": "#1fb5a6", "thinking": "#8a6cf0", "working": "#3d8bff",
    "working_bash": "#3d8bff", "working_edit": "#3d8bff", "working_read": "#3d8bff",
    "needs_input": "#ff7a1a", "done": "#3ccf5a", "error": "#e8333a", "clock": "#9a9aa8",
}
LABELS = {
    "idle": "Idle", "thinking": "Thinking", "working": "Working", "working_bash": "Running a command",
    "working_edit": "Editing", "working_read": "Reading", "needs_input": "Needs you",
    "done": "Done", "error": "Error", "clock": "Clock",
}
OFFLINE = "#55555f"

# Timing settings shown in the app: key, label, unit (seconds or minutes), hint.
TIMINGS = [
    ("doneHoldMs", "Show “done” for", "s", "then the pet goes idle"),
    ("errorHoldMs", "Show errors for at least", "s", ""),
    ("minDisplayMs", "Show each state for at least", "s", "less flicker"),
    ("workingDebounceMs", "Switch between tool animations after", "s", "less flicker"),
    ("staleBusyMs", "Give up on a busy session after", "min", "Esc sends no “done”; 0 = never"),
    ("sessionTimeoutMs", "Forget a quiet session after", "min", ""),
]


def exec_quote(path):
    """A path as one argument in a .desktop Exec line."""
    escaped = "".join("\\" + c if c in '"`$\\' else c for c in str(path))
    return '"' + escaped.replace("%", "%%") + '"'


def read_token():
    if os.environ.get("EVO_TOKEN"):
        return os.environ["EVO_TOKEN"].strip()
    try:
        return TOKEN_FILE.read_text().strip()
    except OSError:
        return ""


def pixels_pixmap(pixels, size):
    """A 16x16 frame of 'rrggbb' strings, scaled up crisply."""
    img = QImage(16, 16, QImage.Format.Format_RGB32)
    for i, c in enumerate(pixels):
        img.setPixel(i % 16, i // 16, 0xFF000000 | int(c, 16))
    return QPixmap.fromImage(img.scaled(size, size))


def dot_icon(color, size=64):
    pm = QPixmap(size, size)
    pm.fill(Qt.GlobalColor.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    p.setBrush(QColor(color))
    p.setPen(QColor(0, 0, 0, 90))
    p.drawEllipse(4, 4, size - 8, size - 8)
    p.end()
    return QIcon(pm)


class Bridge:
    """Asynchronous HTTP calls to the bridge. Callbacks get (status, body)."""

    def __init__(self, parent):
        self.nam = QNetworkAccessManager(parent)
        self.token = read_token()

    def _request(self, path):
        req = QNetworkRequest(QUrl(URL + path))
        req.setRawHeader(b"X-Evo-Token", self.token.encode())
        req.setTransferTimeout(3000)
        return req

    def _wire(self, reply, cb):
        def done():
            status = reply.attribute(QNetworkRequest.Attribute.HttpStatusCodeAttribute) or 0
            body = bytes(reply.readAll()).decode("utf-8", "replace")
            if reply.error() != QNetworkReply.NetworkError.NoError and not status:
                body = reply.errorString()
            reply.deleteLater()
            if cb:
                cb(int(status), body)
        reply.finished.connect(done)

    def get(self, path, cb=None):
        self._wire(self.nam.get(self._request(path)), cb)

    def delete(self, path, cb=None):
        self._wire(self.nam.deleteResource(self._request(path)), cb)

    def post(self, path, body, cb=None, ctype="application/json"):
        req = self._request(path)
        req.setHeader(QNetworkRequest.KnownHeaders.ContentTypeHeader, ctype)
        self._wire(self.nam.post(req, QByteArray(body.encode())), cb)


class Window(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Evo companion")
        self.resize(560, 520)
        self.bridge = Bridge(self)
        self.procs = set()
        self.status = None
        self.config = None
        self.polling = False
        self.config_loading = False
        self.text_color = QColor("#ffffff")
        self.quitting = False
        self.editor = None
        self.themes = None          # from GET /themes
        self.themes_loading = False
        self.pending_theme = None   # chosen, not yet confirmed by the bridge
        self.pending_markers = False  # same, for the unread markers checkbox

        tabs = QTabWidget()
        tabs.addTab(self._status_tab(), "Status")
        tabs.addTab(self._display_tab(), "Display")
        tabs.addTab(self._settings_tab(), "Settings")
        tabs.addTab(self._service_tab(), "Service")
        self.setCentralWidget(tabs)

        self._tray()
        self.poll_timer = QTimer(self, interval=1000, timeout=self.poll)
        self.poll_timer.start()
        self.poll()
        self.load_config()
        self.load_devices()
        self.refresh_service()
        if not self.bridge.token:
            QMessageBox.warning(self, "No token", f"Put the bridge token in {TOKEN_FILE} (see the README).")

    # ---- tabs -------------------------------------------------------------

    def _status_tab(self):
        w = QWidget()
        v = QVBoxLayout(w)
        row = QHBoxLayout()
        self.state_dot = QLabel()
        self.state_label = QLabel("…")
        f = self.state_label.font()
        f.setPointSize(f.pointSize() + 8)
        f.setBold(True)
        self.state_label.setFont(f)
        row.addWidget(self.state_dot)
        row.addWidget(self.state_label, 1)
        v.addLayout(row)
        self.link_label = QLabel()
        self.link_label.setWordWrap(True)
        v.addWidget(self.link_label)
        v.addWidget(QLabel("Claude Code sessions:"))
        self.sessions = QTableWidget(0, 4)
        self.sessions.setHorizontalHeaderLabels(["Session", "State", "Waiting for you", "Last event"])
        hdr = self.sessions.horizontalHeader()
        hdr.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        for col in (1, 2, 3):
            hdr.setSectionResizeMode(col, QHeaderView.ResizeMode.ResizeToContents)
        self.sessions.verticalHeader().hide()
        self.sessions.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        v.addWidget(self.sessions, 1)
        self.clear_btn = QPushButton("Clear markers")
        self.clear_btn.setToolTip("Finished sessions stop counting as waiting. Ones that need you stay.")
        self.clear_btn.setEnabled(False)
        self.clear_btn.clicked.connect(self.clear_markers)
        v.addWidget(self.clear_btn, 0, Qt.AlignmentFlag.AlignRight)
        return w

    def _display_tab(self):
        w = QWidget()
        v = QVBoxLayout(w)

        g = QGroupBox("Brightness")
        h = QHBoxLayout(g)
        self.bright = QSlider(Qt.Orientation.Horizontal, minimum=0, maximum=100, value=100)
        self.bright_label = QLabel("Evo default")
        self.bright_label.setMinimumWidth(80)
        self.bright.valueChanged.connect(lambda val: self.bright_label.setText(f"{val} %"))
        self.bright.sliderReleased.connect(self.save_brightness)
        self.bright.valueChanged.connect(lambda _v: None if self.bright.isSliderDown() else self.bright_timer.start())
        self.bright_timer = QTimer(self, singleShot=True, interval=400, timeout=self.save_brightness)
        h.addWidget(self.bright, 1)
        h.addWidget(self.bright_label)
        v.addWidget(g)

        g = QGroupBox("Scrolling text")
        h = QHBoxLayout(g)
        self.text = QLineEdit(placeholderText="Hello from the computer", maxLength=200)
        self.text.returnPressed.connect(self.send_text)
        self.color_btn = QPushButton()
        self.color_btn.setToolTip("Text colour")
        self.color_btn.clicked.connect(self.pick_color)
        self._paint_color_btn()
        send = QPushButton("Send")
        send.clicked.connect(self.send_text)
        h.addWidget(self.text, 1)
        h.addWidget(self.color_btn)
        h.addWidget(send)
        v.addWidget(g)

        # The characters are the bridge's art themes; config and API still say "theme".
        g = QGroupBox("Character")
        tv = QVBoxLayout(g)
        self.theme_grid = QGridLayout()
        self.theme_grid.setSpacing(4)
        self.theme_group = QButtonGroup(self)
        self.theme_group.setExclusive(True)
        self.theme_group.idClicked.connect(self.choose_theme)
        self.theme_desc = QLabel("…")
        self.theme_desc.setWordWrap(True)
        self.theme_desc.setStyleSheet("color: gray")
        tv.addLayout(self.theme_grid)
        tv.addWidget(self.theme_desc)
        v.addWidget(g)

        self.markers = QCheckBox("Show a pixel along the top for each session that waits for you")
        self.markers.setToolTip("Orange: needs you. Red: error. Green: finished, and you haven't answered yet.")
        self.markers.clicked.connect(self.save_markers)
        v.addWidget(self.markers)

        edit = QPushButton("Edit the animations…")
        edit.setToolTip("Draw your own pixel art for each state")
        edit.clicked.connect(lambda: self.open_editor())
        v.addWidget(edit)

        g = QGroupBox("Preview an animation (5 s)")
        grid = QGridLayout(g)
        for i, name in enumerate(COLORS):
            b = QPushButton(dot_icon(COLORS[name], 24), LABELS[name])
            b.clicked.connect(lambda _c=False, n=name: self.bridge.get(f"/preview/{n}", self._report))
            grid.addWidget(b, i // 3, i % 3)
        v.addWidget(g)
        v.addStretch(1)
        # The character grid makes this tab taller than the window.
        scroll = QScrollArea()
        scroll.setWidget(w)
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.Shape.NoFrame)
        return scroll

    def _settings_tab(self):
        w = QWidget()
        v = QVBoxLayout(w)

        g = QGroupBox("Evo")
        form = QFormLayout(g)
        row = QHBoxLayout()
        self.device = QComboBox(editable=True)
        self.device.setToolTip("A paired device, or type a Bluetooth address")
        refresh = QPushButton("Refresh")
        refresh.clicked.connect(self.load_devices)
        row.addWidget(self.device, 1)
        row.addWidget(refresh)
        form.addRow("Device", row)
        self.env_note = QLabel("EVO_MAC is set for the service, so it overrides this.")
        self.env_note.setStyleSheet("color: #c77d00")
        self.env_note.hide()
        form.addRow(self.env_note)
        v.addWidget(g)

        g = QGroupBox("Timing")
        form = QFormLayout(g)
        self.clock_on = QCheckBox("Show the Evo's clock when everything is idle, after")
        self.clock_min = QDoubleSpinBox(decimals=1, minimum=0.1, maximum=1440, suffix=" min")
        self.clock_on.toggled.connect(self.clock_min.setEnabled)
        row = QHBoxLayout()
        row.addWidget(self.clock_on)
        row.addWidget(self.clock_min)
        row.addStretch(1)
        form.addRow(row)
        self.timing = {}
        for key, label, unit, hint in TIMINGS:
            minimum = 1 if key == "sessionTimeoutMs" else 0  # the bridge refuses less
            box = QDoubleSpinBox(decimals=2 if unit == "s" else 1, minimum=minimum,
                                 maximum=1440 if unit == "min" else 3600,
                                 suffix=f" {unit}", singleStep=0.5 if unit == "s" else 1)
            if hint:
                box.setToolTip(hint)
            self.timing[key] = (box, 60000 if unit == "min" else 1000)
            form.addRow(label, box)
        v.addWidget(g)

        row = QHBoxLayout()
        self.settings_msg = QLabel()
        self.defaults_btn = defaults = QPushButton("Defaults")
        defaults.clicked.connect(lambda: self.fill_settings(self.config["defaults"], keep_device=True)
                                 if self.config else None)
        revert = QPushButton("Revert")
        revert.clicked.connect(self.load_config)
        self.save_btn = save = QPushButton("Save")
        # Until the bridge's settings are loaded the fields hold placeholders;
        # saving those would overwrite the real settings.
        save.setEnabled(False)
        defaults.setEnabled(False)
        save.setDefault(True)
        save.clicked.connect(self.save_settings)
        row.addWidget(self.settings_msg, 1)
        row.addWidget(defaults)
        row.addWidget(revert)
        row.addWidget(save)
        v.addLayout(row)
        v.addStretch(1)
        return w

    def _service_tab(self):
        w = QWidget()
        v = QVBoxLayout(w)
        row = QHBoxLayout()
        self.service_label = QLabel("…")
        row.addWidget(self.service_label, 1)
        for label, verb in (("Start", "start"), ("Stop", "stop"), ("Restart", "restart")):
            b = QPushButton(label)
            b.clicked.connect(lambda _c=False, vb=verb: self.systemctl(vb))
            row.addWidget(b)
        v.addLayout(row)
        self.autostart = QCheckBox("Start the bridge when I log in")
        self.autostart.clicked.connect(lambda on: self.systemctl("enable" if on else "disable"))
        v.addWidget(self.autostart)
        self.app_autostart = QCheckBox("Open this app in the tray when I log in")
        self.app_autostart.setChecked(AUTOSTART.exists())
        self.app_autostart.toggled.connect(self.set_app_autostart)
        v.addWidget(self.app_autostart)
        self.start_minimized = QCheckBox("Start minimized in the tray")
        self.start_minimized.setToolTip("Open only the tray icon when the app starts; click it to show this window.")
        self.start_minimized.setChecked(prefs().value("start_minimized", False, type=bool))
        self.start_minimized.toggled.connect(lambda on: prefs().setValue("start_minimized", on))
        self.start_minimized.setEnabled(QSystemTrayIcon.isSystemTrayAvailable())
        v.addWidget(self.start_minimized)
        row = QHBoxLayout()
        row.addWidget(QLabel("Log"), 1)
        b = QPushButton("Refresh log")
        b.clicked.connect(self.load_log)
        row.addWidget(b)
        v.addLayout(row)
        self.log = QPlainTextEdit(readOnly=True)
        self.log.setLineWrapMode(QPlainTextEdit.LineWrapMode.NoWrap)
        v.addWidget(self.log, 1)
        self.load_log()
        return w

    def _tray(self):
        self.tray = None
        if not QSystemTrayIcon.isSystemTrayAvailable():
            return
        self.tray = QSystemTrayIcon(dot_icon(OFFLINE), self)
        menu = QMenu()
        show = QAction("Open", self, triggered=self.show_window)
        art = QAction("Art editor…", self, triggered=lambda: self.open_editor())
        clear = QAction("Clear markers", self, triggered=self.clear_markers)
        quit_ = QAction("Quit", self, triggered=self.quit)
        menu.addAction(show)
        menu.addAction(art)
        menu.addAction(clear)
        menu.addSeparator()
        menu.addAction(quit_)
        self.tray.setContextMenu(menu)
        self.tray.activated.connect(
            lambda r: self.toggle_window() if r == QSystemTrayIcon.ActivationReason.Trigger else None)
        self.tray.setToolTip("Evo")
        self.tray.show()

    # ---- status -------------------------------------------------------------

    def poll(self):
        if self.polling:
            return
        self.polling = True
        self.bridge.get("/status", self.on_status)

    def on_status(self, code, body):
        self.polling = False
        reason = "bad reply"
        if code == 200:
            try:
                self.status = json.loads(body)
            except ValueError:
                self.status = None
            if self.status and self.config is None and not self.config_loading:
                self.load_config()  # the bridge was not up when the app started
            if self.status and self.themes is None and not self.themes_loading:
                self.load_themes()
            if self.status and self.themes and self.pending_theme is None:
                self._show_theme(self.status.get("theme"))
        else:
            self.status = None
            reason = "wrong token" if code == 401 else (body.strip() or f"HTTP {code}")
        s = self.status
        waiting = 0
        if not s:
            color, title = OFFLINE, "Bridge not running"
            self.link_label.setText(f"No answer from {URL} ({reason}). Start it on the Service tab.")
            self.sessions.setRowCount(0)
            self.clear_btn.setEnabled(False)
        else:
            st = s.get("state", "idle")
            color, title = COLORS.get(st, OFFLINE), LABELS.get(st, st)
            if s.get("text"):
                title += f"  ·  “{s['text']}”"
            elif s.get("preview"):
                title += f"  ·  preview: {LABELS.get(s['preview'], s['preview'])}"
            if not s.get("evo"):
                link = "No Evo chosen or paired yet: pick one on the Settings tab."
            elif s.get("connected"):
                link = f"Connected to the Evo ({s['evo']})."
            else:
                link = f"Connecting to the Evo ({s['evo']})… Is it on and in range?"
                color = OFFLINE
            self.link_label.setText(link)
            if not self.bright.isSliderDown() and not self.bright_timer.isActive() and s.get("brightness") is not None:
                self.bright.blockSignals(True)
                self.bright.setValue(s["brightness"])
                self.bright.blockSignals(False)
                self.bright_label.setText(f"{s['brightness']} %")
            if not self.pending_markers and "unread_markers" in s:
                self.markers.setChecked(bool(s["unread_markers"]))
            rows = s.get("sessions", [])
            self.sessions.setRowCount(len(rows))
            for i, r in enumerate(rows):
                short_id = r["id"][:8] if len(r["id"]) > 12 else r["id"]
                unread = r.get("unread")
                for j, val in enumerate((r.get("name") or short_id, LABELS.get(r["state"], r["state"]),
                                         LABELS.get(unread, unread) if unread else "", f"{r['idle_s']} s ago")):
                    self.sessions.setItem(i, j, QTableWidgetItem(val))
                self.sessions.item(i, 0).setToolTip(r["id"])
                if unread:
                    self.sessions.item(i, 2).setIcon(dot_icon(COLORS.get(unread, OFFLINE), 24))
            waiting = sum(1 for r in rows if r.get("unread"))
            # Only finished sessions can be cleared; the others still need you.
            self.clear_btn.setEnabled(any(r.get("unread") == "done" for r in rows))
        self.state_dot.setPixmap(dot_icon(color, 28).pixmap(28, 28))
        self.state_label.setText(title)
        if self.tray:
            self.tray.setIcon(dot_icon(color))
            self.tray.setToolTip(f"Evo: {title}" + (f"  ·  {waiting} waiting" if waiting else ""))

    def _report(self, code, body):
        if code != 200:
            self.statusBar().showMessage(body.strip() or f"HTTP {code}", 5000)

    # ---- display ------------------------------------------------------------

    def load_themes(self):
        def done(code, body):
            self.themes_loading = False
            try:
                data = json.loads(body) if code == 200 else None
            except ValueError:
                data = None
            if not data:
                return
            self.themes = data["themes"]
            for b in self.theme_group.buttons():
                self.theme_group.removeButton(b)
                b.deleteLater()
            for i, t in enumerate(self.themes):
                b = QToolButton(checkable=True, text=t["label"], toolTip=t["description"])
                b.setIcon(QIcon(pixels_pixmap(t["preview"], 48)))
                b.setIconSize(QSize(48, 48))
                b.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextUnderIcon)
                b.setAutoRaise(True)
                b.setMinimumWidth(84)
                self.theme_group.addButton(b, i)
                self.theme_grid.addWidget(b, i // THEME_COLUMNS, i % THEME_COLUMNS)
            self._show_theme(data["current"])
        self.themes_loading = True
        self.bridge.get("/themes", done)

    def _show_theme(self, theme_id):
        i = next((n for n, t in enumerate(self.themes or []) if t["id"] == theme_id), -1)
        if i < 0:
            return
        b = self.theme_group.button(i)
        if b and not b.isChecked():
            b.setChecked(True)
        t = self.themes[i]
        self.theme_desc.setText(t["description"])
        if self.editor:
            self.editor.set_theme(t["id"], t["label"])

    def choose_theme(self, i):
        theme_id = self.themes[i]["id"]
        self.pending_theme = theme_id  # until the bridge answers, polls must not flip the box back

        def done(code, body):
            self.pending_theme = None
            self._report(code, body)
            current = theme_id if code == 200 else (self.status or {}).get("theme")
            if current:
                self._show_theme(current)
        self.bridge.post("/config", json.dumps({"theme": theme_id}), done)

    def save_brightness(self):
        self.bright_timer.stop()
        self.bridge.post("/config", json.dumps({"brightness": self.bright.value()}), self._report)

    def save_markers(self, on):
        self.pending_markers = True  # until the bridge answers, polls must not flip the box back

        def done(code, body):
            self.pending_markers = False
            self._report(code, body)
        self.bridge.post("/config", json.dumps({"unreadMarkers": bool(on)}), done)

    def clear_markers(self):
        self.bridge.post("/unread/clear", "", self._report)

    def pick_color(self):
        c = QColorDialog.getColor(self.text_color, self, "Text colour")
        if c.isValid():
            self.text_color = c
            self._paint_color_btn()

    def _paint_color_btn(self):
        self.color_btn.setIcon(dot_icon(self.text_color.name(), 24))

    def send_text(self):
        t = self.text.text().strip()
        if not t:
            return
        color = self.text_color.name()[1:]
        self.bridge.post(f"/text?color={color}", t, self._report, ctype="text/plain; charset=utf-8")

    # ---- settings -----------------------------------------------------------

    def load_config(self):
        def done(code, body):
            self.config_loading = False
            try:
                loaded = json.loads(body) if code == 200 else None
            except ValueError:
                loaded = None
            if not loaded:
                self.settings_msg.setText("Bridge not reachable; settings unavailable.")
                return
            self.config = loaded
            self.save_btn.setEnabled(True)
            self.defaults_btn.setEnabled(True)
            self.fill_settings(self.config["config"])
            self.env_note.setVisible(bool(self.config.get("mac_from_env")))
            self.settings_msg.setText("")
        self.config_loading = True
        self.bridge.get("/config", done)

    def fill_settings(self, c, keep_device=False):
        if not keep_device:
            self._select_device(c.get("mac", ""))
        t = c["timing"]
        self.clock_on.setChecked(t["idleToClockMs"] > 0)
        self.clock_min.setEnabled(t["idleToClockMs"] > 0)
        self.clock_min.setValue((t["idleToClockMs"] or self.config["defaults"]["timing"]["idleToClockMs"]) / 60000)
        for key, (box, scale) in self.timing.items():
            box.setValue(t[key] / scale)

    def load_devices(self):
        def done(_code, out):
            current = self._device_mac()
            self.device.clear()
            self.device.addItem("Automatic (the paired TimeBox)", "")
            for line in out.splitlines():
                m = re.match(r"Device ([0-9A-F:]{17}) (.*)", line.strip(), re.I)
                if m:
                    self.device.addItem(f"{m.group(2)}  ({m.group(1)})", m.group(1).upper())
            self._select_device(current if current is not None else (self.config or {}).get("config", {}).get("mac", ""))
        self.run(["bluetoothctl", "devices", "Paired"], done)

    def _select_device(self, mac):
        for i in range(self.device.count()):
            if (self.device.itemData(i) or "") == (mac or "").upper():
                self.device.setCurrentIndex(i)
                return
        self.device.setEditText(mac)

    def _device_mac(self):
        """The chosen address: '' for automatic, None if what's typed isn't an address."""
        i = self.device.currentIndex()
        if i >= 0 and self.device.itemText(i) == self.device.currentText():
            return self.device.itemData(i) or ""
        text = self.device.currentText().strip()
        if not text:
            return ""
        m = MAC_RE.search(text)
        return m.group(1).upper() if m else None

    def save_settings(self):
        if self.config is None:
            return
        mac = self._device_mac()
        if mac is None:
            self.settings_msg.setText("The device must be a Bluetooth address like 11:22:33:44:55:66.")
            return
        timing = {key: int(round(box.value() * scale)) for key, (box, scale) in self.timing.items()}
        timing["idleToClockMs"] = int(round(self.clock_min.value() * 60000)) if self.clock_on.isChecked() else 0

        def done(code, body):
            if code == 200:
                self.config = json.loads(body)
                self.settings_msg.setText("Saved.")
                QTimer.singleShot(3000, lambda: self.settings_msg.setText(""))
            else:
                self.settings_msg.setText(body.strip() or f"Not saved (HTTP {code}).")
        self.bridge.post("/config", json.dumps({"mac": mac, "timing": timing}), done)

    # ---- service ------------------------------------------------------------

    def run(self, argv, cb=None):
        p = QProcess(self)
        p.setProcessChannelMode(QProcess.ProcessChannelMode.MergedChannels)
        self.procs.add(p)

        def finished(code, _status=None):
            if p not in self.procs:  # already handled (or the app is closing)
                return
            self.procs.discard(p)
            try:
                out = bytes(p.readAllStandardOutput()).decode("utf-8", "replace")
                p.deleteLater()
            except RuntimeError:
                return
            if cb:
                cb(code, out)
        p.finished.connect(finished)
        # A program that cannot start never emits finished; other errors do.
        p.errorOccurred.connect(
            lambda e: finished(-1) if e == QProcess.ProcessError.FailedToStart else None)
        p.start(argv[0], argv[1:])

    def systemctl(self, verb):
        def done(code, out):
            if code != 0:
                QMessageBox.warning(self, "Service", out.strip() or f"systemctl {verb} failed")
            self.refresh_service()
            QTimer.singleShot(1500, self.load_log)
            if verb in ("start", "restart"):
                QTimer.singleShot(1500, self.load_config)
        self.run(["systemctl", "--user", verb, SERVICE], done)

    def refresh_service(self):
        self.run(["systemctl", "--user", "is-active", SERVICE],
                 lambda _c, out: self.service_label.setText(f"Bridge service: {out.strip() or 'unknown'}"))
        self.run(["systemctl", "--user", "is-enabled", SERVICE],
                 lambda _c, out: self.autostart.setChecked(out.strip() == "enabled"))

    def load_log(self):
        def done(_code, out):
            self.log.setPlainText(out)
            self.log.verticalScrollBar().setValue(self.log.verticalScrollBar().maximum())
        self.run(["journalctl", "--user", "-u", SERVICE, "-n", "200", "--no-pager", "-o", "cat"], done)

    def open_editor(self, state=None):
        from art_editor import ArtEditor  # next to this file
        if self.editor is None:
            self.editor = ArtEditor(self.bridge)
            self.editor.setWindowIcon(self.windowIcon())
            self.editor.resize(860, 560)
        theme = (self.status or {}).get("theme")
        if theme:
            label = next((t["label"] for t in self.themes or [] if t["id"] == theme), theme)
            self.editor.set_theme(theme, label)
        self.editor.open_state(state)

    def set_app_autostart(self, on):
        try:
            if on:
                AUTOSTART.parent.mkdir(parents=True, exist_ok=True)
                AUTOSTART.write_text(
                    "[Desktop Entry]\nType=Application\nName=Evo companion\n"
                    f"Exec={exec_quote(HERE / 'evo-companion.py')} --hidden\nIcon={HERE / 'evo-companion.svg'}\n"
                    "Terminal=false\nX-GNOME-Autostart-enabled=true\n")
            else:
                AUTOSTART.unlink(missing_ok=True)
        except OSError as e:
            QMessageBox.warning(self, "Autostart", str(e))

    # ---- window -------------------------------------------------------------

    def show_window(self):
        self.show()
        self.raise_()
        self.activateWindow()
        self.refresh_service()

    def toggle_window(self):
        if self.isVisible():
            self.hide()
        else:
            self.show_window()

    def closeEvent(self, e):
        if self.tray and not self.quitting:
            e.ignore()
            self.hide()
        else:
            e.accept()

    def quit(self):
        if self.editor and self.editor.isVisible() and not self.editor.close():
            return  # unsaved art: the user cancelled
        self.quitting = True
        QApplication.quit()


def prefs():
    # The app's own preferences (not the bridge's): ~/.config/evo-bridge/companion.conf
    return QSettings("evo-bridge", "companion")


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("Evo companion")
    app.setDesktopFileName("evo-companion")
    w = Window()
    app.setQuitOnLastWindowClosed(w.tray is None)  # with a tray, closing only hides
    svg = HERE / "evo-companion.svg"
    app.setWindowIcon(QIcon(str(svg)) if svg.exists() else dot_icon(COLORS["idle"]))
    hidden = "--hidden" in sys.argv or prefs().value("start_minimized", False, type=bool)
    if not hidden or not w.tray:
        w.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
