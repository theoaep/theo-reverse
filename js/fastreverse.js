/* THEO REVERSE — Fast Reverse view (beat tap, visualizer, build) */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TR = window.TR;
  const TOTAL = 9;                 // 1..8 + Repeat
  const LABELS = ["1", "2", "3", "4", "5", "6", "7", "8", "↻"];
  const appEl = $("app");
  const body = document.body;

  let marks = [];
  let lengths = [];

  /* ── output comp picker ──────────────────────────────── */
  const addOpt = (sel, val, label) => {
    const o = document.createElement("option");
    o.value = val; o.textContent = label; sel.appendChild(o);
  };
  const optExists = (sel, val) => Array.prototype.some.call(sel.options, (o) => o.value === val);

  function populateTargets() {
    return TR.evalJSX("theoReverse_listComps()").then((r) => {
      const sel = $("target"), prev = sel.value;
      sel.innerHTML = "";
      addOpt(sel, "auto", "Active comp (auto)");
      addOpt(sel, "new", "＋ New master comp");
      let activeId = "0";
      if (r && r.indexOf("OK:") === 0) {
        const lines = r.slice(3).split("\n");
        activeId = lines.shift();
        lines.forEach((ln) => {
          const p = ln.indexOf("|");
          if (p > 0) addOpt(sel, ln.slice(0, p), ln.slice(p + 1));
        });
      }
      if (prev && optExists(sel, prev)) sel.value = prev;
      else if (activeId !== "0" && optExists(sel, activeId)) sel.value = activeId;
      else sel.value = "auto";
    });
  }
  populateTargets();
  $("refresh").addEventListener("click", populateTargets);
  window.addEventListener("focus", populateTargets);

  /* ── beat nodes ──────────────────────────────────────── */
  const nodesEl = $("nodes");
  const nodeEls = [];
  for (let i = 0; i < TOTAL; i++) {
    const n = document.createElement("div");
    n.className = "node";
    n.textContent = LABELS[i];
    nodesEl.appendChild(n);
    nodeEls.push(n);
  }
  function refreshNodes() {
    nodeEls.forEach((n, i) => {
      n.classList.toggle("filled", i < marks.length);
      n.classList.toggle("next", i === marks.length);
    });
  }

  /* ── tap handling ────────────────────────────────────── */
  const now = () => performance.now() / 1000;

  function tap(clientX, clientY) {
    if (body.classList.contains("intro-open")) return;
    if (marks.length >= TOTAL) return;
    marks.push(now());
    const i = marks.length - 1;

    const node = nodeEls[i];
    node.classList.add("filled");
    node.classList.remove("pop");
    void node.offsetWidth;
    node.classList.add("pop");
    setTimeout(() => node.classList.remove("pop"), 250);

    ripple(clientX, clientY);
    burst();
    punchNum();
    if (hasAudio && !audio.paused) shakeUI(marks.length === TOTAL);

    refreshNodes();
    updateReadout();

    $("tapnum").textContent = marks.length < TOTAL ? LABELS[marks.length] : "✓";
    if (marks.length === TOTAL) complete();
  }

  function ripple(clientX, clientY) {
    const pad = $("tap");
    const r = pad.getBoundingClientRect();
    const el = document.createElement("span");
    el.className = "ripple";
    const x = clientX != null ? clientX - r.left : r.width / 2;
    const y = clientY != null ? clientY - r.top : r.height / 2;
    el.style.left = x + "px";
    el.style.top = y + "px";
    pad.appendChild(el);
    el.animate(
      [{ width: "8px", height: "8px", opacity: 0.5 }, { width: "280px", height: "280px", opacity: 0 }],
      { duration: 520, easing: "cubic-bezier(0.23,1,0.32,1)" }
    ).onfinish = () => el.remove();
  }

  function burst() {
    const pad = $("tap");
    const b = document.createElement("span");
    b.className = "burst";
    pad.appendChild(b);
    b.animate(
      [
        { transform: "translate(-50%,-50%) scale(0.5)", opacity: 0.9 },
        { transform: "translate(-50%,-50%) scale(2.3)", opacity: 0 }
      ],
      { duration: 620, easing: "cubic-bezier(0.23,1,0.32,1)" }
    ).onfinish = () => b.remove();
  }

  function punchNum() {
    const el = $("tapnum");
    el.classList.remove("punch");
    void el.offsetWidth;
    el.classList.add("punch");
  }

  function shakeUI(hard) {
    if (TR.reduceMotion) return;
    appEl.classList.remove("shake", "shake-hard");
    void appEl.offsetWidth;
    appEl.classList.add(hard ? "shake-hard" : "shake");
  }
  appEl.addEventListener("animationend", (e) => {
    if (e.target === appEl) appEl.classList.remove("shake", "shake-hard");
  });

  function updateReadout() {
    $("marked").innerHTML = marks.length + "<i>/9</i>";
    if (marks.length >= 2) {
      const segs = [];
      for (let i = 1; i < marks.length; i++) segs.push(marks[i] - marks[i - 1]);
      const avg = segs.reduce((a, b) => a + b, 0) / segs.length;
      $("bpm").textContent = Math.round(60 / avg);
      $("len").textContent = (marks[marks.length - 1] - marks[0]).toFixed(2);
    } else {
      $("bpm").textContent = "–"; $("len").textContent = "–";
    }
  }

  function complete() {
    lengths = [];
    for (let i = 1; i < marks.length; i++) lengths.push(+(marks[i] - marks[i - 1]).toFixed(4));
    $("tap").classList.add("done");
    $("build").disabled = false;
    TR.toast("9 beats locked — ready to build.", "ok");
  }

  function reset() {
    marks = []; lengths = [];
    nodeEls.forEach((n) => n.classList.remove("filled", "pop", "next"));
    refreshNodes();
    $("tapnum").textContent = "1";
    $("tap").classList.remove("done");
    $("build").disabled = true;
    updateReadout();
    TR.hideToast();
  }

  $("tap").addEventListener("click", (e) => tap(e.clientX, e.clientY));
  $("reset").addEventListener("click", reset);
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    if (body.classList.contains("intro-open")) return;
    if (!$("view-fast").classList.contains("active")) return;
    const t = document.activeElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (t && t.tagName === "BUTTON") return;
    e.preventDefault();
    tap();
  });
  refreshNodes();

  /* ── audio + visualizer ──────────────────────────────── */
  const audio = $("audio");
  let audioCtx, analyser, freq, srcNode, hasAudio = false;

  function loadFile(file) {
    if (!file) return;
    audio.src = URL.createObjectURL(file);
    $("trackname").textContent = file.name;
    $("dzIdle").classList.add("hidden");
    $("dzLoaded").classList.remove("hidden");
    hasAudio = true;
    setupAnalyser();
  }
  function setupAnalyser() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (!srcNode) {
        srcNode = audioCtx.createMediaElementSource(audio);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.8;
        freq = new Uint8Array(analyser.frequencyBinCount);
        srcNode.connect(analyser);
        analyser.connect(audioCtx.destination);
      }
    } catch (e) { /* visualizer falls back to idle sine */ }
  }

  $("dzIdle").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", (e) => loadFile(e.target.files[0]));
  const drop = $("drop");
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); }));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });

  $("playpause").addEventListener("click", () => {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    if (audio.paused) { audio.play(); } else { audio.pause(); }
  });
  audio.addEventListener("play", () => $("playpause").classList.add("playing"));
  audio.addEventListener("pause", () => {
    $("playpause").classList.remove("playing");
    appEl.style.setProperty("--bass", 0);
  });
  audio.addEventListener("timeupdate", () => {
    if (!audio.duration) return;
    $("scrubfill").style.width = (audio.currentTime / audio.duration * 100) + "%";
    $("time").textContent = fmt(audio.currentTime);
  });
  $("scrub").addEventListener("click", (e) => {
    if (!audio.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });
  const fmt = (s) => { s = Math.floor(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  const canvas = $("viz"), cctx = canvas.getContext("2d");
  const BARS = 40;
  function sizeCanvas() {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", sizeCanvas);

  function draw(ts) {
    const r = canvas.getBoundingClientRect();
    if (!r.width) { requestAnimationFrame(draw); return; }
    if (canvas.width !== Math.round(r.width * (window.devicePixelRatio || 1))) sizeCanvas();
    cctx.clearRect(0, 0, r.width, r.height);

    const live = hasAudio && analyser && !audio.paused;
    if (live) {
      analyser.getByteFrequencyData(freq);
      let b = 0;
      const n = Math.max(4, freq.length >> 3);
      for (let i = 0; i < n; i++) b += freq[i];
      appEl.style.setProperty("--bass", (b / (n * 255)).toFixed(3));
    }

    const gap = 2, bw = (r.width - gap * (BARS - 1)) / BARS;
    const grad = cctx.createLinearGradient(0, 0, r.width, 0);
    grad.addColorStop(0, "#8b5cf6"); grad.addColorStop(0.55, "#ec4899"); grad.addColorStop(1, "#f59e0b");
    cctx.fillStyle = grad;

    for (let i = 0; i < BARS; i++) {
      let v;
      if (live) v = freq[Math.floor(i / BARS * freq.length)] / 255;
      else v = 0.10 + 0.06 * (Math.sin((ts / 600) + i * 0.5) * 0.5 + 0.5);
      const h = Math.max(2, v * r.height * 0.92);
      const x = i * (bw + gap), y = (r.height - h) / 2;
      roundRect(cctx, x, y, bw, h, Math.min(bw / 2, 2));
    }
    requestAnimationFrame(draw);
  }
  function roundRect(c, x, y, w, h, rad) {
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad);
    c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad);
    c.arcTo(x, y, x + w, y, rad);
    c.closePath(); c.fill();
  }
  sizeCanvas(); requestAnimationFrame(draw);

  /* ── build ───────────────────────────────────────────── */
  function buildConfig() {
    return [
      "w=" + (parseInt($("w").value, 10) || 1080),
      "h=" + (parseInt($("h").value, 10) || 1920),
      "fps=" + (parseFloat($("fps").value) || 30),
      "beats=" + lengths.join(","),
      "target=" + $("target").value,
      "twixtor=" + $("twixtor").value.trim(),
      "rin=" + $("rin").value.trim(),
      "rout=" + $("rout").value.trim(),
      "applyTwixtor=" + ($("applyTwixtor").checked ? "1" : "0")
    ].join(";");
  }

  $("build").addEventListener("click", () => {
    if (lengths.length < 1) return;
    const btn = $("build");
    btn.classList.add("working");
    btn.querySelector(".build-label").textContent = "Building…";
    TR.toast("Building " + lengths.length + " beats in After Effects…");
    TR.evalJSX("theoReverse_build(" + JSON.stringify(buildConfig()) + ")").then((res) => {
      btn.classList.remove("working");
      btn.querySelector(".build-label").textContent = "Build Reel";
      if (res && res.indexOf("OK") === 0) TR.toast(res.replace(/^OK:?/, "✓ "), "ok");
      else TR.toast(res || "No response from After Effects.", "err");
    });
  });
})();
