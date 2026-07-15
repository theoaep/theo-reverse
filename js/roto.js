/* THEO REVERSE — Roto view: auto-isolate the player as a track matte.
   AE's Roto Brush isn't scriptable, so we compute a matte outside AE (Gemini for a still, or any
   matte file you already have) and bind it as a track matte on the selected layer. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TR = window.TR;
  if (!$("view-roto")) return;

  const state = { info: null, source: "gemini", seq: false, matteType: "alpha", matteId: null, fillIndex: null, busy: false };

  /* ── helpers ─────────────────────────────────────────── */
  const ok = (r) => !!r && r.indexOf("OK") === 0;
  const jsx = (fn, cfg) => TR.evalJSX(fn + "(" + JSON.stringify(cfg == null ? "" : cfg) + ")");
  function parseKV(res) {
    const o = {}, body = String(res).replace(/^OK:/, "");
    body.split(";").forEach((p) => { const i = p.indexOf("="); if (i >= 0) o[p.slice(0, i)] = p.slice(i + 1); });
    return o;
  }
  function nodeFs() { try { return require("fs"); } catch (e) { return null; } }
  function status(msg, cls) { const el = $("rotoStatus"); if (el) { el.textContent = msg || ""; el.className = "roto-status" + (cls ? " " + cls : ""); } }
  function fail(res) { setBusy(false); const m = String(res || "").replace(/^ERR:/, ""); status(m || "something broke", "err"); TR.toast(m || "roto failed", "err"); }
  function setBusy(on, label) {
    state.busy = on;
    $("rotoGo").disabled = on;
    $("rotoGo").textContent = on ? (label || "working…") : "Auto-isolate player";
    if (on) status(label || "working…");
  }

  /* ── detect the selected layer ───────────────────────── */
  async function refreshInfo(loud) {
    const res = await jsx("theoReverse_rotoSelectedInfo", "");
    if (!ok(res)) {
      state.info = null;
      $("rotoClip").innerHTML = '<span class="muted">' + String(res).replace(/^ERR:/, "") + "</span>";
      if (loud) TR.toast(String(res).replace(/^ERR:/, ""), "err");
      return null;
    }
    const info = parseKV(res);
    state.info = info;
    $("rotoClip").innerHTML =
      '<b>' + (info.name || "layer") + "</b> " +
      '<span class="muted">· ' + info.w + "×" + info.h + " · " + (info.kind || "") +
      (info.retimed === "1" ? " · retimed" : "") + "</span>";
    return info;
  }

  /* ── Gemini (still) source ───────────────────────────── */
  async function buildMatteDataUrl(seg, W, H) {
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    const box = seg.box_2d || [0, 0, 1000, 1000];
    const bx = box[1] / 1000 * W, by = box[0] / 1000 * H, bw = (box[3] - box[1]) / 1000 * W, bh = (box[2] - box[0]) / 1000 * H;
    if (seg.mask) {
      const src = /^data:/.test(seg.mask) ? seg.mask : ("data:image/png;base64," + seg.mask);
      await new Promise((res) => {
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, bx, by, bw, bh); res(); };
        img.onerror = () => { ctx.fillStyle = "#fff"; ctx.fillRect(bx, by, bw, bh); res(); };
        img.src = src;
      });
    } else { ctx.fillStyle = "#fff"; ctx.fillRect(bx, by, bw, bh); }
    return cv.toDataURL("image/png");
  }
  function writeTempPng(dataUrl) {
    const fs = nodeFs(); if (!fs) throw new Error("no file access");
    const os = require("os");
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    const out = (os.tmpdir ? os.tmpdir() : ".") + "/theo_roto_matte_" + Date.now() + ".png";
    fs.writeFileSync(out, Buffer.from(b64, "base64"));
    return out;
  }

  async function autoIsolateGemini(info) {
    if (!(TR.hasAIKey && TR.hasAIKey())) { fail("ERR:Add your Gemini key in the AI tab first."); return; }
    if (!nodeFs()) { fail("ERR:Gemini cutout needs file access — use the Matte-file source instead."); return; }
    setBusy(true, "grabbing the frame…");
    const seedRes = await jsx("theoReverse_saveSeedFrame", "");
    if (!ok(seedRes)) return fail(seedRes);
    const seed = parseKV(seedRes);
    let b64;
    try { b64 = nodeFs().readFileSync(seed.path).toString("base64"); } catch (e) { return fail("ERR:couldn't read the frame file."); }

    setBusy(true, "AI is finding the player…");
    let segs;
    try { segs = await TR.segment(b64, "the main person / football player"); }
    catch (e) { return fail("ERR:" + (TR.aiError ? TR.aiError(e) : ("AI: " + e.message))); }

    setBusy(true, "building the matte…");
    const W = parseInt(seed.w, 10), H = parseInt(seed.h, 10);
    let mattePath;
    try { mattePath = writeTempPng(await buildMatteDataUrl(segs[0], W, H)); } catch (e) { return fail("ERR:couldn't write the matte."); }

    const imp = await jsx("theoReverse_importSequence", "path=" + mattePath + ";sequence=0");
    if (!ok(imp)) return fail(imp);
    const ap = await jsx("theoReverse_applyAlphaMatte", "matteId=" + parseKV(imp).id + ";fillIndex=" + info.index + ";type=luma");
    if (!ok(ap)) return fail(ap);
    finishIsolate(parseKV(imp).id, parseKV(ap).fillIndex || info.index);
  }

  /* ── Matte-file source ───────────────────────────────── */
  async function autoIsolateMatte(info) {
    const pick = await jsx("theoReverse_pickMedia", state.seq ? "seq" : "matte");
    if (!ok(pick)) return fail(pick);
    const path = pick.slice(3).trim();
    if (!path) { setBusy(false); return; }         // cancelled
    setBusy(true, "importing the matte…");
    const imp = await jsx("theoReverse_importSequence", "path=" + path + ";sequence=" + (state.seq ? "1" : "0") + (info.fps ? ";fps=" + info.fps : ""));
    if (!ok(imp)) return fail(imp);
    const ap = await jsx("theoReverse_applyAlphaMatte", "matteId=" + parseKV(imp).id + ";fillIndex=" + info.index + ";type=" + state.matteType);
    if (!ok(ap)) return fail(ap);
    finishIsolate(parseKV(imp).id, parseKV(ap).fillIndex || info.index);
  }

  function finishIsolate(matteId, fillIndex) {
    state.matteId = matteId; state.fillIndex = fillIndex;
    setBusy(false);
    status("isolated — tweak the edge / flip / cut, then Proceed", "ok");
    $("rotoAdjust").classList.remove("hidden");
    TR.toast("player isolated ✓", "ok");
  }

  /* ── run ─────────────────────────────────────────────── */
  async function run() {
    if (state.busy) return;
    const info = await refreshInfo(true);
    if (!info) { TR.toast("select your player layer in AE first", "err"); return; }
    try {
      if (state.source === "gemini") await autoIsolateGemini(info);
      else await autoIsolateMatte(info);
    } catch (e) { fail("ERR:" + (e.message || e)); }
  }

  /* ── wire up ─────────────────────────────────────────── */
  $("rotoGo").addEventListener("click", run);
  $("rotoDetect").addEventListener("click", () => refreshInfo(true));

  document.querySelectorAll("#rotoSrc .seg-btn").forEach((b) =>
    b.addEventListener("click", () => {
      state.source = b.getAttribute("data-src");
      document.querySelectorAll("#rotoSrc .seg-btn").forEach((x) => x.classList.toggle("on", x === b));
      $("rotoMatteOpts").classList.toggle("hidden", state.source !== "matte");
    }));
  $("rotoSeq") && $("rotoSeq").addEventListener("change", (e) => { state.seq = e.target.checked; });
  $("rotoType") && $("rotoType").addEventListener("change", (e) => { state.matteType = e.target.value; });

  $("rotoEdge").addEventListener("change", (e) => {
    if (state.fillIndex == null) return;
    jsx("theoReverse_refineMatte", "fillIndex=" + state.fillIndex + ";choke=" + e.target.value)
      .then((r) => { if (!ok(r)) TR.toast(String(r).replace(/^ERR:/, ""), "err"); });
  });
  $("rotoInvert").addEventListener("click", () => {
    if (state.fillIndex == null) return;
    jsx("theoReverse_invertMatte", "fillIndex=" + state.fillIndex).then((r) => TR.toast(ok(r) ? "flipped" : String(r).replace(/^ERR:/, ""), ok(r) ? "ok" : "err"));
  });
  $("rotoGarbage").addEventListener("click", () => {
    if (state.fillIndex == null) return;
    jsx("theoReverse_addGarbageMask", "fillIndex=" + state.fillIndex + ";feather=6").then((r) => TR.toast(ok(r) ? "garbage mask added — drag it in AE" : String(r).replace(/^ERR:/, ""), ok(r) ? "ok" : "err"));
  });
  $("rotoProceed").addEventListener("click", () => {
    if (state.fillIndex == null) { TR.toast("isolate first", "err"); return; }
    const bg = $("rotoBg").checked ? ";bg=000000" : "";
    jsx("theoReverse_commitRoto", "fillIndex=" + state.fillIndex + ";precomp=1" + bg).then((r) => {
      if (!ok(r)) { TR.toast(String(r).replace(/^ERR:/, ""), "err"); return; }
      TR.toast(String(r).replace(/^OK:?/, "✓ "), "ok");
      state.matteId = state.fillIndex = null;
      $("rotoAdjust").classList.add("hidden");
      status("done — isolated comp created.", "ok");
      refreshInfo(false);
    });
  });

  // detect when the Roto tab is opened
  const railRoto = document.querySelector('.rail-btn[data-nav="roto"]');
  if (railRoto) railRoto.addEventListener("click", () => refreshInfo(false));
  refreshInfo(false);
})();
