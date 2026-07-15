/* THEO REVERSE — Text animations view */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TR = window.TR;

  const IN_ANIMS = [
    { key: "fadeIn",      ico: "🌤️", lab: "Fade In" },
    { key: "popIn",       ico: "💥", lab: "Pop In" },
    { key: "slideUpIn",   ico: "⬆️", lab: "Slide Up" },
    { key: "slideDownIn", ico: "⬇️", lab: "Slide Down" },
    { key: "blurIn",      ico: "🌫️", lab: "Blur In" },
    { key: "typeIn",      ico: "⌨️", lab: "Typewriter" },
    { key: "trackIn",     ico: "↔️", lab: "Tracking In" }
  ];
  const OUT_ANIMS = [
    { key: "fadeOut",      ico: "🌙", lab: "Fade Out" },
    { key: "popOut",       ico: "💨", lab: "Pop Out" },
    { key: "slideUpOut",   ico: "⤴️", lab: "Slide Up Out" },
    { key: "slideDownOut", ico: "⤵️", lab: "Slide Down Out" },
    { key: "blurOut",      ico: "🌁", lab: "Blur Out" },
    { key: "trackOut",     ico: "↕️", lab: "Tracking Out" }
  ];

  function buildGrid(el, anims, isIn) {
    anims.forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tool";
      b.innerHTML =
        '<span class="tool-ico">' + a.ico + '</span>' +
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
