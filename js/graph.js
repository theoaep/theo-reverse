/* THEO REVERSE — Graph editor: draggable cubic-bezier -> AE eases on selected keys */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TR = window.TR;
  const LS_PRESETS = "tr_graphs";

  // curve state, cubic-bezier style: P1 pulls from start, P2 pulls from end
  let x1 = 0.42, y1 = 0, x2 = 0.58, y2 = 1;

  const BUILTINS = [
    { name: "Ramp",       v: [0.60, 0.04, 0.90, 0.50] },   // accelerate: slow build → whip out
    { name: "Smooth",     v: [0.42, 0.00, 0.58, 1.00] },   // ease in-out
    { name: "Soft",       v: [0.33, 0.10, 0.40, 1.00] },   // gentle in-out
    { name: "Punch",      v: [0.12, 0.85, 0.25, 1.00] },   // fast start, settles
    { name: "Anticipate", v: [0.50, -0.30, 0.60, 1.00] },  // dips back first
    { name: "Overshoot",  v: [0.30, 0.00, 0.20, 1.35] }    // flies past, snaps back
  ];

  /* ── canvas ──────────────────────────────────────────── */
  const canvas = $("gCanvas"), ctx = canvas.getContext("2d");
  const Y_MIN = -0.45, Y_MAX = 1.45;   // vertical range drawn (allows overshoot)
  const PAD = 14;
  let dragging = 0;                    // 0 none, 1 = P1, 2 = P2

  function cw() { return canvas.getBoundingClientRect().width; }
  function ch() { return canvas.getBoundingClientRect().height; }
  function toPx(x, y) {
    return [PAD + x * (cw() - PAD * 2),
            ch() - PAD - ((y - Y_MIN) / (Y_MAX - Y_MIN)) * (ch() - PAD * 2)];
  }
  function fromPx(px, py) {
    return [(px - PAD) / (cw() - PAD * 2),
            Y_MIN + ((ch() - PAD - py) / (ch() - PAD * 2)) * (Y_MAX - Y_MIN)];
  }

  function sizeCanvas() {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width) return;
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  window.addEventListener("resize", sizeCanvas);

  function draw() {
    const w = cw(), h = ch();
    if (!w) return;
    ctx.clearRect(0, 0, w, h);

    // unit box (0..1)
    const [bx0, by1] = toPx(0, 0), [bx1, by0] = toPx(1, 1);
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
    // quarter grid
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    for (let i = 1; i < 4; i++) {
      const gx = bx0 + (bx1 - bx0) * i / 4, gy = by0 + (by1 - by0) * i / 4;
      ctx.beginPath(); ctx.moveTo(gx, by0); ctx.lineTo(gx, by1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx0, gy); ctx.lineTo(bx1, gy); ctx.stroke();
    }
    // linear reference
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath(); ctx.moveTo(...toPx(0, 0)); ctx.lineTo(...toPx(1, 1)); ctx.stroke();
    ctx.setLineDash([]);

    const A = toPx(0, 0), B = toPx(1, 1), P1 = toPx(x1, y1), P2 = toPx(x2, y2);

    // handle stems
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(139,92,246,0.7)";
    ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(...P1); ctx.stroke();
    ctx.strokeStyle = "rgba(245,158,11,0.7)";
    ctx.beginPath(); ctx.moveTo(...B); ctx.lineTo(...P2); ctx.stroke();

    // the curve
    const grad = ctx.createLinearGradient(A[0], 0, B[0], 0);
    grad.addColorStop(0, "#8b5cf6"); grad.addColorStop(0.55, "#ec4899"); grad.addColorStop(1, "#f59e0b");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(...A);
    ctx.bezierCurveTo(P1[0], P1[1], P2[0], P2[1], B[0], B[1]);
    ctx.stroke();

    // anchors + handles
    dot(A, "#fff", 3.5); dot(B, "#fff", 3.5);
    dot(P1, "#8b5cf6", 7); dot(P2, "#f59e0b", 7);

    $("gRead").textContent = x1.toFixed(2) + " · " + y1.toFixed(2) + " · " + x2.toFixed(2) + " · " + y2.toFixed(2);
  }
  function dot(p, color, r) {
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = "rgba(10,10,15,0.8)"; ctx.lineWidth = 2; ctx.stroke();
  }

  /* ── dragging ────────────────────────────────────────── */
  function hit(px, py) {
    const P1 = toPx(x1, y1), P2 = toPx(x2, y2);
    const d1 = Math.hypot(px - P1[0], py - P1[1]);
    const d2 = Math.hypot(px - P2[0], py - P2[1]);
    if (Math.min(d1, d2) > 26) return 0;
    return d1 <= d2 ? 1 : 2;
  }
  canvas.addEventListener("pointerdown", (e) => {
    const r = canvas.getBoundingClientRect();
    dragging = hit(e.clientX - r.left, e.clientY - r.top);
    if (dragging) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const r = canvas.getBoundingClientRect();
    let [nx, ny] = fromPx(e.clientX - r.left, e.clientY - r.top);
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(Y_MIN, Math.min(Y_MAX, ny));
    if (dragging === 1) { x1 = nx; y1 = ny; } else { x2 = nx; y2 = ny; }
    draw();
  });
  ["pointerup", "pointercancel"].forEach((ev) => canvas.addEventListener(ev, () => { dragging = 0; }));

  /* ── presets ─────────────────────────────────────────── */
  const loadUser = () => { try { return JSON.parse(localStorage.getItem(LS_PRESETS)) || []; } catch (e) { return []; } };
  const saveUser = (list) => localStorage.setItem(LS_PRESETS, JSON.stringify(list));

  function setCurve(v) { x1 = v[0]; y1 = v[1]; x2 = v[2]; y2 = v[3]; draw(); }

  function renderPresets() {
    const el = $("gPresets");
    el.innerHTML = "";
    BUILTINS.forEach((p) => el.appendChild(chip(p, false)));
    loadUser().forEach((p) => el.appendChild(chip(p, true)));
  }
  function chip(p, user) {
    const c = document.createElement("span");
    c.className = "mk-chip g-chip";
    c.textContent = p.name;
    c.addEventListener("click", () => { setCurve(p.v); TR.toast("“" + p.name + "” loaded — hit Apply", "ok"); });
    if (user) {
      const x = document.createElement("i");
      x.className = "g-x";
      x.textContent = "×";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        saveUser(loadUser().filter((q) => q.name !== p.name));
        renderPresets();
      });
      c.appendChild(x);
    }
    return c;
  }

  $("gSave").addEventListener("click", () => {
    const name = $("gName").value.trim();
    if (!name) { TR.toast("give the graph a name first", "err"); return; }
    const list = loadUser().filter((q) => q.name !== name);
    list.push({ name, v: [x1, y1, x2, y2].map((n) => +n.toFixed(3)) });
    saveUser(list);
    $("gName").value = "";
    renderPresets();
    TR.toast("✓ saved “" + name + "”", "ok");
  });
  $("gName").addEventListener("keydown", (e) => { if (e.key === "Enter") $("gSave").click(); });

  /* ── apply ───────────────────────────────────────────── */
  $("gApply").addEventListener("click", () => {
    TR.evalJSX("theoReverse_applyGraph(" + [x1, y1, x2, y2].map((n) => +n.toFixed(4)).join(",") + ")")
      .then((res) => {
        if (res && res.indexOf("OK") === 0) TR.toast("✓ " + res.slice(3), "ok");
        else TR.toast(res || "no response from AE", "err");
      });
  });

  /* ── ask ai ──────────────────────────────────────────── */
  $("gAI").addEventListener("click", () => {
    TR.showView("ai");
    const inp = $("aiIn");
    if (!inp) return;
    inp.value = "yo set a graph on my selected keyframes — the vibe i want: ";
    inp.dispatchEvent(new Event("input"));   // trigger autosize
    setTimeout(() => {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }, 150);
  });

  /* boot — canvas may be display:none until the view opens */
  document.querySelectorAll('[data-nav="graph"]').forEach((b) =>
    b.addEventListener("click", () => setTimeout(sizeCanvas, 30)));
  sizeCanvas();
  renderPresets();
  draw();
})();
