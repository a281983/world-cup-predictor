# World Cup 2026 — Bracket Predictor

An interactive, single-page predictor for the 2026 FIFA World Cup. You don't pick winners
directly — you set a **theory of what wins tournaments** (how much history matters vs. current
form vs. your own gut and chaos tolerance), and the whole bracket re-cascades live: remaining
group games are simulated, the table is completed, the eight best third-place teams are seeded
into the Round of 32, and every knockout tie is resolved through to the title, with Monte-Carlo
title odds on top.

No backend. No login. No build step. No API keys. Just static files.

## Run it

Because it uses native ES modules, it must be served over **http(s)** — opening `index.html`
directly as a `file://` will be blocked by the browser. Two easy options:

```bash
# local preview
python3 -m http.server 8000      # then open http://localhost:8000
```

…or just push to GitHub Pages (below) and use the live URL.

## Deploy to GitHub Pages (manual, no token needed)

From inside this folder:

```bash
git init
git add .
git commit -m "World Cup 2026 bracket predictor"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/worldcup-predictor.git
git push -u origin main
```

Then in the repo on github.com: **Settings → Pages → Build and deployment → Source: Deploy from
a branch → Branch: `main` / `root` → Save.** After a minute the site is live at:

```
https://<YOUR_USERNAME>.github.io/worldcup-predictor/
```

The `.nojekyll` file is included so GitHub Pages serves the `js/` modules as-is.

## Keeping it current

The site ships with results **up to the date shown in the header** (embedded in
`data/matches.json`). There are two ways to update it:

1. **Refresh live (one click, free).** The "↻ Refresh live" button re-fetches the public
   [openfootball/worldcup.json](https://github.com/openfootball/worldcup.json) feed straight from
   the browser (it allows cross-origin reads), folds in any new scores, and re-runs the model.
   No account, no key. If the upstream feed is lagging or unreachable, it falls back to the
   embedded snapshot and tells you so. This updates the page in the visitor's browser only — it
   does not change the committed files.

2. **Re-bake the snapshot (to make it permanent).** Re-run the data builder and commit:
   ```bash
   python3 build_data.py        # pulls latest openfootball, rewrites data/*.json
   python3 add_h2h.py           # recomputes head-to-head records from the intl. dataset
   git commit -am "refresh results" && git push
   ```

## What's real and what's modelled

This is an **entertainment tool**, and it's honest about its inputs:

- **Group results** with `played: true` are **real**, from openfootball (MIT licensed).
- **Head-to-head records** are **real**, from ~49k internationals since 1872 (martj42/international_results, CC0), recency-weighted over the last 10 meetings per pair.
- **Elo rating** is **real** — World Football Elo computed from the same ~49k-match history (K-factor
  by match importance, margin-of-victory multiplier, home advantage). It's the single most heavily
  weighted lever. **FIFA rank** is derived from that Elo.
- **Recent form** (results, goals for/against) is **derived from the real played games**.
- **Squad depth, tactical cohesion, key-player availability, penalty-shootout history** and
  similar fields are **synthetic** — deterministically generated from each team's Elo with a
  small seeded jitter. They're plausible and illustrative, not measured (no free source provides them).
- Every slider you see maps to a real lever in the engine — there are no dead controls.

Not affiliated with FIFA. Not a betting tool.

## How the model works (short version)

1. **Score** — every feature is standardised to a z-score across the 48 teams, then each team's
   **strength** is a weighted sum of those z-scores across three buckets (Historical DNA /
   Form & Squad / Strategic Wildcards). Your sliders are the weights. (This is the linear predictor
   from a logistic regression, with hand-set rather than fitted coefficients.)
2. **Match probability** — logistic / Bradley-Terry: `p = 1 / (1 + e^(-k·(strengthA − strengthB)))`,
   where the "upset" slider sets the temperature `k`: chalk → decisive favourites, chaos → coin-flips.
3. **Group completion** — remaining group games are simulated, the table is sorted on
   points / goal difference / goals for, and the eight best third-placed teams are matched into
   their Round-of-32 slots (reproducing FIFA's allocation via constraint matching).
4. **Knockout** — the bracket is resolved 73 → 104 following the official match wiring, including
   the third-place game's losing-semifinalist references.
5. **Title odds** — the knockout is re-simulated ~1,800× (stochastic) from a fixed seeding to
   estimate each team's championship probability. Razor-edge dots flag ties a ~20% swing would
   flip.

## Files

```
index.html            shell
styles.css            dark theme
js/utils.js           pure helpers (rng, normalisation, weighted average)
js/prediction.js      pure prediction engine (no DOM) — group completion, seeding, knockout, MC
js/data.js            load + normalise data, optional live refresh
js/ui.js              rendering + interaction
data/teams.json       48 teams (generated)
data/matches.json     fixtures + real results + bracket wiring (generated)
build_data.py         regenerates data/*.json from openfootball + the curated ratings table
add_h2h.py            injects real head-to-head records into teams.json
.nojekyll             tells GitHub Pages to serve files as-is
```
