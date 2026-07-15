/* THEO REVERSE — Presets view: a .ffx library with folders, applied to selected layers */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TR = window.TR;
  const LS = "tr_preset_lib";
  const ALL = "All", UNFILED = "Unfiled";

  let lib = load();
  let active = ALL;

  function load() {
    try {
      const j = JSON.parse(localStorage.getItem(LS));
      if (j && j.items) { j.folders = j.folders || []; return j; }
    } catch (e) {}
    return { folders: [], items: [] };
  }
  function save() { localStorage.setItem(LS, JSON.stringify(lib)); }
  const uid = () => "p" + Math.random().toString(36).slice(2, 9);
  const baseName = (p) => String(p).replace(/.*[\\/]/, "");

  /* ── render ──────────────────────────────────────────── */
  function inFolder(it) { return active === ALL || it.folder === active; }
  function unfiledCount() { let n = 0; lib.items.forEach((it) => { if (lib.folders.indexOf(it.folder) < 0) n++; }); return n; }

  function renderFolders() {
    const wrap = $("pFolders"); wrap.innerHTML = "";
    const chips = [{ name: ALL, count: lib.items.length }];
    lib.folders.forEach((f) => chips.push({ name: f, count: lib.items.filter((it) => it.folder === f).length }));
    if (unfiledCount()) chips.push({ name: UNFILED, count: unfiledCount() });

    chips.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pfolder" + (c.name === active ? " on" : "");
      b.innerHTML = c.name + ' <span class="cnt">' + c.count + "</span>";
      b.addEventListener("click", () => { active = c.name; renderFolders(); renderList(); });
      // a real (user) folder that's active can be deleted
      if (c.name === active && c.name !== ALL && c.name !== UNFILED) {
        const x = document.createElement("span");
        x.className = "fdel"; x.textContent = "×"; x.title = "delete folder (presets move to Unfiled)";
        x.addEventListener("click", (e) => { e.stopPropagation(); deleteFolder(c.name); });
        b.appendChild(document.createTextNode(" "));
        b.appendChild(x);
      }
      wrap.appendChild(b);
    });
  }

  function renderList() {
    const list = $("pList"); list.innerHTML = "";
    const items = lib.items.filter(inFolder);
    $("pEmpty").classList.toggle("hidden", items.length > 0);
    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "preset";
      const main = document.createElement("div");
      main.className = "preset-main";
      const sub = (active === ALL && lib.folders.indexOf(it.folder) >= 0) ? it.folder : baseName(it.path);
      main.innerHTML = '<span class="preset-name"></span><span class="preset-sub"></span>';
      main.querySelector(".preset-name").textContent = it.name;
      main.querySelector(".preset-sub").textContent = sub;
      main.querySelector(".preset-sub").title = it.path;

      const apply = document.createElement("button");
      apply.type = "button"; apply.className = "preset-apply"; apply.textContent = "Apply";
      apply.addEventListener("click", () => applyPreset(it));

      const del = document.createElement("button");
      del.type = "button"; del.className = "preset-del"; del.textContent = "×"; del.title = "remove from library";
      del.addEventListener("click", () => { lib.items = lib.items.filter((x) => x.id !== it.id); save(); render(); });

      row.appendChild(main); row.appendChild(apply); row.appendChild(del);
      list.appendChild(row);
    });
  }
  function render() { renderFolders(); renderList(); }

  /* ── actions ─────────────────────────────────────────── */
  function applyPreset(it) {
    TR.toast("Applying " + it.name + "…");
    TR.evalJSX("theoReverse_applyPreset(" + JSON.stringify(it.path) + ")").then((res) => {
      if (res && res.indexOf("OK") === 0) TR.toast(res.replace(/^OK:?/, "✓ "), "ok");
      else TR.toast(res || "No response from After Effects.", "err");
    });
  }

  $("pAdd").addEventListener("click", () => {
    TR.evalJSX("theoReverse_pickFile()").then((res) => {
      if (!res || res.indexOf("OK:") !== 0) { TR.toast(res || "couldn't open the file picker.", "err"); return; }
      const path = res.slice(3).trim();
      if (!path) return;                       // cancelled
      const folder = (active === ALL) ? UNFILED : active;
      lib.items.push({ id: uid(), name: baseName(path).replace(/\.ffx$/i, ""), folder: folder, path: path });
      save(); render();
      TR.toast("added · " + baseName(path), "ok");
    });
  });

  function addFolder() {
    const name = $("pFolderName").value.trim();
    if (!name) return;
    if (name !== ALL && name !== UNFILED && lib.folders.indexOf(name) < 0) lib.folders.push(name);
    $("pFolderName").value = "";
    $("pFolderRow").classList.add("hidden");
    active = name; save(); render();
  }
  function deleteFolder(name) {
    lib.folders = lib.folders.filter((f) => f !== name);
    lib.items.forEach((it) => { if (it.folder === name) it.folder = UNFILED; });
    active = ALL; save(); render();
  }
  $("pNewFolder").addEventListener("click", () => {
    const row = $("pFolderRow");
    row.classList.toggle("hidden");
    if (!row.classList.contains("hidden")) setTimeout(() => { try { $("pFolderName").focus(); } catch (e) {} }, 40);
  });
  $("pFolderAdd").addEventListener("click", addFolder);
  $("pFolderName").addEventListener("keydown", (e) => { if (e.key === "Enter") addFolder(); });

  render();
})();
