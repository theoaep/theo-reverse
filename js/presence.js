/* THEO REVERSE — live "N online" count of open panels, via Firebase Realtime DB presence (REST).
   Setup (one time, free): create a Firebase project → build a Realtime Database → set its rules so
   the /presence path is public, then paste the databaseURL below. Rules:
     { "rules": { "presence": { ".read": true, ".write": true } } }
   No server code, no SDK — each open panel writes a timestamp every ~20s; the count = panels seen in
   the last 45s. Leave the placeholder and the badge simply stays hidden. */
(function () {
  "use strict";

  const PRESENCE_URL = "https://YOUR-PROJECT-default-rtdb.firebaseio.com";
  const HEARTBEAT_MS = 20000;   // how often we ping "still here"
  const WINDOW_MS = 45000;      // a panel counts as online if seen within this window
  const STALE_MS = 300000;      // keys older than this get cleaned up opportunistically

  if (/YOUR-PROJECT/.test(PRESENCE_URL)) return;   // not configured yet — no badge, no calls

  const $ = (id) => document.getElementById(id);
  const base = PRESENCE_URL.replace(/\/+$/, "");
  const idKey = "tr_client_id";
  let cid = localStorage.getItem(idKey);
  if (!cid) { cid = "c" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem(idKey, cid); }
  const meUrl = base + "/presence/" + cid + ".json";
  const allUrl = base + "/presence.json";

  function show(n) {
    const el = $("liveCount"); if (!el) return;
    el.classList.remove("hidden");
    $("liveNum").textContent = n;
    el.title = n + (n === 1 ? " editor" : " editors") + " with THEO REVERSE open right now";
  }

  function beat() {
    try { fetch(meUrl, { method: "PUT", body: String(Date.now()) }).catch(() => {}); } catch (e) {}
  }
  function tick() {
    fetch(allUrl, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) { show(1); return; }
        const now = Date.now();
        let n = 0; const stale = [];
        Object.keys(j).forEach((k) => {
          const ts = +j[k];
          if (now - ts < WINDOW_MS) n++;
          else if (now - ts > STALE_MS) stale.push(k);
        });
        show(Math.max(n, 1));   // we're here, so at least 1
        if (stale.length && Math.random() < 0.3)
          stale.slice(0, 10).forEach((k) => { try { fetch(base + "/presence/" + k + ".json", { method: "DELETE" }).catch(() => {}); } catch (e) {} });
      })
      .catch(() => {});
  }

  beat(); tick();
  setInterval(beat, HEARTBEAT_MS);
  setInterval(tick, HEARTBEAT_MS);
  window.addEventListener("beforeunload", () => {
    try { fetch(meUrl, { method: "DELETE", keepalive: true }); } catch (e) {}
  });
})();
