"""Pixel editor for the pet's animations (16x16 frames), part of the companion.

Edits one theme at a time (the bridge's current theme when opened); every
request names it (?theme=), so switching themes meanwhile can't misplace work.

Loads a state's art from the bridge (GET /art/<state>), lets you draw frames,
tries them on the Evo (POST /art/<state>/try) and saves them as
tools/art/custom/<state>.gif (POST /art/<state>). "Use starter art" removes
your version (DELETE /art/<state>).

Mouse: left paints with the chosen colour, right paints black (LEDs off).
Keys: P pencil, F fill, I pick colour, [ and ] previous/next frame,
Ctrl+Z / Ctrl+Shift+Z undo/redo, Ctrl+S save.
"""
import copy
import json
from collections import Counter

from PySide6.QtCore import QSize, Qt, QTimer
from PySide6.QtGui import QColor, QIcon, QImage, QKeySequence, QPainter, QPixmap, QShortcut
from PySide6.QtWidgets import (
    QButtonGroup, QCheckBox, QColorDialog, QComboBox, QGridLayout, QHBoxLayout, QLabel,
    QListWidget, QListWidgetItem, QMessageBox, QPushButton, QSpinBox, QToolButton,
    QVBoxLayout, QWidget,
)

SIZE = 16
BLACK = "000000"
MAX_FRAMES = 64          # same limit as tools/art-io.js
MAX_UNDO = 100
CELL = 24                # on-screen pixel size

STATE_LABELS = {
    "idle": "Idle", "thinking": "Thinking", "working": "Working (other tools)",
    "working_bash": "Running a command", "working_edit": "Editing", "working_read": "Reading",
    "needs_input": "Needs you", "done": "Done", "error": "Error",
}


def qcolor(hex_):
    return QColor("#" + hex_)


def frame_pixmap(pixels, size):
    img = QImage(SIZE, SIZE, QImage.Format.Format_RGB32)
    for i, c in enumerate(pixels):
        img.setPixel(i % SIZE, i // SIZE, 0xFF000000 | int(c, 16))
    return QPixmap.fromImage(img.scaled(size, size))  # nearest neighbour by default


def swatch_icon(hex_, size=18):
    pm = QPixmap(size, size)
    pm.fill(qcolor(hex_))
    p = QPainter(pm)
    p.setPen(QColor(128, 128, 128))
    p.drawRect(0, 0, size - 1, size - 1)
    p.end()
    return QIcon(pm)


class Canvas(QWidget):
    """The 16x16 drawing area. Drawing logic lives in the editor."""

    def __init__(self, editor):
        super().__init__()
        self.editor = editor
        self.setFixedSize(SIZE * CELL, SIZE * CELL)
        self.setMouseTracking(False)
        self.setCursor(Qt.CursorShape.CrossCursor)
        self.stroke_button = None

    def cell_at(self, pos):
        x, y = int(pos.x() // CELL), int(pos.y() // CELL)
        return (x, y) if 0 <= x < SIZE and 0 <= y < SIZE else None

    def mousePressEvent(self, e):
        cell = self.cell_at(e.position())
        if self.stroke_button is not None or not self.editor.editable:
            return  # one stroke at a time
        if cell and e.button() in (Qt.MouseButton.LeftButton, Qt.MouseButton.RightButton):
            self.stroke_button = e.button()
            self.editor.begin_stroke()
            self.editor.apply_tool(*cell, e.button() == Qt.MouseButton.RightButton, first=True)

    def mouseMoveEvent(self, e):
        cell = self.cell_at(e.position())
        if not cell:
            return
        if self.stroke_button is not None and e.buttons() & self.stroke_button:
            self.editor.apply_tool(*cell, self.stroke_button == Qt.MouseButton.RightButton, first=False)

    def mouseReleaseEvent(self, e):
        if e.button() == self.stroke_button:
            self.stroke_button = None
            self.editor.end_stroke()

    def paintEvent(self, _e):
        ed = self.editor
        p = QPainter(self)
        if not ed.frames:
            p.fillRect(self.rect(), QColor("#202028"))
            p.end()
            return
        pixels = ed.frames[ed.cur]["pixels"]
        onion = ed.frames[ed.cur - 1]["pixels"] if ed.onion.isChecked() and ed.cur > 0 else None
        for i, c in enumerate(pixels):
            x, y = (i % SIZE) * CELL, (i // SIZE) * CELL
            p.fillRect(x, y, CELL, CELL, qcolor(c))
            if onion and onion[i] != BLACK and c == BLACK:
                ghost = qcolor(onion[i])
                ghost.setAlpha(70)
                p.fillRect(x, y, CELL, CELL, ghost)
        if ed.grid.isChecked():
            p.setPen(QColor(255, 255, 255, 28))
            for k in range(1, SIZE):
                p.drawLine(k * CELL, 0, k * CELL, SIZE * CELL)
                p.drawLine(0, k * CELL, SIZE * CELL, k * CELL)
        p.end()


class ArtEditor(QWidget):
    def __init__(self, bridge):
        super().__init__()
        self.bridge = bridge
        self.setWindowTitle("Evo art editor")
        self.frames = []
        self.cur = 0
        self.state = None
        self.custom = False
        self.dirty = False
        self.undo_stack, self.redo_stack = [], []
        self.color = "ffffff"
        self.stroke_changed = False
        self.stroke_before = None   # snapshot taken at the start of a stroke, pushed on first change
        self.edits = 0              # bumped on every change; tells late replies apart
        self.load_seq = 0           # newest load request; older replies are ignored
        self.loading = False
        self.reload_on_open = False # the user discarded changes when closing
        self.theme = None           # theme of the loaded art
        self.theme_label = ""
        self.want_theme = None      # theme to load next (the bridge's current one)
        self._build()
        self._shortcuts()
        self.preview_timer = QTimer(self, singleShot=True, timeout=self._preview_step)
        self.preview_index = 0

    # ---- layout -------------------------------------------------------------

    def _build(self):
        root = QVBoxLayout(self)

        top = QHBoxLayout()
        top.addWidget(QLabel("Animation"))
        self.state_box = QComboBox()
        for key, label in STATE_LABELS.items():
            self.state_box.addItem(label, key)
        self.state_box.currentIndexChanged.connect(self._state_chosen)
        top.addWidget(self.state_box)
        self.source = QLabel()
        top.addWidget(self.source, 1)
        self.undo_btn = QPushButton("Undo")
        self.undo_btn.clicked.connect(self.undo)
        self.redo_btn = QPushButton("Redo")
        self.redo_btn.clicked.connect(self.redo)
        top.addWidget(self.undo_btn)
        top.addWidget(self.redo_btn)
        root.addLayout(top)

        mid = QHBoxLayout()

        # tools and colours
        tools = QVBoxLayout()
        self.tool_group = QButtonGroup(self)
        self.tool_buttons = {}
        for key, label, tip in (("pencil", "Pencil", "P"), ("fill", "Fill", "F"), ("pick", "Pick colour", "I")):
            b = QToolButton(text=label, checkable=True)
            b.setToolTip(f"{label} ({tip})")
            b.setMinimumWidth(110)
            self.tool_group.addButton(b)
            self.tool_buttons[key] = b
            tools.addWidget(b)
        self.tool_buttons["pencil"].setChecked(True)
        tools.addSpacing(8)
        self.color_btn = QPushButton("Colour…")
        self.color_btn.setIconSize(QSize(22, 22))
        self.color_btn.clicked.connect(self.choose_color)
        tools.addWidget(self.color_btn)
        hint = QLabel("Right-click paints black\n(LEDs off).")
        hint.setStyleSheet("color: gray")
        tools.addWidget(hint)
        tools.addWidget(QLabel("Colours in use:"))
        self.palette = QGridLayout()
        self.palette.setSpacing(2)
        pal = QWidget()
        pal.setLayout(self.palette)
        tools.addWidget(pal)
        tools.addSpacing(8)
        self.onion = QCheckBox("Show previous frame")
        self.onion.toggled.connect(lambda _on: self.canvas.update())
        self.grid = QCheckBox("Grid", checked=True)
        self.grid.toggled.connect(lambda _on: self.canvas.update())
        tools.addWidget(self.onion)
        tools.addWidget(self.grid)
        tools.addStretch(1)
        mid.addLayout(tools)

        self.canvas = Canvas(self)
        mid.addWidget(self.canvas, 0, Qt.AlignmentFlag.AlignTop)

        # frames
        side = QVBoxLayout()
        side.addWidget(QLabel("Frames"))
        self.frame_list = QListWidget()
        self.frame_list.setIconSize(QSize(40, 40))
        self.frame_list.setMinimumWidth(150)
        self.frame_list.currentRowChanged.connect(self._frame_chosen)
        side.addWidget(self.frame_list, 1)
        row = QGridLayout()
        for i, (label, fn) in enumerate((("Add", lambda: self.add_frame()), ("Duplicate", self.duplicate_frame),
                                         ("Delete", self.delete_frame), ("Clear", self.clear_frame),
                                         ("Move up", lambda: self.move_frame(-1)),
                                         ("Move down", lambda: self.move_frame(1)))):
            b = QPushButton(label)
            b.clicked.connect(fn)
            row.addWidget(b, i // 2, i % 2)
        side.addLayout(row)
        delay = QHBoxLayout()
        delay.addWidget(QLabel("Show for"))
        self.delay = QSpinBox(minimum=0, maximum=65530, singleStep=10, suffix=" ms")
        self.delay.setToolTip("How long this frame stays up (steps of 10 ms)")
        self.delay.setKeyboardTracking(False)  # one change per edit, not per keystroke
        self.delay.valueChanged.connect(self._delay_changed)
        delay.addWidget(self.delay, 1)
        side.addLayout(delay)
        side.addWidget(QLabel("Preview"))
        self.preview = QLabel()
        self.preview.setFixedSize(96, 96)
        side.addWidget(self.preview)
        mid.addLayout(side)
        root.addLayout(mid, 1)

        bottom = QHBoxLayout()
        self.msg = QLabel()
        self.msg.setWordWrap(True)
        bottom.addWidget(self.msg, 1)
        self.starter_btn = QPushButton("Use starter art")
        self.starter_btn.setToolTip("Delete your version of this animation")
        self.starter_btn.clicked.connect(self.use_starter)
        revert = QPushButton("Revert")
        revert.setToolTip("Throw away unsaved changes")
        revert.clicked.connect(lambda: self.load(self.state, ask=True))
        try_btn = QPushButton("Try on Evo")
        try_btn.setToolTip("Show it on the Evo for a few seconds without saving")
        try_btn.clicked.connect(self.try_on_evo)
        self.save_btn = QPushButton("Save")
        self.save_btn.setDefault(True)
        self.save_btn.clicked.connect(self.save)
        for b in (self.starter_btn, revert, try_btn, self.save_btn):
            bottom.addWidget(b)
        root.addLayout(bottom)
        self._paint_color_btn()

    def _shortcuts(self):
        for keys, fn in (("P", lambda: self.tool_buttons["pencil"].setChecked(True)),
                         ("F", lambda: self.tool_buttons["fill"].setChecked(True)),
                         ("I", lambda: self.tool_buttons["pick"].setChecked(True)),
                         ("[", lambda: self.step_frame(-1)), ("]", lambda: self.step_frame(1)),
                         (QKeySequence.StandardKey.Undo, self.undo),
                         (QKeySequence.StandardKey.Redo, self.redo),
                         (QKeySequence.StandardKey.Save, self.save)):
            QShortcut(QKeySequence(keys), self, activated=fn)
        if QKeySequence("Ctrl+Y") not in QKeySequence.keyBindings(QKeySequence.StandardKey.Redo):
            QShortcut(QKeySequence("Ctrl+Y"), self, activated=self.redo)

    # ---- loading and saving -------------------------------------------------

    def set_theme(self, theme, label=""):
        """The bridge's theme changed (or is first known). Reload if nothing is unsaved."""
        if theme == self.want_theme:
            return
        self.want_theme, self.theme_label = theme, label or theme
        if self.state is not None and self.isVisible() and not self.dirty and theme != self.theme:
            self.load(self.state)
        elif self.dirty and theme != self.theme:
            self.say(f"The Evo switched characters; you are still editing {self.theme}. Save or revert to continue there.")

    def open_state(self, state=None):
        """Show the window, loading `state` (or the first one)."""
        state = state or self.state or "idle"
        i = self.state_box.findData(state)
        stale_theme = self.want_theme and self.want_theme != self.theme and not self.dirty
        if self.state is None or self.reload_on_open or stale_theme or (state != self.state and self._confirm_discard()):
            self.reload_on_open = False
            self.state_box.blockSignals(True)
            self.state_box.setCurrentIndex(i)
            self.state_box.blockSignals(False)
            self.load(state)
        self.show()
        self.raise_()
        self.activateWindow()

    def _state_chosen(self, _i):
        state = self.state_box.currentData()
        if state == self.state:
            return
        if not self._confirm_discard():
            self.state_box.blockSignals(True)
            self.state_box.setCurrentIndex(self.state_box.findData(self.state))
            self.state_box.blockSignals(False)
            return
        self.load(state)

    @property
    def editable(self):
        return bool(self.frames) and not self.loading

    def _set_loading(self, on):
        self.loading = on
        for w in (self.canvas, self.frame_list, self.save_btn):
            w.setEnabled(not on)

    def _show_state_in_box(self, state):
        self.state_box.blockSignals(True)
        self.state_box.setCurrentIndex(max(0, self.state_box.findData(state)))
        self.state_box.blockSignals(False)

    def load(self, state, ask=False):
        if state is None:
            state = self.state_box.currentData()
        if ask and not self._confirm_discard():
            return
        self.load_seq += 1
        seq = self.load_seq
        theme = self.want_theme
        self._set_loading(True)

        def done(code, body):
            if seq != self.load_seq:
                return  # a newer load was started; this reply is stale
            self._set_loading(False)
            try:
                data = json.loads(body) if code == 200 else None
            except ValueError:
                data = None
            if not data:
                self.say(f"Could not load the art: {body.strip() or code}", error=True)
                self._show_state_in_box(self.state)  # still editing the previous one
                return
            self.state, self.custom = state, data["custom"]
            self.theme = data.get("theme", theme)
            self.frames = data["frames"]
            self.cur = 0
            self.undo_stack.clear()
            self.redo_stack.clear()
            self.dirty = False
            self.edits += 1
            self._show_state_in_box(state)
            self._refresh_all()
            self.say("")
            if self.want_theme and self.theme != self.want_theme:
                self.load(state)  # the theme switched while this was loading
        self.bridge.get(f"/art/{state}" + (f"?theme={theme}" if theme else ""), done)

    def _payload(self):
        return json.dumps({"frames": self.frames})

    def save(self):
        if not self.frames or self.loading or self.state is None:
            return
        state, edits, theme = self.state, self.edits, self.theme

        def done(code, body):
            if state != self.state or theme != self.theme:
                return  # switched animations meanwhile; that one was saved fine
            if code == 200:
                self.custom = True
                if edits == self.edits:
                    self.dirty = False  # nothing changed since this was sent
                self._refresh_title()
                if not self.dirty and self.want_theme and self.theme != self.want_theme:
                    saved_in = self.theme
                    self.load(self.state)  # carry on in the theme the Evo shows now
                    QTimer.singleShot(400, lambda: self.say(f"Saved to {saved_in}; now editing {self.theme_label}."))
                    return
                note = body.strip()
                self.say(note if note and note != "ok" else
                         "Saved. The Evo uses it from now on." if not self.dirty else
                         "Saved the version from before your latest changes.")
            else:
                self.say(body.strip() or f"Not saved (HTTP {code}).", error=True)
        self.bridge.post(f"/art/{self.state}?theme={self.theme}", self._payload(), done)

    def try_on_evo(self):
        if not self.frames:
            return
        self.bridge.post(f"/art/{self.state}/try?theme={self.theme}", self._payload(),
                         lambda code, body: self.say("Showing it on the Evo…" if code == 200
                                                     else body.strip() or f"HTTP {code}", error=code != 200))

    def use_starter(self):
        if self.state is None or self.loading:
            return
        if QMessageBox.question(self, "Use starter art",
                                f"Delete your version of “{STATE_LABELS[self.state]}” and go back to the starter art?") \
                != QMessageBox.StandardButton.Yes:
            return

        removed_from = self.theme

        def done(code, body):
            if code == 200:
                self.dirty = False
                self.load(self.state)
                msg = ("Back to the starter art." if removed_from == self.want_theme or not self.want_theme
                       else f"Removed your version from {removed_from}; now editing {self.theme_label}.")
                QTimer.singleShot(300, lambda: self.say(msg))
            else:
                self.say(body.strip() or f"HTTP {code}", error=True)
        self.bridge.delete(f"/art/{self.state}?theme={self.theme}", done)

    def _confirm_discard(self):
        if not self.dirty:
            return True
        r = QMessageBox.question(
            self, "Unsaved changes", f"Discard your changes to “{STATE_LABELS.get(self.state, self.state)}”?",
            QMessageBox.StandardButton.Discard | QMessageBox.StandardButton.Cancel)
        return r == QMessageBox.StandardButton.Discard

    def closeEvent(self, e):
        if self._confirm_discard():
            if self.dirty:  # discarded: start fresh next time
                self.dirty = False
                self.reload_on_open = True
            self.preview_timer.stop()
            e.accept()
        else:
            e.ignore()

    def say(self, text, error=False):
        self.msg.setStyleSheet("color: #d03030" if error else "")
        self.msg.setText(text)

    # ---- editing ------------------------------------------------------------

    def _snapshot(self):
        self.undo_stack.append((copy.deepcopy(self.frames), self.cur))
        del self.undo_stack[:-MAX_UNDO]
        self.redo_stack.clear()

    def _changed(self, frames_too=False):
        self.dirty = True
        self.edits += 1
        self._refresh_title()
        if frames_too:
            self._refresh_frames()
        else:
            self._refresh_frame_item(self.cur)
        self.canvas.update()

    def begin_stroke(self):
        # Pushed only if the stroke changes something, so a click that paints
        # nothing (or picks a colour) keeps the undo and redo history intact.
        self.stroke_before = (copy.deepcopy(self.frames), self.cur)
        self.stroke_changed = False

    def _stroke_touch(self):
        if not self.stroke_changed and self.stroke_before is not None:
            self.undo_stack.append(self.stroke_before)
            del self.undo_stack[:-MAX_UNDO]
            self.redo_stack.clear()
        self.stroke_changed = True

    def end_stroke(self):
        if self.stroke_changed:
            self._refresh_palette()
        self.stroke_before = None
        self.stroke_changed = False
        self._refresh_title()

    def apply_tool(self, x, y, black, first):
        if not self.frames:
            return
        pixels = self.frames[self.cur]["pixels"]
        i = y * SIZE + x
        tool = next(k for k, b in self.tool_buttons.items() if b.isChecked())
        color = BLACK if black else self.color
        if tool == "pick":
            if first:
                self.color = pixels[i]
                self._paint_color_btn()
            return
        if tool == "fill":
            if first and pixels[i] != color:
                self._stroke_touch()
                self._flood(pixels, x, y, pixels[i], color)
                self._changed()
            return
        if pixels[i] != color:
            self._stroke_touch()
            pixels[i] = color
            self._changed()

    @staticmethod
    def _flood(pixels, x, y, old, new):
        todo = [(x, y)]
        while todo:
            x, y = todo.pop()
            if 0 <= x < SIZE and 0 <= y < SIZE and pixels[y * SIZE + x] == old:
                pixels[y * SIZE + x] = new
                todo += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]

    def choose_color(self):
        c = QColorDialog.getColor(qcolor(self.color), self, "Drawing colour")
        if c.isValid():
            self.set_color(c.name()[1:].lower())

    def set_color(self, hex_):
        self.color = hex_
        self._paint_color_btn()
        if self.tool_buttons["pick"].isChecked():
            self.tool_buttons["pencil"].setChecked(True)

    def _paint_color_btn(self):
        self.color_btn.setIcon(swatch_icon(self.color, 22))
        self.color_btn.setToolTip(f"#{self.color}")

    def add_frame(self, pixels=None):
        if self.loading:
            return
        if len(self.frames) >= MAX_FRAMES:
            return self.say(f"At most {MAX_FRAMES} frames.", error=True)
        self._snapshot()
        ms = self.frames[self.cur]["ms"] if self.frames else 200
        new = {"pixels": list(pixels) if pixels else [BLACK] * (SIZE * SIZE), "ms": ms or 200}
        self.cur = self.cur + 1 if self.frames else 0
        self.frames.insert(self.cur, new)
        self._changed(frames_too=True)

    def duplicate_frame(self):
        if self.frames:
            self.add_frame(self.frames[self.cur]["pixels"])

    def delete_frame(self):
        if self.loading:
            return
        if len(self.frames) <= 1:
            return self.say("An animation needs at least one frame.", error=True)
        self._snapshot()
        del self.frames[self.cur]
        self.cur = min(self.cur, len(self.frames) - 1)
        self._changed(frames_too=True)

    def clear_frame(self):
        if self.frames and any(c != BLACK for c in self.frames[self.cur]["pixels"]):
            self._snapshot()
            self.frames[self.cur]["pixels"] = [BLACK] * (SIZE * SIZE)
            self._changed()
            self._refresh_palette()

    def move_frame(self, d):
        j = self.cur + d
        if not self.frames or not 0 <= j < len(self.frames):
            return
        self._snapshot()
        self.frames[self.cur], self.frames[j] = self.frames[j], self.frames[self.cur]
        self.cur = j
        self._changed(frames_too=True)

    def step_frame(self, d):
        if self.frames:
            self.frame_list.setCurrentRow((self.cur + d) % len(self.frames))

    def _frame_chosen(self, row):
        if 0 <= row < len(self.frames):
            self.cur = row
            self.delay.blockSignals(True)
            self.delay.setValue(self.frames[row]["ms"])
            self.delay.blockSignals(False)
            self.canvas.update()

    def _delay_changed(self, v):
        if not self.frames:
            return
        ms = int(round(v / 10) * 10)  # GIF delays are in 1/100 s
        if ms != v:
            self.delay.blockSignals(True)
            self.delay.setValue(ms)
            self.delay.blockSignals(False)
        if ms != self.frames[self.cur]["ms"]:
            self._snapshot()
            self.frames[self.cur]["ms"] = ms
            self._changed()

    def undo(self):
        if self.undo_stack and not self.loading:
            self.redo_stack.append((copy.deepcopy(self.frames), self.cur))
            self.frames, self.cur = self.undo_stack.pop()
            self.dirty = True
            self.edits += 1
            self._refresh_all()

    def redo(self):
        if self.redo_stack and not self.loading:
            self.undo_stack.append((copy.deepcopy(self.frames), self.cur))
            self.frames, self.cur = self.redo_stack.pop()
            self.dirty = True
            self.edits += 1
            self._refresh_all()

    # ---- refreshing ---------------------------------------------------------

    def _refresh_all(self):
        self._refresh_title()
        self._refresh_frames()
        self._refresh_palette()
        self.canvas.update()
        self.preview_index = 0
        self._preview_step()

    def _refresh_title(self):
        label = STATE_LABELS.get(self.state, self.state or "")
        theme = f"{self.theme_label if self.theme == self.want_theme else self.theme} · " if self.theme else ""
        self.source.setText(theme + ("your art" if self.custom else "starter art") + (" · unsaved changes" if self.dirty else ""))
        self.setWindowTitle(f"Evo art editor – {label}{' *' if self.dirty else ''}")
        self.starter_btn.setEnabled(self.custom)
        self.undo_btn.setEnabled(bool(self.undo_stack))
        self.redo_btn.setEnabled(bool(self.redo_stack))

    def _frame_text(self, i):
        return f"{i + 1}  ·  {self.frames[i]['ms']} ms"

    def _refresh_frames(self):
        self.frame_list.blockSignals(True)
        self.frame_list.clear()
        for i, f in enumerate(self.frames):
            self.frame_list.addItem(QListWidgetItem(QIcon(frame_pixmap(f["pixels"], 40)), self._frame_text(i)))
        self.frame_list.setCurrentRow(self.cur)
        self.frame_list.blockSignals(False)
        self._frame_chosen(self.cur)

    def _refresh_frame_item(self, i):
        item = self.frame_list.item(i)
        if item:
            item.setIcon(QIcon(frame_pixmap(self.frames[i]["pixels"], 40)))
            item.setText(self._frame_text(i))

    def _refresh_palette(self):
        while self.palette.count():
            w = self.palette.takeAt(0).widget()
            if w:
                w.deleteLater()
        counts = Counter(c for f in self.frames for c in f["pixels"])
        colors = [c for c, _n in counts.most_common(32)]
        for c in ("ffffff", BLACK):
            if c not in colors:
                colors.append(c)
        for k, c in enumerate(colors[:32]):
            b = QToolButton()
            b.setIcon(swatch_icon(c))
            b.setToolTip(f"#{c}")
            b.setAutoRaise(True)
            b.clicked.connect(lambda _c=False, col=c: self.set_color(col))
            self.palette.addWidget(b, k // 6, k % 6)

    def _preview_step(self):
        self.preview_timer.stop()
        if not self.frames:
            self.preview.clear()
            return
        k = self.preview_index % len(self.frames)
        self.preview.setPixmap(frame_pixmap(self.frames[k]["pixels"], 96))
        self.preview_index = k + 1
        if len(self.frames) > 1 and self.isVisible():
            self.preview_timer.start(max(self.frames[k]["ms"], 40))

    def showEvent(self, e):
        super().showEvent(e)
        self._preview_step()
