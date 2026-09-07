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
| Milestone flags (`["Name", 1]`) | **Invented.** The chart marks milestones with coloured dots that did not survive text extraction | **Low — replace, do not build on** |
| Difficulty tiers (Beginner/Intermediate/Advanced/Elite) | **Not implemented.** The chart colour-codes all four; that colour data was never captured | **Missing** |
| Rep and hold targets | **Not on the chart at all.** Applied by rule from the Overcoming Gravity convention | Rule-derived, not per-exercise data |
| Straight Bar Dip | Added on request, not on the original chart | Deliberate addition |

Both gaps (milestones, tiers) are carried by **cell colour** in the original, so
recovering them means an `.xlsx` export, not a CSV. The source sheet is public:
`https://docs.google.com/spreadsheets/d/1a8tlZ-zbF695HA3Lmm20OIYeYYxo1lmUOczUXKLoL4s/edit`
(`?format=xlsx` on the export endpoint preserves fills). reddit.com blocks
automated fetching, so the wiki itself cannot be scraped.

Verified counts as of the port: **8 categories, 37 ladders, 244 rungs, 37
milestones, 23 ladders with prerequisites.** Note that HANDOVER.md §4 says "34
ladders" — that is wrong; it is 37. The "23 of" figure is correct.

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

`chart.json` rungs use the prototype's compact form — `"Name"` or `["Name", 1]`
where `1` marks a milestone — because `app.js` still runs the original
`normalise` step over them. Prerequisites are `[Category, Ladder, Move]` triples
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

1. Milestones are guesses; difficulty tiers are absent. See the table above.
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
