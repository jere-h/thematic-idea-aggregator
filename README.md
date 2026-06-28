# TrendDeck — Studio Trend Voting Brief Builder

A single-page, **fully static** web app for running ONE studio trend-voting round entirely in the browser. No backend, no build step, no accounts.

An admin pastes or CSV-imports candidate trend signals, groups them into named **trend cards** (manually, or by pasting clustering JSON from their own Claude session), the studio votes head-to-head across 6–10 random pairs, and the admin sees a **consensus dashboard** and exports a two-page **PDF brief**.

All state lives in the browser's `localStorage`. Rounds are shared by exporting/importing a round file or via an encoded **share link** — no server required.

TrendDeck ships pre-populated with a realistic **sample round** (signals, cards, and votes), so the full UI is populated the first time you open it.

## How it works

1. **Ingest** — paste or CSV-import candidate trend signals.
2. **Cluster** — group signals into named trend cards manually, or paste clustering JSON produced in your own Claude session.
3. **Vote** — the studio votes head-to-head over 6–10 random pairs of cards.
4. **Decide** — review the consensus dashboard and export a two-page PDF brief.
5. **Share** — export/import a round file or copy an encoded share link to move a round between people or machines.

## Run it locally

This is a static site — there is nothing to install or build.

- Just open **`index.html`** in any modern web browser (double-click it, or drag it into a browser window).

That's it. State persists in your browser's `localStorage`, and the bundled sample round means the UI is populated on first load.

> Tip: if your browser is strict about loading local files, you can serve the folder over a tiny local web server instead, e.g. `python3 -m http.server` and visit `http://localhost:8000`. This is optional — opening `index.html` directly works for normal use.

## Host it on GitHub Pages

Because TrendDeck is entirely client-side, GitHub Pages can host it as-is:

1. Create a new GitHub repository and push these files to it (keep the structure intact — `index.html` at the repo root, alongside `css/` and `js/`):
   bash
   git init
   git add .
   git commit -m "Add TrendDeck"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   
2. In the repository on GitHub, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose the **`main`** branch and the **`/ (root)`** folder, then click **Save**.
5. Wait a minute for the deploy to finish. Your app will be available at:
   
   https://<your-username>.github.io/<your-repo>/
   

The included `.nojekyll` file tells GitHub Pages to serve all files verbatim (skipping Jekyll processing), so assets in `css/` and `js/` load correctly.

## Project structure


index.html          App shell and entry point
css/
  app.css           Styles
js/
  sample-data.js    Pre-populated sample round (signals, cards, votes)
  ingestion.js      Signal paste / CSV import
  store.js          localStorage state, export/import, share-link encoding
  cards.js          Trend card grouping (manual + clustering JSON)
  voting.js         Head-to-head pairwise voting
  dashboard.js      Consensus dashboard + PDF brief export
.nojekyll           Serve assets verbatim on GitHub Pages

