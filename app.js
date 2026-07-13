/* Scripture Quiz — "Truths We Love to Teach" (Appendix A)
 * Pass-and-play multiplayer quiz over NWT Study Edition scriptures.
 * Vanilla JS, no build step. Scriptural data per language comes from data.js
 * (window.QUIZ_DATA_BY_LANG) and UI strings from i18n.js (window.QUIZ_I18N).
 *
 * Features: topic filter, per-question timer with speed + streak bonuses,
 * and per-player question categories (scripture / truth / mixed).
 */
(function () {
  "use strict";

  const app = document.getElementById("app");

  // ----- language / i18n -----
  const LANGS = window.QUIZ_LANGS;
  const LANG_CODES = LANGS.map((l) => l.code);
  const LS_LANG = "sq_lang";
  // For a bare base subtag (e.g. "pt" with no region), which full code to use.
  const BASE_DEFAULT = { pt: "pt-BR" };

  // Match one browser language tag (e.g. "pt-BR", "de") to one of our codes.
  function matchLang(pref) {
    const p = String(pref).toLowerCase();
    const exact = LANG_CODES.find((c) => c.toLowerCase() === p);
    if (exact) return exact;
    const base = p.split("-")[0];
    if (BASE_DEFAULT[base] && LANG_CODES.includes(BASE_DEFAULT[base])) return BASE_DEFAULT[base];
    return LANG_CODES.find((c) => c.toLowerCase() === base)
      || LANG_CODES.find((c) => c.toLowerCase().split("-")[0] === base)
      || null;
  }

  // Preference order: saved choice -> browser languages -> English.
  function detectLang() {
    try {
      const saved = localStorage.getItem(LS_LANG);
      if (saved && LANG_CODES.includes(saved)) return saved;
    } catch (e) { /* storage unavailable */ }
    const prefs = (navigator.languages && navigator.languages.length)
      ? navigator.languages : [navigator.language || "en"];
    for (const p of prefs) {
      const m = matchLang(p);
      if (m) return m;
    }
    return "en";
  }

  let lang = detectLang();
  // The active language's data + strings. Reassigned when the user switches.
  let DATA = window.QUIZ_DATA_BY_LANG[lang];
  let t = window.QUIZ_I18N[lang];
  document.documentElement.lang = lang;

  // Which screen is showing, so a language switch knows how to re-render.
  let screen = "home";

  function setLang(code) {
    if (!LANG_CODES.includes(code)) return;
    lang = code;
    DATA = window.QUIZ_DATA_BY_LANG[lang];
    t = window.QUIZ_I18N[lang];
    document.documentElement.lang = lang;
    recomputePools();
    updateChrome();
    try { localStorage.setItem(LS_LANG, lang); } catch (e) { /* ignore */ }
  }

  // Persistent language selector (lives in #topbar, outside #app, so it stays
  // visible on every screen). Wired once at boot; re-rendered to reflect the
  // active language. Switching re-renders the current screen in the new
  // language — and, mid-game, rebuilds the remaining questions so the scripture
  // text and options stay consistent while scores and turn order are kept.
  function renderTopbar() {
    const bar = document.getElementById("topbar");
    if (!bar) return;
    bar.innerHTML = `
      <label class="sr-only" for="langSel">${escapeHtml(t.languageLabel)}</label>
      <span aria-hidden="true" class="text-slate-400">🌐</span>
      <select id="langSel" aria-label="${escapeHtml(t.languageLabel)}"
              class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm focus:border-indigo-400 focus:outline-none">
        ${LANGS.map((l) => `<option value="${l.code}" ${l.code === lang ? "selected" : ""}>${escapeHtml(l.name)}</option>`).join("")}
      </select>`;
    bar.querySelector("#langSel").addEventListener("change", (e) => switchLang(e.target.value));
  }

  function switchLang(code) {
    if (code === lang || !LANG_CODES.includes(code)) return;
    setLang(code);           // also refreshes the footer/title via updateChrome
    renderTopbar();          // reflect the new selection
    if (game && (screen === "intro" || screen === "question")) {
      // Continue the same game. A turn that's already been answered keeps its
      // score; rebuild the remaining (unplayed) turns in the new language and
      // resume at the next one to play.
      const nextTurn = game.turn + (game.selected != null ? 1 : 0);
      regenerateScheduleFrom(nextTurn);
      game.turn = nextTurn;
      game.selected = null;
      if (game.turn >= game.schedule.length) viewResults();
      else viewTurnIntro();
    } else if (game && screen === "results") {
      viewResults();
    } else {
      viewHome();
    }
  }

  // Fill {placeholders} in a catalog string.
  function fmt(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, (m, k) =>
      vars && k in vars ? vars[k] : m);
  }

  // Localize the persistent page chrome (title + footer) outside #app.
  function updateChrome() {
    document.title = t.appName;
    const footer = document.getElementById("appFooter");
    if (footer) {
      const line = escapeHtml(fmt(t.footerScriptures, { nwt: t.nwt }));
      footer.innerHTML = `${line} &middot; &ldquo;${escapeHtml(DATA.appendixTitle)}&rdquo; (${escapeHtml(t.appendixLabel)})`;
    }
  }

  // ----- scoring -----
  const BASE_POINTS = 100;   // for a correct answer
  const MAX_TIME_BONUS = 50; // full bonus for an instant answer (timer on)
  const STREAK_STEP = 25;    // extra points per consecutive correct beyond the first
  const STREAK_CAP = 100;    // maximum streak bonus
  const TIMER_OPTIONS = [
    { sec: 0, label: "Off" },
    { sec: 10, label: "10s" },
    { sec: 20, label: "20s" },
    { sec: 30, label: "30s" },
  ];

  // ----- persistence -----
  const LS_PLAYERS = "sq_players";
  const LS_SETTINGS = "sq_settings";
  const LS_HISTORY = "sq_history";

  function load(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      /* storage may be unavailable (private mode); fail silently */
    }
  }

  // ----- helpers -----
  const uniq = (arr) => Array.from(new Set(arr));

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // Title-case an ALL-CAPS topic for display, but leave grammatical connectors
  // ("de", "di", "la", …) lowercase so Romance-language topics read naturally
  // (e.g. "Reino de Deus", not "Reino De Deus"). These words never lead a topic
  // and don't occur in the German/English/Polish topics, so nothing else shifts.
  const TOPIC_CONNECTORS = new Set(["de", "del", "di", "do", "da", "la", "el", "e", "y", "i"]);
  function niceTopic(topic) {
    return topic.split(" ").map((w, idx) => {
      const lower = w.toLowerCase();
      if (idx > 0 && TOPIC_CONNECTORS.has(lower)) return lower;
      return w.charAt(0) + w.slice(1).toLowerCase();
    }).join(" ");
  }

  // The kinds of question the quiz can ask. Players choose which are in play
  // (via checkboxes on the setup screen); each question picks a random enabled
  // kind. Order here is the display order on the setup screen.
  // Question kinds and their emoji; labels + hints come from the i18n catalog.
  const QTYPE_KEYS = ["ref", "passage", "topic", "meaning"];
  const QTYPE_EMOJI = { ref: "📖", passage: "🔎", topic: "🏷️", meaning: "💡" };
  const qtypeLabel = (key) => `${QTYPE_EMOJI[key]} ${t.typeLabels[key]}`;
  const qtypeHint = (key) => t.typeHints[key];

  // ----- question generation -----
  // Global distractor pools for the active language; recomputed on a switch.
  let ALL_REFS, ALL_SUMMARIES, ALL_TEXTS, ALL_TOPICS;
  function recomputePools() {
    ALL_REFS = uniq(DATA.scriptures.map((s) => s.ref));
    ALL_SUMMARIES = uniq(DATA.scriptures.map((s) => s.summary));
    ALL_TEXTS = uniq(DATA.scriptures.map((s) => s.text));
    ALL_TOPICS = uniq(DATA.scriptures.map((s) => s.topic));
  }
  recomputePools();

  // Pick `count` distinct distractors, preferring the (topic-filtered) pool and
  // falling back to the global pool so there are always enough options.
  function pickDistractors(pool, globalPool, correct, count) {
    const chosen = [];
    for (const x of shuffle(pool)) {
      if (chosen.length >= count) break;
      if (x !== correct && !chosen.includes(x)) chosen.push(x);
    }
    if (chosen.length < count) {
      for (const x of shuffle(globalPool)) {
        if (chosen.length >= count) break;
        if (x !== correct && !chosen.includes(x)) chosen.push(x);
      }
    }
    return chosen;
  }

  function buildQuestion(scripture, type, pools) {
    // The prompt text is looked up from the catalog at render time (by type),
    // so a question stays correct even if the language changes between games.
    let correct, pool, globalPool;
    if (type === "ref") {
      // clue = passage text, options = references
      correct = scripture.ref;
      pool = pools.ref; globalPool = ALL_REFS;
    } else if (type === "passage") {
      // clue = reference, options = passage texts (reverse of "ref")
      correct = scripture.text;
      pool = pools.text; globalPool = ALL_TEXTS;
    } else if (type === "topic") {
      // clue = reference, options = topics
      correct = scripture.topic;
      pool = pools.topic; globalPool = ALL_TOPICS;
    } else {
      // clue = passage text, options = truth summaries
      correct = scripture.summary;
      pool = pools.summary; globalPool = ALL_SUMMARIES;
    }
    const distractors = pickDistractors(pool, globalPool, correct, 3);
    const options = shuffle([correct, ...distractors]);
    return { type, scripture, options, correctIndex: options.indexOf(correct) };
  }

  // Scriptures for the active language limited to the selected topics. Topics
  // are stored as indices (0-8) so the filter survives a language switch — the
  // topics are in the same order in every language.
  function filteredScriptures(topicIndices) {
    return DATA.scriptures.filter((s) => topicIndices.includes(DATA.topics.indexOf(s.topic)));
  }

  // Fill schedule slots [startTurn, total) with fresh round-robin questions in
  // the active language. Slot t always belongs to player t % players.length, so
  // regenerating a tail keeps whose-turn intact. Mutates and returns `schedule`.
  function fillSchedule(schedule, startTurn, players, perPlayer, filtered, types) {
    const pools = {
      ref: uniq(filtered.map((s) => s.ref)),
      summary: uniq(filtered.map((s) => s.summary)),
      text: uniq(filtered.map((s) => s.text)),
      topic: uniq(filtered.map((s) => s.topic)),
    };
    let bag = shuffle(filtered);
    const draw = () => {
      if (bag.length === 0) bag = shuffle(filtered);
      return bag.pop();
    };
    const typePool = types && types.length ? types : QTYPE_KEYS;
    const total = players.length * perPlayer;
    for (let i = startTurn; i < total; i++) {
      const type = typePool[Math.floor(Math.random() * typePool.length)];
      schedule[i] = { playerIndex: i % players.length, question: buildQuestion(draw(), type, pools) };
    }
    return schedule;
  }

  // ----- game state -----
  let game = null;
  let tickHandle = null;

  function clearTimer() {
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
  }

  function newGame(players, perPlayer, topicIndices, timerSec, types) {
    const filtered = filteredScriptures(topicIndices);
    const pls = players.map((p) => ({
      name: p.name,
      score: 0, correct: 0, answered: 0, streak: 0, bestStreak: 0,
    }));
    game = {
      players: pls, perPlayer, timerSec, topicIndices, types,
      schedule: fillSchedule(new Array(pls.length * perPlayer), 0, pls, perPlayer, filtered, types),
      turn: 0, selected: null, deadline: null, recorded: false,
    };
  }

  // Rebuild the current + upcoming questions in the active language after a
  // language switch, preserving scores and whose-turn.
  function regenerateScheduleFrom(startTurn) {
    fillSchedule(game.schedule, startTurn, game.players, game.perPlayer,
      filteredScriptures(game.topicIndices), game.types);
  }

  // =========================================================
  //  VIEWS
  // =========================================================

  function render(html) {
    clearTimer();
    app.innerHTML = html;
    app.classList.remove("animate-pop");
    void app.offsetWidth; // reflow to restart animation
    app.classList.add("animate-pop");
  }

  // ---- Home / setup ----
  function viewHome() {
    screen = "home";
    const savedPlayers = load(LS_PLAYERS, null);
    let players = Array.isArray(savedPlayers) && savedPlayers.length
      ? savedPlayers.map((p) => ({ name: typeof p === "string" ? p : p.name }))
      : [{ name: t.player + " 1" }, { name: t.player + " 2" }];

    const settings = load(LS_SETTINGS, {});
    let perPlayer = settings.perPlayer || 8;
    let timerSec = TIMER_OPTIONS.some((o) => o.sec === settings.timerSec) ? settings.timerSec : 20;
    // Selected topics persist as language-independent indices; map to the active
    // language's topic strings for display (and fall back to all).
    let selTopics = Array.isArray(settings.topics) && settings.topics.length
        && settings.topics.every((x) => typeof x === "number")
      ? settings.topics.map((i) => DATA.topics[i]).filter(Boolean)
      : DATA.topics.slice();
    if (selTopics.length === 0) selTopics = DATA.topics.slice();
    let selTypes = Array.isArray(settings.types) && settings.types.length
      ? QTYPE_KEYS.filter((k) => settings.types.includes(k))
      : QTYPE_KEYS.slice();
    if (selTypes.length === 0) selTypes = QTYPE_KEYS.slice();

    function draw() {
      const history = load(LS_HISTORY, []);
      render(`
        <header class="pt-4 pb-4 text-center">
          <div class="text-5xl">📖</div>
          <h1 class="mt-3 text-2xl font-bold text-slate-900">${escapeHtml(t.appName)}</h1>
          <p class="mt-1 text-sm text-slate-500">${escapeHtml(DATA.appendixTitle)} &middot; ${escapeHtml(t.appendixLabel)}</p>
        </header>

        <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">${escapeHtml(t.players)}</h2>
            <span class="text-xs text-slate-400">${escapeHtml(t.passPlay)}</span>
          </div>
          <div id="players" class="mt-3 space-y-2">
            ${players.map((p, i) => playerRow(p, i, players.length)).join("")}
          </div>
          <button id="addPlayer" class="mt-3 w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-500 hover:border-indigo-400 hover:text-indigo-600">
            ${escapeHtml(t.addPlayer)}
          </button>
        </section>

        <section class="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">${escapeHtml(t.topics)}</h2>
            <div class="text-xs">
              <button id="topicAll" class="text-indigo-600 hover:underline">${escapeHtml(t.all)}</button>
              <span class="text-slate-300">·</span>
              <button id="topicNone" class="text-indigo-600 hover:underline">${escapeHtml(t.none)}</button>
            </div>
          </div>
          <div id="topics" class="mt-3 flex flex-wrap gap-2">
            ${DATA.topics.map((topic) => topicChip(topic, selTopics.includes(topic))).join("")}
          </div>
          <p id="topicWarn" class="mt-2 hidden text-xs text-rose-500">${escapeHtml(t.topicWarn)}</p>
        </section>

        <section class="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">${escapeHtml(t.questionTypes)}</h2>
            <div class="text-xs">
              <button id="typeAll" class="text-indigo-600 hover:underline">${escapeHtml(t.all)}</button>
              <span class="text-slate-300">·</span>
              <button id="typeNone" class="text-indigo-600 hover:underline">${escapeHtml(t.none)}</button>
            </div>
          </div>
          <div id="types" class="mt-3 space-y-2">
            ${QTYPE_KEYS.map((key) => typeRow(key, selTypes.includes(key))).join("")}
          </div>
          <p id="typeWarn" class="mt-2 hidden text-xs text-rose-500">${escapeHtml(t.typeWarn)}</p>
        </section>

        <section class="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">${escapeHtml(t.perPlayer)}</h2>
          <div class="mt-2 flex items-center gap-3">
            <input id="perPlayer" type="range" min="3" max="20" value="${perPlayer}" class="flex-1 accent-indigo-600" />
            <span id="perPlayerVal" class="w-8 text-center font-semibold text-indigo-600">${perPlayer}</span>
          </div>

          <h2 class="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">${escapeHtml(t.answerTimer)}</h2>
          <div id="timer" class="mt-2 grid grid-cols-4 gap-2">
            ${TIMER_OPTIONS.map((o) => `
              <button class="timer-opt rounded-xl border py-2 text-sm font-semibold transition ${o.sec === timerSec ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}" data-sec="${o.sec}">${escapeHtml(o.sec === 0 ? t.timerOff : o.label)}</button>`).join("")}
          </div>
          <p class="mt-2 text-xs text-slate-400">${escapeHtml(t.timerHint)}</p>

          <button id="start" class="mt-6 w-full rounded-xl bg-indigo-600 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[.99]">
            ${escapeHtml(t.startQuiz)}
          </button>
        </section>

        ${history.length ? recentGames(history) : ""}
      `);

      // player name + remove
      app.querySelectorAll(".player-name").forEach((inp) => {
        inp.addEventListener("input", (e) => { players[+e.target.dataset.i].name = e.target.value; });
      });
      app.querySelectorAll(".player-remove").forEach((btn) => {
        btn.addEventListener("click", (e) => { players.splice(+e.currentTarget.dataset.i, 1); draw(); });
      });
      app.querySelector("#addPlayer").addEventListener("click", () => {
        players.push({ name: t.player + " " + (players.length + 1) });
        draw();
      });

      // question types
      app.querySelectorAll(".type-check").forEach((box) => {
        box.addEventListener("change", (e) => {
          const k = e.target.dataset.key;
          const idx = selTypes.indexOf(k);
          if (e.target.checked) { if (idx < 0) selTypes.push(k); }
          else if (idx >= 0) selTypes.splice(idx, 1);
          syncTypes();
        });
      });
      app.querySelector("#typeAll").addEventListener("click", () => { selTypes = QTYPE_KEYS.slice(); syncTypes(); });
      app.querySelector("#typeNone").addEventListener("click", () => { selTypes = []; syncTypes(); });

      // topics
      app.querySelectorAll(".topic-chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          const topic = btn.dataset.topic;
          const idx = selTopics.indexOf(topic);
          if (idx >= 0) selTopics.splice(idx, 1); else selTopics.push(topic);
          syncTopics();
        });
      });
      app.querySelector("#topicAll").addEventListener("click", () => { selTopics = DATA.topics.slice(); syncTopics(); });
      app.querySelector("#topicNone").addEventListener("click", () => { selTopics = []; syncTopics(); });

      // perPlayer + timer
      app.querySelector("#perPlayer").addEventListener("input", (e) => {
        perPlayer = +e.target.value;
        app.querySelector("#perPlayerVal").textContent = perPlayer;
      });
      app.querySelectorAll(".timer-opt").forEach((btn) => {
        btn.addEventListener("click", () => {
          timerSec = +btn.dataset.sec;
          app.querySelectorAll(".timer-opt").forEach((b) => {
            const on = +b.dataset.sec === timerSec;
            b.className = "timer-opt rounded-xl border py-2 text-sm font-semibold transition " +
              (on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:border-slate-300");
          });
        });
      });

      app.querySelector("#start").addEventListener("click", () => {
        const clean = players.map((p) => ({ name: p.name.trim() }))
          .filter((p) => p.name);
        if (clean.length === 0) { alert(t.addPlayerAlert); return; }
        if (selTopics.length === 0) { app.querySelector("#topicWarn").classList.remove("hidden"); return; }
        if (selTypes.length === 0) { app.querySelector("#typeWarn").classList.remove("hidden"); return; }
        // keep the enabled types in the canonical display order
        const types = QTYPE_KEYS.filter((k) => selTypes.includes(k));
        // Persist and play using language-independent topic indices.
        const topicIndices = selTopics.map((tp) => DATA.topics.indexOf(tp)).filter((i) => i >= 0);
        save(LS_PLAYERS, clean);
        save(LS_SETTINGS, { perPlayer, timerSec, topics: topicIndices, types });
        newGame(clean, perPlayer, topicIndices, timerSec, types);
        viewTurnIntro();
      });
      const clearBtn = app.querySelector("#clearHistory");
      if (clearBtn) clearBtn.addEventListener("click", () => { save(LS_HISTORY, []); draw(); });

      function syncTypes() {
        app.querySelectorAll(".type-row").forEach((row) => {
          const on = selTypes.includes(row.dataset.key);
          row.className = "type-row flex cursor-pointer items-center gap-3 rounded-xl border " +
            (on ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-slate-50") + " px-3 py-2.5 transition";
          const box = row.querySelector(".type-check");
          if (box) box.checked = on;
        });
        app.querySelector("#typeWarn").classList.toggle("hidden", selTypes.length > 0);
      }

      function syncTopics() {
        app.querySelectorAll(".topic-chip").forEach((btn) => {
          const on = selTopics.includes(btn.dataset.topic);
          btn.className = topicChipClass(on);
        });
        app.querySelector("#topicWarn").classList.toggle("hidden", selTopics.length > 0);
      }
    }

    function playerRow(p, i, count) {
      return `
        <div class="flex items-center gap-2">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">${i + 1}</span>
          <input class="player-name min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                 data-i="${i}" value="${escapeHtml(p.name)}" maxlength="24" placeholder="${escapeHtml(t.namePlaceholder)}" />
          ${count > 1 ? `<button class="player-remove shrink-0 rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-500" data-i="${i}" aria-label="${escapeHtml(t.removeLabel)}">✕</button>` : ""}
        </div>`;
    }

    function typeRow(key, on) {
      return `
        <label class="type-row flex cursor-pointer items-center gap-3 rounded-xl border ${on ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-slate-50"} px-3 py-2.5 transition" data-key="${key}">
          <input type="checkbox" class="type-check h-4 w-4 shrink-0 accent-indigo-600" data-key="${key}" ${on ? "checked" : ""} />
          <span class="min-w-0">
            <span class="block text-sm font-medium text-slate-700">${escapeHtml(qtypeLabel(key))}</span>
            <span class="block text-xs text-slate-400">${escapeHtml(qtypeHint(key))}</span>
          </span>
        </label>`;
    }

    function topicChipClass(on) {
      return "topic-chip rounded-full border px-3 py-1.5 text-xs font-medium transition " +
        (on ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300");
    }
    function topicChip(topic, on) {
      return `<button class="${topicChipClass(on)}" data-topic="${escapeHtml(topic)}">${escapeHtml(niceTopic(topic))}</button>`;
    }

    function recentGames(history) {
      const recent = history.slice(-5).reverse();
      return `
        <section class="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">${escapeHtml(t.recentGames)}</h2>
          <ul class="mt-3 space-y-2">
            ${recent.map((g) => `
              <li class="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <span class="font-medium text-slate-700">🏆 ${escapeHtml(g.winner)}</span>
                <span class="truncate pl-3 text-right text-slate-400">${escapeHtml(g.summary)}</span>
              </li>`).join("")}
          </ul>
          <button id="clearHistory" class="mt-3 text-xs text-slate-400 hover:text-rose-500">${escapeHtml(t.clearHistory)}</button>
        </section>`;
    }

    draw();
  }

  // ---- Turn intro (pass the device) ----
  function viewTurnIntro() {
    screen = "intro";
    const { playerIndex } = game.schedule[game.turn];
    const player = game.players[playerIndex];
    const round = Math.floor(game.turn / game.players.length) + 1;
    const streakLine = player.streak >= 2
      ? `<p class="mt-2 text-sm font-semibold text-orange-500">🔥 ${escapeHtml(fmt(t.inARow, { n: player.streak }))}</p>` : "";
    render(`
      <div class="flex min-h-[70vh] flex-col items-center justify-center text-center">
        <p class="text-sm font-medium uppercase tracking-wide text-indigo-500">${escapeHtml(fmt(t.questionXofY, { n: game.turn + 1, m: game.schedule.length }))}</p>
        <p class="mt-6 text-sm text-slate-500">${escapeHtml(t.passDeviceTo)}</p>
        <h1 class="mt-2 text-4xl font-bold text-slate-900">${escapeHtml(player.name)}</h1>
        <p class="mt-4 text-sm text-slate-400">${escapeHtml(fmt(t.roundXofY, { n: round, m: game.perPlayer }))} &middot; ${player.score} ${escapeHtml(t.pts)}</p>
        ${streakLine}
        <button id="ready" class="mt-8 w-full max-w-xs rounded-xl bg-indigo-600 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[.99]">
          ${escapeHtml(t.imReady)}
        </button>
        <button id="quit" class="mt-4 text-sm text-slate-400 hover:text-slate-600">${escapeHtml(t.quitGame)}</button>
      </div>
    `);
    app.querySelector("#ready").addEventListener("click", () => { game.selected = null; viewQuestion(); });
    app.querySelector("#quit").addEventListener("click", () => { if (confirm(t.quitConfirm)) viewHome(); });
  }

  // ---- Question ----
  function viewQuestion() {
    screen = "question";
    const entry = game.schedule[game.turn];
    const player = game.players[entry.playerIndex];
    const q = entry.question;
    const progress = (game.turn / game.schedule.length) * 100;
    const BADGES = {
      ref: ["bg-amber-100", "text-amber-700"],
      passage: ["bg-sky-100", "text-sky-700"],
      topic: ["bg-violet-100", "text-violet-700"],
      meaning: ["bg-emerald-100", "text-emerald-700"],
    };
    const [badgeBg, badgeText] = BADGES[q.type] || BADGES.meaning;
    const badge = `<span class="rounded-full ${badgeBg} px-2.5 py-1 text-xs font-semibold ${badgeText}">${escapeHtml(t.typeLabels[q.type])}</span>`;
    const streakBadge = player.streak >= 2
      ? `<span class="text-xs font-semibold text-orange-500">🔥 ${player.streak}</span>` : "";
    const timerBlock = game.timerSec ? `
      <div class="mt-3 flex items-center gap-2">
        <div class="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div id="timerBar" class="h-full rounded-full bg-emerald-500" style="width:100%"></div>
        </div>
        <span id="timerNum" class="w-9 text-right text-xs font-semibold tabular-nums text-slate-500">${game.timerSec}s</span>
      </div>` : "";

    render(`
      <div class="pt-4">
        <div class="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div class="h-full rounded-full bg-indigo-500 transition-all" style="width:${progress}%"></div>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold text-slate-700">${escapeHtml(player.name)}</span>
          <span class="flex items-center gap-2 text-xs text-slate-400">${streakBadge}<span>${player.score} ${escapeHtml(t.pts)}</span></span>
        </div>

        <div class="mt-3 flex items-center gap-2">${badge}
          ${q.type === "topic" ? "" : `<span class="text-xs uppercase tracking-wide text-slate-400">${escapeHtml(niceTopic(q.scripture.topic))}</span>`}
        </div>

        ${timerBlock}

        ${q.type === "passage" || q.type === "topic"
          ? `<div class="mt-3 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
               <p class="text-xs uppercase tracking-wide text-slate-400">${escapeHtml(t.scriptureReference)}</p>
               <p class="mt-1 font-serif text-2xl font-semibold text-slate-800">${escapeHtml(q.scripture.ref)}</p>
             </div>`
          : `<div class="scripture-scroll mt-3 max-h-[40vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
               <p class="font-serif text-[1.05rem] leading-relaxed text-slate-800">${escapeHtml(q.scripture.text)}</p>
             </div>`}

        <p class="mt-5 text-center text-base font-semibold text-slate-700">${escapeHtml(t.prompts[q.type])}</p>

        <div id="options" class="mt-3 space-y-2.5">
          ${q.options.map((opt, i) => `
            <button class="option w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left ${q.type === "passage" ? "font-serif text-[0.95rem] leading-relaxed" : "text-[0.95rem] leading-snug"} text-slate-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 active:scale-[.99]" data-i="${i}">
              <span class="mr-2 font-semibold text-slate-400">${String.fromCharCode(65 + i)}</span>${escapeHtml(q.type === "topic" ? niceTopic(opt) : opt)}
            </button>`).join("")}
        </div>

        <div id="feedback" class="mt-4"></div>
      </div>
    `);

    app.querySelectorAll(".option").forEach((btn) => {
      btn.addEventListener("click", () => resolveAnswer(+btn.dataset.i));
    });

    // test seam: expose the answer only when an automated test opts in
    if (window.__QUIZ_TEST) app.querySelector("#options").dataset.correct = q.correctIndex;

    // start timer
    if (game.timerSec) {
      game.deadline = performance.now() + game.timerSec * 1000;
      tickHandle = setInterval(() => {
        const rem = (game.deadline - performance.now()) / 1000;
        if (rem <= 0) { updateTimerUI(0); resolveAnswer(-1); }
        else updateTimerUI(rem);
      }, 100);
    }
  }

  function updateTimerUI(rem) {
    const bar = document.getElementById("timerBar");
    const num = document.getElementById("timerNum");
    if (!bar) return;
    const pct = Math.max(0, (rem / game.timerSec) * 100);
    bar.style.width = pct + "%";
    bar.className = "h-full rounded-full transition-[width] duration-100 " +
      (pct > 50 ? "bg-emerald-500" : pct > 20 ? "bg-amber-500" : "bg-rose-500");
    if (num) num.textContent = Math.max(0, Math.ceil(rem)) + "s";
  }

  // choice = option index, or -1 for a timeout (no answer)
  function resolveAnswer(choice) {
    if (game.selected !== null) return; // already answered
    clearTimer();
    game.selected = choice;
    const entry = game.schedule[game.turn];
    const player = game.players[entry.playerIndex];
    const q = entry.question;
    const correct = q.correctIndex;
    const timedOut = choice === -1;
    const isRight = !timedOut && choice === correct;

    // remaining time (for speed bonus)
    const remaining = game.timerSec && game.deadline
      ? Math.max(0, (game.deadline - performance.now()) / 1000) : 0;

    player.answered++;
    let base = 0, timeBonus = 0, streakBonus = 0;
    if (isRight) {
      player.correct++;
      player.streak++;
      player.bestStreak = Math.max(player.bestStreak, player.streak);
      base = BASE_POINTS;
      if (game.timerSec) timeBonus = Math.round((remaining / game.timerSec) * MAX_TIME_BONUS);
      streakBonus = Math.min((player.streak - 1) * STREAK_STEP, STREAK_CAP);
      player.score += base + timeBonus + streakBonus;
    } else {
      player.streak = 0;
    }
    const gained = base + timeBonus + streakBonus;

    // reveal
    const typo = q.type === "passage" ? "font-serif text-[0.95rem] leading-relaxed" : "text-[0.95rem] leading-snug";
    const buttons = app.querySelectorAll(".option");
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === correct) {
        btn.className = `option w-full rounded-xl border-2 border-emerald-400 bg-emerald-50 px-4 py-3.5 text-left ${typo} font-medium text-emerald-800 shadow-sm`;
      } else if (i === choice) {
        btn.className = `option w-full rounded-xl border-2 border-rose-300 bg-rose-50 px-4 py-3.5 text-left ${typo} text-rose-700 shadow-sm`;
      } else {
        btn.className = `option w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left ${typo} text-slate-400 opacity-70`;
      }
    });

    const heading = isRight ? "✓ " + t.correct : timedOut ? "⏱ " + t.timesUp : "✕ " + t.notQuite;
    const breakdown = isRight ? [
      `+${base} ${escapeHtml(t.baseBonus)}`,
      timeBonus > 0 ? `+${timeBonus} ${escapeHtml(t.speedBonus)}` : null,
      streakBonus > 0 ? `+${streakBonus} ${escapeHtml(t.streakBonus)} 🔥` : null,
    ].filter(Boolean).join("&nbsp;&nbsp;") + `&nbsp;&nbsp;=&nbsp;&nbsp;<span class="font-bold">${gained} ${escapeHtml(t.pts)}</span>` : "";

    const isLast = game.turn === game.schedule.length - 1;
    app.querySelector("#feedback").innerHTML = `
      <div class="rounded-2xl ${isRight ? "bg-emerald-50 ring-emerald-200" : "bg-rose-50 ring-rose-200"} p-4 ring-1">
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold ${isRight ? "text-emerald-700" : "text-rose-700"}">${escapeHtml(heading)}</p>
          ${isRight ? `<p class="text-sm text-emerald-700">${breakdown}</p>` : ""}
        </div>
        <p class="mt-1 text-sm text-slate-600">
          <span class="font-semibold">${escapeHtml(q.scripture.ref)}</span> &mdash; ${escapeHtml(q.scripture.summary)}
        </p>
        <button id="next" class="mt-3 w-full rounded-xl bg-slate-800 py-3 text-sm font-semibold text-white transition hover:bg-slate-900 active:scale-[.99]">
          ${escapeHtml(isLast ? t.seeResults : t.nextPlayer)}
        </button>
      </div>`;
    const nextBtn = app.querySelector("#next");
    nextBtn.addEventListener("click", () => {
      game.turn++;
      if (game.turn >= game.schedule.length) viewResults();
      else viewTurnIntro();
    });
    nextBtn.focus();
  }

  // ---- Results ----
  function viewResults() {
    screen = "results";
    const ranked = game.players
      .map((p) => ({ ...p, pct: p.answered ? Math.round((p.correct / p.answered) * 100) : 0 }))
      .sort((a, b) => b.score - a.score || b.correct - a.correct);
    const top = ranked[0].score;
    const winners = ranked.filter((p) => p.score === top).map((p) => p.name);
    const tie = winners.length > 1;

    // Record the game once (viewResults can re-run on a language switch).
    if (!game.recorded) {
      const history = load(LS_HISTORY, []);
      history.push({
        winner: tie ? winners.join(" & ") : winners[0],
        summary: ranked.map((p) => `${p.name} ${p.score}`).join(" · "),
      });
      save(LS_HISTORY, history);
      game.recorded = true;
    }

    const medals = ["🥇", "🥈", "🥉"];
    render(`
      <header class="pt-8 pb-4 text-center">
        <div class="text-5xl">🏆</div>
        <h1 class="mt-3 text-2xl font-bold text-slate-900">${tie ? escapeHtml(t.tie) : escapeHtml(fmt(t.wins, { name: winners[0] }))}</h1>
        <p class="mt-1 text-sm text-slate-500">${escapeHtml(fmt(t.resultsMeta, { q: game.schedule.length, p: game.perPlayer }))}${game.timerSec ? " &middot; " + escapeHtml(fmt(t.timerMeta, { s: game.timerSec })) : ""}</p>
      </header>

      <section class="space-y-2.5">
        ${ranked.map((p, i) => `
          <div class="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ${i === 0 ? "ring-amber-300" : "ring-slate-200"}">
            <span class="w-7 text-center text-2xl">${medals[i] || `<span class="text-base font-semibold text-slate-400">${i + 1}</span>`}</span>
            <div class="min-w-0 flex-1">
              <p class="truncate font-semibold text-slate-800">${escapeHtml(p.name)}</p>
              <p class="text-xs text-slate-400">${p.correct}/${p.answered} ${escapeHtml(t.correctLabel)} &middot; ${p.pct}%${p.bestStreak >= 2 ? ` &middot; 🔥 ${escapeHtml(t.bestLabel)} ${p.bestStreak}` : ""}</p>
            </div>
            <div class="text-right">
              <span class="text-2xl font-bold text-indigo-600">${p.score}</span>
              <span class="block text-[10px] uppercase tracking-wide text-slate-400">${escapeHtml(t.points)}</span>
            </div>
          </div>`).join("")}
      </section>

      <div class="mt-6 space-y-2.5">
        <button id="again" class="w-full rounded-xl bg-indigo-600 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[.99]">
          ${escapeHtml(t.playAgain)}
        </button>
        <button id="home" class="w-full rounded-xl bg-white py-3.5 text-base font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50">
          ${escapeHtml(t.changeSetup)}
        </button>
      </div>
    `);
    app.querySelector("#again").addEventListener("click", () => {
      newGame(
        game.players.map((p) => ({ name: p.name })),
        game.perPlayer, game.topicIndices, game.timerSec, game.types
      );
      viewTurnIntro();
    });
    app.querySelector("#home").addEventListener("click", viewHome);
  }

  // ----- boot -----
  if (!DATA || !DATA.scriptures || !DATA.scriptures.length) {
    app.innerHTML = '<p class="p-8 text-center text-rose-600">Failed to load quiz data.</p>';
  } else {
    updateChrome();
    renderTopbar();
    viewHome();
  }
})();
