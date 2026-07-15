/**********************************************************************************************
 * THEO REVERSE — ExtendScript engine (After Effects host side)
 *
 * Loaded once by the CEP panel (ScriptPath in manifest). The panel calls:
 *    theoReverse_ping()               -> "AE <ver> · ready"
 *    theoReverse_build(configString)  -> "OK:<msg>" | "ERR:<msg>"
 *
 * Phase 1: builds, per beat, a 3-level nested precomp stack —
 *    TR_NN_src  (raw clip + head-centering keys)   [innermost, source time]
 *      -> TR_NN_twx  (Twixtor)                      [retime]
 *        -> TR_NN     (reverse in/out + zoom)       [placed in master]
 * then applies the alternating .ffx presets and stretches their keyframes to each beat.
 *
 * NOTE: ExtendScript is ES3 — no JSON, no Array.map/forEach. Plain loops only.
 **********************************************************************************************/

// ---------------------------------------------------------------------------
// config: "w=1080;h=1920;fps=30;beats=0.5,0.4,...;twixtor=..;rin=..;rout=..;zin=..;zout=..;zoom=alt;applyTwixtor=1"
// ---------------------------------------------------------------------------
function parseConfig(s) {
    var cfg = {};
    var pairs = String(s).split(";");
    for (var i = 0; i < pairs.length; i++) {
        var p = pairs[i];
        var idx = p.indexOf("=");
        if (idx < 0) continue;
        cfg[p.substring(0, idx)] = p.substring(idx + 1);
    }
    return cfg;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
function pad(n) { return (n < 10 ? "0" : "") + n; }

// compact number/array formatter for the AI context readout
function trFmt(v) {
    function r(n) { return Math.round(n * 10) / 10; }
    if (v instanceof Array) {
        var a = [];
        for (var i = 0; i < v.length && i < 3; i++) a.push(r(v[i]));
        return "[" + a.join(",") + "]";
    }
    return String(r(v));
}

function baseName(p) {
    if (!p) return "";
    var s = String(p).replace(/\\/g, "/");
    var i = s.lastIndexOf("/");
    return i >= 0 ? s.substring(i + 1) : s;
}

function fileExists(p) { return p ? (new File(p)).exists : false; }

function beatColor(i) {
    var pal = [[0.20, 0.22, 0.28], [0.28, 0.20, 0.22], [0.20, 0.27, 0.22], [0.27, 0.24, 0.20]];
    return pal[i % pal.length];
}

function deselectAll(comp) {
    for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
}

function hasTwixtor(layer) {
    var fx = layer.property("ADBE Effect Parade");
    if (!fx) return false;
    for (var i = 1; i <= fx.numProperties; i++) {
        var e = fx.property(i);
        if (/twixtor/i.test((e.name || "") + " " + (e.matchName || ""))) return true;
    }
    return false;
}

// is this comp one WE generated? (don't offer it as an output target)
function isGeneratedComp(c) {
    return /^TR_/.test(c.name) || c.name.indexOf("THEO REVERSE") === 0;
}

function findCompById(id) {
    if (isNaN(id)) return null;
    var items = app.project.items;
    for (var i = 1; i <= items.length; i++) {
        var it = items[i];
        if (it instanceof CompItem && it.id === id) return it;
    }
    return null;
}

// ---------------------------------------------------------------------------
// viewer-tab + project-panel hygiene: every comp we open to apply a preset
// leaves a viewer tab behind — close them all after the build.
// ---------------------------------------------------------------------------
var $trViewers = [];   // comps whose viewers we opened during this build
var $trMaster = null;  // comp to leave focused when we're done

function trackViewer(comp) {
    for (var i = 0; i < $trViewers.length; i++) if ($trViewers[i] === comp) return;
    $trViewers.push(comp);
}

function closeGeneratedViewers() {
    var closeId = 0;
    try { closeId = app.findMenuCommandId("Close"); } catch (e) {}
    if (!closeId) closeId = 4; // File > Close (Ctrl+W) — closes the active viewer tab
    for (var i = 0; i < $trViewers.length; i++) {
        try {
            $trViewers[i].openInViewer();
            app.executeCommand(closeId);
        } catch (e) {}
    }
    $trViewers = [];
    try { if ($trMaster) $trMaster.openInViewer(); } catch (e) {}
}

// project-panel folder for everything we generate
function getBeatsFolder() {
    var items = app.project.items;
    for (var i = 1; i <= items.length; i++) {
        var it = items[i];
        if (it instanceof FolderItem && it.name === "THEO REVERSE beats") return it;
    }
    return items.addFolder("THEO REVERSE beats");
}

// index-path of a leaf property, unique within its layer (for touched-prop detection)
function propPath(prop) {
    var parts = [], p = prop;
    while (p && p.parentProperty) { parts.unshift(String(p.propertyIndex)); p = p.parentProperty; }
    return parts.join(".");
}

// walk every leaf Property under a group/layer, calling fn(prop)
function walkProps(root, fn) {
    var n;
    try { n = root.numProperties; } catch (e) { return; }
    for (var k = 1; k <= n; k++) {
        var p;
        try { p = root.property(k); } catch (e2) { continue; }
        if (!p) continue;
        if (p.propertyType === PropertyType.PROPERTY) {
            fn(p);
        } else {
            walkProps(p, fn);
        }
    }
}

// snapshot { propPath: numKeys } for every animated leaf on the layer
function collectAnimatedCounts(layer) {
    var map = {};
    walkProps(layer, function (prop) {
        var nk = 0;
        try { nk = prop.numKeys; } catch (e) {}
        if (nk > 0) map[propPath(prop)] = nk;
    });
    return map;
}

// ---------------------------------------------------------------------------
// keyframe time-stretch (port + generalization of ReversePulse.jsx)
// stretch a set of props together so their combined key span fills [0, dur]
// ---------------------------------------------------------------------------
function stretchProps(props, dur, t0) {
    if (t0 === undefined) t0 = 0;
    var gmin = Infinity, gmax = -Infinity, i, j;
    for (i = 0; i < props.length; i++) {
        var pr = props[i];
        for (j = 1; j <= pr.numKeys; j++) {
            var t = pr.keyTime(j);
            if (t < gmin) gmin = t;
            if (t > gmax) gmax = t;
        }
    }
    if (!(gmax > gmin)) return;           // 0 or 1 key across the set — nothing to stretch
    var factor = dur / (gmax - gmin);
    for (i = 0; i < props.length; i++) rescaleOneProp(props[i], gmin, factor, t0);
}

// clear-and-recreate one property's keys at scaled times, re-applying fidelity
function rescaleOneProp(prop, offset, factor, t0) {
    if (t0 === undefined) t0 = 0;
    var n = prop.numKeys;
    if (n < 1) return;
    var keys = [], i;
    for (i = 1; i <= n; i++) {
        var k = { t: t0 + (prop.keyTime(i) - offset) * factor, v: prop.keyValue(i) };
        try { k.inInterp = prop.keyInInterpolationType(i); } catch (e) {}
        try { k.outInterp = prop.keyOutInterpolationType(i); } catch (e) {}
        try { k.inEase = prop.keyInTemporalEase(i); } catch (e) {}
        try { k.outEase = prop.keyOutTemporalEase(i); } catch (e) {}
        if (prop.isSpatial) {
            try { k.inTan = prop.keyInSpatialTangent(i); } catch (e) {}
            try { k.outTan = prop.keyOutSpatialTangent(i); } catch (e) {}
            try { k.roving = prop.keyRoving(i); } catch (e) {}
        }
        try { k.contin = prop.keyTemporalContinuous(i); } catch (e) {}
        try { k.autob = prop.keyTemporalAutoBezier(i); } catch (e) {}
        keys.push(k);
    }
    for (i = n; i >= 1; i--) prop.removeKey(i);
    for (i = 0; i < keys.length; i++) prop.setValueAtTime(keys[i].t, keys[i].v);
    for (i = 0; i < keys.length; i++) {
        var idx = i + 1, kk = keys[i];
        try { if (kk.inInterp !== undefined) prop.setInterpolationTypeAtKey(idx, kk.inInterp, kk.outInterp); } catch (e) {}
        if (prop.isSpatial) {
            try { if (kk.inTan && kk.outTan) prop.setSpatialTangentsAtKey(idx, kk.inTan, kk.outTan); } catch (e) {}
            try { if (kk.roving !== undefined && idx > 1 && idx < keys.length) prop.setRovingAtKey(idx, kk.roving); } catch (e) {}
        }
        try { if (kk.contin !== undefined) prop.setTemporalContinuousAtKey(idx, kk.contin); } catch (e) {}
        try { if (kk.autob !== undefined) prop.setTemporalAutoBezierAtKey(idx, kk.autob); } catch (e) {}
        try {
            if (kk.inEase && kk.outEase &&
                (kk.inInterp === KeyframeInterpolationType.BEZIER || kk.outInterp === KeyframeInterpolationType.BEZIER))
                prop.setTemporalEaseAtKey(idx, kk.inEase, kk.outEase);
        } catch (e) {}
    }
}

// ---------------------------------------------------------------------------
// apply a .ffx to a layer, then stretch only the keyframes IT added, to [0,dur]
// ---------------------------------------------------------------------------
function applyPresetAndStretch(comp, layer, path, dur, warnings, label, t0) {
    if (t0 === undefined) t0 = 0;
    if (!fileExists(path)) { warnings.push(label + ": missing " + baseName(path)); return false; }
    var before = collectAnimatedCounts(layer);
    try { comp.openInViewer(); trackViewer(comp); } catch (e) {}
    try { comp.time = t0; } catch (e) {}   // presets drop keys at the CTI — pin it
    deselectAll(comp);
    layer.selected = true;
    try { layer.applyPreset(new File(path)); }
    catch (e) { warnings.push(label + ": apply failed (" + e.toString() + ")"); return false; }

    var touched = [];
    walkProps(layer, function (prop) {
        var nk = 0; try { nk = prop.numKeys; } catch (e) {}
        if (nk > 0) {
            var pth = propPath(prop);
            if (before[pth] === undefined || before[pth] < nk) touched.push(prop);
        }
    });
    if (touched.length) stretchProps(touched, dur, t0);
    return true;
}

// ---------------------------------------------------------------------------
// build one beat's nested precomp stack, return the outer (placed) comp
// ---------------------------------------------------------------------------
function buildBeat(i, dur, w, h, fps, par, folder, cfg, applyTwix, warnings) {
    var idx = i + 1;
    var proj = app.project;

    // Level A — inner raw clip (placeholder solid) + head-centering keys (Phase 4)
    var compA = proj.items.addComp("TR_" + pad(idx) + "_src", w, h, par, dur, fps);
    compA.parentFolder = folder;
    var clip = compA.layers.addSolid(beatColor(i), "CLIP " + idx, w, h, par, dur);
    compA.frameBlending = true;
    try { clip.frameBlendingType = FrameBlendingType.PIXEL_MOTION; } catch (e) {}

    // Level B — Twixtor retime
    var compB = proj.items.addComp("TR_" + pad(idx) + "_twx", w, h, par, dur, fps);
    compB.parentFolder = folder;
    var layB = compB.layers.add(compA);
    compB.frameBlending = true;
    try { layB.frameBlendingType = FrameBlendingType.PIXEL_MOTION; } catch (e) {}
    if (applyTwix) {
        var okT = applyPresetAndStretch(compB, layB, cfg.twixtor, dur, warnings, "Twixtor");
        if (okT && !hasTwixtor(layB)) warnings.push("Twixtor effect not found after preset — is Twixtor installed?");
    }

    // Level C — reverse in/out + zoom (this comp goes in the master)
    var compC = proj.items.addComp("TR_" + pad(idx), w, h, par, dur, fps);
    compC.parentFolder = folder;
    var layC = compC.layers.add(compB);
    compC.frameBlending = true;
    try { layC.frameBlendingType = FrameBlendingType.PIXEL_MOTION; } catch (e) {}

    // reverse (zoom is already baked into these presets): even -> in.ffx, odd -> out.ffx
    var revPath = (i % 2 === 0) ? cfg.rin : cfg.rout;
    applyPresetAndStretch(compC, layC, revPath, dur, warnings, "Reverse " + ((i % 2 === 0) ? "in" : "out"));

    return compC;
}

// ---------------------------------------------------------------------------
// build the whole reel
// ---------------------------------------------------------------------------
function buildReel(cfg) {
    var w = parseInt(cfg.w, 10) || 1080;
    var h = parseInt(cfg.h, 10) || 1920;
    var fps = parseFloat(cfg.fps) || 30;

    var beats = [], raw = String(cfg.beats || "").split(",");
    for (var i = 0; i < raw.length; i++) {
        var d = parseFloat(raw[i]);
        if (!isNaN(d) && d > 0) beats.push(d);
    }
    if (beats.length < 1) throw new Error("No beat lengths given.");

    var applyTwix = cfg.applyTwixtor === "1";
    var repeatDur = beats[0];
    var total = repeatDur;
    for (i = 0; i < beats.length; i++) total += beats[i];

    // Resolve the OUTPUT comp. cfg.target is a comp id chosen in the panel, or "auto" (active comp),
    // or "new" (make our own). The 8 beats are added into it, aligned back-to-back in order.
    var master = null, par = 1, startAt = 0, intoExisting = false;
    var target = cfg.target || "auto";

    if (target !== "auto" && target !== "new") {
        master = findCompById(parseInt(target, 10));
        if (!master) throw new Error("Output comp not found — hit refresh in the panel and pick again.");
        intoExisting = true;
    } else if (target === "auto") {
        var active = app.project.activeItem;
        if (active && active instanceof CompItem && !isGeneratedComp(active)) {
            master = active; intoExisting = true;
        }
    }

    if (intoExisting && master) {
        w = master.width; h = master.height; fps = master.frameRate; par = master.pixelAspect;
        startAt = master.time;                  // place the reel at the current playhead
    } else {
        master = app.project.items.addComp("THEO REVERSE — Master", w, h, par, total, fps);
        intoExisting = false;
        startAt = 0;
    }

    $trViewers = [];
    $trMaster = master;
    var folder = getBeatsFolder();

    var warnings = [], cursor = startAt, firstBeatComp = null;
    for (i = 0; i < beats.length; i++) {
        var beatComp = buildBeat(i, beats[i], w, h, fps, par, folder, cfg, applyTwix, warnings);
        if (i === 0) firstBeatComp = beatComp;
        var lyr = master.layers.add(beatComp);
        lyr.startTime = cursor;
        cursor += beats[i];
    }
    // 9th = repeat of beat 1, then end
    if (firstBeatComp) {
        var rl = master.layers.add(firstBeatComp);
        rl.startTime = cursor;
        cursor += repeatDur;
    }
    if (intoExisting) {
        if (cursor > master.duration) master.duration = cursor;   // grow to fit, never shrink
    } else {
        master.duration = cursor;
        master.workAreaStart = 0;
        master.workAreaDuration = cursor;
    }
    try { master.openInViewer(); } catch (e) {}

    var where = intoExisting ? ("into “" + master.name + "”") : "in a new master comp";
    var msg = beats.length + " beats + repeat " + where + " (" + (cursor - startAt).toFixed(2) + "s).";
    if (warnings.length) {
        // de-dup warnings
        var seen = {}, uniq = [];
        for (i = 0; i < warnings.length; i++) if (!seen[warnings[i]]) { seen[warnings[i]] = 1; uniq.push(warnings[i]); }
        msg += "  ⚠ " + uniq.join("  ⚠ ");
    }
    return msg;
}

// ---------------------------------------------------------------------------
// TOOLKIT — one-click editor tools
// ---------------------------------------------------------------------------
function menuCmd(name) {
    var id = 0;
    try { id = app.findMenuCommandId(name); } catch (e) {}
    if (!id) throw new Error('Menu command "' + name + '" not found');
    app.executeCommand(id);
}

function activeCompOrErr() {
    var comp = app.project.activeItem;
    if (!(comp && comp instanceof CompItem)) return null;
    return comp;
}

// Precomp Each — every selected layer gets its own precomp, named after it
function theoReverse_precompEach() {
    try {
        var comp = activeCompOrErr();
        if (!comp) return "ERR:Open a comp first.";
        var sel = comp.selectedLayers;
        if (!sel.length) return "ERR:Select layers to precomp.";
        app.beginUndoGroup("TR Precomp Each");
        var idxs = [], i;
        for (i = 0; i < sel.length; i++) idxs.push(sel[i].index);
        idxs.sort(function (a, b) { return b - a; });  // descending: single-layer precompose keeps indices stable
        var n = 0;
        for (i = 0; i < idxs.length; i++) {
            var ly = comp.layer(idxs[i]);
            var inP = ly.inPoint, outP = ly.outPoint;   // remember this layer's trim on the timeline
            try {
                // move all attributes into the new comp-sized precomp...
                var pc = comp.layers.precompose([idxs[i]], ly.name + " Comp 1", true);
                // ...but precompose stretches the new precomp layer to the FULL comp length, so trim it
                // back to the original in/out — each precomp keeps its own length + position.
                var np = comp.layer(idxs[i]);
                if (!np || np.source !== pc) {
                    for (var q = 1; q <= comp.numLayers; q++) { if (comp.layer(q).source === pc) { np = comp.layer(q); break; } }
                }
                if (np) { try { np.inPoint = inP; np.outPoint = outP; } catch (eT) {} }
                n++;
            } catch (e) {}
        }
        app.endUndoGroup();
        return "OK:Precomposed " + n + " layer" + (n === 1 ? "" : "s") + " separately (length kept).";
    } catch (e2) { try { app.endUndoGroup(); } catch (e3) {} return "ERR:" + e2.toString(); }
}

// Pick a preset file via a native open dialog — returns "OK:<path>" (or "OK:" if cancelled)
function theoReverse_pickFile() {
    try {
        var f = File.openDialog("Choose a preset (.ffx)", "After Effects preset:*.ffx", false);
        if (!f) return "OK:";              // cancelled
        return "OK:" + f.fsName;
    } catch (e) { return "ERR:" + e.toString(); }
}

// Apply an animation preset (.ffx) to each selected layer (no time-stretch)
function theoReverse_applyPreset(path) {
    try {
        var comp = activeCompOrErr();
        if (!comp) return "ERR:Open a comp first.";
        if (!fileExists(path)) return "ERR:Preset file not found.";
        var sel = comp.selectedLayers;
        if (!sel.length) return "ERR:Select layer(s) first.";
        var f = new File(path);
        app.beginUndoGroup("TR Apply Preset");
        var n = 0, i;
        for (i = 0; i < sel.length; i++) { try { sel[i].applyPreset(f); n++; } catch (e) {} }
        app.endUndoGroup();
        return "OK:Applied to " + n + " layer" + (n === 1 ? "" : "s") + ".";
    } catch (e2) { try { app.endUndoGroup(); } catch (e3) {} return "ERR:" + e2.toString(); }
}

// Save Frame — export the current frame of the active comp as a PNG (a save dialog picks where)
function theoReverse_saveFrame() {
    try {
        var comp = activeCompOrErr();
        if (!comp) return "ERR:Open a comp first.";
        if (typeof comp.saveFrameToPng !== "function") return "ERR:This AE version can't save a frame via script.";
        var frame = Math.round(comp.time / comp.frameDuration);
        var safe = String(comp.name).replace(/[\\\/:*?"<>|]/g, "_");
        var base = safe + " f" + frame + ".png";
        var dir = null;
        try { if (app.project.file) dir = app.project.file.parent; } catch (eD) {}
        if (!dir) dir = Folder.desktop;
        var def = new File(dir.fsName + "/" + base);
        var out = def.saveDlg("Save frame as PNG", "PNG:*.png");
        if (!out) return "OK:Save cancelled.";
        if (!/\.png$/i.test(out.fsName)) out = new File(out.fsName + ".png");
        comp.saveFrameToPng(comp.time, out);
        return "OK:Saved frame " + frame + " -> " + out.fsName;
    } catch (e) { return "ERR:" + e.toString(); }
}

// Quick Reverse — apply YOUR reverse .ffx to each selected layer, auto-stretched to its length
function theoReverse_quickReverse(path) {
    try {
        var comp = activeCompOrErr();
        if (!comp) return "ERR:Open a comp first.";
        if (!fileExists(path)) return "ERR:Preset not found: " + path;
        var sel = comp.selectedLayers;
        if (!sel.length) return "ERR:Select at least one layer.";
        app.beginUndoGroup("TR Quick Reverse");
        var layers = [], i;
        for (i = 0; i < sel.length; i++) layers.push(sel[i]);
        var warnings = [], done = 0;
        for (i = 0; i < layers.length; i++) {
            var ly = layers[i];
            var dur = ly.outPoint - ly.inPoint;
            if (dur <= 0) continue;
            if (applyPresetAndStretch(comp, ly, path, dur, warnings, "Quick Reverse", ly.inPoint)) done++;
        }
        for (i = 0; i < layers.length; i++) { try { layers[i].selected = true; } catch (eS) {} }
        app.endUndoGroup();
        $trViewers = [];  // we only touched the user's own comp — never close it
        var msg = "Reversed " + done + " layer" + (done === 1 ? "" : "s") + " (auto-stretched).";
        if (warnings.length) msg += "  ⚠ " + warnings.join("  ⚠ ");
        return "OK:" + msg;
    } catch (e) { try { app.endUndoGroup(); } catch (e2) {} $trViewers = []; return "ERR:" + e.toString(); }
}

// grab-bag of one-click tools
function theoReverse_tool(name) {
    try {
        var comp = activeCompOrErr();
        if (!comp) return "ERR:Open a comp first.";
        var sel = comp.selectedLayers, i, ly;
        var needSel = { splitLayer: 1, reverseLayer: 1, freeze: 1, loop: 1, trimWA: 1, sequence: 1, pixelMotion: 1, motionBlur: 1, fitComp: 1, centerAnchor: 1 };
        if (needSel[name] && !sel.length) return "ERR:Select layer(s) first.";
        app.beginUndoGroup("TR " + name);
        var msg = "Done.";

        if (name === "splitLayer") { menuCmd("Split Layer"); msg = "Split at playhead."; }
        else if (name === "reverseLayer") { menuCmd("Time-Reverse Layer"); msg = "Layer time-reversed."; }
        else if (name === "freeze") { menuCmd("Freeze Frame"); msg = "Frozen at playhead."; }
        else if (name === "loop") {
            var n = 0;
            for (i = 0; i < sel.length; i++) {
                ly = sel[i];
                try {
                    if (ly.canSetTimeRemapEnabled) {
                        ly.timeRemapEnabled = true;
                        ly.property("ADBE Time Remapping").expression = "loopOut()";
                        ly.outPoint = comp.duration;
                        n++;
                    }
                } catch (eL) {}
            }
            msg = "Looping " + n + " layer(s) to comp end.";
        }
        else if (name === "trimWA") {
            for (i = 0; i < sel.length; i++) {
                sel[i].inPoint = comp.workAreaStart;
                sel[i].outPoint = comp.workAreaStart + comp.workAreaDuration;
            }
            msg = "Trimmed to work area.";
        }
        else if (name === "sequence") {
            var arr = [];
            for (i = 0; i < sel.length; i++) arr.push(sel[i]);
            arr.sort(function (a, b) { return a.index - b.index; });
            var cursor = arr[0].inPoint;
            for (i = 0; i < arr.length; i++) { ly = arr[i]; ly.startTime += cursor - ly.inPoint; cursor = ly.outPoint; }
            msg = "Sequenced " + arr.length + " layers back-to-back.";
        }
        else if (name === "pixelMotion") {
            comp.frameBlending = true;
            for (i = 0; i < sel.length; i++) { try { sel[i].frameBlendingType = FrameBlendingType.PIXEL_MOTION; } catch (eP) {} }
            msg = "Pixel Motion on (comp + layers).";
        }
        else if (name === "motionBlur") {
            comp.motionBlur = true;
            for (i = 0; i < sel.length; i++) { try { sel[i].motionBlur = true; } catch (eM) {} }
            msg = "Motion blur on (comp + layers).";
        }
        else if (name === "fitComp") {
            for (i = 0; i < sel.length; i++) {
                ly = sel[i];
                try {
                    var rct = ly.sourceRectAtTime(comp.time, false);
                    var tr = ly.property("ADBE Transform Group");
                    var sc = Math.max(comp.width / rct.width, comp.height / rct.height) * 100;
                    tr.property("ADBE Anchor Point").setValue([rct.left + rct.width / 2, rct.top + rct.height / 2]);
                    tr.property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
                    var oldS = tr.property("ADBE Scale").value;
                    tr.property("ADBE Scale").setValue(oldS.length === 3 ? [sc, sc, oldS[2]] : [sc, sc]);
                } catch (eF) {}
            }
            msg = "Fit to comp (fill + centered).";
        }
        else if (name === "centerAnchor") {
            for (i = 0; i < sel.length; i++) {
                ly = sel[i];
                try {
                    var r2 = ly.sourceRectAtTime(comp.time, false);
                    var tg = ly.property("ADBE Transform Group");
                    var ap = tg.property("ADBE Anchor Point"), ps = tg.property("ADBE Position"), scp = tg.property("ADBE Scale");
                    var oldA = ap.value, pos = ps.value, s = scp.value;
                    var nA = [r2.left + r2.width / 2, r2.top + r2.height / 2];
                    var np = [pos[0] + (nA[0] - oldA[0]) * s[0] / 100, pos[1] + (nA[1] - oldA[1]) * s[1] / 100];
                    if (pos.length === 3) np.push(pos[2]);
                    ap.setValue(oldA.length === 3 ? [nA[0], nA[1], oldA[2]] : nA);
                    ps.setValue(np);
                } catch (eC) {}
            }
            msg = "Anchor centered (position kept).";
        }
        else if (name === "adjust") {
            var ad = comp.layers.addSolid([1, 1, 1], "Adjustment", comp.width, comp.height, comp.pixelAspect, comp.duration);
            ad.adjustmentLayer = true;
            msg = "Adjustment layer added on top.";
        }
        else if (name === "solidBG") {
            var so = comp.layers.addSolid([0, 0, 0], "BG", comp.width, comp.height, comp.pixelAspect, comp.duration);
            so.moveToEnd();
            msg = "Solid BG added at bottom.";
        }
        else { app.endUndoGroup(); return "ERR:Unknown tool: " + name; }

        app.endUndoGroup();
        return "OK:" + msg;
    } catch (e) { try { app.endUndoGroup(); } catch (e9) {} return "ERR:" + e.toString(); }
}

// find an installed effect by (fuzzy) display name -> {matchName, displayName}
function findEffectMatch(name) {
    if (!name) return null;
    var q = String(name).toLowerCase().replace(/^\s+|\s+$/g, "");
    var eff = app.effects, exact = null, starts = null, contains = null;
    for (var i = 0; i < eff.length; i++) {
        var dn = eff[i].displayName || "";
        var dl = dn.toLowerCase();
        if (dl === q) { exact = eff[i]; break; }
        if (!starts && dl.indexOf(q) === 0) starts = eff[i];
        if (!contains && dl.indexOf(q) >= 0) contains = eff[i];
    }
    var e = exact || starts || contains;
    return e ? { matchName: e.matchName, displayName: e.displayName } : null;
}

// AI action: add a named effect/plugin to a layer (named, or the selected one)
function theoReverse_addEffect(effectName, layerName) {
    try {
        var comp = activeCompOrErr();
        if (!comp) return "ERR:no comp open";
        var targets = [], i;
        var ln = layerName ? String(layerName).replace(/^\s+|\s+$/g, "") : "";
        if (ln !== "") {
            var lq = ln.toLowerCase();
            for (i = 1; i <= comp.numLayers; i++)
                if (comp.layer(i).name.toLowerCase().indexOf(lq) >= 0) targets.push(comp.layer(i));
            if (!targets.length) return "ERR:no layer named like \"" + ln + "\"";
        } else {
            var sel = comp.selectedLayers;
            if (!sel.length) return "ERR:no layer selected";
            for (i = 0; i < sel.length; i++) targets.push(sel[i]);
        }
        var m = findEffectMatch(effectName);
        if (!m) return "ERR:\"" + effectName + "\" isn't installed";
        app.beginUndoGroup("TR AI Add Effect");
        var n = 0;
        for (i = 0; i < targets.length; i++) {
            try {
                var fxp = targets[i].property("ADBE Effect Parade");
                if (fxp.canAddProperty(m.matchName)) { fxp.addProperty(m.matchName); n++; }
            } catch (e) {}
        }
        app.endUndoGroup();
        if (!n) return "ERR:couldn't add " + m.displayName + " (wrong layer type?)";
        return "OK:added " + m.displayName + " to " + n + " layer" + (n === 1 ? "" : "s");
    } catch (e) { try { app.endUndoGroup(); } catch (e2) {} return "ERR:" + e.toString(); }
}

// ---------------------------------------------------------------------------
// ANIMATION ENGINE — shakes, keyframe animation, expressions (AI-driven)
// resolve a friendly property name -> the actual AE Property on a layer
// ---------------------------------------------------------------------------
function trResolveProp(ly, name) {
    if (!name) name = "position";
    var q = String(name).toLowerCase().replace(/^\s+|\s+$/g, "");
    var tg = null; try { tg = ly.property("ADBE Transform Group"); } catch (e0) {}
    var map = {
        "position": "ADBE Position", "pos": "ADBE Position", "move": "ADBE Position",
        "scale": "ADBE Scale", "zoom": "ADBE Scale", "size": "ADBE Scale",
        "rotation": "ADBE Rotate Z", "rotate": "ADBE Rotate Z", "rot": "ADBE Rotate Z",
        "spin": "ADBE Rotate Z", "z rotation": "ADBE Rotate Z",
        "opacity": "ADBE Opacity", "opa": "ADBE Opacity", "alpha": "ADBE Opacity", "fade": "ADBE Opacity",
        "anchor": "ADBE Anchor Point", "anchor point": "ADBE Anchor Point", "anchorpoint": "ADBE Anchor Point",
        "x rotation": "ADBE Rotate X", "y rotation": "ADBE Rotate Y", "orientation": "ADBE Orientation"
    };
    if (tg && map[q]) { try { var pp = tg.property(map[q]); if (pp) return pp; } catch (e1) {} }
    // effect-parameter fallback: first animatable leaf whose name contains the query
    var fx = null; try { fx = ly.property("ADBE Effect Parade"); } catch (e2) {}
    if (fx) {
        var hit = null;
        walkProps(fx, function (p) {
            if (hit) return;
            try { if ((p.name || "").toLowerCase().indexOf(q) >= 0 && p.canVaryOverTime) hit = p; } catch (e) {}
        });
        if (hit) return hit;
    }
    // last resort: transform position
    if (tg) { try { return tg.property("ADBE Position"); } catch (e3) {} }
    return null;
}

function trDim(prop) {
    try { var v = prop.value; return (v instanceof Array) ? v.length : 1; } catch (e) { return 1; }
}

// parse "960,540" or "120" into a scalar or dim-length array (single value fills all dims)
function trParseVal(str, dim) {
    var parts = String(str).split(",");
    if (dim <= 1) return parseFloat(parts[0]);
    var arr = [];
    for (var i = 0; i < dim; i++) {
        var raw = (parts[i] !== undefined && parts[i] !== "") ? parts[i] : parts[parts.length - 1];
        arr.push(parseFloat(raw));
    }
    return arr;
}

// flexible ease across every key of a property
function trApplyEase(p, kind) {
    var n = p.numKeys, k;
    if (n < 1) return;
    var d = trDim(p); try { if (p.isSpatial) d = 1; } catch (e) {}
    if (kind === "hold") {
        for (k = 1; k <= n; k++) { try { p.setInterpolationTypeAtKey(k, p.keyInInterpolationType(k), KeyframeInterpolationType.HOLD); } catch (e) {} }
        return;
    }
    if (kind === "linear") {
        for (k = 1; k <= n; k++) { try { p.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR); } catch (e) {} }
        return;
    }
    var inf = (kind === "punch") ? 85 : (kind === "overshoot") ? 92 : 66;   // smooth default
    for (k = 1; k <= n; k++) {
        var eIn = [], eOut = [], i;
        for (i = 0; i < d; i++) { eIn.push(new KeyframeEase(0, inf)); eOut.push(new KeyframeEase(0, inf)); }
        try { p.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER); } catch (e) {}
        try { p.setTemporalEaseAtKey(k, eIn, eOut); } catch (e2) {}
    }
}

// one jittered sample around a base value (scale jitters uniformly = a real zoom pulse)
function trShakeVal(base, propName, amp) {
    if (base instanceof Array) {
        var out = [], i;
        if (propName === "scale") {
            var r = (Math.random() * 2 - 1) * amp;
            for (i = 0; i < base.length; i++) out.push(base[i] + (i < 2 ? r : 0));
        } else {
            for (i = 0; i < base.length; i++) out.push(base[i] + (Math.random() * 2 - 1) * amp);
        }
        return out;
    }
    return base + (Math.random() * 2 - 1) * amp;
}

// AI: bake a shake (or drop a wiggle expression) on the selected layer(s).
// cfg: "property=position|scale|rotation;intensity=subtle|medium|strong;keys=0|1;dur=;settle=0|1;amount=;freq=;fromPlayhead=0|1"
function theoReverse_shake(cfg) {
    try {
        var comp = activeCompOrErr();
        if (!comp) return "ERR:no comp open";
        var sel = comp.selectedLayers;
        if (!sel.length) return "ERR:select a layer first, then i'll shake it";
        var c = parseConfig(cfg);
        var which = (c.property || "position").toLowerCase();
        var useKeys = c.keys !== "0";
        var intensity = c.intensity || "medium";
        var scaleAmp = { subtle: 4, medium: 9, strong: 18 };
        var posAmp = { subtle: 8, medium: 18, strong: 40 };
        var rotAmp = { subtle: 2, medium: 5, strong: 12 };
        var freqMap = { subtle: 8, medium: 12, strong: 16 };
        var propName, amp;
        if (/scale|zoom|size/.test(which)) { propName = "scale"; amp = scaleAmp[intensity] || scaleAmp.medium; }
        else if (/rot|spin/.test(which)) { propName = "rotation"; amp = rotAmp[intensity] || rotAmp.medium; }
        else { propName = "position"; amp = posAmp[intensity] || posAmp.medium; }
        if (c.amount) { var av = parseFloat(c.amount); if (!isNaN(av)) amp = av; }
        var freq = parseFloat(c.freq); if (isNaN(freq) || freq <= 0) freq = freqMap[intensity] || 12;

        app.beginUndoGroup("TR Shake " + propName);
        var done = 0, i;
        for (i = 0; i < sel.length; i++) {
            var ly = sel[i];
            var p = trResolveProp(ly, propName);
            if (!p) continue;
            var span = ly.outPoint - ly.inPoint;
            if (c.dur) { var dv = parseFloat(c.dur); if (!isNaN(dv) && dv > 0) span = Math.min(span, dv); }
            if (!(span > 0)) span = comp.duration;
            var start = (c.fromPlayhead === "1") ? comp.time : ly.inPoint;

            if (useKeys) {
                var base = p.value;
                var step = 1 / freq;
                if (span / step > 1000) step = span / 1000;   // safety cap on key count
                p.setValueAtTime(start, base);                // start at rest
                var t;
                for (t = step; t <= span - 1e-6; t += step) {
                    var decay = (c.settle === "1") ? Math.max(0, 1 - t / span) : 1;
                    p.setValueAtTime(start + t, trShakeVal(base, propName, amp * decay));
                }
                p.setValueAtTime(start + span, base);          // land back on rest
                trApplyEase(p, "linear");
            } else {
                p.expression = (propName === "scale")
                    ? "w=wiggle(" + freq + "," + amp + ");[w[0],w[1]]"
                    : "wiggle(" + freq + "," + amp + ")";
            }
            done++;
        }
        app.endUndoGroup();
        if (!done) return "ERR:couldn't shake that — is a normal layer selected?";
        return "OK:threw a " + intensity + " " + propName + " shake on " + done + " layer" + (done === 1 ? "" : "s") + (useKeys ? " (keyframes)" : " (wiggle)");
    } catch (e) { try { app.endUndoGroup(); } catch (e2) {} return "ERR:" + e.toString(); }
}

// AI: animate any property with explicit keyframes.
// cfg: "property=position;ease=smooth;relative=0;fromPlayhead=0;keys=0:960,540|0.5:1200,540|1:960,300"
function theoReverse_animate(cfg) {
    try {
        var comp = activeCompOrErr();
        if (!comp) return "ERR:no comp open";
        var sel = comp.selectedLayers;
        if (!sel.length) return "ERR:select a layer first";
        var c = parseConfig(cfg);
        var propName = c.property || c.prop || "position";
        var ease = c.ease || "smooth";
        var rel = c.relative === "1";
        var atPlayhead = c.fromPlayhead === "1";
        if (!c.keys) return "ERR:no keyframes given";
        var pairs = String(c.keys).split("|");
        app.beginUndoGroup("TR Animate " + propName);
        var done = 0, i, j, d;
        for (i = 0; i < sel.length; i++) {
            var ly = sel[i];
            var p = trResolveProp(ly, propName);
            if (!p) continue;
            var dim = trDim(p);
            var base = null;
            try { base = p.valueAtTime(ly.inPoint, false); } catch (eB) { try { base = p.value; } catch (eB2) { base = 0; } }
            var t0 = atPlayhead ? comp.time : ly.inPoint;
            var wrote = 0;
            for (j = 0; j < pairs.length; j++) {
                var kv = pairs[j].split(":");
                if (kv.length < 2) continue;
                var tt = t0 + parseFloat(kv[0]);
                var val = trParseVal(kv[1], dim);
                if (isNaN(tt)) continue;
                if (rel) {
                    if (val instanceof Array) { for (d = 0; d < val.length; d++) val[d] += (base instanceof Array ? base[d] : base); }
                    else val += (base instanceof Array ? base[0] : base);
                }
                try { p.setValueAtTime(tt, val); wrote++; } catch (eW) {}
            }
            if (wrote) { trApplyEase(p, ease); done++; }
        }
        app.endUndoGroup();
        if (!done) return "ERR:couldn't animate \"" + propName + "\" — check the layer/property name";
        return "OK:animated " + propName + " on " + done + " layer" + (done === 1 ? "" : "s");
    } catch (e) { try { app.endUndoGroup(); } catch (e2) {} return "ERR:" + e.toString(); }
}

// AI: put an expression on a property (wiggle, loopOut, bounce, links, anything)
function theoReverse_setExpression(propName, expr) {
    try {
        var comp = activeCompOrErr();
        if (!comp) return "ERR:no comp open";
        var sel = comp.selectedLayers;
        if (!sel.length) return "ERR:select a layer first";
        app.beginUndoGroup("TR Expression");
        var done = 0, i;
        for (i = 0; i < sel.length; i++) {
            var p = trResolveProp(sel[i], propName || "position");
            if (!p) continue;
            try { p.expression = String(expr || ""); done++; } catch (e) {}
        }
        app.endUndoGroup();
        if (!done) return "ERR:couldn't set that expression (property not found or locked)";
        return "OK:set the expression on " + done + " layer" + (done === 1 ? "" : "s");
    } catch (e) { try { app.endUndoGroup(); } catch (e2) {} return "ERR:" + e.toString(); }
}

// ---------------------------------------------------------------------------
// TEXT ANIMS — in/out animations with adjustable duration
// ---------------------------------------------------------------------------
function trEase(p) {
    try {
        var d = 1;
        try { var v = p.value; if (v instanceof Array) d = v.length; } catch (e0) {}
        try { if (p.isSpatial) d = 1; } catch (e1) {}
        var arr = [];
        for (var i = 0; i < d; i++) arr.push(new KeyframeEase(0, 66));
        for (var k = 1; k <= p.numKeys; k++) p.setTemporalEaseAtKey(k, arr, arr);
    } catch (e) {}
}

function trKeys(p, times, vals) {
    for (var i = 0; i < times.length; i++) p.setValueAtTime(times[i], vals[i]);
    trEase(p);
}

function isTextLayer(ly) {
    try { return ly.property("ADBE Text Properties") !== null && ly.property("ADBE Text Properties").property("ADBE Text Document") !== null; }
    catch (e) { return false; }
}

function theoReverse_textAnim(kind, dur) {
    try {
        var comp = activeCompOrErr();
        if (!comp) return "ERR:Open a comp first.";
        var sel = comp.selectedLayers;
        if (!sel.length) return "ERR:Select layer(s) first.";
        dur = parseFloat(dur);
        if (isNaN(dur) || dur <= 0) dur = 0.5;

        app.beginUndoGroup("TR Text Anim " + kind);
        var done = 0, skippedText = 0, i;

        for (i = 0; i < sel.length; i++) {
            var ly = sel[i];
            var span = ly.outPoint - ly.inPoint;
            var d = Math.min(dur, span);
            if (d <= 0) continue;
            var isIn = kind.indexOf("Out") < 0;
            var a = isIn ? ly.inPoint : ly.outPoint - d;
            var b = isIn ? ly.inPoint + d : ly.outPoint;

            var tg = ly.property("ADBE Transform Group");
            var op = tg.property("ADBE Opacity");
            var scp = tg.property("ADBE Scale");
            var ps = tg.property("ADBE Position");

            try {
                if (kind === "fadeIn")  trKeys(op, [a, b], [0, 100]);
                else if (kind === "fadeOut") trKeys(op, [a, b], [100, 0]);
                else if (kind === "popIn") {
                    var s0 = scp.value;
                    var lo = s0.length === 3 ? [s0[0] * 0.6, s0[1] * 0.6, s0[2]] : [s0[0] * 0.6, s0[1] * 0.6];
                    var hi = s0.length === 3 ? [s0[0] * 1.06, s0[1] * 1.06, s0[2]] : [s0[0] * 1.06, s0[1] * 1.06];
                    trKeys(scp, [a, a + d * 0.7, b], [lo, hi, s0]);
                    trKeys(op, [a, a + d * 0.5], [0, 100]);
                }
                else if (kind === "popOut") {
                    var s1 = scp.value;
                    var up = s1.length === 3 ? [s1[0] * 1.4, s1[1] * 1.4, s1[2]] : [s1[0] * 1.4, s1[1] * 1.4];
                    trKeys(scp, [a, b], [s1, up]);
                    trKeys(op, [a, b], [100, 0]);
                }
                else if (kind === "slideUpIn" || kind === "slideDownIn") {
                    var p0 = ps.value, off = kind === "slideUpIn" ? 80 : -80;
                    var from = p0.length === 3 ? [p0[0], p0[1] + off, p0[2]] : [p0[0], p0[1] + off];
                    trKeys(ps, [a, b], [from, p0]);
                    trKeys(op, [a, b * 0.5 + a * 0.5], [0, 100]);
                }
                else if (kind === "slideUpOut" || kind === "slideDownOut") {
                    var p1 = ps.value, off2 = kind === "slideUpOut" ? -80 : 80;
                    var to = p1.length === 3 ? [p1[0], p1[1] + off2, p1[2]] : [p1[0], p1[1] + off2];
                    trKeys(ps, [a, b], [p1, to]);
                    trKeys(op, [a, b], [100, 0]);
                }
                else if (kind === "blurIn" || kind === "blurOut") {
                    var fx = ly.property("ADBE Effect Parade");
                    var gb = fx.addProperty("ADBE Gaussian Blur 2");
                    var blur = gb.property(1);
                    if (kind === "blurIn") { trKeys(blur, [a, b], [40, 0]); trKeys(op, [a, b], [0, 100]); }
                    else { trKeys(blur, [a, b], [0, 40]); trKeys(op, [a, b], [100, 0]); }
                }
                else if (kind === "typeIn") {
                    if (!isTextLayer(ly)) { skippedText++; continue; }
                    var anim = ly.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
                    anim.name = "TR Typewriter";
                    var rsel = anim.property("ADBE Text Selectors").addProperty("ADBE Text Selector");
                    try { rsel.property("ADBE Text Range Advanced").property("ADBE Text Selector Smoothness").setValue(0); } catch (eS) {}
                    var st = rsel.property("ADBE Text Percent Start");
                    st.setValueAtTime(a, 0); st.setValueAtTime(b, 100);
                    anim.property("ADBE Text Animator Properties").addProperty("ADBE Text Opacity").setValue(0);
                }
                else if (kind === "trackIn" || kind === "trackOut") {
                    if (!isTextLayer(ly)) { skippedText++; continue; }
                    var anim2 = ly.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
                    anim2.name = "TR Tracking";
                    anim2.property("ADBE Text Selectors").addProperty("ADBE Text Selector");
                    var tramt = anim2.property("ADBE Text Animator Properties").addProperty("ADBE Text Tracking Amount");
                    if (kind === "trackIn") { trKeys(tramt, [a, b], [40, 0]); trKeys(op, [a, b], [0, 100]); }
                    else { trKeys(tramt, [a, b], [0, 40]); trKeys(op, [a, b], [100, 0]); }
                }
                else if (kind === "fadeUpWords" || kind === "fadeUpWordsBlur") {
                    if (!isTextLayer(ly)) { skippedText++; continue; }
                    var animW = ly.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
                    animW.name = (kind === "fadeUpWordsBlur") ? "TR Fade Up Words + Blur" : "TR Fade Up Words";
                    var selW = animW.property("ADBE Text Selectors").addProperty("ADBE Text Selector");
                    try { selW.property("ADBE Text Range Advanced").property("ADBE Text Range Type2").setValue(3); } catch (eW) {}   // Based On: Words
                    var apW = animW.property("ADBE Text Animator Properties");
                    apW.addProperty("ADBE Text Opacity").setValue(0);
                    try { apW.addProperty("ADBE Text Position 3D").setValue([0, 40, 0]); } catch (ePos) {}   // +Y = below -> rises up on reveal
                    if (kind === "fadeUpWordsBlur") { try { apW.addProperty("ADBE Text Blur").setValue([24, 24]); } catch (eB) {} }
                    trKeys(selW.property("ADBE Text Percent Start"), [a, b], [0, 100]);
                }
                else if (kind === "randomChars") {
                    if (!isTextLayer(ly)) { skippedText++; continue; }
                    var animR = ly.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
                    animR.name = "TR Random Chars";
                    var selR = animR.property("ADBE Text Selectors").addProperty("ADBE Text Selector");
                    try {
                        var advR = selR.property("ADBE Text Range Advanced");
                        advR.property("ADBE Text Range Type2").setValue(1);        // Based On: Characters
                        advR.property("ADBE Text Randomize Order").setValue(1);     // random reveal order
                    } catch (eR) {}
                    animR.property("ADBE Text Animator Properties").addProperty("ADBE Text Opacity").setValue(0);
                    trKeys(selR.property("ADBE Text Percent Start"), [a, b], [0, 100]);
                }
                else if (kind === "fadeOutSlow") {
                    var dSlow = Math.min(span, Math.max(d * 2.5, 1.6));   // clearly slower than a normal fade
                    trKeys(op, [ly.outPoint - dSlow, ly.outPoint], [100, 0]);
                }
                else { continue; }
                done++;
            } catch (eA) {}
        }

        app.endUndoGroup();
        if (!done && skippedText) return "ERR:That anim needs a TEXT layer selected.";
        var m = "OK:Applied " + kind + " to " + done + " layer" + (done === 1 ? "" : "s") + ".";
        if (skippedText) m += " (" + skippedText + " non-text skipped)";
        return m;
    } catch (e) { try { app.endUndoGroup(); } catch (e2) {} return "ERR:" + e.toString(); }
}

// ---------------------------------------------------------------------------
// GRAPH EDITOR — apply a cubic-bezier curve (x1,y1,x2,y2) as AE temporal eases
// between selected keyframes. x = time 0..1, y = progress (can overshoot).
// ---------------------------------------------------------------------------
function applyEaseSegment(p, k1, k2, x1, y1, x2, y2) {
    var t1 = p.keyTime(k1), t2 = p.keyTime(k2);
    var dt = t2 - t1;
    if (dt <= 0) return false;
    var v1 = p.keyValue(k1), v2 = p.keyValue(k2);
    var spatial = false; try { spatial = p.isSpatial; } catch (e) {}
    var speeds = [], i;
    if (v1 instanceof Array) {
        if (spatial) {                       // spatial props take ONE ease (speed = px/sec along path)
            var d2 = 0;
            for (i = 0; i < v1.length; i++) d2 += (v2[i] - v1[i]) * (v2[i] - v1[i]);
            speeds = [Math.sqrt(d2) / dt];
        } else {
            for (i = 0; i < v1.length; i++) speeds.push((v2[i] - v1[i]) / dt);
        }
    } else {
        speeds = [(v2 - v1) / dt];
    }
    // clamp control-point TIME so AE gets valid, visible influences.
    // (influence near 0% degenerates the handle in AE -> the segment comes out wrong)
    if (x1 < 0.04) x1 = 0.04; else if (x1 > 0.96) x1 = 0.96;
    if (x2 < 0.04) x2 = 0.04; else if (x2 > 0.96) x2 = 0.96;
    // bezier handles -> AE influence (% of segment) + speed factor (capped so extremes stay sane)
    var outInf = x1 * 100;
    var inInf  = (1 - x2) * 100;
    var outF = Math.max(-30, Math.min(30, y1 / x1));
    var inF  = Math.max(-30, Math.min(30, (1 - y2) / (1 - x2)));
    var outE = [], inE = [];
    for (i = 0; i < speeds.length; i++) {
        outE.push(new KeyframeEase(speeds[i] * outF, outInf));
        inE.push(new KeyframeEase(speeds[i] * inF, inInf));
    }
    try { p.setTemporalContinuousAtKey(k1, false); p.setTemporalAutoBezierAtKey(k1, false); } catch (e1) {}
    try { p.setTemporalContinuousAtKey(k2, false); p.setTemporalAutoBezierAtKey(k2, false); } catch (e2) {}
    p.setInterpolationTypeAtKey(k1, p.keyInInterpolationType(k1), KeyframeInterpolationType.BEZIER);
    p.setInterpolationTypeAtKey(k2, KeyframeInterpolationType.BEZIER, p.keyOutInterpolationType(k2));
    p.setTemporalEaseAtKey(k1, p.keyInTemporalEase(k1), outE);
    p.setTemporalEaseAtKey(k2, inE, p.keyOutTemporalEase(k2));
    return true;
}

function theoReverse_applyGraph(x1, y1, x2, y2) {
    try {
        var comp = activeCompOrErr();
        if (!comp) return "ERR:no comp open";
        x1 = Math.max(0, Math.min(1, parseFloat(x1)));
        x2 = Math.max(0, Math.min(1, parseFloat(x2)));
        y1 = parseFloat(y1); y2 = parseFloat(y2);
        if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return "ERR:bad curve values";
        var props = comp.selectedProperties;
        var segs = 0, propsHit = 0;
        app.beginUndoGroup("TR Graph");
        for (var pi = 0; pi < props.length; pi++) {
            var p = props[pi];
            try {
                if (p.propertyType !== PropertyType.PROPERTY) continue;
                var sk = p.selectedKeys;
                if (!sk || sk.length < 2) continue;
                sk.sort(function (a, b) { return a - b; });
                var did = false;
                for (var si = 0; si < sk.length - 1; si++) {
                    if (applyEaseSegment(p, sk[si], sk[si + 1], x1, y1, x2, y2)) { segs++; did = true; }
                }
                if (did) propsHit++;
            } catch (eP) {}
        }
        app.endUndoGroup();
        if (!segs) return "ERR:select 2+ keyframes on a property first (click the keys in the timeline)";
        return "OK:graphed " + segs + " segment" + (segs === 1 ? "" : "s") + " on " + propsHit + " propert" + (propsHit === 1 ? "y" : "ies");
    } catch (e) { try { app.endUndoGroup(); } catch (e2) {} return "ERR:" + e.toString(); }
}

// ---------------------------------------------------------------------------
// TAP BEATMARKER — play comp audio in panel, tap, drop comp markers
// ---------------------------------------------------------------------------
// find the first audio-bearing footage layer in the active comp
function theoReverse_compAudio() {
    try {
        var comp = activeCompOrErr();
        if (!comp) return "ERR:no comp open";
        for (var i = 1; i <= comp.numLayers; i++) {
            var ly = comp.layer(i);
            try {
                var src = ly.source;
                if (src && (src instanceof FootageItem) && src.hasAudio && src.file) {
                    return "OK:" + src.file.fsName + "|" + ly.startTime + "|" + comp.duration + "|" + comp.frameRate;
                }
            } catch (e) {}
        }
        return "ERR:no audio layer in \"" + comp.name + "\" — drop a file instead";
    } catch (e) { return "ERR:" + e.toString(); }
}

function clearCompMarkers(comp) {
    var mp = comp.markerProperty;
    while (mp.numKeys > 0) mp.removeKey(1);
}

// cfg: "times=1.2,2.4,...;clear=0|1;snap=0|1;label=Beat"
function theoReverse_writeMarkers(cfg) {
    try {
        var comp = activeCompOrErr();
        if (!comp) return "ERR:no comp open";
        var c = parseConfig(cfg);
        var times = [], raw = String(c.times || "").split(",");
        for (var i = 0; i < raw.length; i++) { var t = parseFloat(raw[i]); if (!isNaN(t) && t >= 0) times.push(t); }
        if (!times.length) return "ERR:no beats tapped";
        var label = c.label || "Beat";
        var snap = c.snap === "1";
        var fd = comp.frameDuration;

        app.beginUndoGroup("TR Beat Markers");
        if (c.clear === "1") clearCompMarkers(comp);
        var mp = comp.markerProperty, n = 0;
        for (i = 0; i < times.length; i++) {
            var tt = times[i];
            if (tt > comp.duration) continue;
            if (snap) tt = Math.round(tt / fd) * fd;
            var mv = new MarkerValue(label + " " + (i + 1));
            mv.duration = 0;
            mp.setValueAtTime(tt, mv);
            n++;
        }
        app.endUndoGroup();
        return "OK:dropped " + n + " marker" + (n === 1 ? "" : "s");
    } catch (e) { try { app.endUndoGroup(); } catch (e2) {} return "ERR:" + e.toString(); }
}

function theoReverse_clearMarkers() {
    try {
        var comp = activeCompOrErr();
        if (!comp) return "ERR:no comp open";
        app.beginUndoGroup("TR Clear Markers");
        clearCompMarkers(comp);
        app.endUndoGroup();
        return "OK:markers cleared";
    } catch (e) { try { app.endUndoGroup(); } catch (e2) {} return "ERR:" + e.toString(); }
}

// ---------------------------------------------------------------------------
// AI CONTEXT — what the chatbot knows about this AE install
// ---------------------------------------------------------------------------
function theoReverse_aiContext() {
    try {
        var s = "After Effects " + app.version + ".";
        var comp = app.project.activeItem;
        if (comp && comp instanceof CompItem) {
            s += " Active comp: \"" + comp.name + "\" " + comp.width + "x" + comp.height +
                 " @" + comp.frameRate.toFixed(2) + "fps, " + comp.duration.toFixed(2) + "s.";
            s += " Comp center = [" + (comp.width / 2) + "," + (comp.height / 2) + "].";
            var sel = comp.selectedLayers;
            if (sel.length) {
                s += " Selected layers:";
                for (var i = 0; i < sel.length && i < 6; i++) {
                    var ly = sel[i];
                    s += " \"" + ly.name + "\"";
                    try {
                        var tg = ly.property("ADBE Transform Group");
                        var pv = tg.property("ADBE Position").value, sv = tg.property("ADBE Scale").value;
                        var rv = tg.property("ADBE Rotate Z").value, ov = tg.property("ADBE Opacity").value;
                        s += " (pos " + trFmt(pv) + ", scale " + trFmt(sv) + "%, rot " + trFmt(rv) + "°, opa " + trFmt(ov) + ")";
                    } catch (eT) {}
                    var fx = ly.property("ADBE Effect Parade");
                    if (fx && fx.numProperties) {
                        var names = [];
                        for (var j = 1; j <= fx.numProperties && j <= 8; j++) names.push(fx.property(j).name);
                        s += " [fx: " + names.join(", ") + "]";
                    }
                    s += (i < sel.length - 1 && i < 5) ? ";" : ".";
                }
            } else {
                s += " (nothing selected right now.)";
            }
        }
        var fx3 = [], seen = {}, count3 = 0;
        var eff = app.effects;
        for (var k = 0; k < eff.length; k++) {
            var mn = eff[k].matchName || "";
            if (mn.indexOf("ADBE") === 0) continue;
            count3++;
            var dn = eff[k].displayName;
            if (!seen[dn] && fx3.length < 220) { seen[dn] = 1; fx3.push(dn); }
        }
        s += " Third-party effects installed (" + count3 + "): " + fx3.join(", ") + ".";
        return "OK:" + s;
    } catch (e) { return "ERR:" + e.toString(); }
}

// ---------------------------------------------------------------------------
// entry points called from the panel
// ---------------------------------------------------------------------------
function theoReverse_ping() {
    try { return "AE " + app.version.split("x")[0] + " · ready"; }
    catch (e) { return "ERR:" + e.toString(); }
}

// list selectable output comps as "id|name" lines (excludes our generated comps)
function theoReverse_listComps() {
    try {
        var out = [], items = app.project.items;
        for (var i = 1; i <= items.length; i++) {
            var it = items[i];
            if (it instanceof CompItem && !isGeneratedComp(it)) out.push(it.id + "|" + it.name);
        }
        var active = app.project.activeItem;
        var activeId = (active && active instanceof CompItem) ? active.id : 0;
        return "OK:" + activeId + "\n" + out.join("\n");
    } catch (e) { return "ERR:" + e.toString(); }
}

function theoReverse_build(configString) {
    var undo = false;
    try {
        if (!app.project) return "ERR:No project open.";
        var cfg = parseConfig(configString);
        app.beginUndoGroup("THEO REVERSE — Build Reel"); undo = true;
        var msg = buildReel(cfg);
        app.endUndoGroup(); undo = false;
        try { closeGeneratedViewers(); } catch (eCV) {}   // clear the leftover TR_* viewer tabs
        return "OK:" + msg;
    } catch (e) {
        if (undo) { try { app.endUndoGroup(); } catch (e2) {} }
        return "ERR:" + e.toString() + (e.line ? (" @line " + e.line) : "");
    }
}
