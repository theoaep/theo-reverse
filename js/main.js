/* THEO REVERSE — shell: nav, intro/greeting, shared helpers */
(function () {
  "use strict";

  const cs = new CSInterface();
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const LS_NAME = "tr_name";
  const LS_VIEW = "tr_view";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── shared API for the other modules ────────────────── */
  const evalJSX = (call) => new Promise((res) => cs.evalScript(call, res));

  let toastTimer;
  function toast(msg, cls) {
    const t = $("toast");
    t.className = "toast show" + (cls ? " " + cls : "");
    t.textContent = msg;
    clearTimeout(toastTimer);
    if (cls !== "err") toastTimer = setTimeout(hideToast, 5000);
  }
  function hideToast() { $("toast").className = "toast"; }

  function showView(v) {
    document.querySelectorAll(".view").forEach((el) => el.classList.remove("active"));
    const target = $("view-" + v);
    if (target) target.classList.add("active");
    const railV = (v === "fast" || v === "marker") ? "kit" : v;
    document.querySelectorAll(".rail-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.nav === railV));
    if (v !== "fast" && v !== "marker") localStorage.setItem(LS_VIEW, v);
  }

  window.TR = {
    cs, evalJSX, toast, hideToast, showView, reduceMotion,
    getName: () => localStorage.getItem(LS_NAME) || "",
    openURL: (u) => { try { cs.openURLInDefaultBrowser(u); } catch (e) { window.open(u); } }
  };

  /* ── nav rail ────────────────────────────────────────── */
  document.querySelectorAll(".rail-btn").forEach((b) =>
    b.addEventListener("click", () => showView(b.dataset.nav)));
  showView(localStorage.getItem(LS_VIEW) || "ai");

  /* ── host ping ───────────────────────────────────────── */
  evalJSX("theoReverse_ping()").then((r) => {
    if (r && r.indexOf("ERR") !== 0) { $("hostinfo").textContent = r; $("dot").classList.add("on"); }
    else { $("hostinfo").textContent = "bridge not ready"; }
  });

  /* ── update check ────────────────────────────────────── */
  // Bump this on every release; keep it equal to CSXS/manifest.xml ExtensionBundleVersion.
  const CURRENT_VERSION = "1.1.0";
  // Where "the latest version" lives. Pick ONE (see README → Releasing):
  //   • GitHub Releases API:  https://api.github.com/repos/<user>/theo-reverse/releases/latest
  //   • A JSON you host:      https://<your-site>/version.json   → { "version":"1.1.0", "notes":"…", "url":"…" }
  const UPDATE_URL = "https://api.github.com/repos/theoaep/theo-reverse/releases/latest";

  function verParts(v) {
    return String(v == null ? "0" : v).replace(/^v/i, "").trim()
      .split(".").map((x) => parseInt(x, 10) || 0);
  }
  function isNewer(remote, current) {
    const A = verParts(remote), B = verParts(current), n = Math.max(A.length, B.length);
    for (let i = 0; i < n; i++) { const x = A[i] || 0, y = B[i] || 0; if (x !== y) return x > y; }
    return false;
  }
  function showUpdateBar(ver, notes, url) {
    const bar = $("updateBar"); if (!bar) return;
    $("updateVer").textContent = "Update available · v" + ver;
    $("updateNote").textContent = notes ? " — " + notes : "";
    $("updateGet").onclick = () => TR.openURL(url);   // opens the release page (zip + installers)
    $("updateSkip").onclick = () => { bar.classList.add("hidden"); localStorage.setItem("tr_update_skip", ver); };
    bar.classList.remove("hidden");
  }
  function checkForUpdate() {
    if (/YOUR_GH_USER/.test(UPDATE_URL)) return;   // not wired to a real repo yet — skip the call
    fetch(UPDATE_URL, { headers: { "Accept": "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        // tolerant: works with a hand-written version.json OR the GitHub Releases API response
        const latest = String(j.version || j.tag_name || "").replace(/^v/i, "").trim();
        if (!latest || !isNewer(latest, CURRENT_VERSION)) return;
        if (localStorage.getItem("tr_update_skip") === latest) return;   // user dismissed this one
        const url = j.url || j.html_url || UPDATE_URL;
        const notes = String(j.notes || j.body || "").split("\n")[0].replace(/[#*_`>\-]/g, "").trim().slice(0, 70);
        showUpdateBar(latest, notes, url);
      })
      .catch(() => { /* offline / blocked — stay quiet */ });
  }
  checkForUpdate();

  /* ── intro / greeting ────────────────────────────────── */
  let greetTimer = null;

  function greetLine(name) {
    const h = new Date().getHours();
    if (h < 5)  return "Still cooking, " + name + "?";
    if (h < 12) return "Good morning, " + name + ".";
    if (h < 18) return "Good afternoon, " + name + ".";
    return "Good evening, " + name + ".";
  }
  const SUBS = [
    "Let's make it loop.",
    "Beats ready when you are.",
    "Time to reverse something.",
    "Funk loaded. Locked in.",
    "Siu. Let's go."
  ];

  function initIntro() {
    body.classList.add("intro-open");
    const saved = localStorage.getItem(LS_NAME);
    if (saved) showGreet(saved);
    else {
      $("nameStep").classList.remove("hidden");
      setTimeout(() => { try { $("nameInput").focus(); } catch (e) {} }, 400);
    }
  }

  function showGreet(name) {
    $("nameStep").classList.add("hidden");
    $("greetStep").classList.remove("hidden");
    const line = greetLine(name);
    const el = $("greetText");
    el.innerHTML = "";
    Array.from(line).forEach((ch, i) => {
      const s = document.createElement("span");
      s.textContent = ch === " " ? " " : ch;
      s.style.setProperty("--i", i);
      el.appendChild(s);
    });
    $("greetSub").textContent = SUBS[Math.floor(Math.random() * SUBS.length)];
    const hold = reduceMotion ? 900 : 520 + line.length * 26 + 950;
    clearTimeout(greetTimer);
    greetTimer = setTimeout(dismissIntro, Math.min(hold, 2600));
  }

  function dismissIntro() {
    clearTimeout(greetTimer);
    const iv = $("intro");
    if (!iv || iv.classList.contains("leave") || iv.classList.contains("gone")) return;
    iv.classList.add("leave");
    setTimeout(() => {
      iv.classList.add("gone");
      iv.classList.remove("leave");
      body.classList.remove("intro-open");
      body.classList.add("ready");
      const n = localStorage.getItem(LS_NAME);
      $("who").textContent = n ? "hi, " + n : "";
    }, 640);
  }

  $("nameInput").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const v = e.target.value.trim();
    if (!v) {
      e.target.classList.remove("nope");
      void e.target.offsetWidth;
      e.target.classList.add("nope");
      return;
    }
    localStorage.setItem(LS_NAME, v);
    showGreet(v);
  });

  $("intro").addEventListener("click", () => {
    if (!$("greetStep").classList.contains("hidden")) dismissIntro();
  });

  $("who").addEventListener("click", () => {
    const iv = $("intro");
    iv.classList.remove("gone", "leave");
    body.classList.add("intro-open");
    body.classList.remove("ready");
    $("greetStep").classList.add("hidden");
    $("nameStep").classList.remove("hidden");
    const inp = $("nameInput");
    inp.value = localStorage.getItem(LS_NAME) || "";
    setTimeout(() => { try { inp.select(); inp.focus(); } catch (e) {} }, 300);
  });

  initIntro();
})();
