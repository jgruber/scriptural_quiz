/* Scripture Quiz — "Truths We Love to Teach" (Appendix A)
 * Pass-and-play multiplayer quiz over NWT Study Edition scriptures.
 * Vanilla JS, no build step. Data is provided by data.js (window.QUIZ_DATA).
 *
 * Features: topic filter, per-question timer with speed + streak bonuses,
 * and per-player question categories (scripture / truth / mixed).
 */
(function () {
  "use strict";

  const DATA = window.QUIZ_DATA;
  const app = document.getElementById("app");

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

  function niceTopic(t) {
    return t.split(" ").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
  }

  // The kinds of question the quiz can ask. Players choose which are in play
  // (via checkboxes on the setup screen); each question picks a random enabled
  // kind. Order here is the display order on the setup screen.
  const QTYPES = [
    { key: "ref", label: "📖 Name the scripture", hint: "See the passage, pick the reference" },
    { key: "passage", label: "🔎 Match the passage", hint: "See the reference, pick the passage" },
    { key: "topic", label: "🏷️ Name the topic", hint: "See the reference, pick the topic" },
    { key: "meaning", label: "💡 Name the truth", hint: "See the passage, pick the truth" },
  ];
  const QTYPE_KEYS = QTYPES.map((t) => t.key);

  // ----- question generation -----
  const ALL_REFS = uniq(DATA.scriptures.map((s) => s.ref));
  const ALL_SUMMARIES = uniq(DATA.scriptures.map((s) => s.summary));
  const ALL_TEXTS = uniq(DATA.scriptures.map((s) => s.text));
  const ALL_TOPICS = uniq(DATA.scriptures.map((s) => s.topic));

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
    let prompt, correct, pool, globalPool;
    if (type === "ref") {
      // clue = passage text, options = references
      prompt = "Which scripture is this passage from?";
      correct = scripture.ref;
      pool = pools.ref; globalPool = ALL_REFS;
    } else if (type === "passage") {
      // clue = reference, options = passage texts (reverse of "ref")
      prompt = "Which passage is this scripture?";
      correct = scripture.text;
      pool = pools.text; globalPool = ALL_TEXTS;
    } else if (type === "topic") {
      // clue = reference, options = topics
      prompt = "What topic does this scripture cover?";
      correct = scripture.topic;
      pool = pools.topic; globalPool = ALL_TOPICS;
    } else {
      // clue = passage text, options = truth summaries
      prompt = "What truth does this scripture teach?";
      correct = scripture.summary;
      pool = pools.summary; globalPool = ALL_SUMMARIES;
    }
    const distractors = pickDistractors(pool, globalPool, correct, 3);
    const options = shuffle([correct, ...distractors]);
    return { type, prompt, scripture, options, correctIndex: options.indexOf(correct) };
  }

  // Round-robin schedule honoring the enabled question types and topic filter.
  function generateSchedule(players, perPlayer, filtered, types) {
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
    // Each question picks a random kind from the enabled types.
    const pool = types && types.length ? types : QTYPE_KEYS;
    const schedule = [];
    for (let round = 0; round < perPlayer; round++) {
      for (let p = 0; p < players.length; p++) {
        const type = pool[Math.floor(Math.random() * pool.length)];
        schedule.push({ playerIndex: p, question: buildQuestion(draw(), type, pools) });
      }
    }
    return schedule;
  }

  // ----- game state -----
  let game = null;
  let tickHandle = null;

  function clearTimer() {
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
  }

  function newGame(players, perPlayer, topics, timerSec, types) {
    const filtered = DATA.scriptures.filter((s) => topics.includes(s.topic));
    const pls = players.map((p) => ({
      name: p.name,
      score: 0, correct: 0, answered: 0, streak: 0, bestStreak: 0,
    }));
    game = {
      players: pls, perPlayer, timerSec, topics, types,
      schedule: generateSchedule(pls, perPlayer, filtered, types),
      turn: 0, selected: null, deadline: null,
    };
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
    const savedPlayers = load(LS_PLAYERS, null);
    let players = Array.isArray(savedPlayers) && savedPlayers.length
      ? savedPlayers.map((p) => ({ name: typeof p === "string" ? p : p.name }))
      : [{ name: "Player 1" }, { name: "Player 2" }];

    const settings = load(LS_SETTINGS, {});
    let perPlayer = settings.perPlayer || 8;
    let timerSec = TIMER_OPTIONS.some((o) => o.sec === settings.timerSec) ? settings.timerSec : 20;
    let selTopics = Array.isArray(settings.topics) && settings.topics.length
      ? DATA.topics.filter((t) => settings.topics.includes(t))
      : DATA.topics.slice();
    if (selTopics.length === 0) selTopics = DATA.topics.slice();
    let selTypes = Array.isArray(settings.types) && settings.types.length
      ? QTYPE_KEYS.filter((k) => settings.types.includes(k))
      : QTYPE_KEYS.slice();
    if (selTypes.length === 0) selTypes = QTYPE_KEYS.slice();

    function draw() {
      const history = load(LS_HISTORY, []);
      render(`
        <header class="pt-6 pb-4 text-center">
          <div class="text-5xl">📖</div>
          <h1 class="mt-3 text-2xl font-bold text-slate-900">Scripture Quiz</h1>
          <p class="mt-1 text-sm text-slate-500">Truths We Love to Teach &middot; Appendix A</p>
        </header>

        <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Players</h2>
            <span class="text-xs text-slate-400">pass &amp; play</span>
          </div>
          <div id="players" class="mt-3 space-y-2">
            ${players.map((p, i) => playerRow(p, i, players.length)).join("")}
          </div>
          <button id="addPlayer" class="mt-3 w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-500 hover:border-indigo-400 hover:text-indigo-600">
            + Add player
          </button>
        </section>

        <section class="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Topics</h2>
            <div class="text-xs">
              <button id="topicAll" class="text-indigo-600 hover:underline">All</button>
              <span class="text-slate-300">·</span>
              <button id="topicNone" class="text-indigo-600 hover:underline">None</button>
            </div>
          </div>
          <div id="topics" class="mt-3 flex flex-wrap gap-2">
            ${DATA.topics.map((t) => topicChip(t, selTopics.includes(t))).join("")}
          </div>
          <p id="topicWarn" class="mt-2 hidden text-xs text-rose-500">Select at least one topic.</p>
        </section>

        <section class="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Question types</h2>
            <div class="text-xs">
              <button id="typeAll" class="text-indigo-600 hover:underline">All</button>
              <span class="text-slate-300">·</span>
              <button id="typeNone" class="text-indigo-600 hover:underline">None</button>
            </div>
          </div>
          <div id="types" class="mt-3 space-y-2">
            ${QTYPES.map((t) => typeRow(t, selTypes.includes(t.key))).join("")}
          </div>
          <p id="typeWarn" class="mt-2 hidden text-xs text-rose-500">Select at least one question type.</p>
        </section>

        <section class="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Questions per player</h2>
          <div class="mt-2 flex items-center gap-3">
            <input id="perPlayer" type="range" min="3" max="20" value="${perPlayer}" class="flex-1 accent-indigo-600" />
            <span id="perPlayerVal" class="w-8 text-center font-semibold text-indigo-600">${perPlayer}</span>
          </div>

          <h2 class="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">Answer timer</h2>
          <div id="timer" class="mt-2 grid grid-cols-4 gap-2">
            ${TIMER_OPTIONS.map((o) => `
              <button class="timer-opt rounded-xl border py-2 text-sm font-semibold transition ${o.sec === timerSec ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}" data-sec="${o.sec}">${o.label}</button>`).join("")}
          </div>
          <p class="mt-2 text-xs text-slate-400">Faster answers and answer streaks earn bonus points.</p>

          <button id="start" class="mt-6 w-full rounded-xl bg-indigo-600 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[.99]">
            Start quiz
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
        players.push({ name: "Player " + (players.length + 1) });
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
          const t = btn.dataset.topic;
          const idx = selTopics.indexOf(t);
          if (idx >= 0) selTopics.splice(idx, 1); else selTopics.push(t);
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
        if (clean.length === 0) { alert("Add at least one player."); return; }
        if (selTopics.length === 0) { app.querySelector("#topicWarn").classList.remove("hidden"); return; }
        if (selTypes.length === 0) { app.querySelector("#typeWarn").classList.remove("hidden"); return; }
        // keep the enabled types in the canonical display order
        const types = QTYPE_KEYS.filter((k) => selTypes.includes(k));
        save(LS_PLAYERS, clean);
        save(LS_SETTINGS, { perPlayer, timerSec, topics: selTopics, types });
        newGame(clean, perPlayer, selTopics, timerSec, types);
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
                 data-i="${i}" value="${escapeHtml(p.name)}" maxlength="24" placeholder="Name" />
          ${count > 1 ? `<button class="player-remove shrink-0 rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-500" data-i="${i}" aria-label="Remove">✕</button>` : ""}
        </div>`;
    }

    function typeRow(t, on) {
      return `
        <label class="type-row flex cursor-pointer items-center gap-3 rounded-xl border ${on ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-slate-50"} px-3 py-2.5 transition" data-key="${t.key}">
          <input type="checkbox" class="type-check h-4 w-4 shrink-0 accent-indigo-600" data-key="${t.key}" ${on ? "checked" : ""} />
          <span class="min-w-0">
            <span class="block text-sm font-medium text-slate-700">${t.label}</span>
            <span class="block text-xs text-slate-400">${t.hint}</span>
          </span>
        </label>`;
    }

    function topicChipClass(on) {
      return "topic-chip rounded-full border px-3 py-1.5 text-xs font-medium transition " +
        (on ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300");
    }
    function topicChip(t, on) {
      return `<button class="${topicChipClass(on)}" data-topic="${escapeHtml(t)}">${escapeHtml(niceTopic(t))}</button>`;
    }

    function recentGames(history) {
      const recent = history.slice(-5).reverse();
      return `
        <section class="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Recent games</h2>
          <ul class="mt-3 space-y-2">
            ${recent.map((g) => `
              <li class="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <span class="font-medium text-slate-700">🏆 ${escapeHtml(g.winner)}</span>
                <span class="truncate pl-3 text-right text-slate-400">${escapeHtml(g.summary)}</span>
              </li>`).join("")}
          </ul>
          <button id="clearHistory" class="mt-3 text-xs text-slate-400 hover:text-rose-500">Clear history</button>
        </section>`;
    }

    draw();
  }

  // ---- Turn intro (pass the device) ----
  function viewTurnIntro() {
    const { playerIndex } = game.schedule[game.turn];
    const player = game.players[playerIndex];
    const round = Math.floor(game.turn / game.players.length) + 1;
    const streakLine = player.streak >= 2
      ? `<p class="mt-2 text-sm font-semibold text-orange-500">🔥 ${player.streak} in a row — keep it going!</p>` : "";
    render(`
      <div class="flex min-h-[70vh] flex-col items-center justify-center text-center">
        <p class="text-sm font-medium uppercase tracking-wide text-indigo-500">Question ${game.turn + 1} of ${game.schedule.length}</p>
        <p class="mt-6 text-sm text-slate-500">Pass the device to</p>
        <h1 class="mt-2 text-4xl font-bold text-slate-900">${escapeHtml(player.name)}</h1>
        <p class="mt-4 text-sm text-slate-400">Round ${round} of ${game.perPlayer} &middot; ${player.score} pts</p>
        ${streakLine}
        <button id="ready" class="mt-8 w-full max-w-xs rounded-xl bg-indigo-600 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[.99]">
          I'm ready
        </button>
        <button id="quit" class="mt-4 text-sm text-slate-400 hover:text-slate-600">Quit game</button>
      </div>
    `);
    app.querySelector("#ready").addEventListener("click", () => { game.selected = null; viewQuestion(); });
    app.querySelector("#quit").addEventListener("click", () => { if (confirm("Quit this game?")) viewHome(); });
  }

  // ---- Question ----
  function viewQuestion() {
    const entry = game.schedule[game.turn];
    const player = game.players[entry.playerIndex];
    const q = entry.question;
    const progress = (game.turn / game.schedule.length) * 100;
    const BADGES = {
      ref: ["bg-amber-100", "text-amber-700", "Name the scripture"],
      passage: ["bg-sky-100", "text-sky-700", "Match the passage"],
      topic: ["bg-violet-100", "text-violet-700", "Name the topic"],
      meaning: ["bg-emerald-100", "text-emerald-700", "Name the truth"],
    };
    const [badgeBg, badgeText, badgeLabel] = BADGES[q.type] || BADGES.meaning;
    const badge = `<span class="rounded-full ${badgeBg} px-2.5 py-1 text-xs font-semibold ${badgeText}">${badgeLabel}</span>`;
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
          <span class="flex items-center gap-2 text-xs text-slate-400">${streakBadge}<span>${player.score} pts</span></span>
        </div>

        <div class="mt-3 flex items-center gap-2">${badge}
          ${q.type === "topic" ? "" : `<span class="text-xs uppercase tracking-wide text-slate-400">${escapeHtml(niceTopic(q.scripture.topic))}</span>`}
        </div>

        ${timerBlock}

        ${q.type === "passage" || q.type === "topic"
          ? `<div class="mt-3 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
               <p class="text-xs uppercase tracking-wide text-slate-400">Scripture reference</p>
               <p class="mt-1 font-serif text-2xl font-semibold text-slate-800">${escapeHtml(q.scripture.ref)}</p>
             </div>`
          : `<div class="scripture-scroll mt-3 max-h-[40vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
               <p class="font-serif text-[1.05rem] leading-relaxed text-slate-800">${escapeHtml(q.scripture.text)}</p>
             </div>`}

        <p class="mt-5 text-center text-base font-semibold text-slate-700">${escapeHtml(q.prompt)}</p>

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

    const heading = isRight ? "✓ Correct!" : timedOut ? "⏱ Time's up!" : "✕ Not quite.";
    const breakdown = isRight ? [
      `+${base} base`,
      timeBonus > 0 ? `+${timeBonus} speed` : null,
      streakBonus > 0 ? `+${streakBonus} streak 🔥` : null,
    ].filter(Boolean).join("&nbsp;&nbsp;") + `&nbsp;&nbsp;=&nbsp;&nbsp;<span class="font-bold">${gained} pts</span>` : "";

    const isLast = game.turn === game.schedule.length - 1;
    app.querySelector("#feedback").innerHTML = `
      <div class="rounded-2xl ${isRight ? "bg-emerald-50 ring-emerald-200" : "bg-rose-50 ring-rose-200"} p-4 ring-1">
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold ${isRight ? "text-emerald-700" : "text-rose-700"}">${heading}</p>
          ${isRight ? `<p class="text-sm text-emerald-700">${breakdown}</p>` : ""}
        </div>
        <p class="mt-1 text-sm text-slate-600">
          <span class="font-semibold">${escapeHtml(q.scripture.ref)}</span> &mdash; ${escapeHtml(q.scripture.summary)}
        </p>
        <button id="next" class="mt-3 w-full rounded-xl bg-slate-800 py-3 text-sm font-semibold text-white transition hover:bg-slate-900 active:scale-[.99]">
          ${isLast ? "See results" : "Next player →"}
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
    const ranked = game.players
      .map((p) => ({ ...p, pct: p.answered ? Math.round((p.correct / p.answered) * 100) : 0 }))
      .sort((a, b) => b.score - a.score || b.correct - a.correct);
    const top = ranked[0].score;
    const winners = ranked.filter((p) => p.score === top).map((p) => p.name);
    const tie = winners.length > 1;

    const history = load(LS_HISTORY, []);
    history.push({
      winner: tie ? winners.join(" & ") : winners[0],
      summary: ranked.map((p) => `${p.name} ${p.score}`).join(" · "),
    });
    save(LS_HISTORY, history);

    const medals = ["🥇", "🥈", "🥉"];
    render(`
      <header class="pt-8 pb-4 text-center">
        <div class="text-5xl">🏆</div>
        <h1 class="mt-3 text-2xl font-bold text-slate-900">${tie ? "It's a tie!" : escapeHtml(winners[0]) + " wins!"}</h1>
        <p class="mt-1 text-sm text-slate-500">${game.schedule.length} questions &middot; ${game.perPlayer} per player${game.timerSec ? ` &middot; ${game.timerSec}s timer` : ""}</p>
      </header>

      <section class="space-y-2.5">
        ${ranked.map((p, i) => `
          <div class="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ${i === 0 ? "ring-amber-300" : "ring-slate-200"}">
            <span class="w-7 text-center text-2xl">${medals[i] || `<span class="text-base font-semibold text-slate-400">${i + 1}</span>`}</span>
            <div class="min-w-0 flex-1">
              <p class="truncate font-semibold text-slate-800">${escapeHtml(p.name)}</p>
              <p class="text-xs text-slate-400">${p.correct}/${p.answered} correct &middot; ${p.pct}%${p.bestStreak >= 2 ? ` &middot; 🔥 best ${p.bestStreak}` : ""}</p>
            </div>
            <div class="text-right">
              <span class="text-2xl font-bold text-indigo-600">${p.score}</span>
              <span class="block text-[10px] uppercase tracking-wide text-slate-400">points</span>
            </div>
          </div>`).join("")}
      </section>

      <div class="mt-6 space-y-2.5">
        <button id="again" class="w-full rounded-xl bg-indigo-600 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[.99]">
          Play again (same settings)
        </button>
        <button id="home" class="w-full rounded-xl bg-white py-3.5 text-base font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50">
          Change setup
        </button>
      </div>
    `);
    app.querySelector("#again").addEventListener("click", () => {
      newGame(
        game.players.map((p) => ({ name: p.name })),
        game.perPlayer, game.topics, game.timerSec, game.types
      );
      viewTurnIntro();
    });
    app.querySelector("#home").addEventListener("click", viewHome);
  }

  // ----- boot -----
  if (!DATA || !DATA.scriptures || !DATA.scriptures.length) {
    app.innerHTML = '<p class="p-8 text-center text-rose-600">Failed to load quiz data.</p>';
  } else {
    viewHome();
  }
})();
