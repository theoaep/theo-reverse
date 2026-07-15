# THEO REVERSE — After Effects toolkit

A CEP panel for football/TikTok editors: AI assistant, one-click editor tools, the Fast Reverse
beat-tap reel builder, and a text-animation library. Installed via junction at
`%APPDATA%\Adobe\CEP\extensions\com.theo.reverse` → this folder. **Restart AE to reload changes.**

Open in AE: **Window → Extensions → THEO REVERSE**.

## First launch
Type your name once → every launch greets you by name. Click the **"hi, …"** chip to change it.

## Sidebar
### ✦ AI — "Editing Bot by Theo"
- **Setup (⚙ button):** paste one free Google AI Studio key (`AIzaSy…` from aistudio.google.com/apikey)
  and hit **Save**. That's it — no provider toggle, no model dropdown, no thinking level. On Save the
  panel asks your key which models it can run and **locks onto the best flash model your key actually
  has** (shown as "✓ you're in — running …"). The key stays in your localStorage. Auth/access errors
  re-open setup.
- **One model, auto-detected.** Earlier builds let you pick models, but hardcoded names 404'd on some
  keys and the picker just caused confusion — so now it's a single working Gemini model chosen from
  your own key's catalog. If the stored model ever stops existing, the panel silently re-detects a
  working one (and `/models` in chat prints exactly what your key serves).
- **Model badge** reads **Gemini** (hover shows the exact model id).
- **Rate-limit handling:** Gemini's free tier is request-capped (per-minute + ~daily), not credit-metered.
  On a **429** it degrades once to a flash-lite model (its own separate free quota) for that message —
  no cooldown, no lockout. If it's still capped it tells you to wait a minute.
- The bot never names the model/company — asked what it is, it's "an Editing Bot made by Theo."
- Talks like a **real mate** (short, casual, no AI-markdown), fast (thinking off + short answers).
- **Reads your real AE setup** (active comp, selected layers + effects, full plugin list) and
  recommends plugins you actually own.
- **Does edits for you** — "add twitch to this layer", "reverse these", "precomp each", "fade this
  in" → it calls the tool and does it. Actions show a ⚙ line so you see what it did.
- **Actually animates** — it can build motion, not just talk about it:
  - "shake neymarr, small and soft" / "punchy zoom shake" → bakes real shake keyframes
    (position / scale-zoom / rotation, subtle→strong, optional fade-out settle).
  - "grow it in", "slide from the left", "spin it" → keyframes position/scale/rotation/opacity
    with your chosen ease (smooth / linear / hold / punch / overshoot).
  - "make it wiggle", "loop this", "bounce" → drops the right AE expression.
  It reads your selected layer's current transform + the comp center so the values land right.

### ⚡ Kit — one-click tools
- **Fast Reverse** (hero button) → opens the beat-tap reel builder (below).
- **Tap Beatmarker** (hero button) → opens the marker tool: it auto-loads your **current comp's
  audio** into the panel (or drop/click a file), you **play + tap Space/click** on each beat, then
  **Drop N markers** writes composition markers onto your comp's timeline (frame-snapped, optional
  "clear existing first"). Note: AE freezes scripting during its *own* preview, so the panel plays
  the audio itself — tap to the panel's playback, and markers land at `layerStart + panel time`.
- **Quick Reverse** — point at your reverse `.ffx` (Twixtor + zooms baked in), select layers,
  hit apply: the preset lands on each layer **auto-stretched to that layer's length**.
- Tools grid: **Save Frame** (📸 exports the current frame of the active comp to a PNG — a save
  dialog picks where; defaults to the project folder, named `<comp> f<frame>.png`), **Precomp Each**
  (each selected layer → its own comp-sized precomp with all attributes moved in, timeline position
  kept — like AE's Pre-compose "Move all attributes"), Split Layer, Reverse Layer, Freeze Frame, Loop Layer,
  Trim to Work Area, Sequence, Pixel Motion, Motion Blur, Fit to Comp, Center Anchor,
  Adjustment Layer, Solid BG.

### Fast Reverse (inside Kit)
1. Drop your funk track (optional) — live visualizer + bass glow; marking a beat while the song
   plays **shakes the panel**.
2. Tap the pad (or Space) on beats `1–8` then once more for `↻` = 9 taps. Live BPM readout.
3. Pick the **Output** comp (e.g. Comp 1) — beats are added there aligned back-to-back from the
   playhead; or Active comp / a new master comp.
4. **Build Reel** — per beat: `TR_NN_src` (clip) → `TR_NN_twx` (Twixtor) → `TR_NN` (your
   alternating `in.ffx`/`out.ffx`, keyframes stretched to the beat). 9th = repeat of beat 1.
   Viewer tabs are auto-closed after the build; comps are filed into a **"THEO REVERSE beats"**
   project folder.

### ∿ Graph — ease curve editor
Select **2+ keyframes** on a property in AE, then shape the curve on the canvas (drag the two
dots — pull past the box for anticipation/overshoot) and **Apply**: it converts the bezier into
real AE speed/influence eases on those keys (multiple selected keys = each consecutive pair).
Built-in presets (Ramp, Smooth, Soft, Punch, Anticipate, Overshoot) + save your own by name.
**✨ ask ai** jumps to the chat with a pre-written message — describe the vibe ("aggressive ramp",
"smooth soft") and the bot applies the graph itself via its set_graph tool.

### T — Text anims
Set **Anim IN duration** / **Anim OUT duration**, select layer(s), click an anim.
IN anims start at the layer in-point; OUT anims end at the out-point.
IN: Fade, Pop, Slide Up/Down, Blur, Typewriter*, Tracking*. OUT: Fade, Pop, Slide Up/Down, Blur,
Tracking*. (*needs a text layer)

## Releasing + "update available" banner
The panel checks for a newer version on launch and shows a dismissible **Update** banner at the top
if one is live. Clicking **Update** opens the download page; **×** hides it until the *next* version.

**One-time wiring** (in [js/main.js](js/main.js)): set `UPDATE_URL` to a real source. Two options —

1. **GitHub Releases (recommended, zero upkeep).** Push this folder to a GitHub repo, then for each
   release publish a **Release** with tag `vX.Y.Z` and attach the packaged `.zxp`. Point
   `UPDATE_URL` at `https://api.github.com/repos/<user>/theo-reverse/releases/latest`. The panel reads
   the tag as the version, the release body's first line as the note, and links to the release page.
2. **A JSON you host anywhere.** Host [version.json](version.json) (GitHub raw, a gist, your site) and
   point `UPDATE_URL` at it. Shape: `{ "version": "1.1.0", "notes": "…", "url": "<download page>" }`.

**Each release, bump the version in two places (keep them equal):**
- `CSXS/manifest.xml` → `ExtensionBundleVersion` **and** the `<Extension … Version>`
- `js/main.js` → `CURRENT_VERSION`

Then update the remote (publish the GitHub Release, or edit `version.json`). Users on an older
`CURRENT_VERSION` see the banner next launch. (Until `UPDATE_URL` is set to a real repo, the check is
skipped — no failed network calls.)

**Packaging a `.zxp`:** sign with Adobe's `ZXPSignCmd` (needs a self-signed or real cert.p12) →
distribute the `.zxp`; users install with the free **ZXP/UXP Installer** (aescripts) or **Anastasiy's
Extension Manager**. (Dev installs run unpacked via the CEP `PlayerDebugMode` junction; end users get
the signed `.zxp`.)

## Debugging
- Panel DevTools: open panel → browse `http://localhost:8099` in Chrome.
- ExtendScript errors surface as toasts prefixed `ERR:`.
- After editing files here, restart AE.

## Layout
```
CSXS/manifest.xml      CEP manifest (AEFT, CEP 9+)
index.html             shell: rail + views (AI / Kit / Fast / Text)
css/style.css          all styles
js/main.js             nav, intro/greeting, shared TR helpers
js/fastreverse.js      beat tap, visualizer, build
js/toolkit.js          quick reverse + tool grid
js/textanims.js        text anim grid
js/ai.js               Gemini/Claude chat, key setup, model picker, Flash fallback
jsx/engine.jsx         ALL ExtendScript: build engine, tools, text anims, AI context
py/ ranking/           reserved for the face-pipeline phases
```
