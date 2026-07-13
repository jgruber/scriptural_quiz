# 📖 Scripture Quiz — Truths We Love to Teach

A mobile-friendly, multi-player **pass-and-play** quiz game over the scriptures
in the **"Truths We Love to Teach"** section (Appendix A) of *Love People—Make
Disciples*. All scriptural text is quoted from the **New World Translation of the
Holy Scriptures (Study Edition)**.

The app is available in **seven languages** — English, Spanish, German, Polish,
Italian, Brazilian Portuguese, and European Portuguese. The interface language
defaults to the browser's preference and can be switched at any time — even
mid-game — from the 🌐 selector shown at the top of every screen; switching
during a game rebuilds the remaining questions in the new language while keeping
scores and turn order. None of the content is machine-translated: every topic,
truth, and verse is taken verbatim from the corresponding jw.org publication in
that language (see [Data source](#data-source)).

It's a single-page app — pure HTML, Tailwind CSS, and vanilla JavaScript, with no
build step and no backend. It runs entirely in the browser and can be hosted as a
static site (e.g. GitHub Pages).

It's also an installable **Progressive Web App**: on a phone you can add it to
your home screen and it launches full-screen like a native app, and a service
worker caches the app shell so it keeps working offline after the first visit.

## How to play

1. Add one or more players and choose how many questions each should answer.
2. Optionally tune the round (all settings are remembered in your browser):
   - **Per-player category** — each player picks 🔀 Mixed, 📖 Scripture, or 💡 Truth.
   - **Topic filter** — limit questions to any of the 9 topics (or all of them).
   - **Answer timer** — Off, 10s, 20s, or 30s per question.
3. Players take turns on a single device (round-robin). A "pass the device"
   screen keeps the next player from seeing the previous answer.
4. Choose which of the four question types are in play (each question picks a
   random enabled type).
5. After every player has answered, a ranked scoreboard declares the winner.
   Recent games are saved locally in your browser.

## Scoring

A correct answer earns **100 base points**, plus bonuses:

- **Speed bonus** — up to **+50** for answering quickly (only when a timer is on).
- **Streak bonus** — **+25** per consecutive correct answer (2nd in a row +25,
  3rd +50 …), capped at +100. A wrong answer or a timeout resets the streak.

The scoreboard ranks players by total points and shows each player's accuracy
and best streak.

## The four question types

| Type | You see | You choose from |
|------|---------|-----------------|
| 📖 Name the scripture | The scriptural text | 4 scripture references |
| 🔎 Match the passage | A scripture reference | 4 passages |
| 🏷️ Name the topic | A scripture reference | 4 topics |
| 💡 Name the truth | The scriptural text | 4 truth summaries |

## Running it

Because the quiz data is embedded in `data.js`, you can simply open `index.html`
in a browser. To serve it locally:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

> Tailwind CSS is loaded via its CDN, so an internet connection is needed for
> styling on first load.

## Installing on a phone (Add to Home Screen)

The app must be served over **HTTPS** (or `localhost`) for install/offline to
work — GitHub Pages does this automatically. Opening `index.html` from `file://`
still plays, but won't register the service worker.

- **Android / Chrome** — open the site, then tap the ⋮ menu → **Install app**
  (or **Add to Home screen**).
- **iOS / Safari** — open the site, tap the **Share** button, then
  **Add to Home Screen**.

Once installed it launches full-screen from its own icon and works offline.

## Project structure

```
index.html            App shell, Tailwind config, mobile meta tags, PWA links
app.js                Game logic: language handling, question generation, turns, scoring
data.js               window.QUIZ_DATA_BY_LANG — per-language topics, truths, and 85 scriptures
i18n.js               window.QUIZ_I18N / QUIZ_LANGS — interface strings for the six languages
manifest.webmanifest  PWA metadata (name, icons, theme) for installation
sw.js                 Service worker — caches the app shell for offline use
icon.svg              Source artwork for the app icons
icon-192.png          App icon (also used as maskable icon)
icon-512.png          App icon (also used as maskable icon)
apple-touch-icon.png  Home-screen icon for iOS
```

## Data source

Each language's dataset is extracted from the "Truths We Love to Teach" appendix
of the jw.org brochure *Love People—Make Disciples* (`lmd`): **9 topics**,
**34 truths**, and **85 scripture citations** with their full New World
Translation (Study Edition) text — the same structure in every language.

| Language | Source |
|----------|--------|
| English, Spanish, German, Italian, European Portuguese | The Study-Edition **EPUB** for each language (its Appendix A embeds the verse text in footnotes) |
| Polish, Brazilian Portuguese | The **Watchtower Online Library** (`wol.jw.org`), since no Study-Edition EPUB is published in these — the appendix supplies topics/truths/references and each verse is read from WOL's bible-citation endpoint |

Nothing is translated by the app; every string of scriptural content is the
official jw.org wording for that language. Both Portuguese editions are
included: Brazilian (`pt-BR`) and European/Portugal (`pt-PT`).

Topics (English): The Future · Family · God · Prayer · Jesus · God's Kingdom ·
Suffering · Death · Religion.

---

*Scripture quotations are from the New World Translation of the Holy Scriptures
(Study Edition), published by the Watch Tower Bible and Tract Society of
Pennsylvania. This is an unofficial study aid and is not affiliated with or
endorsed by the publisher.*
