# Bodyweight Ladders — notes for agents

A progression tracker for bodyweight strength training. Installable PWA, no build
step, no dependencies, no backend. Data lives in `localStorage` on the device.

## Read this before touching chart.json

`chart.json` looks like uniform data. It is not. Some of it is transcribed from a
published source and some is inferred or invented, and a change that treats those
as equally solid will quietly corrupt the app's meaning. Confidence per field:

| Data | Provenance | Confidence |
|---|---|---|
| Exercise names, ladder ordering | Transcribed from the published PDF of chart v5.4 | **High** — verified against the source |
| Category grouping | The chart's column headers | **High** |
| Prerequisite links (`from`) | Read from the chart's connector paths | **Medium** — the shape is right, exact branch points are one person's reading |
| Iron Cross prerequisites | The chart highlights and labels these explicitly | **High** |
| Difficulty tiers (`["Name", ms, "Tier"]`) | Recovered from the fill colour of each exercise's dot cell in the source `.xlsx` | **High** — one dot per exercise, 243 of 244 matched |
| Milestone flags (`["Name", 1, ...]`) | Recovered by inference: the source sheet sets milestone names in **bold** | **Medium-high** — see the note below |
| Rep and hold targets | **Not on the chart at all.** Applied by rule from the Overcoming Gravity convention | Rule-derived, not per-exercise data |
| Straight Bar Dip | Added on request, not on the original chart | Deliberate addition |

### How tiers and milestones were recovered

Both were reconstructed from the source `.xlsx` by `tools/apply-sheet-data.ps1`.
The source sheet is public, and `?format=xlsx` on the export endpoint preserves
cell fills (a CSV export would lose them):
`https://docs.google.com/spreadsheets/d/1a8tlZ-zbF695HA3Lmm20OIYeYYxo1lmUOczUXKLoL4s/edit`
reddit.com blocks automated fetching, so the wiki itself cannot be scraped.

**Tiers — solid.** Every exercise on the chart has a `•` cell next to its name,
and that cell's fill is the tier. The sheet's own legend gives the mapping:

| Fill | Tier |
|---|---|
| `FFC5E0B3` light green | Beginner |
| `FFB4C6E7` light blue | Intermediate |
| `FFFFD965` gold | Advanced |
| `FFF4B083` orange | Elite |

**Milestones — an inference, so treat it as such.** The legend defines
"Milestone" as a *grey* dot (`FFBFBFBF`), but **no grey dot appears anywhere** in
v5.4, v5.3 or v5.2 — the legend entry is defined and never used. What does
partition the exercises is **bold**: 46 bold names in v5.2, 49 in v5.3, 55 in
v5.4. A curated list that grows each release, and which reads exactly like a
milestone set (Pull Up, Dip, Push Up, Row, Muscle Up, Front Lever, Back Lever,
Planche, Iron Cross, Manna, Handstand, Full Squat, Nordic Curl, Human Flag...).
That is the basis for the flags. It is a good inference, not a transcription — if
you can reach the author or a legible original, confirm it.

Two things to know if you re-run the recovery:

- The sheet abbreviates differently from `chart.json` and has two genuine typos,
  "Tuck **Font** Lever" and "Straddle **Font** Lever". `apply-sheet-data.ps1`
  carries an explicit alias table for the 10 names that don't normalise cleanly.
- PowerShell 5.1 reads BOM-less files as ANSI, which double-encodes the degree
  signs in `RTO 75° Dip` and `360° Pull` and silently breaks prerequisite
  matching. The script forces UTF-8 on both read and write and stays pure ASCII
  itself. **Keep it that way**, and check `grep -c 'Â' chart.json` is 0 after any
  re-run.

Verified counts: **8 categories, 37 ladders, 244 rungs, 58 milestones, 23
ladders with prerequisites.** Tiers: Beginner 108, Intermediate 85, Advanced 40,
Elite 10, plus Straight Bar Dip which has no tier because it is not on the source
chart. Note that HANDOVER.md §4 says "34 ladders" — that is wrong; it is 37. The
"23 of" figure is correct.

The recovery replaced the prototype's 37 guessed milestones: **31 kept, 27 added,
6 dropped.** Only metadata changed — no rung was renamed, added, removed or
reordered — so stored progress counts remain valid.

## Layout (v2)

v2 replaced v1's three tabs with the screens in `docs/v2/SPEC.md`. That spec
was approved by the app's only user on 2026-10-14 and is the reference for
behaviour and look.

| File | Role |
|---|---|
| `index.html` | Static shell. Loads `data.js`, `ui.js`, `app.js` with `?v=<version>`. |
| `data.js` | **All storage and the v1 to v2 migration.** Header comment lists the API. |
| `ui.js` | DOM helpers and shared components (`UI.h`, cards, pills, two-step, swipe, dock). |
| `app.js` | Screens, routing and the boot sequence. |
| `styles.css` | Zinc tokens + Oxanium, per the spec's visual system. |
| `fonts/` | Self-hosted Oxanium variable font (OFL), so the app works offline. |
| `chart.json` | The chart, as data. Read the table above first. Becomes the built-in "BWF" collection. |
| `sw.js` | Offline caching. See **Deploying** below. |
| `docs/v2/` | The spec, the approved prototype and a component gallery (`components.html`). |
| `tools/test-migration.js` | Node test for the migration; also audits a real v1 export. |
| `docs/prototype.html`, `docs/HANDOVER.md` | v1-era history. Useful for the reasoning, stale on the specifics. |

`chart.json` rungs are `["Name", milestone(0|1), "Tier"]`. The built-in
collection gives every category, ladder and rung a deterministic id derived from
its names (`bwf:<cat>/<ladder>/<rung>`). **Renaming a rung in chart.json changes its
id** and breaks links and positions pointing at it.

## Data safety: read before changing storage

The user's whole training history lives only in `localStorage` on one phone.

- v2 state is one blob under `bwl-v2`. v1's `bwf-*` keys are **never written or
  removed**. A raw copy of them sits in `bwl-v1-backup`.
- Migration runs once (if `bwl-v2` is absent), checks it lost nothing, and only
  then writes. If it fails, nothing is written and the app shows an
  "Export v1 data" screen.
- Positions are the **last cleared rung** (the user's choice; v1 stored a count N,
  so N maps to `rungs[N-1]`).
- Anything v1 had that v2 has no field for is parked under a `v1` property, not
  dropped.
- `node tools/test-migration.js [export.json]` must pass before any deploy that
  touches `data.js`.

## Deploying

The service worker serves the app's own assets **cache-first**. A phone running an
older worker would otherwise pair a new `index.html` with an old cached `app.js`.
On every deploy, bump **both** `CACHE` and `V` in `sw.js` **and** the `?v=` on
every asset in `index.html`, to the same value.

## Design constraints worth preserving

- The rule: the app never makes a training decision. It never moves a position,
  never advances a rung and never derives achievements.
- Zinc greys plus one accent (`#eab308`), used only for "this week" and
  "you're here". Oxanium throughout.
- Destructive actions use `UI.twoStep`. Native `confirm()` is banned.
- Every handler saves before it renders. The logger autosaves on each keystroke.
- Everything is script-rendered, so each screen render is wrapped in try/catch.
  Keep the boot message.

## Testing

```
python3 -m http.server 8124 --bind 127.0.0.1
node tools/test-migration.js
```

Service workers and `localStorage` need a real HTTP origin; `file://` will not do.
When testing locally, remember the worker is cache-first: bump the version or
reload twice to see an edit.
