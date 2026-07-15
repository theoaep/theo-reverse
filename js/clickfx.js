/* THEO REVERSE — global click ripples + cursor-follow sheen (pure flair, no deps) */
(function () {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // elements that get a click ripple (tappad has its own richer effect → excluded)
  const RIPPLE = ".tool,.build,.hero,.mini,.ghost,.sendbtn,.playbtn,.rail-btn,.chip";

  document.addEventListener("pointerdown", (e) => {
    if (reduce || e.button !== 0) return;
    const el = e.target.closest(RIPPLE);
    if (!el || el.disabled) return;
    const r = el.getBoundingClientRect();
    const d = Math.max(r.width, r.height) * 1.6;
    const rip = document.createElement("span");
    rip.className = "rfx";
    rip.style.width = rip.style.height = d + "px";
    rip.style.left = (e.clientX - r.left) + "px";
    rip.style.top = (e.clientY - r.top) + "px";
    el.appendChild(rip);
    rip.animate(
      [{ transform: "translate(-50%,-50%) scale(0)", opacity: 0.55 },
       { transform: "translate(-50%,-50%) scale(1)", opacity: 0 }],
      { duration: 560, easing: "cubic-bezier(0.23,1,0.32,1)" }
    ).onfinish = () => rip.remove();
  }, { passive: true });

  // cursor-follow radial sheen on tools / hero / build
  if (!reduce) {
    const GLOW = ".tool,.hero,.build";
    let raf = 0, last = null;
    document.addEventListener("pointermove", (e) => {
      last = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = last.target.closest(GLOW);
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", ((last.clientX - r.left) / r.width * 100) + "%");
        el.style.setProperty("--my", ((last.clientY - r.top) / r.height * 100) + "%");
      });
    }, { passive: true });
  }
})();
