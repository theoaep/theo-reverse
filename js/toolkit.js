/* THEO REVERSE — Toolkit view: Fast Reverse launcher, Quick Reverse, one-click tools */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TR = window.TR;

  /* ── Fast Reverse launcher ───────────────────────────── */
  $("openFast").addEventListener("click", () => TR.showView("fast"));
  $("backKit").addEventListener("click", () => TR.showView("kit"));

  /* ── Quick Reverse (file picker, no typed paths) ─────── */
  const baseName = (p) => String(p).replace(/.*[\\/]/, "");
  function setQR(path) {
    localStorage.setItem("tr_qr_path", path || "");
    const el = $("qrFile");
    el.textContent = path ? baseName(path) : "no file chosen";
    el.title = path || "";
    el.classList.toggle("muted", !path);
  }
  $("qrPick").addEventListener("click", () => {
    TR.evalJSX("theoReverse_pickFile()").then((res) => {
      if (!res || res.indexOf("OK:") !== 0) { TR.toast(res || "couldn't open the file picker.", "err"); return; }
      const path = res.slice(3).trim();
      if (!path) return;                       // cancelled
      setQR(path);
      TR.toast("preset set · " + baseName(path), "ok");
    });
  });
  setQR(localStorage.getItem("tr_qr_path") || "");

  /* generic file pickers (Fast Reverse settings) — write to a hidden input + remember the path */
  document.querySelectorAll(".pick-btn[data-for]").forEach((btn) => {
    const target = $(btn.getAttribute("data-for"));
    const lsKey = btn.getAttribute("data-ls");
    const nameEl = $(btn.getAttribute("data-for") + "Name");
    const setVal = (path) => {
      if (target) target.value = path || "";
      if (lsKey) localStorage.setItem(lsKey, path || "");
      if (nameEl) { nameEl.textContent = path ? baseName(path) : "none"; nameEl.title = path || ""; nameEl.classList.toggle("muted", !path); }
    };
    const saved = lsKey ? (localStorage.getItem(lsKey) || "") : "";
    if (saved) setVal(saved);
    btn.addEventListener("click", () => {
      TR.evalJSX("theoReverse_pickFile()").then((res) => {
        if (!res || res.indexOf("OK:") !== 0) { TR.toast(res || "couldn't open the file picker.", "err"); return; }
        const path = res.slice(3).trim();
        if (!path) return;
        setVal(path);
        TR.toast("set · " + baseName(path), "ok");
      });
    });
  });

  $("qrGo").addEventListener("click", () => {
    const path = (localStorage.getItem("tr_qr_path") || "").trim();
    if (!path) { TR.toast("Choose your reverse .ffx first.", "err"); return; }
    TR.toast("Applying reverse to selected layers…");
    TR.evalJSX("theoReverse_quickReverse(" + JSON.stringify(path) + ")").then((res) => {
      if (res && res.indexOf("OK") === 0) TR.toast(res.replace(/^OK:?/, "✓ "), "ok");
      else TR.toast(res || "No response from After Effects.", "err");
    });
  });

  /* ── one-click tools ─────────────────────────────────── */
  // unified line-icon set (24px, currentColor) — swaps out the emoji for a professional look
  const svg = (p) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + "</svg>";
  const ICON = {
    saveFrame:    svg('<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 7l1.4-2.4h4.2L15.5 7"/><circle cx="12" cy="13.3" r="3.2"/>'),
    precompEach:  svg('<path d="M12 3l8 4.2v9.6L12 21l-8-4.2V7.2L12 3Z"/><path d="M4.3 7.3 12 11.5l7.7-4.2"/><path d="M12 11.5V21"/>'),
    splitLayer:   svg('<circle cx="6" cy="7" r="2.2"/><circle cx="6" cy="17" r="2.2"/><path d="M8 8.2 19 16.5M8 15.8 19 7.5"/>'),
    reverseLayer: svg('<path d="M11 7v10l-7-5 7-5Z"/><path d="M20 7v10l-7-5 7-5Z"/>'),
    freeze:       svg('<path d="M12 3v18"/><path d="M4.2 7.5 19.8 16.5"/><path d="M19.8 7.5 4.2 16.5"/><path d="m9.5 5 2.5-2 2.5 2"/><path d="m9.5 19 2.5 2 2.5-2"/><path d="m4.8 10.2-.6-2.9 2.9-.3"/><path d="m19.2 10.2.6-2.9-2.9-.3"/><path d="m4.8 13.8-.6 2.9 2.9.3"/><path d="m19.2 13.8.6 2.9-2.9.3"/>'),
    loop:         svg('<path d="M4 10.5V10a5 5 0 0 1 5-5h9"/><path d="M15 1.5 18.5 5 15 8.5"/><path d="M20 13.5v.5a5 5 0 0 1-5 5H6"/><path d="M9 22.5 5.5 19 9 15.5"/>'),
    trimWA:       svg('<path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H16"/>'),
    sequence:     svg('<rect x="3" y="9" width="4.7" height="6" rx="1"/><rect x="9.6" y="9" width="4.7" height="6" rx="1"/><rect x="16.3" y="9" width="4.7" height="6" rx="1"/>'),
    pixelMotion:  svg('<path d="M2.5 12.5c2 0 2.5-5 4.5-5s2.5 9 4.5 9 2.5-5 4.5-5 2 1.5 3 1.5"/>'),
    motionBlur:   svg('<path d="M4 8h13"/><path d="M3 12h18"/><path d="M6 16h11"/>'),
    fitComp:      svg('<path d="M9 4H5.2A1.2 1.2 0 0 0 4 5.2V9M15 4h3.8A1.2 1.2 0 0 1 20 5.2V9M20 15v3.8a1.2 1.2 0 0 1-1.2 1.2H15M4 15v3.8A1.2 1.2 0 0 0 5.2 20H9"/>'),
    centerAnchor: svg('<circle cx="12" cy="12" r="7.3"/><path d="M12 1.8v3.4M12 18.8v3.4M1.8 12h3.4M18.8 12h3.4"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>'),
    adjust:       svg('<path d="M4 7h8M16 7h4M4 12h3M11 12h9M4 17h5M13 17h7"/><circle cx="14" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="11" cy="17" r="2"/>'),
    solidBG:      svg('<rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" fill-opacity="0.16"/>'),
    speedRamp:    svg('<path d="M3 19c7 0 9-13 18-13"/><path d="M16 6h5v5"/>'),
    beatZoom:     svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M10.5 7.7v5.6M7.7 10.5h5.6"/><path d="M20.5 20.5 15.6 15.6"/>'),
    flash:        svg('<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>'),
    organize:     svg('<path d="M3 7.5a1.5 1.5 0 0 1 1.5-1.5H8l2 2h8.5A1.5 1.5 0 0 1 20 9.5v8A1.5 1.5 0 0 1 18.5 19h-14A1.5 1.5 0 0 1 3 17.5Z"/>')
  };
  const TOOLS = [
    { key: "speedRamp",    lab: "Speed Ramp" },
    { key: "beatZoom",     lab: "Beat Zoom" },
    { key: "flash",        lab: "Flash" },
    { key: "organize",     lab: "Organize" },
    { key: "saveFrame",    lab: "Save Frame" },
    { key: "precompEach",  lab: "Precomp Each" },
    { key: "splitLayer",   lab: "Split Layer" },
    { key: "reverseLayer", lab: "Reverse Layer" },
    { key: "freeze",       lab: "Freeze Frame" },
    { key: "loop",         lab: "Loop Layer" },
    { key: "trimWA",       lab: "Trim to WA" },
    { key: "sequence",     lab: "Sequence" },
    { key: "pixelMotion",  lab: "Pixel Motion" },
    { key: "motionBlur",   lab: "Motion Blur" },
    { key: "fitComp",      lab: "Fit to Comp" },
    { key: "centerAnchor", lab: "Center Anchor" },
    { key: "adjust",       lab: "Adjust Layer" },
    { key: "solidBG",      lab: "Solid BG" }
  ];

  const grid = $("kitgrid");
  TOOLS.forEach((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tool";
    b.innerHTML = '<span class="tool-ico">' + (ICON[t.key] || "") + '</span><span class="tool-lab">' + t.lab + "</span>";
    b.addEventListener("click", () => {
      b.classList.remove("flash");
      void b.offsetWidth;
      b.classList.add("flash");
      const SPECIAL = {
        precompEach: "theoReverse_precompEach()",
        saveFrame:   "theoReverse_saveFrame()",
        speedRamp:   'theoReverse_speedRamp("")',
        beatZoom:    'theoReverse_beatZoom("")',
        organize:    "theoReverse_organize()",
        flash:       'theoReverse_flash("")'
      };
      const call = SPECIAL[t.key] || ("theoReverse_tool(" + JSON.stringify(t.key) + ")");
      TR.evalJSX(call).then((res) => {
        if (res && res.indexOf("OK") === 0) TR.toast(res.replace(/^OK:?/, "✓ "), "ok");
        else TR.toast(res || "No response from After Effects.", "err");
      });
    });
    grid.appendChild(b);
  });
})();
