/* THEO REVERSE — Text animations view */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TR = window.TR;

  const IN_ANIMS = [
    { key: "fadeIn",      lab: "Fade In" },
    { key: "popIn",       lab: "Pop In" },
    { key: "slideUpIn",   lab: "Slide Up" },
    { key: "slideDownIn", lab: "Slide Down" },
    { key: "blurIn",      lab: "Blur In" },
    { key: "typeIn",      lab: "Typewriter" },
    { key: "trackIn",     lab: "Tracking In" },
    { key: "fadeUpWords", lab: "Fade Up Words" },
    { key: "fadeUpWordsBlur", lab: "Fade Up + Blur" },
    { key: "randomChars", lab: "Random Chars" }
  ];
  const OUT_ANIMS = [
    { key: "fadeOut",      lab: "Fade Out" },
    { key: "fadeOutSlow",  lab: "Fade Out Slow" },
    { key: "popOut",       lab: "Pop Out" },
    { key: "slideUpOut",   lab: "Slide Up Out" },
    { key: "slideDownOut", lab: "Slide Down Out" },
    { key: "blurOut",      lab: "Blur Out" },
    { key: "trackOut",     lab: "Tracking Out" }
  ];
  // Random Chars previews as individual letters revealing out of order
  const RC_DELAYS = [0.35, 0, 0.5, 0.15];
  function previewInner(key) {
    if (key !== "randomChars") return "Text";
    return "Text".split("").map((ch, i) => '<span style="animation-delay:' + RC_DELAYS[i % RC_DELAYS.length] + 's">' + ch + "</span>").join("");
  }

  function buildGrid(el, anims, isIn) {
    anims.forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tool tool-tanim";
      b.innerHTML =
        '<span class="tanim-preview"><span class="tanim-word tanim-' + a.key + '">' + previewInner(a.key) + '</span></span>' +
        '<span class="tool-lab">' + a.lab + '</span>' +
        '<span class="tool-tag ' + (isIn ? "in" : "out") + '">' + (isIn ? "IN" : "OUT") + "</span>";
      b.addEventListener("click", () => {
        b.classList.remove("flash");
        void b.offsetWidth;
        b.classList.add("flash");
        const dur = parseFloat(isIn ? $("durIn").value : $("durOut").value) || 0.5;
        TR.evalJSX("theoReverse_textAnim(" + JSON.stringify(a.key) + "," + dur + ")").then((res) => {
          if (res && res.indexOf("OK") === 0) TR.toast(res.replace(/^OK:?/, "✓ "), "ok");
          else TR.toast(res || "No response from After Effects.", "err");
        });
      });
      el.appendChild(b);
    });
  }

  buildGrid($("tanimIn"), IN_ANIMS, true);
  buildGrid($("tanimOut"), OUT_ANIMS, false);

  // remember durations
  ["durIn", "durOut"].forEach((id) => {
    const saved = localStorage.getItem("tr_" + id);
    if (saved) $(id).value = saved;
    $(id).addEventListener("change", () => localStorage.setItem("tr_" + id, $(id).value));
  });
})();
