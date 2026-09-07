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

## Layout

| File | Role |
|---|---|
| `index.html` | Static shell. All content is script-rendered into it. |
| `app.js` | **The source of truth for behaviour.** |
| `chart.json` | The chart, as data. Read the table above first. |
| `styles.css` | Verbatim from the prototype. The visual language is deliberate. |
| `sw.js` | Offline caching. **Bump `CACHE` on every deploy** or phones keep the old shell. |
| `docs/prototype.html` | The original single-file artifact. Historical reference only — not wired up, do not edit to change behaviour. |
| `docs/HANDOVER.md` | Why the app is shaped the way it is. Still the best explanation of the design decisions. |
| `tools/serve.ps1` | Local static server. There is no Node or Python on the dev machine. |
| `tools/make-icons.ps1` | Regenerates the PWA icons via System.Drawing. |

`chart.json` rungs are `["Name", milestone(0|1), "Tier"]`, normalised into
`{n, ms, tier}` by `initChart()`. Tier is `null` only for Straight Bar Dip, which
is not on the source chart. Prerequisites are `[Category, Ladder, Move]` triples
and may cross categories.

## Design constraints worth preserving

- Cool grey paper, deep slate ink, and a highlighter yellow used **only** for
  "your next step". Barlow Semi Condensed throughout.
- The ladder drawing — two rails, one rung per exercise — is the one piece of
  visual boldness. Keep it.
- Progress is stored as a **count** of cleared rungs, not a set of names. Cheap,
  but inserting a rung mid-ladder silently promotes anyone already past that
  point. If you edit a ladder's `m` array, you are rewriting history for existing
  users. Consider switching to named rungs.
- Nothing is ever blocked. An unmet prerequisite fades a ladder but you can still
  mark into it, because people skip around.
- Moving up a rung is always offered, never automatic.
- Everything is script-rendered, so one early exception blanks the page. Keep the
  boot message and the try/catch around render.

## Known issues carried over from the prototype

1. Milestone flags are inferred from bold in the source sheet, not transcribed.
   See the recovery notes above. Tiers are solid.
2. Progress stored as a count, so mid-ladder insertions shift meaning.
3. Target parsing is loose — it reads `3×8`, `30s`, and bare numbers. Anything
   freeform (`AMRAP`, `5-3-1`) logs fine but silently disables the move-up check.
4. Targets are assigned by **regex on the exercise name**, not curated data. It
   misclassifies some: explosive and skill work (muscle-ups, handstand balance,
   planche leans) should not be trained to a flat 3×8, and advanced statics are
   held far under 30 s at first.
5. Duplicate exercises are refused across a whole workout, so the same movement
   cannot appear in two blocks for a two-round structure.
6. Block names do not resequence when reordered — move C above A and you get
   C, A, B.
7. RPE is per exercise, not per set. Deliberate, to keep phone input manageable.
8. The Log tab's set boxes wrap two-per-line at 375px. Usable but cramped; the
   table wants a proper narrow-screen treatment.
9. The Legs branch was incomplete in the first transcription (Nordic curl and
   split squat / step up were recovered later). Worth a final check against the
   source that nothing else is missing.

## Testing

There is no test runner and no Node. To exercise it:

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8123
```

then open `http://localhost:8123/`. Service workers and `localStorage` need a
real HTTP origin — `file://` will not do.

The logic worth protecting is small and pure: `requirements()`, `orderLegs()`,
`routeTo()`, `parseTarget()`, `gate()`, `target()`. If you change any of them,
check these known-good values, recomputed from `chart.json` at port time: Muscle
Up is **8 checkpoints over 2 ladders**; Iron Cross is **50 checkpoints over 10
ladders and 5 categories**.

(HANDOVER.md §4 says Iron Cross spans 4 categories. It is 5 — it misses Core,
which enters via Planche's `Core|Plank` prerequisite.)
