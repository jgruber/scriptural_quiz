/* Scripture Quiz — "Truths We Love to Teach" (Appendix A)
 * Pass-and-play multiplayer quiz over NWT Study Edition scriptures.
 * Vanilla JS, no build step. Data is provided by data.js (window.QUIZ_DATA).
 */
(function () {
  "use strict";

  const DATA = window.QUIZ_DATA;
  const app = document.getElementById("app");

  // ----- persistence -----
  const LS_PLAYERS = "sq_players";
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

  function sample(arr, n) {
    return shuffle(arr).slice(0, n);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ----- question generation -----
  const ALL_REFS = uniq(DATA.scriptures.map((s) => s.ref));
  const ALL_SUMMARIES = uniq(DATA.scriptures.map((s) => s.summary));

  // Build one question from a scripture + a chosen type ("ref" | "meaning").
  function buildQuestion(scripture, type) {
    let correct, distractorPool, prompt;
    if (type === "ref") {
      prompt = "Which scripture is this passage from?";
      correct = scripture.ref;
      distractorPool = ALL_REFS.filter((r) => r !== correct);
    } else {
      prompt = "What truth does this scripture teach?";
      correct = scripture.summary;
      distractorPool = ALL_SUMMARIES.filter((s) => s !== correct);
    }
    const distractors = sample(distractorPool, 3);
    const options = shuffle([correct, ...distractors]);
    return {
      type,
      prompt,
      scripture,
      options,
      correctIndex: options.indexOf(correct),
    };
  }

  // Generate a full round: round-robin schedule of {playerIndex, question}.
  function generateSchedule(players, perPlayer) {
    const total = players.length * perPlayer;
    // Draw scriptures without replacement where possible, then recycle.
    let bag = shuffle(DATA.scriptures);
    const draw = () => {
      if (bag.length === 0) bag = shuffle(DATA.scriptures);
      return bag.pop();
    };
    const questions = [];
    for (let i = 0; i < total; i++) {
      const type = Math.random() < 0.5 ? "ref" : "meaning";
      questions.push(buildQuestion(draw(), type));
    }
    // round-robin: round by round, player by player
    const schedule = [];
    let q = 0;
    for (let round = 0; round < perPlayer; round++) {
      for (let p = 0; p < players.length; p++) {
        schedule.push({ playerIndex: p, question: questions[q++] });
      }
    }
    return schedule;
  }

  // ----- game state -----
  let game = null;

  function newGame(names, perPlayer) {
    const players = names.map((n) => ({ name: n, score: 0, answered: 0 }));
    game = {
      players,
      perPlayer,
      schedule: generateSchedule(players, perPlayer),
      turn: 0,
      selected: null, // index chosen for current question
    };
  }

  // =========================================================
  //  VIEWS
  // =========================================================

  function render(html) {
    app.innerHTML = html;
    app.classList.remove("animate-pop");
    void app.offsetWidth; // reflow to restart animation
    app.classList.add("animate-pop");
  }

  // ---- Home / setup ----
  function viewHome() {
    let names = load(LS_PLAYERS, ["Player 1", "Player 2"]);
    if (!Array.isArray(names) || names.length === 0) names = ["Player 1"];
    let perPlayer = 8;

    function draw() {
      const history = load(LS_HISTORY, []);
      render(`
        <header class="pt-6 pb-4 text-center">
          <div class="text-5xl">📖</div>
          <h1 class="mt-3 text-2xl font-bold text-slate-900">Scripture Quiz</h1>
          <p class="mt-1 text-sm text-slate-500">Truths We Love to Teach &middot; Appendix A</p>
        </header>

        <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Players</h2>
          <div id="players" class="mt-3 space-y-2">
            ${names.map((n, i) => playerRow(n, i, names.length)).join("")}
          </div>
          <button id="addPlayer" class="mt-3 w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-500 hover:border-indigo-400 hover:text-indigo-600">
            + Add player
          </button>

          <h2 class="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">Questions per player</h2>
          <div class="mt-2 flex items-center gap-3">
            <input id="perPlayer" type="range" min="3" max="20" value="${perPlayer}" class="flex-1 accent-indigo-600" />
            <span id="perPlayerVal" class="w-8 text-center font-semibold text-indigo-600">${perPlayer}</span>
          </div>

          <button id="start" class="mt-6 w-full rounded-xl bg-indigo-600 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[.99]">
            Start quiz
          </button>
          <p class="mt-3 text-center text-xs text-slate-400">
            Each round mixes two challenges: name the scripture, or name the truth it teaches.
          </p>
        </section>

        ${history.length ? recentGames(history) : ""}
      `);

      // wire inputs
      app.querySelectorAll(".player-name").forEach((inp) => {
        inp.addEventListener("input", (e) => { names[+e.target.dataset.i] = e.target.value; });
      });
      app.querySelectorAll(".player-remove").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          names.splice(+e.currentTarget.dataset.i, 1);
          draw();
        });
      });
      app.querySelector("#addPlayer").addEventListener("click", () => {
        names.push("Player " + (names.length + 1));
        draw();
      });
      const range = app.querySelector("#perPlayer");
      range.addEventListener("input", (e) => {
        perPlayer = +e.target.value;
        app.querySelector("#perPlayerVal").textContent = perPlayer;
      });
      app.querySelector("#start").addEventListener("click", () => {
        const clean = names.map((n) => n.trim()).filter(Boolean);
        if (clean.length === 0) { alert("Add at least one player."); return; }
        save(LS_PLAYERS, clean);
        newGame(clean, perPlayer);
        viewTurnIntro();
      });
      const clearBtn = app.querySelector("#clearHistory");
      if (clearBtn) clearBtn.addEventListener("click", () => { save(LS_HISTORY, []); draw(); });
    }

    function playerRow(name, i, count) {
      return `
        <div class="flex items-center gap-2">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">${i + 1}</span>
          <input class="player-name flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                 data-i="${i}" value="${escapeHtml(name)}" maxlength="24" placeholder="Name" />
          ${count > 1 ? `<button class="player-remove shrink-0 rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-500" data-i="${i}" aria-label="Remove">✕</button>` : ""}
        </div>`;
    }

    function recentGames(history) {
      const recent = history.slice(-5).reverse();
      return `
        <section class="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Recent games</h2>
          <ul class="mt-3 space-y-2">
            ${recent.map((g) => `
              <li class="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <span class="font-medium text-slate-700">🏆 ${escapeHtml(g.winner)}</span>
                <span class="text-slate-400">${escapeHtml(g.summary)}</span>
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
    render(`
      <div class="flex min-h-[70vh] flex-col items-center justify-center text-center">
        <p class="text-sm font-medium uppercase tracking-wide text-indigo-500">Question ${game.turn + 1} of ${game.schedule.length}</p>
        <p class="mt-6 text-sm text-slate-500">Pass the device to</p>
        <h1 class="mt-2 text-4xl font-bold text-slate-900">${escapeHtml(player.name)}</h1>
        <p class="mt-4 text-sm text-slate-400">Round ${round} of ${game.perPlayer} &middot; Score: ${player.score}</p>
        <button id="ready" class="mt-10 w-full max-w-xs rounded-xl bg-indigo-600 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[.99]">
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
    const progress = ((game.turn) / game.schedule.length) * 100;
    const badge = q.type === "ref"
      ? `<span class="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">Name the scripture</span>`
      : `<span class="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">Name the truth</span>`;

    render(`
      <div class="pt-4">
        <div class="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div class="h-full rounded-full bg-indigo-500 transition-all" style="width:${progress}%"></div>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold text-slate-700">${escapeHtml(player.name)}</span>
          <span class="text-xs text-slate-400">Score ${player.score}</span>
        </div>

        <div class="mt-3 flex items-center gap-2">${badge}
          <span class="text-xs uppercase tracking-wide text-slate-400">${escapeHtml(q.scripture.topic)}</span>
        </div>

        <div class="scripture-scroll mt-3 max-h-[42vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <p class="font-serif text-[1.05rem] leading-relaxed text-slate-800">${escapeHtml(q.scripture.text)}</p>
        </div>

        <p class="mt-5 text-center text-base font-semibold text-slate-700">${escapeHtml(q.prompt)}</p>

        <div id="options" class="mt-3 space-y-2.5">
          ${q.options.map((opt, i) => `
            <button class="option w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left text-[0.95rem] leading-snug text-slate-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 active:scale-[.99]" data-i="${i}">
              <span class="mr-2 font-semibold text-slate-400">${String.fromCharCode(65 + i)}</span>${escapeHtml(opt)}
            </button>`).join("")}
        </div>

        <div id="feedback" class="mt-4"></div>
      </div>
    `);

    app.querySelectorAll(".option").forEach((btn) => {
      btn.addEventListener("click", () => onAnswer(+btn.dataset.i));
    });
  }

  function onAnswer(choice) {
    if (game.selected !== null) return; // already answered
    game.selected = choice;
    const entry = game.schedule[game.turn];
    const player = game.players[entry.playerIndex];
    const q = entry.question;
    const correct = q.correctIndex;
    const isRight = choice === correct;
    if (isRight) player.score++;
    player.answered++;

    const buttons = app.querySelectorAll(".option");
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      btn.classList.remove("hover:border-indigo-300", "hover:bg-indigo-50");
      if (i === correct) {
        btn.className = "option w-full rounded-xl border-2 border-emerald-400 bg-emerald-50 px-4 py-3.5 text-left text-[0.95rem] leading-snug font-medium text-emerald-800 shadow-sm";
      } else if (i === choice) {
        btn.className = "option w-full rounded-xl border-2 border-rose-300 bg-rose-50 px-4 py-3.5 text-left text-[0.95rem] leading-snug text-rose-700 shadow-sm";
      } else {
        btn.className = "option w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left text-[0.95rem] leading-snug text-slate-400 opacity-70";
      }
    });

    const isLast = game.turn === game.schedule.length - 1;
    const answerRef = escapeHtml(q.scripture.ref);
    app.querySelector("#feedback").innerHTML = `
      <div class="rounded-2xl ${isRight ? "bg-emerald-50 ring-emerald-200" : "bg-rose-50 ring-rose-200"} p-4 ring-1">
        <p class="text-sm font-semibold ${isRight ? "text-emerald-700" : "text-rose-700"}">
          ${isRight ? "✓ Correct!" : "✕ Not quite."}
        </p>
        <p class="mt-1 text-sm text-slate-600">
          <span class="font-semibold">${answerRef}</span> &mdash; ${escapeHtml(q.scripture.summary)}
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
      .map((p) => ({ ...p, pct: p.answered ? Math.round((p.score / p.answered) * 100) : 0 }))
      .sort((a, b) => b.score - a.score || b.pct - a.pct);
    const top = ranked[0].score;
    const winners = ranked.filter((p) => p.score === top).map((p) => p.name);
    const tie = winners.length > 1;

    // persist to history
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
        <p class="mt-1 text-sm text-slate-500">${game.schedule.length} questions &middot; ${game.perPlayer} per player</p>
      </header>

      <section class="space-y-2.5">
        ${ranked.map((p, i) => `
          <div class="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ${i === 0 ? "ring-amber-300" : "ring-slate-200"}">
            <span class="text-2xl">${medals[i] || `<span class="text-base font-semibold text-slate-400">${i + 1}</span>`}</span>
            <div class="flex-1">
              <p class="font-semibold text-slate-800">${escapeHtml(p.name)}</p>
              <p class="text-xs text-slate-400">${p.score} / ${p.answered} correct &middot; ${p.pct}%</p>
            </div>
            <span class="text-2xl font-bold text-indigo-600">${p.score}</span>
          </div>`).join("")}
      </section>

      <div class="mt-6 space-y-2.5">
        <button id="again" class="w-full rounded-xl bg-indigo-600 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[.99]">
          Play again (same players)
        </button>
        <button id="home" class="w-full rounded-xl bg-white py-3.5 text-base font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50">
          New players
        </button>
      </div>
    `);
    app.querySelector("#again").addEventListener("click", () => {
      newGame(game.players.map((p) => p.name), game.perPlayer);
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
