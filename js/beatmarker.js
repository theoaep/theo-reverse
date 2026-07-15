/* THEO REVERSE — Tap Beatmarker: play comp audio in-panel, tap beats, drop comp markers */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TR = window.TR;
  const body = document.body;

  let startTime = 0;        // comp time of the audio layer's start
  let compDuration = 1e9;
  let marks = [];           // comp-time seconds
  let loaded = false;
  let triedLoad = false;

  const audio = $("mAudio");
  let audioCtx, analyser, freq, srcNode, hasAudio = false;

  /* ── nav ─────────────────────────────────────────────── */
  $("openMarker").addEventListener("click", () => {
    TR.showView("marker");
    if (!triedLoad) { triedLoad = true; loadFromComp(); }
  });
  $("mBack").addEventListener("click", () => TR.showView("kit"));

  /* ── audio source ────────────────────────────────────── */
  function fileURL(fsName) {
    return "file:///" + encodeURI(fsName.replace(/\\/g, "/"));
  }
  function baseName(p) { const s = p.replace(/\\/g, "/"); return s.slice(s.lastIndexOf("/") + 1); }

  function loadFromComp() {
    TR.evalJSX("theoReverse_compAudio()").then((r) => {
      if (r && r.indexOf("OK:") === 0) {
        const parts = r.slice(3).split("|");
        startTime = parseFloat(parts[1]) || 0;
        compDuration = parseFloat(parts[2]) || 1e9;
        setSource(fileURL(parts[0]), baseName(parts[0]));
      } else {
        $("mIdleText").innerHTML = "no audio in this comp — <span class=\"muted\">click to pick a file</span>";
      }
    });
  }

  function setSource(url, name) {
    audio.src = url;
    $("mName").textContent = name;
    $("mIdle").classList.add("hidden");
    $("mLoaded").classList.remove("hidden");
    hasAudio = true; loaded = true;
    setupAnalyser();
  }
  function loadFile(file) {
    if (!file) return;
    startTime = 0; compDuration = 1e9;   // manual file: assume comp start
    setSource(URL.createObjectURL(file), file.name);
  }
  function setupAnalyser() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (!srcNode) {
        srcNode = audioCtx.createMediaElementSource(audio);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128; analyser.smoothingTimeConstant = 0.8;
        freq = new Uint8Array(analyser.frequencyBinCount);
        srcNode.connect(analyser); analyser.connect(audioCtx.destination);
      }
    } catch (e) {}
  }

  $("mIdle").addEventListener("click", () => $("mFile").click());
  $("mName").addEventListener("click", () => $("mFile").click());   // click track name to swap file
  $("mName").style.cursor = "pointer";
  $("mFile").addEventListener("change", (e) => loadFile(e.target.files[0]));
  const drop = $("mDrop");
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => e.preventDefault()));
  drop.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

  /* ── transport ───────────────────────────────────────── */
  $("mPlay").addEventListener("click", () => {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    if (audio.paused) audio.play(); else audio.pause();
  });
  audio.addEventListener("play", () => $("mPlay").classList.add("playing"));
  audio.addEventListener("pause", () => $("mPlay").classList.remove("playing"));
  audio.addEventListener("timeupdate", () => {
    if (!audio.duration) return;
    $("mScrubfill").style.width = (audio.currentTime / audio.duration * 100) + "%";
    $("mTime").textContent = fmt(audio.currentTime);
  });
  $("mScrub").addEventListener("click", (e) => {
    if (!audio.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });
  const fmt = (s) => { s = Math.floor(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  /* ── visualizer ──────────────────────────────────────── */
  const canvas = $("mViz"), cctx = canvas.getContext("2d");
  const BARS = 40;
  function sizeCanvas() {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", sizeCanvas);
  function roundRect(c, x, y, w, h, rad) {
    c.beginPath(); c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad); c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad); c.arcTo(x, y, x + w, y, rad); c.closePath(); c.fill();
  }
  function draw(ts) {
    const r = canvas.getBoundingClientRect();
    if (!r.width) { requestAnimationFrame(draw); return; }
    if (canvas.width !== Math.round(r.width * (window.devicePixelRatio || 1))) sizeCanvas();
    cctx.clearRect(0, 0, r.width, r.height);
    const live = hasAudio && analyser && !audio.paused;
    if (live) analyser.getByteFrequencyData(freq);
    const gap = 2, bw = (r.width - gap * (BARS - 1)) / BARS;
    const g = cctx.createLinearGradient(0, 0, r.width, 0);
    g.addColorStop(0, "#8b5cf6"); g.addColorStop(0.55, "#ec4899"); g.addColorStop(1, "#f59e0b");
    cctx.fillStyle = g;
    for (let i = 0; i < BARS; i++) {
      let v = live ? freq[Math.floor(i / BARS * freq.length)] / 255
                   : 0.10 + 0.06 * (Math.sin((ts / 600) + i * 0.5) * 0.5 + 0.5);
      const h = Math.max(2, v * r.height * 0.92);
      roundRect(cctx, i * (bw + gap), (r.height - h) / 2, bw, h, Math.min(bw / 2, 2));
    }
    requestAnimationFrame(draw);
  }
  sizeCanvas(); requestAnimationFrame(draw);

  /* ── tapping ─────────────────────────────────────────── */
  function tap(clientX, clientY) {
    if (body.classList.contains("intro-open")) return;
    if (!$("view-marker").classList.contains("active")) return;
    if (!loaded) { TR.toast("load a track first (it auto-loads your comp audio)", "err"); return; }
    const t = Math.min(Math.max(startTime + audio.currentTime, 0), compDuration);
    marks.push(t);
    ripple(clientX, clientY); burst(); punch();
    render();
  }
  function ripple(cx, cy) {
    const pad = $("mTap"), r = pad.getBoundingClientRect();
    const el = document.createElement("span"); el.className = "ripple";
    el.style.left = (cx != null ? cx - r.left : r.width / 2) + "px";
    el.style.top = (cy != null ? cy - r.top : r.height / 2) + "px";
    pad.appendChild(el);
    el.animate([{ width: "8px", height: "8px", opacity: .5 }, { width: "280px", height: "280px", opacity: 0 }],
      { duration: 520, easing: "cubic-bezier(0.23,1,0.32,1)" }).onfinish = () => el.remove();
  }
  function burst() {
    const pad = $("mTap"), b = document.createElement("span"); b.className = "burst"; pad.appendChild(b);
    b.animate([{ transform: "translate(-50%,-50%) scale(0.5)", opacity: .9 }, { transform: "translate(-50%,-50%) scale(2.3)", opacity: 0 }],
      { duration: 620, easing: "cubic-bezier(0.23,1,0.32,1)" }).onfinish = () => b.remove();
  }
  function punch() { const el = $("mTapnum"); el.classList.remove("punch"); void el.offsetWidth; el.classList.add("punch"); }

  function render() {
    $("mTapnum").textContent = marks.length;
    $("mDropMarkers").disabled = marks.length === 0;
    $("mDropMarkers").querySelector(".build-label").textContent = "Drop " + marks.length + " marker" + (marks.length === 1 ? "" : "s");
    const list = $("mList"); list.innerHTML = "";
    marks.forEach((t, i) => {
      const chip = document.createElement("span");
      chip.className = "mk-chip";
      chip.textContent = "♪ " + t.toFixed(2) + "s";
      list.appendChild(chip);
    });
    list.scrollLeft = list.scrollWidth;
  }

  $("mTap").addEventListener("click", (e) => tap(e.clientX, e.clientY));
  $("mUndo").addEventListener("click", () => { marks.pop(); render(); });
  $("mClearTaps").addEventListener("click", () => { marks = []; render(); });
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    if (!$("view-marker").classList.contains("active")) return;
    if (body.classList.contains("intro-open")) return;
    const t = document.activeElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON")) return;
    e.preventDefault(); tap();
  });

  /* ── commit markers ──────────────────────────────────── */
  $("mDropMarkers").addEventListener("click", () => {
    if (!marks.length) return;
    const cfg = [
      "times=" + marks.map((t) => t.toFixed(4)).join(","),
      "clear=" + ($("mClearExisting").checked ? "1" : "0"),
      "snap=" + ($("mSnap").checked ? "1" : "0"),
      "label=Beat"
    ].join(";");
    TR.evalJSX("theoReverse_writeMarkers(" + JSON.stringify(cfg) + ")").then((res) => {
      if (res && res.indexOf("OK") === 0) TR.toast("✓ " + res.slice(3), "ok");
      else TR.toast(res || "no response from AE", "err");
    });
  });

  render();
})();
