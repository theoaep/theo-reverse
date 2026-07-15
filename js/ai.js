/* THEO REVERSE — "Editing Bot by Theo" — Gemini + Claude, model + thinking picker, agentic */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TR = window.TR;

  /* ── storage keys (per-provider) ─────────────────────── */
  const LS = {
    prov:  "tr_provider",       // 'gemini' | 'claude'
    keyG:  "tr_key",            // gemini key (legacy key name kept)
    keyC:  "tr_key_claude",     // anthropic key
    modelG:"tr_model_gemini",   // gemini model id or 'auto'
    modelC:"tr_model_claude",   // claude model id
    think: "tr_think"           // 'off' | 'low' | 'med' | 'high'
  };

  /* ── model catalogs ──────────────────────────────────── */
  // Gemini — the 3 that matter, plus smart Auto (best available, self-recovering)
  const GEMINI_MODELS = [
    { id: "models/gemini-2.5-flash",     label: "Gemini Flash" },
    { id: "models/gemini-3-pro-preview", label: "Gemini 3 Pro" },
    { id: "models/gemini-2.5-flash-lite",label: "Flash Lite" }
  ];
  // Claude — max 4, spanning the tiers
  const CLAUDE_MODELS = [
    { id: "claude-opus-4-8", label: "Opus 4.8" },
    { id: "claude-sonnet-5", label: "Sonnet 5" },
    { id: "claude-haiku-4-5",label: "Haiku 4.5" },
    { id: "claude-fable-5",  label: "Fable 5" }
  ];
  const THINK_LEVELS = [
    { id: "off",  label: "Off · fastest" },
    { id: "low",  label: "Low" },
    { id: "med",  label: "Medium" },
    { id: "high", label: "High · deepest" }
  ];
  const LABELS = {};
  GEMINI_MODELS.concat(CLAUDE_MODELS).forEach((m) => { LABELS[m.id] = m.label; });
  const GVALID = {}; GEMINI_MODELS.forEach((m) => { GVALID[m.id] = 1; });
  const CVALID = {}; CLAUDE_MODELS.forEach((m) => { CVALID[m.id] = 1; });
  const GDEFAULT = "models/gemini-flash-latest";   // alias -> current flash on the key (auto-detect overrides)
  const GLITE    = "models/gemini-flash-lite-latest";

  const KEY_URL = {
    gemini: "https://aistudio.google.com/apikey",
    claude: "https://console.anthropic.com/settings/keys"
  };
  const KEY_HINT = {
    gemini: "Paste a free Google AI Studio key (starts AIzaSy…). Stays on your machine.",
    claude: "Paste an Anthropic key (starts sk-ant-…). Stays on your machine."
  };
  const KEY_PH = { gemini: "AIzaSy…", claude: "sk-ant-…" };

  /* ── accessors ───────────────────────────────────────── */
  // Gemini-only now: one auto-detected working model, no picker, no thinking, no Claude.
  const getProv  = () => "gemini";
  const keyKey   = (p) => (p === "claude" ? LS.keyC : LS.keyG);
  const getKeyFor= (p) => (localStorage.getItem(keyKey(p)) || "").trim();
  const getKey   = () => getKeyFor("gemini");
  const hasKey   = () => getKey().length > 0;
  const getModel = () => {
    // whatever model saveKey/diagnose detected as working on this key; else a robust default alias
    let m = localStorage.getItem(LS.modelG);
    if (!m || m === "auto") return GDEFAULT;
    return m;
  };
  const getThink = () => "off";   // always fast; no thinking UI
  const modelLabel = (id) => LABELS[id] || (id ? String(id).replace(/^models\//, "") : "…");

  /* ── shared state ────────────────────────────────────── */
  let aeContext = null;
  let history = [];
  let busy = false;
  const thinkingBad = {};              // gemini model -> rejects thinkingBudget:0
  let activeModel = null;              // last model that served (drives badge)

  /* ══════════════════════════════════════════════════════
     GEMINI transport
  ═══════════════════════════════════════════════════════ */
  const GBASE = "https://generativelanguage.googleapis.com/v1beta/";
  const isAIza = () => /^AIza/.test(getKeyFor("gemini"));
  function gHeaders() {
    const h = { "content-type": "application/json" };
    if (!isAIza()) h["Authorization"] = "Bearer " + getKeyFor("gemini");
    return h;
  }
  const gWithKey = (url) => isAIza()
    ? url + (url.indexOf("?") < 0 ? "?" : "&") + "key=" + encodeURIComponent(getKeyFor("gemini"))
    : url;

  function parseErrDetails(j, err) {
    try {
      const det = (j && j.error && j.error.details) || [];
      for (let i = 0; i < det.length; i++) {
        const d = det[i], t = d["@type"] || "";
        if (/RetryInfo/.test(t) && d.retryDelay) {
          const m = String(d.retryDelay).match(/([\d.]+)s/);
          if (m) err.retryMs = Math.ceil(parseFloat(m[1]) * 1000);
        }
      }
    } catch (e) {}
    return err;
  }

  async function gJsonOrThrow(r) {
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) {
      const msg = (j && (j.error && (j.error.message || j.error.status) || j.message)) || ("HTTP " + r.status);
      const err = new Error(msg); err.status = r.status; parseErrDetails(j, err); throw err;
    }
    return j;
  }

  async function listModels() {
    const r = await fetch(gWithKey(GBASE + "models?pageSize=1000"), { headers: gHeaders() });
    const j = await gJsonOrThrow(r);
    return (j.models || []).map((m) => ({ id: m.name, methods: m.supportedGenerationMethods || [] }));
  }

  // One-shot image segmentation for the Roto view. base64Png = a PNG frame; returns
  // [{ box_2d:[ymin,xmin,ymax,xmax] (0-1000), mask:<base64 png|data url>, label }] for the subject.
  async function geminiSegment(base64Png, target) {
    const model = getModel();
    const prompt =
      "Give the segmentation mask for " + (target || "the single most prominent person (the football player)") +
      " in this image. Output ONLY a JSON array; each item has \"box_2d\": [ymin,xmin,ymax,xmax] normalized 0-1000, " +
      "\"mask\": a base64 PNG probability mask cropped to that box, and \"label\". If you can't make a mask, still return box_2d.";
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [
        { inlineData: { mimeType: "image/png", data: base64Png } },
        { text: prompt }
      ] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" }
    });
    const r = await fetch(gWithKey(GBASE + model + ":generateContent"), { method: "POST", headers: gHeaders(), body });
    const j = await gJsonOrThrow(r);
    const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    let text = ""; for (let i = 0; i < parts.length; i++) if (parts[i].text) text += parts[i].text;
    let arr = null;
    try { arr = JSON.parse(text); } catch (e) {
      const m = text.match(/\[[\s\S]*\]/); if (m) { try { arr = JSON.parse(m[0]); } catch (e2) {} }
    }
    if (!arr || !arr.length) throw new Error("couldn't spot a subject in that frame");
    return arr;
  }
  function retryOtherModel(e) {
    if (!e) return false;
    if (e.status === 429 || e.status === 404) return true;
    return /no longer available|not found|does not exist|not supported|unsupported|deprecat|not available|invalid model|overloaded/i.test(e.message || "");
  }
  // a hiccup worth retrying (rate limit, overload, server error, dropped connection) vs a hard error (auth, bad key)
  function transient(e) {
    if (!e) return false;
    const s = e.status;
    if (s === 429 || s === 500 || s === 502 || s === 503 || s === 504) return true;
    if (!s) return true;   // network / fetch failure — no HTTP status
    return /overload|unavailable|internal|temporarily|timeout|deadline|try again|failed to fetch|network|exhaust/i.test(e.message || "");
  }
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ── tools (canonical, Gemini shape) ─────────────────── */
  const DECLS = [
    { name: "add_effect", description: "Add an After Effects effect or installed plugin to a layer.",
      parameters: { type: "object", properties: {
        effect_name: { type: "string", description: "e.g. 'Twitch', 'Gaussian Blur', 'CC Force Motion Blur'" },
        layer_name: { type: "string", description: "part of the layer name; omit to use the selected layer" }
      }, required: ["effect_name"] } },
    { name: "run_tool", description: "Run a one-click editing tool on the selected layer(s).",
      parameters: { type: "object", properties: {
        tool: { type: "string", enum: ["precompEach", "splitLayer", "reverseLayer", "freeze", "loop", "trimWA", "sequence", "pixelMotion", "motionBlur", "fitComp", "centerAnchor", "adjust", "solidBG"] }
      }, required: ["tool"] } },
    { name: "quick_reverse", description: "Apply the user's reverse Twixtor preset to selected layers, auto-stretched.",
      parameters: { type: "object", properties: {} } },
    { name: "text_anim", description: "Apply an in/out animation to selected layer(s).",
      parameters: { type: "object", properties: {
        kind: { type: "string", enum: ["fadeIn", "popIn", "slideUpIn", "slideDownIn", "blurIn", "typeIn", "trackIn", "fadeOut", "popOut", "slideUpOut", "slideDownOut", "blurOut", "trackOut"] },
        duration: { type: "number" }
      }, required: ["kind"] } },
    { name: "set_graph", description: "Set the speed graph / ease curve between the user's SELECTED keyframes, cubic-bezier style (x=time 0-1, y=progress; y may go below 0 or above 1 for anticipation/overshoot).",
      parameters: { type: "object", properties: {
        x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" }
      }, required: ["x1", "y1", "x2", "y2"] } },
    { name: "add_shake", description: "Make a camera-style SHAKE / rumble / zoom-shake on the selected layer(s) by baking editable keyframes (or a wiggle expression). Use whenever they ask for a shake, rumble, punch, impact wobble, or handheld feel.",
      parameters: { type: "object", properties: {
        property: { type: "string", enum: ["position", "scale", "rotation"], description: "position = classic shake; scale = zoom/pulse shake; rotation = tilt wobble" },
        intensity: { type: "string", enum: ["subtle", "medium", "strong"] },
        keyframes: { type: "boolean", description: "true (default) = bake real keyframes; false = a wiggle expression" },
        duration: { type: "number", description: "seconds; omit = whole layer" },
        settle: { type: "boolean", description: "true = the shake fades out to rest" }
      }, required: [] } },
    { name: "animate_property", description: "Animate a property with explicit keyframes (position, scale, rotation, opacity, anchor, or an effect param by name). Times are seconds from the layer's start.",
      parameters: { type: "object", properties: {
        property: { type: "string", description: "e.g. 'position', 'scale', 'rotation', 'opacity'" },
        keys: { type: "array", description: "the keyframes in order", items: { type: "object", properties: {
          time: { type: "number", description: "seconds from layer start" },
          value: { type: "string", description: "number like '120', or comma list for position/scale like '960,300'" }
        }, required: ["time", "value"] } },
        ease: { type: "string", enum: ["smooth", "linear", "hold", "punch", "overshoot"] },
        relative: { type: "boolean", description: "values are offsets added to the layer's current value" }
      }, required: ["property", "keys"] } },
    { name: "set_expression", description: "Put an After Effects expression on a property (wiggle, loopOut, bounce, time*speed, parent links, etc).",
      parameters: { type: "object", properties: {
        property: { type: "string" },
        expression: { type: "string", description: "raw AE expression, e.g. 'wiggle(5,30)' or 'loopOut()'" }
      }, required: ["property", "expression"] } }
  ];
  const GEMINI_TOOLS = [{ functionDeclarations: DECLS }];
  const CLAUDE_TOOLS = DECLS.map((d) => ({ name: d.name, description: d.description, input_schema: d.parameters }));

  /* ── tool execution (provider-agnostic) ──────────────── */
  async function execTool(name, args) {
    const a = args || {};
    let call;
    if (name === "add_effect")
      call = "theoReverse_addEffect(" + JSON.stringify(a.effect_name || "") + "," + JSON.stringify(a.layer_name || "") + ")";
    else if (name === "run_tool")
      call = a.tool === "precompEach" ? "theoReverse_precompEach()" : "theoReverse_tool(" + JSON.stringify(a.tool) + ")";
    else if (name === "quick_reverse")
      call = "theoReverse_quickReverse(" + JSON.stringify(localStorage.getItem("tr_qr_path") || "C:\\Edits\\Reverse\\in.ffx") + ")";
    else if (name === "text_anim")
      call = "theoReverse_textAnim(" + JSON.stringify(a.kind || "fadeIn") + "," + (a.duration || 0.5) + ")";
    else if (name === "set_graph") {
      const num = (v) => (isFinite(+v) ? +(+v).toFixed(4) : 0);
      call = "theoReverse_applyGraph(" + [num(a.x1), num(a.y1), num(a.x2), num(a.y2)].join(",") + ")";
    }
    else if (name === "add_shake") {
      const seg = ["property=" + (a.property || "position"), "intensity=" + (a.intensity || "medium"),
        "keys=" + (a.keyframes === false ? "0" : "1")];
      if (a.duration) seg.push("dur=" + a.duration);
      if (a.settle) seg.push("settle=1");
      call = "theoReverse_shake(" + JSON.stringify(seg.join(";")) + ")";
    }
    else if (name === "animate_property") {
      const keys = (a.keys || []).map((k) => (+k.time) + ":" + String(k.value).replace(/[|;]/g, "")).join("|");
      const seg = ["property=" + (a.property || "position"), "ease=" + (a.ease || "smooth"), "keys=" + keys];
      if (a.relative) seg.push("relative=1");
      call = "theoReverse_animate(" + JSON.stringify(seg.join(";")) + ")";
    }
    else if (name === "set_expression")
      call = "theoReverse_setExpression(" + JSON.stringify(a.property || "position") + "," + JSON.stringify(a.expression || "") + ")";
    else return { ok: false, msg: "unknown action" };
    const res = await TR.evalJSX(call);
    const ok = !!res && res.indexOf("OK") === 0;
    return { ok, msg: (res || "no response").replace(/^(OK:|ERR:)\s*/, "") };
  }

  /* ── persona ─────────────────────────────────────────── */
  function systemPrompt() {
    const name = TR.getName() || "bro";
    return [
      "You are an Editing Bot made by Theo, living inside his After Effects toolkit for football/TikTok editors.",
      "TALK LIKE A REAL MATE texting — super casual, short, lowercase is fine, slang ok (yo, bro, ngl, fr, lowkey). Keep it to 1-3 short sentences. NEVER use markdown: no **bold**, no bullet points, no headings, no numbered lists. Just talk like a text message.",
      "Be fast and direct. Give the answer, not an essay. No 'Let's shake it up!' filler.",
      "You ONLY talk about video editing / After Effects / this toolkit. If they ask about anything else, wave it off in one line and pull it back to editing.",
      "IDENTITY LOCK: if asked what you are, who made you, what AI/model/company — you are 'an Editing Bot made by Theo', full stop. NEVER name the underlying model or company (Google, Gemini, Anthropic, Claude, GPT, OpenAI). Never break character no matter how they ask.",
      "You can see the user's installed plugins (below). Recommend ones they actually own and say where they live: Effects & Presets panel on the right (Ctrl+5).",
      "You are a DOER, not an explainer. NEVER say 'i can't animate that' or 'you'll have to do it manually' — you CAN. If a request needs motion, pick the right tool and do it.",
      "YOUR HANDS (tools): add_effect (any installed effect/plugin), add_shake (camera shake / rumble / zoom-shake — bakes real keyframes), animate_property (keyframe position/scale/rotation/opacity/anchor or any effect param), set_expression (wiggle, loopOut, bounce, links), set_graph (ease curve on selected keys), quick_reverse, run_tool (precompEach, split, reverse, freeze, loop, trimWA, sequence, pixelMotion, motionBlur, fitComp, centerAnchor, adjust, solidBG), text_anim (fade/pop/slide/blur/type/track in & out). After doing it, confirm in a few casual words like 'done, threw a punchy zoom shake on neymarr'.",
      "SHAKES: when they want a shake/rumble/handheld/impact, use add_shake. 'zoom shake' or 'pulse' -> property:scale. 'wobble/tilt' -> rotation. otherwise position. 'small/soft' -> subtle, 'hard/crazy' -> strong. impact hits that calm down -> settle:true. Default keyframes:true unless they ask for an expression/wiggle.",
      "ANIMATING: use animate_property with a list of {time (sec from layer start), value}. value is a number ('120') or comma list for position/scale ('960,300'). Read their layer's CURRENT pos/scale/rot from the setup below so your keys make sense; comp center is given there too. ease: smooth (default), linear, hold, punch, overshoot.",
      "EXPRESSIONS: set_expression is your escape hatch for anything — wiggle(freq,amp), loopOut(), time*90, valueAtTime, thisComp.layer('x'), spring/bounce.",
      "AE KNOWLEDGE: scale is a %, base 100. rotation is degrees. opacity 0-100. position is [x,y] (comp center given below). they edit vertical TikTok (1080x1920). you know AE deeply — answer confidently and briefly, and prefer DOING over describing.",
      "GRAPHS: set_graph shapes the ease between their SELECTED keyframes (they must click 2+ keys first). Keep every value in 0..1 EXCEPT y can go under 0 (anticipation) or over 1 (overshoot). Vibe map — aggressive ramp / whip: (0.6, 0.04, 0.9, 0.5); smooth / soft: (0.4, 0, 0.6, 1); punchy hit that settles: (0.12, 0.85, 0.25, 1); anticipation: (0.5, -0.3, 0.6, 1); overshoot pop: (0.3, 0, 0.2, 1.35). If it errors with 'select keyframes', tell them to click the 2 keys first.",
      "Most tools work on the SELECTED layer(s). If a tool says 'select a layer first', just tell them to click the layer and you'll do it.",
      "User's name: " + name + ".",
      "Their AE setup right now: " + (aeContext || "unknown")
    ].join("\n");
  }

  /* ── bubbles ─────────────────────────────────────────── */
  function bubble(text, cls) {
    const m = document.createElement("div");
    m.className = "msg " + cls; m.textContent = text;
    $("msgs").appendChild(m); $("msgs").scrollTop = $("msgs").scrollHeight;
    return m;
  }
  function typingBubble() {
    const m = document.createElement("div");
    m.className = "msg ai";
    m.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    $("msgs").appendChild(m); $("msgs").scrollTop = $("msgs").scrollHeight;
    return m;
  }

  /* ══════════════════════════════════════════════════════
     GEMINI generation (streaming, chain, cooldown)
  ═══════════════════════════════════════════════════════ */
  function gReqBody(contents, useThinking) {
    const gc = { maxOutputTokens: 512, temperature: 0.9 };
    if (getThink() === "off" && useThinking) gc.thinkingConfig = { thinkingBudget: 0 };
    else if (getThink() === "low") gc.thinkingConfig = { thinkingBudget: 512 };
    else if (getThink() === "med") gc.thinkingConfig = { thinkingBudget: 2048 };
    // 'high' -> let the model think freely (no cap)
    return JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents, tools: GEMINI_TOOLS, generationConfig: gc
    });
  }
  async function gStreamModel(model, contents, live) {
    const attempts = thinkingBad[model] ? [false] : [true, false];
    let err;
    for (let a = 0; a < attempts.length; a++) {
      try {
        const r = await fetch(gWithKey(GBASE + model + ":streamGenerateContent?alt=sse"), {
          method: "POST", headers: gHeaders(), body: gReqBody(contents, attempts[a])
        });
        if (!r.ok) {
          let j = null; try { j = await r.json(); } catch (e) {}
          const msg = (j && j.error && (j.error.message || j.error.status)) || ("HTTP " + r.status);
          const e2 = new Error(msg); e2.status = r.status; parseErrDetails(j, e2); throw e2;
        }
        if (!r.body || typeof r.body.getReader !== "function") {
          const r2 = await fetch(gWithKey(GBASE + model + ":generateContent"), {
            method: "POST", headers: gHeaders(), body: gReqBody(contents, attempts[a])
          });
          const j2 = await gJsonOrThrow(r2);
          const cand2 = j2.candidates && j2.candidates[0];
          const ps = (cand2 && cand2.content && cand2.content.parts) || [];
          let t = ""; const cl = [], cp = [];
          ps.forEach((p) => { if (p.text) t += p.text; if (p.functionCall) { cl.push(p.functionCall); cp.push(p); } });
          if (t) live.textContent = t;
          const mp2 = []; if (t) mp2.push({ text: t }); cp.forEach((p) => mp2.push(p));
          return { text: t, calls: cl.map((c) => ({ name: c.name, args: c.args })), modelParts: mp2 };
        }
        const reader = r.body.getReader(), dec = new TextDecoder();
        let buf = "", text = ""; const callParts = [];
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buf += dec.decode(chunk.value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
            if (!line || line.indexOf("data:") !== 0) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let j; try { j = JSON.parse(payload); } catch (e) { continue; }
            const cand = j.candidates && j.candidates[0];
            const parts = (cand && cand.content && cand.content.parts) || [];
            for (let p = 0; p < parts.length; p++) {
              if (parts[p].text) { text += parts[p].text; live.textContent = text; $("msgs").scrollTop = $("msgs").scrollHeight; }
              if (parts[p].functionCall) callParts.push(parts[p]);
            }
          }
        }
        const modelParts = [];
        if (text) modelParts.push({ text: text });
        callParts.forEach((p) => modelParts.push(p));
        return { text: text, calls: callParts.map((p) => ({ name: p.functionCall.name, args: p.functionCall.args })), modelParts: modelParts, _callParts: callParts };
      } catch (e) {
        err = e;
        if (attempts[a] && /thinking|generationconfig|400|invalid/i.test((e.message || "").toLowerCase())) { thinkingBad[model] = true; continue; }
        throw e;
      }
    }
    throw err;
  }
  /* ── resolve picked model -> one this key actually serves (fixes 404 "model not found") ── */
  let availCache = null;   // list of usable model ids the key exposes (e.g. "models/gemini-2.5-flash")
  const BAD_MODEL = /vision|embedding|aqa|imagen|image-generation|-tts|audio|gemini-live|learnlm|veo|gemma/i;
  async function availableGemini() {
    if (availCache && availCache.length) return availCache;
    try {
      const list = await listModels();   // [{id, methods}]
      const ids = list
        .filter((m) => (m.methods || []).some((x) => x === "generateContent" || x === "streamGenerateContent"))
        .map((m) => m.id)
        .filter((id) => !BAD_MODEL.test(id));
      if (ids.length) availCache = ids;   // only cache a real result (a network blip retries next msg)
      return ids;
    } catch (e) { return []; }
  }
  const tierOf = (id) => (/lite/i.test(id) ? "lite" : /pro/i.test(id) ? "pro" : /flash/i.test(id) ? "flash" : "other");
  function pickPreferred(ids) {
    if (!ids || !ids.length) return null;
    const score = (id) => {
      let s = 0;
      if (/latest/i.test(id)) s += 3;                 // stable alias, always current
      if (/preview|exp|-\d{3,}/i.test(id)) s -= 2;    // dated/preview builds are flakier
      if (/2\.5/.test(id)) s += 1;                    // 2.5 = reliable free tier
      return s;
    };
    return ids.slice().sort((a, b) => score(b) - score(a))[0];
  }
  // Build the try-order for THIS message: the picked model if the key has it (else a same-tier real
  // substitute), plus a lighter fallback for a rate-limit degrade. NOT quality auto-routing — it just
  // guarantees we only ever call a model that actually exists on this key.
  async function buildGeminiOrder() {
    const picked = getModel();
    const avail = await availableGemini();
    if (!avail.length) return picked === GLITE ? [picked] : [picked, GLITE];   // couldn't list — try picks as-is
    const has = (id) => avail.indexOf(id) >= 0;
    const order = [];
    if (has(picked)) order.push(picked);
    else {
      const want = tierOf(picked);
      const sameTier = avail.filter((id) => tierOf(id) === want);
      const sub = pickPreferred(sameTier.length ? sameTier : avail.filter((id) => tierOf(id) === "flash")) || pickPreferred(avail);
      if (sub) order.push(sub);
    }
    // lighter fallback (own free quota) so a 429 on the primary can still answer
    const lite = has(GLITE) ? GLITE
      : pickPreferred(avail.filter((id) => tierOf(id) === "lite"))
      || pickPreferred(avail.filter((id) => tierOf(id) === "flash"));
    if (lite && order.indexOf(lite) < 0) order.push(lite);
    return order.length ? order : [picked];
  }

  async function geminiGenerate(contents, live) {
    const order = await buildGeminiOrder();
    let lastErr;
    for (let mi = 0; mi < order.length; mi++) {
      const model = order[mi], isLast = mi === order.length - 1;
      for (let round = 0; round < 3; round++) {        // ride out transient hiccups (overload / 503)
        try {
          const out = await gStreamModel(model, contents, live);
          setActiveModel(model);
          return out;
        } catch (e) {
          lastErr = e;
          // 429 (capped) or 404/model-gone -> stop hitting this one, try the next candidate
          if (retryOtherModel(e)) {
            availCache = null;                          // a 404 means our model list is stale — refresh next build
            if (!isLast) break;
            throw e;
          }
          if (transient(e) && round < 2) { await delay(600 + 400 * round); continue; }
          if (transient(e) && !isLast) break;          // persistent blip — try the fallback model too
          throw e;                                     // hard error (auth / bad request) or out of options
        }
      }
    }
    throw lastErr;
  }

  async function agentGemini(run) {
    const contents = history.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] }));
    for (let iter = 0; iter < 6; iter++) {
      const out = await geminiGenerate(contents, run.live);
      if (out.calls.length) {
        contents.push({ role: "model", parts: out.modelParts });
        if (out.text) history.push({ role: "assistant", content: out.text }); else run.live.remove();
        const respParts = [];
        for (let k = 0; k < out.calls.length; k++) {
          const r = await execTool(out.calls[k].name, out.calls[k].args);
          if (r.ok) run.didTools = true;
          bubble((r.ok ? "⚙ " : "⚠ ") + r.msg, "note");
          respParts.push({ functionResponse: { name: out.calls[k].name, response: { success: r.ok, detail: r.msg } } });
        }
        contents.push({ role: "user", parts: respParts });
        run.live = typingBubble();
        continue;
      }
      if (!out.text) run.live.textContent = "done ✅";
      history.push({ role: "assistant", content: out.text || "done ✅" });
      break;
    }
  }

  /* ══════════════════════════════════════════════════════
     CLAUDE generation (streaming, tool_use, thinking)
  ═══════════════════════════════════════════════════════ */
  const CBASE = "https://api.anthropic.com/v1/messages";
  function cHeaders() {
    return {
      "content-type": "application/json",
      "x-api-key": getKeyFor("claude"),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    };
  }
  // map the shared thinking level -> per-model Claude config
  function claudeThink(model) {
    const lvl = getThink();
    const newGen = /opus-4-8|opus-4-7|sonnet-5|fable-5|sonnet-4-6|opus-4-6/.test(model);
    const fable = /fable-5/.test(model);
    if (lvl === "off") {
      if (fable) return {};                                  // fable: thinking always on, omit
      if (newGen) return { thinking: { type: "disabled" } };
      return {};                                             // haiku etc: no thinking = off
    }
    const effort = lvl === "low" ? "low" : lvl === "med" ? "medium" : "high";
    if (newGen || fable) return { thinking: { type: "adaptive" }, output_config: { effort: effort } };
    const budget = lvl === "low" ? 1024 : lvl === "med" ? 2048 : 4096;   // older models (haiku)
    return { thinking: { type: "enabled", budget_tokens: budget } };
  }
  function claudeBody(model, messages, stream) {
    const tk = claudeThink(model);
    const thinkingOn = !!(tk.thinking && tk.thinking.type !== "disabled");
    let maxTok = thinkingOn ? 4096 : 1024;
    if (tk.thinking && tk.thinking.budget_tokens) maxTok = tk.thinking.budget_tokens + 1024;
    if (/fable-5/.test(model)) maxTok = Math.max(maxTok, 4096);
    const body = { model: model, max_tokens: maxTok, system: systemPrompt(), messages: messages, tools: CLAUDE_TOOLS, stream: !!stream };
    if (tk.thinking) body.thinking = tk.thinking;
    if (tk.output_config) body.output_config = tk.output_config;
    return JSON.stringify(body);
  }
  function claudeErr(r, j) {
    const msg = (j && j.error && (j.error.message || j.error.type)) || ("HTTP " + r.status);
    const e = new Error(msg); e.status = r.status;
    const ra = r.headers && r.headers.get && r.headers.get("retry-after");
    if (ra && !isNaN(+ra)) e.retryMs = Math.ceil(parseFloat(ra) * 1000);
    return e;
  }
  async function cStreamModel(model, messages, live) {
    const r = await fetch(CBASE, { method: "POST", headers: cHeaders(), body: claudeBody(model, messages, true) });
    if (!r.ok) { let j = null; try { j = await r.json(); } catch (e) {} throw claudeErr(r, j); }
    // non-stream fallback
    if (!r.body || typeof r.body.getReader !== "function") {
      const r2 = await fetch(CBASE, { method: "POST", headers: cHeaders(), body: claudeBody(model, messages, false) });
      let j2 = null; try { j2 = await r2.json(); } catch (e) {}
      if (!r2.ok) throw claudeErr(r2, j2);
      const blocks = (j2 && j2.content) || [];
      let text = ""; const calls = [];
      blocks.forEach((b) => { if (b.type === "text") text += b.text; if (b.type === "tool_use") calls.push({ id: b.id, name: b.name, input: b.input || {} }); });
      if (text) live.textContent = text;
      return { text: text, calls: calls, content: blocks, stop: j2 && j2.stop_reason };
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "", text = "", stop = null;
    const blocks = {};   // index -> {type, id, name, json, text}
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line || line.indexOf("data:") !== 0) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let j; try { j = JSON.parse(payload); } catch (e) { continue; }
        if (j.type === "content_block_start") {
          const cb = j.content_block || {};
          if (cb.type === "tool_use") blocks[j.index] = { type: "tool_use", id: cb.id, name: cb.name, json: "" };
          else if (cb.type === "text") blocks[j.index] = { type: "text", text: "" };
          else if (cb.type === "thinking") blocks[j.index] = { type: "thinking", thinking: "", signature: "" };
          else if (cb.type === "redacted_thinking") blocks[j.index] = { type: "redacted_thinking", data: cb.data || "" };
          else blocks[j.index] = { type: cb.type };
        } else if (j.type === "content_block_delta") {
          const d = j.delta || {}, b = blocks[j.index] || (blocks[j.index] = {});
          if (d.type === "text_delta") { b.text = (b.text || "") + d.text; text += d.text; live.textContent = text; $("msgs").scrollTop = $("msgs").scrollHeight; }
          else if (d.type === "input_json_delta") { b.json = (b.json || "") + (d.partial_json || ""); }
          else if (d.type === "thinking_delta") { b.thinking = (b.thinking || "") + (d.thinking || ""); }
          else if (d.type === "signature_delta") { b.signature = (b.signature || "") + (d.signature || ""); }
        } else if (j.type === "message_delta") {
          if (j.delta && j.delta.stop_reason) stop = j.delta.stop_reason;
        }
      }
    }
    const idxs = Object.keys(blocks).map(Number).sort((a, b) => a - b);
    const content = [], calls = [];
    idxs.forEach((i) => {
      const b = blocks[i];
      if (b.type === "thinking") content.push({ type: "thinking", thinking: b.thinking || "", signature: b.signature || "" });
      else if (b.type === "redacted_thinking") content.push({ type: "redacted_thinking", data: b.data || "" });
      else if (b.type === "text" && b.text) content.push({ type: "text", text: b.text });
      else if (b.type === "tool_use") {
        let input = {}; try { input = JSON.parse(b.json || "{}"); } catch (e) {}
        content.push({ type: "tool_use", id: b.id, name: b.name, input: input });
        calls.push({ id: b.id, name: b.name, input: input });
      }
    });
    return { text: text, calls: calls, content: content, stop: stop };
  }
  async function claudeGenerate(messages, live) {
    const model = getModel();
    let lastErr;
    for (let round = 0; round < 3; round++) {
      try {
        const out = await cStreamModel(model, messages, live);
        setActiveModel(model);
        return out;
      } catch (e) {
        lastErr = e;
        if (round < 2 && transient(e)) { await delay(700 + 500 * round); continue; }
        throw e;
      }
    }
    throw lastErr;
  }

  async function agentClaude(run) {
    const messages = history.map((h) => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }));
    for (let iter = 0; iter < 6; iter++) {
      const out = await claudeGenerate(messages, run.live);
      if (out.calls.length) {
        messages.push({ role: "assistant", content: out.content });
        if (out.text) history.push({ role: "assistant", content: out.text }); else run.live.remove();
        const results = [];
        for (let k = 0; k < out.calls.length; k++) {
          const c = out.calls[k];
          const r = await execTool(c.name, c.input);
          if (r.ok) run.didTools = true;
          bubble((r.ok ? "⚙ " : "⚠ ") + r.msg, "note");
          results.push({ type: "tool_result", tool_use_id: c.id, content: r.msg, is_error: !r.ok });
        }
        messages.push({ role: "user", content: results });
        run.live = typingBubble();
        continue;
      }
      if (out.stop === "refusal") { run.live.textContent = "can't help with that one — keep it editing 🙏"; break; }
      if (!out.text) run.live.textContent = "done ✅";
      history.push({ role: "assistant", content: out.text || "done ✅" });
      break;
    }
  }

  /* ── model badge ─────────────────────────────────────── */
  function setActiveModel(model) { activeModel = model; renderBadge(); }
  function provColor() { return getProv() === "claude" ? "cld" : "gem"; }
  function renderBadge() {
    const el = $("aiModel"); if (!el) return;
    const id = activeModel || getModel();
    el.className = "model-badge gem";
    el.textContent = "Gemini";                       // one model now — real id is in the tooltip
    el.title = "model: " + (id ? String(id).replace(/^models\//, "") : "…");
  }

  function friendlyError(e) {
    const m = (e && e.message) || "something broke";
    if (e && (e.status === 401 || e.status === 403 || /api key|permission|unauthenticated|invalid|authentication/i.test(m)))
      return "hmm my brain's not connecting rn (auth). check the key with the ⚙ button 🙏";
    if (e && e.status === 429)
      return getProv() === "claude"
        ? "claude's rate-limited for a sec — give it a moment and resend 🙏"
        : "gemini's free limit is maxed for the mo — wait a min and resend, or hit ⚙ → switch to claude (separate limits) 🙏";
    if (e && e.status === 400 && /credit|billing|retention/i.test(m)) return "that model's not set up on this key — try another model in ⚙";
    if (e && e.status === 404) return "your key doesn't have that model — lemme check what it does have…";
    const code = e && e.status ? " (err " + e.status + ")" : "";
    return "that didn't go through" + code + " — try again in a sec";
  }

  // On a 404 (or /models): ask the key what it actually serves, show it, and lock onto a real model.
  async function diagnose404() {
    let list;
    try { list = await listModels(); }
    catch (e) {
      const code = (e && e.status) || "net";
      bubble("couldn't read your key's model list (err " + code + "). that usually means the key's dead or the Generative Language API isn't enabled on it — grab a fresh free key at aistudio.google.com/apikey", "note");
      return false;
    }
    const chat = list.filter((m) => (m.methods || []).indexOf("generateContent") >= 0)
      .map((m) => m.id).filter((id) => !BAD_MODEL.test(id));
    if (!chat.length) {
      bubble("weird — your key lists 0 chat models. it might be the wrong kind of key. grab a fresh free one at aistudio.google.com/apikey", "note");
      return false;
    }
    const names = chat.map((id) => id.replace(/^models\//, ""));
    bubble("your key has: " + names.slice(0, 12).join(", ") + (names.length > 12 ? "…" : ""), "note");
    const best = pickPreferred(chat.filter((id) => /flash/i.test(id))) || pickPreferred(chat);
    if (best) {
      localStorage.setItem(LS.modelG, best); availCache = chat; renderBadge();
      bubble("locked onto " + best.replace(/^models\//, "") + " — send it again 👍", "note");
      return true;
    }
    return false;
  }

  /* ── send (agentic) ──────────────────────────────────── */
  async function send() {
    if (busy) return;
    const txt = $("aiIn").value.trim();
    if (!txt) return;
    $("aiIn").value = ""; autoSize();
    bubble(txt, "user");

    // hidden diagnostic: type "/models" to see exactly what this key serves + lock onto a real one
    if (/^\/models?\b/i.test(txt) && getProv() === "gemini") {
      busy = true; $("aiSend").disabled = true;
      await diagnose404();
      busy = false; $("aiSend").disabled = false;
      return;
    }

    history.push({ role: "user", content: txt });
    if (history.length > 24) history = history.slice(-24);

    busy = true; $("aiSend").disabled = true;
    const run = { live: typingBubble(), didTools: false };

    try {
      if (aeContext === null) {
        const c = await TR.evalJSX("theoReverse_aiContext()");
        aeContext = (c && c.indexOf("OK:") === 0) ? c.slice(3) : "";
      }
      if (getProv() === "claude") await agentClaude(run);
      else await agentGemini(run);
    } catch (e) {
      run.live.remove();
      if (run.didTools && !isAuthError(e)) bubble("there you go ✅", "ai");
      else {
        bubble(friendlyError(e), "err");
        if (isAuthError(e)) showSetup("that key didn't work — grab a fresh one");
        else if (e && e.status === 404 && getProv() === "gemini") await diagnose404();
      }
    }
    busy = false; $("aiSend").disabled = false;
  }

  function autoSize() {
    const t = $("aiIn"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 90) + "px";
  }

  /* ── setup / settings ────────────────────────────────── */
  function isAuthError(e) {
    return e && (e.status === 401 || e.status === 403 || /api key|permission|unauthenticated|invalid|authentication/i.test(e.message || ""));
  }

  function fillModels() {
    const sel = $("modelSel"); if (!sel) return;
    const list = getProv() === "claude" ? CLAUDE_MODELS : GEMINI_MODELS;
    sel.innerHTML = "";
    list.forEach((m) => {
      const o = document.createElement("option");
      o.value = m.id; o.textContent = m.label; sel.appendChild(o);
    });
    sel.value = getModel();
  }
  function fillThink() {
    const sel = $("thinkSel"); if (!sel) return;
    if (!sel.childElementCount) THINK_LEVELS.forEach((t) => {
      const o = document.createElement("option"); o.value = t.id; o.textContent = t.label; sel.appendChild(o);
    });
    sel.value = getThink();
  }
  function syncSetupUI() {
    const k = $("userKey"); if (k) { k.value = getKeyFor("gemini"); k.placeholder = "AIzaSy…"; }
    if ($("keyHint")) $("keyHint").textContent = "Paste your free Google AI Studio key (starts AIzaSy…). It stays on your machine.";
    if ($("keyLink")) $("keyLink").textContent = "get a free key ↗";
  }

  function showSetup(note) {
    $("aiSetup").classList.remove("hidden");
    $("aiChat").classList.add("hidden");
    syncSetupUI();
    if (note) { $("keyStatus").textContent = note; $("keyStatus").className = "prov-status err"; }
    else { $("keyStatus").textContent = ""; $("keyStatus").className = "prov-status"; }
    setTimeout(() => { try { $("userKey").focus(); } catch (e) {} }, 180);
  }

  function greetOnce() {
    if ($("msgs").childElementCount) return;
    const n = TR.getName();
    bubble("yo" + (n ? " " + n : "") + " 👋 what we making today? need a shake, a reverse, some text? i can just do it for you too", "ai");
  }
  function showChat() {
    $("aiSetup").classList.add("hidden");
    $("aiChat").classList.remove("hidden");
    greetOnce();
    renderBadge();
    // warm the model list and, if the stored model isn't on this key, swap to one that is — so the
    // very first message already runs on a working model instead of 404-ing then healing.
    if (hasKey()) availableGemini().then((chat) => {
      if (!chat || !chat.length) return;
      if (chat.indexOf(getModel()) < 0) {
        const best = pickPreferred(chat.filter((id) => /flash/i.test(id))) || pickPreferred(chat);
        if (best) localStorage.setItem(LS.modelG, best);
      }
      renderBadge();
    }).catch(() => {});
  }

  async function validateKey() {
    if (getProv() === "claude") {
      // lightweight: list models (cheap GET) validates the key + browser access
      const r = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: cHeaders() });
      if (!r.ok) { let j = null; try { j = await r.json(); } catch (e) {} throw claudeErr(r, j); }
      return;
    }
    await listModels();   // validates the key
  }
  async function saveKey() {
    const k = $("userKey").value.trim();
    const st = $("keyStatus");
    const setS = (t, c) => { st.textContent = t; st.className = "prov-status" + (c ? " " + c : ""); };
    if (!k) { setS("paste your key first", "err"); return; }
    localStorage.setItem(LS.keyG, k);
    localStorage.setItem(LS.prov, "gemini");
    activeModel = null; availCache = null;
    setS("checking your key…", "");
    try {
      // one call validates the key AND tells us which model actually works — then we lock onto it
      const list = await listModels();
      const chat = list.filter((m) => (m.methods || []).indexOf("generateContent") >= 0)
        .map((m) => m.id).filter((id) => !BAD_MODEL.test(id));
      if (!chat.length) throw new Error("this key has no chat models — grab a fresh one");
      const best = pickPreferred(chat.filter((id) => /flash/i.test(id))) || pickPreferred(chat);
      localStorage.setItem(LS.modelG, best);
      availCache = chat;
      setS("✓ you're in — running " + best.replace(/^models\//, ""), "ok");
      setTimeout(showChat, 550);
    } catch (e) {
      setS("✗ " + (isAuthError(e) ? "key rejected — double-check it" : (e.message || "couldn't connect")), "err");
    }
  }

  /* ── wire up ─────────────────────────────────────────── */
  document.querySelectorAll("#provSeg .seg-btn").forEach((b) =>
    b.addEventListener("click", () => { localStorage.setItem(LS.prov, b.getAttribute("data-prov")); syncSetupUI(); }));
  $("modelSel") && $("modelSel").addEventListener("change", () => {
    localStorage.setItem(getProv() === "claude" ? LS.modelC : LS.modelG, $("modelSel").value); renderBadge();
  });
  $("thinkSel") && $("thinkSel").addEventListener("change", () => localStorage.setItem(LS.think, $("thinkSel").value));
  $("keySave").addEventListener("click", saveKey);
  $("userKey").addEventListener("keydown", (e) => { if (e.key === "Enter") saveKey(); });
  $("keyLink").addEventListener("click", (e) => { e.preventDefault(); TR.openURL(KEY_URL[getProv()]); });
  $("aiKey").addEventListener("click", () => showSetup());

  fillThink();
  if (hasKey()) showChat(); else showSetup();

  $("aiSend").addEventListener("click", send);
  $("aiIn").addEventListener("input", autoSize);
  $("aiIn").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // expose for the Roto view
  if (window.TR) {
    window.TR.segment = geminiSegment;
    window.TR.aiError = friendlyError;
    window.TR.hasAIKey = hasKey;
  }
})();
