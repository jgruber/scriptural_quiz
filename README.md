# 📖 Scripture Quiz — Truths We Love to Teach

A mobile-friendly, multi-player **pass-and-play** quiz game over the scriptures
in the **"Truths We Love to Teach"** section (Appendix A) of *Love People—Make
Disciples*. All scriptural text is quoted from the **New World Translation of the
Holy Scriptures (Study Edition)**.

It's a single-page app — pure HTML, Tailwind CSS, and vanilla JavaScript, with no
build step and no backend. It runs entirely in the browser and can be hosted as a
static site (e.g. GitHub Pages).

## How to play

1. Add one or more players and choose how many questions each should answer.
2. Players take turns on a single device (round-robin). A "pass the device"
   screen keeps the next player from seeing the previous answer.
3. Each round mixes two kinds of question:
   - **Name the scripture** — read the passage, then pick the correct citation.
   - **Name the truth** — read the passage, then pick the truth it teaches.
4. After every player has answered, a ranked scoreboard declares the winner.
   Recent games are saved locally in your browser.

## The two question types

| Type | You see | You choose from |
|------|---------|-----------------|
| Name the scripture | The scriptural text | 4 scripture references |
| Name the truth | The scriptural text | 4 truth summaries |

## Running it

Because the quiz data is embedded in `data.js`, you can simply open `index.html`
in a browser. To serve it locally:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

> Tailwind CSS is loaded via its CDN, so an internet connection is needed for
> styling on first load.

## Project structure

```
index.html   App shell, Tailwind config, mobile meta tags
app.js       Game logic: setup, question generation, turns, scoring, results
data.js      window.QUIZ_DATA — topics, truths, and 85 scriptures (NWT Study Edition)
```

## Data source

The dataset is extracted from the "Truths We Love to Teach" appendix:
**9 topics**, **34 truths**, and **85 scripture citations** with their full
New World Translation (Study Edition) text.

Topics: The Future · Family · God · Prayer · Jesus · God's Kingdom · Suffering ·
Death · Religion.

---

*Scripture quotations are from the New World Translation of the Holy Scriptures
(Study Edition), published by the Watch Tower Bible and Tract Society of
Pennsylvania. This is an unofficial study aid and is not affiliated with or
endorsed by the publisher.*
