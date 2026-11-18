# Evo Bridge on madebypless.dk

Two Projects in wp.madebypless.dk (English, then the Danish translation linked to it in Polylang). The slugs matter: the site draws the LED-pet card art for `evo-bridge` and `evo-bridge-statuslys`. Leave the featured image empty, or the image replaces that art.

Paste each body into the editor's **Code editor** view (⋮ → Code editor), then switch back and drop the images into the Screenshots gallery.

Images to upload (all in this folder):

| File | Use | Alt text (EN) | Alt text (DA) |
|---|---|---|---|
| `evo-blip-states.gif` | first image, under "The idea" | Blip, the pet, going through idle, thinking, working, editing, needs you, done and error on a 16×16 LED display | Blip, kæledyret, går gennem hvile, tænker, arbejder, redigerer, venter på dig, færdig og fejl på et 16×16 LED-display |
| `evo-themes-grid.png` | gallery | All seven themes (rows: Blip, Robot, Status ring, Critter, Sprout, Weather, Terminal) in six states (idle, thinking, working, needs you, done, error) | Alle syv temaer (rækker: Blip, Robot, Statusring, Critter, Spire, Vejr, Terminal) i seks tilstande (hvile, tænker, arbejder, venter på dig, færdig, fejl) |
| `companion-display.png` | gallery | The companion app's Display tab: brightness, scrolling text, the theme picker and animation previews | Companion-appens Display-fane: lysstyrke, rulletekst, temavælgeren og forhåndsvisning af animationerne |
| `companion-art-editor.png` | gallery | The art editor: a 16×16 canvas with the Critter's "done" frame, the frame list and a live preview | Pixel-editoren: et 16×16-lærred med Critters "færdig"-billede, billedlisten og en levende forhåndsvisning |

Optional: the per-theme GIFs (`evo-theme-<theme>.gif`) if you'd rather show each theme animated.

---

## English

- **Title:** Evo Bridge
- **Slug:** `evo-bridge`
- **Excerpt:** A tiny pixel pet on a Divoom Timebox Evo that shows what Claude Code is up to: thinking, working, waiting for you, done or stuck.
- **Project details:** Client `Own product` · Year `2026` · Role `Design & development` · URL `https://github.com/pless84/evo-bridge`
- **Project tags:** Claude Code, Node.js, Python, Qt, Bluetooth
- **Order:** 12 (after the games; change to taste)

```html
<!-- wp:heading -->
<h2 class="wp-block-heading">The idea</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>When Claude Code works on something for a few minutes, I switch to another window and forget to check back. Evo Bridge puts a small pet on the 16×16 LED display of a Divoom Timebox Evo next to the screen. It changes colour and animation with what Claude is doing, so a glance across the desk tells me whether it's still working, done, or waiting for an answer.</p>
<!-- /wp:paragraph -->

<!-- wp:heading -->
<h2 class="wp-block-heading">What it does</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list"><!-- wp:list-item -->
<li>Claude Code hooks report each session's state: idle, thinking, working (with its own animation for running a command, editing and reading files), needs you, done and error</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Several sessions at once: the display shows the one that needs you most, and falls back to the Evo's own clock after a while with nothing going on</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Seven art themes: Blip (the original pet), Robot, Status ring, Critter, Sprout, Weather and Terminal</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>A built-in pixel-art editor with onion skin, a live preview and "Try on Evo", so you can redraw any animation and see it on the display right away</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>A tray app for KDE and other Linux desktops: what the Evo shows, brightness, scrolling text, the theme picker, device and timing settings, and the bridge service</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Talks to the Evo over the laptop's own Bluetooth, or through an ESP32 on Wi-Fi so any computer on the network can drive it</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:heading -->
<h2 class="wp-block-heading">Screenshots</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Every theme in six of its states, the companion app, and the art editor.</p>
<!-- /wp:paragraph -->

<!-- wp:heading -->
<h2 class="wp-block-heading">Built with</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list"><!-- wp:list-item -->
<li>Node.js for the bridge, which speaks the Evo's Bluetooth protocol, and for the art pipeline</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Python and Qt (PySide6) for the tray app and the art editor</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>C++ on an ESP32 for the Wi-Fi version</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:heading -->
<h2 class="wp-block-heading">Status</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Working on my desk every day, and open source. It needs a classic Timebox Evo (the one with a Bluetooth serial port). The source code and setup guide are <a href="https://github.com/pless84/evo-bridge">on GitHub</a>.</p>
<!-- /wp:paragraph -->
```

---

## Dansk

- **Titel:** Evo Bridge
- **Slug:** `evo-bridge-statuslys`
- **Uddrag:** Et lille pixelkæledyr på en Divoom Timebox Evo, der viser, hvad Claude Code laver: tænker, arbejder, venter på dig, er færdig eller sidder fast.
- **Projektdetaljer:** Kunde `Eget produkt` · År `2026` · Rolle `Design og udvikling` · URL `https://github.com/pless84/evo-bridge`
- **Projekttags:** som den engelske (de danske projekter har ingen i dag, så det er valgfrit)
- **Rækkefølge:** 12

```html
<!-- wp:heading -->
<h2 class="wp-block-heading">Idéen</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Når Claude Code arbejder på noget i et par minutter, skifter jeg vindue og glemmer at kigge tilbage. Evo Bridge sætter et lille kæledyr på 16×16 LED-displayet på en Divoom Timebox Evo ved siden af skærmen. Det skifter farve og animation efter, hvad Claude laver, så et blik hen over skrivebordet fortæller, om den stadig arbejder, er færdig eller venter på et svar.</p>
<!-- /wp:paragraph -->

<!-- wp:heading -->
<h2 class="wp-block-heading">Det kan den</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list"><!-- wp:list-item -->
<li>Claude Code-hooks melder hver sessions tilstand: hvile, tænker, arbejder (med sin egen animation for kommandoer, redigering og læsning af filer), venter på dig, færdig og fejl</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Flere sessioner på én gang: displayet viser den, der mest har brug for dig, og skifter til Evo'ens eget ur, når der ikke sker noget</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Syv temaer: Blip (det oprindelige kæledyr), Robot, Statusring, Critter, Spire, Vejr og Terminal</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>En indbygget pixel-editor med løgskind, levende forhåndsvisning og "Prøv på Evo", så du kan tegne enhver animation om og se den på displayet med det samme</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>En bakke-app til KDE og andre Linux-skriveborde: hvad Evo'en viser, lysstyrke, rulletekst, temavælger, enheds- og tidsindstillinger og bridge-tjenesten</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Taler med Evo'en over bærbarens egen Bluetooth eller gennem en ESP32 på Wi-Fi, så enhver computer på netværket kan styre den</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:heading -->
<h2 class="wp-block-heading">Skærmbilleder</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Alle temaer i seks af deres tilstande, companion-appen og pixel-editoren.</p>
<!-- /wp:paragraph -->

<!-- wp:heading -->
<h2 class="wp-block-heading">Bygget med</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list"><!-- wp:list-item -->
<li>Node.js til bridgen, der taler Evo'ens Bluetooth-protokol, og til pixelgrafikken</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>Python og Qt (PySide6) til bakke-appen og pixel-editoren</li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li>C++ på en ESP32 til Wi-Fi-udgaven</li>
<!-- /wp:list-item --></ul>
<!-- /wp:list -->

<!-- wp:heading -->
<h2 class="wp-block-heading">Status</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Kører på mit skrivebord hver dag og er open source. Den kræver en klassisk Timebox Evo (den med en Bluetooth-serielport). Kildekoden og opsætningsguiden ligger <a href="https://github.com/pless84/evo-bridge">på GitHub</a>.</p>
<!-- /wp:paragraph -->
```
