/* THEO REVERSE — Projects view: a .aep library you import into the current project in one click */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TR = window.TR;
  if (!$("view-projects")) return;
  const LS = "tr_project_lib";
  const ALL = "All", UNFILED = "Unfiled";

  let lib = load();
  let active = ALL;

  function load() {
    try { const j = JSON.parse(localStorage.getItem(LS)); if (j && j.items) { j.folders = j.folders || []; return j; } } catch (e) {}
    return { folders: [], items: [] };
  }
  function save() { localStorage.setItem(LS, JSON.stringify(lib)); }
  const uid = () => "j" + Math.random().toString(36).slice(2, 9);
  const baseName = (p) => String(p).replace(/.*[\\/]/, "");
  const ok = (r) => !!r && r.indexOf("OK") === 0;

  const inFolder = (it) => active === ALL || it.folder === active;
  function unfiledCount() { let n = 0; lib.items.forEach((it) => { if (lib.folders.indexOf(it.folder) < 0) n++; }); return n; }

  function renderFolders() {
    const wrap = $("jFolders"); wrap.innerHTML = "";
    const chips = [{ name: ALL, count: lib.items.length }];
    lib.folders.forEach((f) => chips.push({ name: f, count: lib.items.filter((it) => it.folder === f).length }));
    if (unfiledCount()) chips.push({ name: UNFILED, count: unfiledCount() });
    chips.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pfolder" + (c.name === active ? " on" : "");
      b.innerHTML = c.name + ' <span class="cnt">' + c.count + "</span>";
      b.addEventListener("click", () => { active = c.name; render(); });
      if (c.name === active && c.name !== ALL && c.name !== UNFILED) {
        const x = document.createElement("span");
        x.className = "fdel"; x.textContent = "×"; x.title = "delete folder (projects move to Unfiled)";
        x.addEventListener("click", (e) => { e.stopPropagation(); deleteFolder(c.name); });
        b.appendChild(document.createTextNode(" ")); b.appendChild(x);
      }
      wrap.appendChild(b);
    });
  }

  function renderList() {
    const list = $("jList"); list.innerHTML = "";
    const items = lib.items.filter(inFolder);
    $("jEmpty").classList.toggle("hidden", items.length > 0);
    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "preset";
      const main = document.createElement("div");
      main.className = "preset-main";
      main.innerHTML = '<span class="preset-name"></span><span class="preset-sub"></span>';
      main.querySelector(".preset-name").textContent = it.name;
      const sub = (active === ALL && lib.folders.indexOf(it.folder) >= 0) ? it.folder : baseName(it.path);
      main.querySelector(".preset-sub").textContent = sub;
      main.querySelector(".preset-sub").title = it.path;

      const imp = document.createElement("button");
      imp.type = "button"; imp.className = "preset-apply"; imp.textContent = "Import";
      imp.title = "merge this project's comps + footage into the current project";
      imp.addEventListener("click", () => importProject(it));

      const del = document.createElement("button");
      del.type = "button"; del.className = "preset-del"; del.textContent = "×"; del.title = "remove from library";
      del.addEventListener("click", () => { lib.items = lib.items.filter((x) => x.id !== it.id); save(); render(); });

      row.appendChild(main); row.appendChild(imp); row.appendChild(del);
      list.appendChild(row);
    });
  }
  function render() { renderFolders(); renderList(); }

  function importProject(it) {
    TR.toast("Importing " + it.name + "…");
    TR.evalJSX("theoReverse_importProject(" + JSON.stringify(it.path) + ")").then((res) => {
      if (ok(res)) TR.toast(res.replace(/^OK:?/, "✓ "), "ok");
      else TR.toast(res || "No response from After Effects.", "err");
    });
  }
  function addPath(path) {
    if (!path) return;
    const folder = (active === ALL) ? UNFILED : active;
    lib.items.push({ id: uid(), name: baseName(path).replace(/\.aepx?$/i, ""), folder: folder, path: path });
    save(); render();
    TR.toast("added · " + baseName(path), "ok");
  }

  $("jAdd").addEventListener("click", () => {
    TR.evalJSX("theoReverse_pickProject()").then((res) => {
      if (!ok(res)) { TR.toast(res || "couldn't open the picker.", "err"); return; }
      addPath(res.slice(3).trim());
    });
  });
  $("jSaveCur").addEventListener("click", () => {
    TR.toast("save your project to the library…");
    TR.evalJSX("theoReverse_saveProjectAs()").then((res) => {
      if (!ok(res)) { TR.toast(res || "couldn't save.", "err"); return; }
      addPath(res.slice(3).trim());
    });
  });

  function addFolder() {
    const name = $("jFolderName").value.trim();
    if (!name) return;
    if (name !== ALL && name !== UNFILED && lib.folders.indexOf(name) < 0) lib.folders.push(name);
    $("jFolderName").value = ""; $("jFolderRow").classList.add("hidden");
    active = name; save(); render();
  }
  function deleteFolder(name) {
    lib.folders = lib.folders.filter((f) => f !== name);
    lib.items.forEach((it) => { if (it.folder === name) it.folder = UNFILED; });
    active = ALL; save(); render();
  }
  $("jNewFolder").addEventListener("click", () => {
    const row = $("jFolderRow"); row.classList.toggle("hidden");
    if (!row.classList.contains("hidden")) setTimeout(() => { try { $("jFolderName").focus(); } catch (e) {} }, 40);
  });
  $("jFolderAdd").addEventListener("click", addFolder);
  $("jFolderName").addEventListener("keydown", (e) => { if (e.key === "Enter") addFolder(); });

  render();
})();
