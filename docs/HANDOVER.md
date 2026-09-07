# Bodyweight Ladders — handover

**Status:** working single-file HTML prototype, feature-complete for one user.
**Goal of the next phase:** rebuild it as a real app using Claude Code, with persistence that
actually syncs across devices.

Source file: `bodyweight-ladders.html` (single file, ~64 KB, no build step, no dependencies
beyond one Google Fonts link). Full source is embedded in the appendix at the end of this
document, and shipped alongside it.

---

## 1. What this is

A progression tracker for bodyweight strength training, built on the community chart
**"Bodyweight Fitness Progressions" v5.4** by u/shellerik (March 2019), which is itself derived
from *Overcoming Gravity* 2nd ed., the r/bodyweightfitness Recommended Routine and Exercise Wiki,
and Antranik.

The chart organises ~240 exercises into eight categories, each containing several ordered
progressions ("ladders"). You climb a ladder rung by rung. Ladders also feed each other —
you need a Pull Up before a Muscle Up — which the chart draws as connector lines and which this
app models explicitly as prerequisites.

The app has three sections: **Ladders** (browse and mark progress), **Log** (record sessions),
**Build** (compose workouts).

---

## 2. Where the data came from, and what's trustworthy

This matters more than it sounds — some of the data is transcribed from the source and some is
inferred, and a rebuild shouldn't treat them as equally solid.

| Data | Provenance | Confidence |
|---|---|---|
| Exercise names and ladder ordering | Transcribed from the published PDF of chart v5.4 | High — verified against the source |
| Category grouping | From the chart's column headers | High |
| Prerequisite links between ladders | Read from the chart's connector paths | Medium — the shape is right, exact branch points are my reading |
| Iron Cross prerequisites | The chart highlights these in yellow and labels them explicitly | High |
| Milestone flags | **My own picks.** The chart marks milestones with coloured dots that didn't survive text extraction and weren't legible enough in the screenshot to transcribe safely | Low — replace these |
| Difficulty tiers (Beginner / Intermediate / Advanced / Elite) | **Not implemented.** The chart colour-codes every exercise into four tiers; that colour data was never captured | Missing |
| Rep and hold targets | **Not on the chart at all.** Applied by rule from the Overcoming Gravity convention: 3 sets of 5–8 reps, move up at 3×8; isometrics work toward 30 s; negatives 3×5 slow | Rule-derived, not per-exercise data |
| Straight Bar Dip | Added on request, not on the original chart | Deliberate addition |

**Highest-value data work for the next phase:** get the sheet as CSV or a high-resolution export
and transcribe the real milestone flags and the four difficulty tiers. Both are carried by cell
colour in the original. Source sheet:
`https://docs.google.com/spreadsheets/d/1a8tlZ-zbF695HA3Lmm20OIYeYYxo1lmUOczUXKLoL4s/edit`

Note that reddit.com blocks automated fetching, so the wiki itself can't be scraped; the PDF
mirror at calisthenics-101.co.uk was the workable source.

---

## 3. Data model

Four independent stores, each a single key.

```
level     : { "<Category>/<Ladder>": <number of rungs cleared> }
workouts  : [ { id, name, blocks: [ { id, name, sets, items: [ { key, target, note } ] } ] } ]
logbook   : [ { id, date, wid, name, note, entries: [ { key, name, block, target, note, sets: [], rpe } ] } ]
focus     : [ "<Category>|<Ladder>|<Move>", ... ]      // Priority tab goals, max 4
```

An exercise is identified everywhere by the string `"Category|Ladder|Move"`. Progress is stored as
a **count** of cleared rungs, not a set of names — cheap, but it means inserting a rung mid-ladder
silently promotes anyone who was already past that point. **Consider switching to named rungs
during the rebuild.**

The chart itself lives in a single `DATA` array literal at the top of the script: eight category
objects, each with `ladders`, each ladder with `n` (name), optional `from` (prerequisites), and
`m` (rungs, where `["Name", M]` marks a milestone). Prerequisites are triples
`[Category, Ladder, Move]`; a ladder can have several, and they can point across categories.
This array should become a data file (JSON) rather than inline code.

---

## 4. Features, and the decisions behind them

**Ladders tab.** Eight category sub-tabs plus Priority. Within a category, ladders render as
columns drawn like actual ladders — two rails, one rung per exercise. Tapping a rung sets your
level *to* that rung, filling everything below; tapping a filled rung drops back to it. Chosen
over per-rung toggling because progressions are strictly ordered. Milestones show as a ring on
the rail. Each rung displays its target. A "milestones only" filter collapses a category to its
checkpoints.

**Prerequisites.** 23 of 34 ladders declare where they branch from. A ladder whose prerequisites
aren't met renders faded, with its requirements listed under the title as `· Pull Up` / `✓ Pull Up`.
Nothing is blocked — you can still mark into a faded ladder, because people skip around.

**Priority tab** (originally "Next up"). Pick up to four goals; each becomes a column showing the
complete route there. The route is computed by walking the prerequisite graph backwards
(`requirements()` collects every ladder and how deep it must go, `orderLegs()` emits them
prerequisites-first), so it spans categories. Muscle Up is 8 checkpoints over 2 ladders; Iron
Cross is 50 over 10 ladders and 4 categories. The single next checkpoint is highlighted.

**Build tab.** A workout is an ordered list of blocks; a block is a named group of exercises with
a **block-level set count**. Two or more exercises in a block means a superset. Exercises are
chosen with a two-stage picker — tree first, then rung, with your current position marked and
already-added rungs disabled. Exercises and blocks both reorder by drag, with a click-to-carry
fallback because HTML5 drag doesn't fire on touch. Per-exercise notes column.

**Log tab.** Runs a session against a workout. Set boxes are generated from the block's set count,
grouped under block headings, with a per-exercise RPE column and notes carried through from the
builder. On save it compares what you entered against each target and offers to advance the
matching rungs — one button per exercise, never automatic. If something was cleared at RPE 9+,
it says so but still offers the button. Logging feeds the ladders rather than sitting beside them.

**Navigation.** Fixed bottom bar with three icon tabs, mobile-app style.

---

## 5. Known issues and open items

1. **Persistence is the reason for this rebuild.** The prototype uses the artifact `window.storage`
   API, which is account-scoped but exists only inside Claude. A downloaded copy in a plain browser
   has no storage at all. There's a manual JSON backup/restore/download panel at the bottom of
   Build as a stopgap. **A real app needs a backend or at minimum IndexedDB plus an export path.**
2. **Milestones are guesses.** See §2.
3. **Difficulty tiers were never implemented.** The chart has four; the app has none.
4. **Progress stored as a count**, so mid-ladder insertions shift meaning. See §3.
5. **Target parsing is loose.** It reads `3×8`, `30s`, and bare numbers like `10`. Anything
   freeform (`AMRAP`, `5-3-1`, rep ranges) logs fine but silently disables the move-up check.
6. **Targets are assigned by regex** on the exercise name (`DYN` / `STAT` in the source). It's a
   rule, not curated data, and it misclassifies a few — explosive and skill work like muscle-ups,
   handstand balance and planche leans shouldn't be trained to a flat 3×8, and advanced statics
   are held far under 30 s at first.
7. **Duplicate exercises are refused across a whole workout**, so the same movement can't appear
   in two blocks for a two-round structure.
8. **Block names don't resequence** when reordered — move C above A and you get C, A, B.
9. **RPE is per exercise, not per set.** Deliberate, to keep phone input manageable.
10. **Everything is script-rendered**, so a single early exception blanks the page. There's a boot
    message and a try/catch around the render as a guard, but server-rendered or
    progressively-enhanced markup would be more robust.
11. **Legs branch was incomplete** in the first transcription; Nordic curl and split squat / step up
    lines were recovered later. Worth a final check against the source that nothing else is missing.

---

## 6. Suggested direction for the rebuild

Not prescriptive — the prototype deliberately has no framework, so nothing constrains this.

- The chart data is static, read-only and shared by every user: ship it as a JSON asset, not code.
- User data is small (a few KB), writes are infrequent, conflicts are unlikely. Local-first with a
  sync layer fits better than a request-per-tap API.
- The interesting logic is small and pure — `requirements()`, `orderLegs()`, `routeTo()`,
  `parseTarget()`, `gate()`. Port these as tested functions before any UI work; they're where the
  behaviour lives.
- The visual language is deliberate and worth keeping: cool grey paper, deep slate ink, a
  highlighter yellow used *only* for "your next step", Barlow Semi Condensed throughout. The ladder
  drawing is the one piece of visual boldness — keep it.
- Test data: a real user snapshot is in §7 below.

### Suggested skills for the next session

- **`frontend-design`** — for the visual direction if the UI is rebuilt rather than ported.
- **`web-artifacts-builder`** — if it stays a web app with React/Tailwind/shadcn.
- **`writing-for-agents`** — worth writing a `CLAUDE.md` for the repo early, since the chart-data
  provenance rules in §2 are exactly the kind of thing a fresh agent will otherwise get wrong.
- **`skill-creator`** — if the chart transcription becomes a repeatable task.

---

## 7. Current user data

Real snapshot, used as the app's seed state. Six ladders marked, one four-block workout, three
focus goals, no sessions logged yet.

```json
{"v":1,"saved":"2026-09-07","level":{"Vertical pull/Pull up":3,"Horizontal pull/Rows":4,"Dips & L-sit/Dip":3,"Horizontal push/Push up":3,"Legs/Squat":3,"Legs/Pistol squat":2},"workouts":[{"id":"rr7rtqy","name":"Tensile Strength - Bodyw","blocks":[{"id":"niux0j8","name":"Main 1","items":[{"key":"Vertical pull|Pull up|Pull Up","target":"10","note":"Chin Over Bar"},{"key":"Dips & L-sit|Dip|Straight Bar Dip","target":"10","note":"Chest To Bar"}],"sets":4},{"id":"zoqvsli","name":"Main 2","items":[{"key":"Dips & L-sit|Dip|Dip","target":"10"},{"key":"Legs|Pistol squat|Assisted Pistol Squat","target":"4"}],"sets":4},{"id":"x30dzm9","name":"C","sets":3,"items":[{"key":"Horizontal pull|Rows|Wide Row","target":"10"},{"key":"Horizontal push|Push up|Pike Push Up","target":"5"}]},{"id":"xwjbo3z","name":"Core","sets":3,"items":[{"key":"Core|Compression|Hanging Leg Raise to Bar","target":"10","note":"L position for now"},{"key":"Core|Dragon flag|Tuck Dragon Flag Negative","target":"3×5 slow","note":"[1151]"}]}]}],"logbook":[],"focus":["Vertical pull|Muscle up|Muscle Up","Horizontal pull|Rows|One Arm Row","Horizontal push|One arm push up|One Arm Push Up"]}
```

---

## 8. Appendix — full source

The complete artifact follows. It is also provided as `bodyweight-ladders.html` alongside this
document; if you have that file, work from it rather than copying out of here.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bodyweight ladders</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
<style>
  :root{--paper:#E5E9E7;--panel:#F0F3F1;--ink:#16262A;--muted:#7C8B8C;
        --rail:#C0CAC7;--mark:#F3E15A;--focus:#2C6FA8}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{background:var(--paper);color:var(--ink);
    font-family:'Barlow Semi Condensed','Arial Narrow',system-ui,sans-serif;
    font-size:15px;line-height:1.35;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1180px;margin:0 auto;padding:22px 18px 112px}
  h1{font-size:27px;font-weight:700;letter-spacing:-.01em;margin:0}
  h2{font-size:16px;font-weight:700;margin:0}
  input,select,button,textarea{font:inherit;color:inherit}

  header{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px 16px;
    padding-bottom:14px;border-bottom:2.5px solid var(--ink)}
  .count{margin-left:auto;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
  .count span{color:var(--muted);font-weight:400}

  .tabbar{position:fixed;left:0;right:0;bottom:0;z-index:20;background:var(--paper);
    border-top:1.5px solid var(--rail);padding-bottom:env(safe-area-inset-bottom)}
  .tabbar .inner{max-width:1180px;margin:0 auto;display:flex}
  .tabbar button{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;
    background:none;border:0;border-top:2.5px solid transparent;margin-top:-1.5px;
    padding:10px 4px 11px;color:var(--muted);cursor:pointer;font-size:13px;font-weight:500}
  .tabbar button svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.6;
    stroke-linecap:round;stroke-linejoin:round}
  .tabbar button:hover{color:var(--ink)}
  .tabbar button[aria-selected="true"]{color:var(--ink);font-weight:700;border-top-color:var(--ink)}
  .tabbar button[aria-selected="true"] svg{stroke-width:2.1}

  .meter{height:4px;background:var(--rail);margin:18px 0 4px;overflow:hidden}
  .meter i{display:block;height:100%;background:var(--ink);width:0;transition:width .35s ease}
  nav.grp{display:flex;flex-wrap:wrap;gap:2px;margin:16px 0 4px;border-bottom:1.5px solid var(--rail)}
  nav.grp button{font-weight:500;color:var(--muted);background:none;border:0;padding:8px 13px;
    margin-bottom:-1.5px;border-bottom:2.5px solid transparent;cursor:pointer}
  nav.grp button:hover{color:var(--ink)}
  nav.grp button[aria-selected="true"]{color:var(--ink);font-weight:700;border-bottom-color:var(--ink)}
  nav.grp button .n{font-variant-numeric:tabular-nums;color:var(--muted);font-weight:400;margin-left:5px;font-size:13px}
  nav.grp button[aria-selected="true"] .n{color:var(--ink)}

  .bar{display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin:14px 0 18px}
  .hint{color:var(--muted);font-size:14px;margin:0;max-width:60ch}
  .only{display:inline-flex;align-items:center;gap:7px;color:var(--muted);font-size:14px;cursor:pointer}
  .only input{accent-color:var(--ink);width:15px;height:15px;margin:0}
  .only:hover{color:var(--ink)}

  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:26px 22px;align-items:start}
  .col .frac{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums;margin:0 0 9px}
  .col .pre{margin:0 0 3px;font-size:12.5px;line-height:1.5;display:flex;flex-wrap:wrap;gap:3px 10px}
  .col .pre span{color:var(--muted)}
  .col .pre span.ok{color:var(--ink)}
  .col.locked .ladder,.col.locked h2{opacity:.5}
  .ladder{position:relative}
  .ladder::before,.ladder::after{content:"";position:absolute;top:9px;bottom:9px;width:1.5px;background:var(--rail)}
  .ladder::before{left:7px}
  .ladder::after{left:25px}
  .rung{position:relative;display:flex;gap:8px;align-items:baseline;width:100%;text-align:left;
    color:var(--muted);background:none;border:0;cursor:pointer;padding:5px 2px 5px 36px}
  .rung::before{content:"";position:absolute;left:7px;top:50%;width:19px;height:1.5px;
    background:var(--rail);transform:translateY(-50%)}
  .rung .t{position:relative;padding:1px 3px;margin-left:-3px;flex:1}
  .rung .rx{font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums;opacity:.75;white-space:nowrap}
  .rung:hover .t{box-shadow:inset 0 -1.5px 0 var(--rail)}
  .rung.ms::after{content:"";position:absolute;left:2.5px;top:50%;width:11px;height:11px;
    border:2px solid var(--rail);border-radius:50%;background:var(--paper);transform:translateY(-50%)}
  .rung.ms .t{font-weight:600}
  .rung.done{color:var(--ink);font-weight:600}
  .rung.done::before{background:var(--ink);height:3.5px}
  .rung.done.ms::after{background:var(--ink);border-color:var(--ink)}
  .rung.next{color:var(--ink);font-weight:600}
  .rung.next::before{background:var(--ink);height:3.5px;opacity:.32}
  .rung.next .t{background:var(--mark)}
  .rung.next .rx{color:var(--ink);opacity:1}
  .rung:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}

  .chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 22px}
  .chip{display:inline-flex;align-items:center;gap:7px;background:var(--ink);color:var(--paper);
    padding:4px 6px 4px 12px;font-size:14px;font-weight:600}
  .chip button{background:none;border:0;color:var(--paper);font-size:16px;line-height:1;
    padding:0 4px;cursor:pointer;opacity:.7}
  .chip button:hover{opacity:1}
  .goals{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:30px 24px;align-items:start}
  .goal h2{font-size:20px;margin:0 0 1px}
  .goal .gsub{color:var(--muted);font-size:13px;margin:0 0 2px}
  .goal .gcount{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums;margin:0 0 12px}
  .goal .gmeter{height:3px;background:var(--rail);margin:0 0 14px}
  .goal .gmeter i{display:block;height:100%;background:var(--ink)}
  .leg{color:var(--muted);font-size:13px;font-weight:600;margin:14px 0 2px}
  .leg:first-child{margin-top:0}
  .step{position:relative;display:flex;gap:8px;align-items:baseline;width:100%;text-align:left;
    background:none;border:0;color:var(--muted);cursor:pointer;padding:4px 2px 4px 20px}
  .step::before{content:"";position:absolute;left:4px;top:50%;width:6px;height:6px;border-radius:50%;
    background:var(--rail);transform:translateY(-50%)}
  .step .t{flex:1;padding:1px 3px;margin-left:-3px}
  .step .rx{font-size:12.5px;opacity:.75;white-space:nowrap;font-variant-numeric:tabular-nums}
  .step.ms::before{width:9px;height:9px;left:2.5px;border:2px solid var(--rail);background:var(--paper)}
  .step.now{color:var(--ink);font-weight:700}
  .step.now .t{background:var(--mark)}
  .step.now::before{background:var(--ink);border-color:var(--ink)}
  .step:hover .t{box-shadow:inset 0 -1.5px 0 var(--rail)}
  .xfer{margin-top:40px;padding-top:16px;border-top:1.5px solid var(--rail)}
  .xfer h2{margin-bottom:4px}
  .xfer p{color:var(--muted);font-size:13.5px;margin:0 0 12px;max-width:62ch}
  .xfer textarea{width:100%;min-height:90px;background:var(--panel);border:1.5px solid var(--rail);
    padding:8px 10px;font-size:12.5px;font-family:ui-monospace,Menlo,monospace;resize:vertical}
  .xfer textarea:focus{outline:none;border-color:var(--ink)}
  .xfer .acts{margin-top:10px}
  .xstat{color:var(--muted);font-size:13.5px;margin-left:4px;align-self:center}
  .start{background:var(--panel);padding:18px;margin-top:4px}
  .start h3{margin:0 0 6px;font-size:18px}
  .start p{margin:0 0 14px;color:var(--muted);max-width:52ch}
  .sugg{display:flex;flex-wrap:wrap;gap:8px}
  .sugg button{background:none;border:1.5px solid var(--ink);color:var(--ink);
    padding:5px 12px;cursor:pointer;font-weight:600;font-size:14px}
  .sugg button:hover{background:var(--ink);color:var(--paper)}
  .cleared{color:var(--muted);font-size:13px;margin:6px 0 0;padding-left:20px}
  .up{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
  .card{background:var(--panel);padding:12px 14px}
  .card .grp{color:var(--muted);font-size:13px;margin:0 0 1px}
  .card .lad{font-size:14px;font-weight:500;margin:0 0 5px}
  .card .mv{font-size:19px;font-weight:700;line-height:1.15;margin:0;display:inline;padding:1px 4px;background:var(--mark)}
  .card .meta{color:var(--muted);font-size:13px;margin:9px 0 0}
  .card.clear .mv{background:none}
  .card.ready{border-left:3px solid var(--ink);padding-left:11px}
  .card.ready .mv{background:none;box-shadow:inset 0 -2px 0 var(--mark)}
  .badge{display:inline-block;border:1.5px solid var(--ink);border-radius:20px;padding:0 7px;
    font-size:12px;font-weight:600;margin-left:6px;vertical-align:2px}
  .empty{color:var(--muted);max-width:52ch}

  /* build + log */
  .split{display:grid;grid-template-columns:250px 1fr;gap:28px;align-items:start;margin-top:20px}
  .rowhead{display:flex;align-items:center;gap:12px;margin-bottom:10px}
  .rowhead h2{flex:1}
  .btn{background:none;border:1.5px solid var(--rail);padding:5px 12px;cursor:pointer;color:var(--muted)}
  .btn:hover{color:var(--ink);border-color:var(--ink)}
  .btn.solid{background:var(--ink);border-color:var(--ink);color:var(--paper)}
  .btn.solid:hover{opacity:.85;color:var(--paper)}
  .btn.mini{padding:2px 8px;font-size:13px}
  .wlist{list-style:none;margin:0;padding:0}
  .wlist li{display:flex;align-items:baseline;gap:8px;padding:8px 0;border-bottom:1.5px solid var(--rail);cursor:pointer}
  .wlist li:hover .wn{box-shadow:inset 0 -1.5px 0 var(--rail)}
  .wlist li[aria-current="true"] .wn{font-weight:700}
  .wlist .wn{flex:1}
  .wlist .wc{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
  .editor{min-height:120px}
  .name{width:100%;max-width:420px;background:none;border:0;border-bottom:2px solid var(--rail);
    font-size:22px;font-weight:700;padding:4px 0;margin-bottom:14px}
  .name:focus{outline:none;border-bottom-color:var(--ink)}
  .items{width:100%;border-collapse:collapse}
  .items td,.items th{padding:7px 8px 7px 0;border-bottom:1.5px solid var(--rail);vertical-align:baseline;text-align:left}
  .items th{color:var(--muted);font-size:13px;font-weight:500}
  .items .mvname{font-weight:600}
  .items .sub{color:var(--muted);font-size:13px}
  .num{width:56px;background:none;border:1.5px solid var(--rail);padding:3px 6px;text-align:center;
    font-variant-numeric:tabular-nums}
  .num:focus{outline:none;border-color:var(--ink)}
  .tin{width:88px;background:none;border:1.5px solid var(--rail);padding:3px 6px}
  .tin:focus{outline:none;border-color:var(--ink)}
  .block{border-left:3px solid var(--rail);padding-left:14px;margin:0 0 24px}
  .block.super{border-left-color:var(--ink)}
  .bhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;margin-bottom:4px}
  .bname{width:130px;background:none;border:0;border-bottom:1.5px solid var(--rail);
    font-size:16px;font-weight:700;padding:3px 0}
  .bname:focus{outline:none;border-bottom-color:var(--ink)}
  .x{background:none;border:0;color:var(--rail);font-size:18px;line-height:1;padding:2px 5px;cursor:pointer}
  .x:hover,.x:focus-visible{color:var(--ink)}
  .items td.rm{text-align:right;width:34px;padding-right:0}
  .items td.notecell{width:30%}
  .items td.notecell input{width:100%}
  .block.lifted{opacity:.4}
  .picker{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:10px}
  .picker select{max-width:none;flex:1 1 190px;min-width:0}
  .picker select:disabled{opacity:.45}
  .grip{cursor:grab;color:var(--rail);background:none;border:0;padding:2px 4px;line-height:1;
    font-size:16px;letter-spacing:-2px}
  .grip:hover,.grip:focus-visible{color:var(--ink)}
  .items tr.lifted{opacity:.4}
  .items td.gripcell{width:26px;padding-right:0}
  .block.over{background:var(--panel);box-shadow:-3px 0 0 var(--ink)}
  .block.target .bhead{cursor:copy}
  .carry{display:flex;flex-wrap:wrap;align-items:center;gap:12px;background:var(--ink);color:var(--paper);
    padding:9px 14px;margin-bottom:18px}
  .carry b{font-weight:600}
  .carry button{background:none;border:1.5px solid var(--paper);color:var(--paper);padding:3px 10px;cursor:pointer}
  .drophere{margin-left:auto}
  .bsets{display:inline-flex;align-items:baseline;gap:6px;color:var(--muted);font-size:13.5px;white-space:nowrap}
  .bhead .sub{color:var(--muted);font-size:13px;flex:1}
  .blockrow td{color:var(--muted);font-size:13px;font-weight:600;padding-top:16px;border-bottom:0}
  .adder{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:16px}
  select{background:var(--panel);border:1.5px solid var(--rail);padding:5px 8px;max-width:360px}
  select:focus{outline:none;border-color:var(--ink)}
  .sets{display:flex;gap:6px;flex-wrap:wrap}
  .session{background:var(--panel);padding:16px 18px;margin-top:20px}
  .session h2{margin-bottom:4px}
  .session .when{color:var(--muted);font-size:13px;margin:0 0 14px}
  .note{width:100%;background:none;border:1.5px solid var(--rail);padding:5px 7px;resize:vertical;min-height:44px}
  .note:focus{outline:none;border-color:var(--ink)}
  .acts{display:flex;gap:10px;margin-top:16px}
  .nudge{border-left:3px solid var(--ink);padding:10px 0 10px 12px;margin-top:18px}
  .nudge p{margin:0 0 8px}
  .hist{margin-top:10px}
  .entry{border-bottom:1.5px solid var(--rail);padding:12px 0;display:flex;gap:16px;align-items:baseline}
  .entry .d{width:110px;color:var(--muted);font-size:13.5px;flex:none}
  .entry .body{flex:1}
  .entry .wn{font-weight:600;margin:0 0 3px}
  .entry .ex{color:var(--muted);font-size:13.5px;margin:1px 0}
  .entry .ex b{color:var(--ink);font-weight:500}

  footer{margin-top:44px;padding-top:14px;border-top:1.5px solid var(--rail);
    display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;color:var(--muted);font-size:13.5px}
  footer button{background:none;border:1.5px solid var(--rail);padding:5px 11px;cursor:pointer;color:var(--muted)}
  footer button:hover{color:var(--ink);border-color:var(--ink)}
  .key{display:inline-flex;align-items:center;gap:7px}
  .key i{width:11px;height:11px;border:2px solid var(--ink);border-radius:50%;display:inline-block}
  .save{margin-left:auto;font-variant-numeric:tabular-nums}
  @media (max-width:640px){ .split{grid-template-columns:1fr} .entry{flex-wrap:wrap} }
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<noscript><p style="padding:20px">This tracker needs JavaScript to run.</p></noscript>
<div id="boot" style="padding:20px 18px;color:#7C8B8C">Loading…</div>
<div class="wrap" id="wrap" style="display:none">
  <header>
    <h1>Bodyweight ladders</h1>
    <p class="count" id="count"></p>
  </header>

  <section id="v-ladders">
    <div class="meter"><i id="meter"></i></div>
    <nav class="grp" id="tabs" role="tablist"></nav>
    <div class="bar">
      <p class="hint" id="hint"></p>
      <label class="only" id="onlyWrap"><input type="checkbox" id="only"> Milestones only</label>
    </div>
    <div id="view" role="tabpanel"></div>
  </section>

  <section id="v-build" hidden>
    <div class="split">
      <aside>
        <div class="rowhead"><h2>Workouts</h2><button class="btn mini" id="newW">New</button></div>
        <ul class="wlist" id="wlist"></ul>
      </aside>
      <div class="editor" id="weditor"></div>
    </div>
  </section>

  <section id="v-log" hidden>
    <div id="logtop"></div>
    <div id="nudge"></div>
    <div class="rowhead" style="margin-top:34px"><h2>History</h2></div>
    <div class="hist" id="hist"></div>
  </section>

  <footer>
    <button id="reset" type="button">Clear everything</button>
    <span class="key ladonly"><i></i> milestone</span>
    <span class="ladonly">Faded ladders are waiting on a prerequisite.</span>
    <span class="ladonly">Targets: 3&times;8 clean reps, or a 30&thinsp;s hold, then move up.</span>
    <span class="save" id="save"></span>
  </footer>
</div>

<nav class="tabbar" aria-label="Sections"><div class="inner" id="top" role="tablist"></div></nav>
<script>
const M = 1; // milestone flag
const DATA = [
  { g:"Priority", next:true },
  { g:"Horizontal pull", ladders:[
    { n:"Rows", m:["Vertical Row","Incline Row",["Row",M],"Wide Row","Archer Row","Archer-In Row","Straight One Arm Row",["One Arm Row",M]] },
    { n:"Front lever rows", from:[["Horizontal pull","Front lever","Tuck Front Lever"]], m:["Tuck Ice Cream Maker","Tuck FL Row","Adv Tuck FL Row","Straddle FL Row",["Front Lever Row",M]] },
    { n:"Back lever", m:["German Hang","Tuck Skin the Cat","Adv Tuck Skin the Cat","Pike Skin the Cat",["Tuck Back Lever",M],"Adv Tuck Back Lever","One Leg Back Lever","Straddle Back Lever",["Back Lever",M],"Back Lever Pullout","German Hang Pullout","Bent Arm Pull Up to BL","Handstand Lower to BL"] },
    { n:"Front lever", m:["L-Hang",["Tuck Front Lever",M],"Adv Tuck Front Lever","One Leg Front Lever","Straddle Front Lever",["Front Lever",M],"FL to Inverted","Hanging Pull FL to Inverted","360° Pull"] },
    { n:"Iron cross", from:[["Horizontal pull","Back lever","Back Lever"],["Horizontal pull","Front lever","One Leg Front Lever"],["Dips & L-sit","Ring dip","RTO 75° Dip"],["Dips & L-sit","L-sit to manna","45° V-Sit"],["Handstand","Rings","Ring Strap HS PU"],["Planche","Planche","Adv Tuck Planche"]], m:["Iron Cross Progression",["Iron Cross",M],"Iron Cross to Back Lever"] }
  ]},
  { g:"Vertical pull", ladders:[
    { n:"Pull up", m:["Scapular Pull","Arch Hang","Pull Up Negative",["Pull Up",M],"L-Sit Pull Up","Chest to Bar Pull Up","Ring L-Sit Pull Up"] },
    { n:"Muscle up", from:[["Vertical pull","Pull up","Pull Up"]], m:["Pullover","Muscle Up Negative","Kipping Muscle Up",["Muscle Up",M],"Wide Muscle Up","Strict Bar Muscle Up","L-Sit Muscle Up"] },
    { n:"One arm pull up", from:[["Vertical pull","Pull up","Pull Up"]], m:["Ring Wide Pull Up","Ring Wide L-Pull Up","Typewriter Pull Up","Archer Pull Up","OA Pull Up Negative",["One Arm Pull Up",M],"OA Straight Muscle Up","High One Arm Pull Up"] },
    { n:"Human flag", from:[["Vertical pull","Pull up","Pull Up"]], m:["Side Plank","Support Press","Tuck Flag","Vertical Flag","Adv Tuck Flag","Straddle Flag",["Human Flag",M]] }
  ]},
  { g:"Dips & L-sit", ladders:[
    { n:"Dip", m:["Support Hold","Dip Negative",["Dip",M],"Straight Bar Dip","Tuck L-Sit Dip","L-Sit Dip"] },
    { n:"Ring dip", from:[["Dips & L-sit","Dip","Dip"]], m:["Ring Support Hold","RTO Support Hold","Ring Dip Negative",["Ring Dip",M],"RTO Dip","Bulgarian Dip","Ring L-Sit Dip","Ring Wide Dip","RTO 45° Dip","RTO 75° Dip","RTO 90° Dip"] },
    { n:"L-sit to manna", from:[["Dips & L-sit","Dip","Support Hold"]], m:["Foot Supported L-Sit","One Leg L-Sit","Tuck L-Sit","One Leg Bent L-Sit",["L-Sit",M],"Straddle L-Sit","RTO L-Sit","45° V-Sit","90° V-Sit","120° V-Sit","140° V-Sit","155° V-Sit","170° V-Sit",["Manna",M]] },
    { n:"Bridge", m:["Reverse Plank","Shoulder Bridge","Table Bridge","Angled Bridge","Head Bridge",["Bridge / Wheel",M],"Decline Bridge","One Leg Bridge","Decline OL Bridge","OA Head Bridge","One Arm Bridge"] }
  ]},
  { g:"Handstand", ladders:[
    { n:"Handstand", m:["Wall Plank","Wall Headstand","Wall Handstand",["Handstand",M],"Tuck Handstand"] },
    { n:"Handstand push up", from:[["Handstand","Handstand","Wall Handstand"]], m:["Wall Headstand PU Negative","Wall Headstand PU","Wall HS PU","Headstand PU",["HS PU",M]] },
    { n:"Rings", from:[["Handstand","Handstand","Handstand"]], m:["Ring Shoulder Stand",["Ring Handstand",M],"Ring Wide HS PU","Ring Strap HS PU","Ring HS Push Up"] },
    { n:"One arm handstand", from:[["Handstand","Handstand","Handstand"]], m:["OA HS Progression","Straddle OA Handstand",["Straight OA Handstand",M],"OA Elbow Lever Press to OA HS"] }
  ]},
  { g:"Horizontal push", ladders:[
    { n:"Push up", m:["Incline Push Up",["Push Up",M],"Diamond Push Up","Pseudo Planche Push Up","Pike Push Up","Decline Pike Push Up"] },
    { n:"Ring push up", from:[["Horizontal push","Push up","Push Up"]], m:["Ring Wide Push Up","Ring Push Up","Archer Push Up","Ring Archer Push Up","RTO Push Up","RTO Archer Push Up","RTO PP Push Up"] },
    { n:"One arm push up", from:[["Horizontal push","Ring push up","RTO Push Up"]], m:["Incline OA Push Up","Straddle OA Push Up","Ring Straight OA Push Up",["One Arm Push Up",M],"Ring OA Push Up"] },
    { n:"Maltese", from:[["Horizontal push","Push up","Pseudo Planche Push Up"]], m:["Wall PP Push Up","Ring Wall PP Push Up","Wall Maltese Push Up","RTO Maltese Push Up","Ring Wall Maltese Push Up","Inverted Cross",["Maltese",M]] },
    { n:"Elbow lever", from:[["Core","Plank","Plank"]], m:["Straddle Elbow Lever","One Leg Elbow Lever",["Elbow Lever",M],"Ring Elbow Lever","OA Straddle Elbow Lever","One Arm Elbow Lever"] }
  ]},
  { g:"Planche", ladders:[
    { n:"Planche", from:[["Core","Plank","Plank"]], m:["Planche Lean","Frog Stand / Crow Pose","Straight Arm Frog Stand / Crane Pose",["Tuck Planche",M],"Adv Tuck Planche","Straddle Planche","One Leg Planche",["Planche",M]] },
    { n:"Planche push up", from:[["Planche","Planche","Tuck Planche"]], m:["Tuck Planche Push Up","Adv Tuck Planche Push Up","Straddle Planche Push Up","One Leg Planche Push Up",["Planche Push Up",M],"Straight Arm Planche to Handstand"] },
    { n:"Ring planche", from:[["Planche","Planche","Tuck Planche"]], m:["Ring Frog Stand","Ring SA Frog Stand","Ring Tuck Planche","Ring Adv Tuck Planche","Ring Straddle Planche","Ring One Leg Planche",["Ring Planche",M]] },
    { n:"Ring planche push up", from:[["Planche","Ring planche","Ring Tuck Planche"]], m:["Ring Tuck Planche PU","Ring Adv Tuck Planche PU","Ring Straddle Planche PU","Ring OL Planche PU","Ring Planche Push Up"] }
  ]},
  { g:"Core", ladders:[
    { n:"Plank", m:[["Plank",M],"Straddle One Arm Plank","One Arm Plank","OA One Leg Plank"] },
    { n:"Extension", m:["Reverse Hyperextension","Hyperextension","Arch Body Hold"] },
    { n:"Anti-rotation", m:["Banded Pallof Press","Ring Pallof Press"] },
    { n:"Compression", m:[["Hollow Hold",M],"Tuck Up Crunch","Seated Pike Leg Lift","Hanging Knees to Chest","Hanging Leg Raise to Bar","Ankle Weight HLR","One Arm HLR"] },
    { n:"Dragon flag", from:[["Core","Compression","Hanging Leg Raise to Bar"]], m:["Tuck Dragon Flag Negative","Adv Tuck Dragon Flag","Straddle / One Leg Dragon Flag",["Dragon Flag",M],"Ankle Weight Dragon Flag","One Arm Dragon Flag","One Leg Dragon Press","Dragon Press","One Arm Dragon Press"] },
    { n:"Ab wheel", from:[["Core","Plank","Plank"]], m:["Ring Ab Rollout","Knees Ab Wheel","Straight Leg Ab Wheel Ramp","Straight Leg Ab Wheel Negative",["Straight Leg Ab Wheel",M],"Weighted Ab Wheel","One Arm Ab Wheel"] }
  ]},
  { g:"Legs", ladders:[
    { n:"Squat", m:["Assisted Squat","Parallel Squat",["Full Squat",M],"Cossack Squat"] },
    { n:"Split squat & step up", from:[["Legs","Squat","Full Squat"]], m:["Split Squat","Bulgarian Split Squat","Step Up","Deep Step Up"] },
    { n:"Pistol squat", from:[["Legs","Squat","Full Squat"]], m:["Partial Pistol Squat","Assisted Pistol Squat",["Pistol Squat",M],"Weighted Pistol Squat","Natural One Leg Press","Elevated Friction Pistol Squat"] },
    { n:"Shrimp squat", from:[["Legs","Squat","Full Squat"]], m:["Beginner Shrimp Squat","Intermediate Shrimp Squat",["Shrimp Squat",M],"Two Hand Shrimp Squat","Elevated 2H Shrimp Squat"] },
    { n:"Nordic curl", m:["One Leg Deadlift","90° Hip Nordic Curl","45° Hip Nordic Curl","Nordic Curl Negative",["Nordic Curl",M],"Nordic Curl Arms Overhead","Tuck One Leg Nordic Curl","One Leg Nordic Curl"] }
  ]}
];

// normalise ["name", flag] and "name" into objects
DATA.forEach(g => (g.ladders||[]).forEach(l =>
  l.m = l.m.map(x => Array.isArray(x) ? {n:x[0], ms:true} : {n:x, ms:false})
));

const DYN = /push up|pull up|pullover|pullout|\brow\b|\bdip\b|dips|squat|raise|curl|ab wheel|rollout|press|muscle up|crunch|leg lift|step up|deadlift|knees to chest|360|scapular|ice cream|to inverted|to handstand|lower to|to bl|\bpu\b|hlr/i;
const STAT = /hold|hang|lever|planche|flag|l-sit|v-sit|manna|handstand|\bhs\b|plank|bridge|stand|lean|cross|maltese|skin the cat|frog|crane|crow|arch body/i;
function target(n){
  if (/negative|\bneg\b/i.test(n)) return "3×5 slow";
  if (DYN.test(n)) return "3×8";
  if (STAT.test(n)) return "30s";
  return "3×8";
}
function parseTarget(t){
  t = String(t || "").trim();
  let m = /(\d+)\s*[×x]\s*(\d+)/.exec(t);          // "3×8"
  if (m) return { sets:+m[1], val:+m[2], unit:"reps" };
  m = /^(\d+(?:\.\d+)?)\s*s\b/i.exec(t);           // "30s"
  if (m) return { sets:null, val:+m[1], unit:"s" };
  m = /^(\d+)/.exec(t);                             // "10", "5 slow"
  if (m) return { sets:null, val:+m[1], unit:"reps" };
  return { sets:null, val:0, unit:"reps" };
}
// a block carries the set count, so an item's target only needs the number
function itemTarget(n){ return target(n).replace(/^\d+\s*[×x]\s*/, ""); }

const id = (g,n) => g + "/" + n;
const groups = DATA.filter(d => d.ladders);
const total = groups.reduce((s,g)=> s + g.ladders.reduce((t,l)=> t + l.m.length, 0), 0);

const MOVES = [];
groups.forEach(g => g.ladders.forEach(l => l.m.forEach((mv,i) =>
  MOVES.push({ g:g.g, l:l.n, n:mv.n, i, ms:mv.ms, key:g.g+"|"+l.n+"|"+mv.n })
)));
const byKey = Object.fromEntries(MOVES.map(m => [m.key, m]));

function findLadder(gn, ln){
  const g = DATA.find(x => x.g === gn);
  return g && g.ladders && g.ladders.find(l => l.n === ln);
}
function met(p){
  const l = findLadder(p[0], p[1]);
  if (!l) return false;
  const i = l.m.findIndex(x => x.n === p[2]);
  return i >= 0 && (level[id(p[0], p[1])] || 0) > i;
}
function gate(l){
  if (!l.from) return { open:true, items:[] };
  const items = l.from.map(p => ({ name:p[2], ok:met(p) }));
  return { open: items.every(x => x.ok), items };
}

/* ---------- state ---------- */
const SEED = {"v":1,"saved":"2026-09-07","level":{"Vertical pull/Pull up":3,"Horizontal pull/Rows":4,"Dips & L-sit/Dip":3,"Horizontal push/Push up":3,"Legs/Squat":3,"Legs/Pistol squat":2},"workouts":[{"id":"rr7rtqy","name":"Tensile Strength - Bodyw","blocks":[{"id":"niux0j8","name":"Main 1","items":[{"key":"Vertical pull|Pull up|Pull Up","target":"10","note":"Chin Over Bar"},{"key":"Dips & L-sit|Dip|Straight Bar Dip","target":"10","note":"Chest To Bar"}],"sets":4},{"id":"zoqvsli","name":"Main 2","items":[{"key":"Dips & L-sit|Dip|Dip","target":"10"},{"key":"Legs|Pistol squat|Assisted Pistol Squat","target":"4"}],"sets":4},{"id":"x30dzm9","name":"C","sets":3,"items":[{"key":"Horizontal pull|Rows|Wide Row","target":"10"},{"key":"Horizontal push|Push up|Pike Push Up","target":"5"}]},{"id":"xwjbo3z","name":"Core","sets":3,"items":[{"key":"Core|Compression|Hanging Leg Raise to Bar","target":"10","note":"L position for now"},{"key":"Core|Dragon flag|Tuck Dragon Flag Negative","target":"3×5 slow","note":"[1151]"}]}]}],"logbook":[],"focus":["Vertical pull|Muscle up|Muscle Up","Horizontal pull|Rows|One Arm Row","Horizontal push|One arm push up|One Arm Push Up"]};
const K = { prog:"bwf-ladders-v3", seeded:"bwf-seeded-v1", work:"bwf-workouts-v1", log:"bwf-log-v1", focus:"bwf-focus-v1" };
let level = {}, workouts = [], logbook = [], focus = [];
let topTab = 0, active = 0, msOnly = false, editing = null, session = null, nudges = [];
let saveNote = "";
const done = () => Object.values(level).reduce((s,v)=> s + v, 0);
const $ = s => document.getElementById(s) || null;
const uid = () => Math.random().toString(36).slice(2,9);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

const store = (typeof window !== "undefined" && window.storage) ? window.storage : null;
if (!store) saveNote = "Storage unavailable — nothing will persist";
async function get(k){
  if (!store) return null;
  try{ const r = await store.get(k); return r && r.value ? JSON.parse(r.value) : null; }
  catch(e){ return null; }
}
async function put(k,v){
  if (!store){ saveNote = "Not saved — storage unavailable here"; }
  else {
    try{ await store.set(k, JSON.stringify(v)); saveNote = "Saved"; }
    catch(e){ saveNote = "Couldn't save — this session only"; }
  }
  const el = $("save"); if (el) el.textContent = saveNote;
}
const saveProg = () => put(K.prog, level);
const saveWork = () => put(K.work, workouts);
const saveLog  = () => put(K.log, logbook);
const saveFocus = () => put(K.focus, focus);

async function loadAll(){
  const [a,b,c,d,seeded] = await Promise.all([get(K.prog), get(K.work), get(K.log), get(K.focus), get(K.seeded)]);
  const nothingHere = !seeded && !(a && Object.keys(a).length) && !(b && b.length) && !(c && c.length);
  if (nothingHere){
    try{ restore(JSON.stringify(SEED)); put(K.seeded, true); }
    catch(e){ /* fall through to a blank start */ }
    renderAll();
    return;
  }
  if (a) level = a;
  if (b) workouts = b;
  if (c) logbook = c;
  if (Array.isArray(d)) focus = d.filter(k => byKey[k]);
  if (!focus.length && !Object.keys(level).length) active = 1;
  workouts.forEach(migrate);
  if (workouts.length && !editing) editing = workouts[0].id;
  renderAll();
}

/* ---------- ladders ---------- */
function tap(key, i){
  const cur = level[key] || 0;
  level[key] = (i < cur) ? i : i + 1;
  if (!level[key]) delete level[key];
  renderAll(); saveProg();
}
function advance(g, l, i){
  const key = id(g,l);
  if ((level[key] || 0) <= i) level[key] = i + 1;
  saveProg();
}
function nextRung(g, l){
  const lv = level[id(g.g, l.n)] || 0;
  return lv < l.m.length ? { g:g.g, l:l.n, n:l.m[lv].n, i:lv } : null;
}

function ladderEl(g, l){
  const key = id(g.g, l.n);
  const lv = level[key] || 0;
  const shown = l.m.map((mv,i)=>({mv,i})).filter(o => !msOnly || o.mv.ms);
  if (!shown.length) return null;
  const gt = gate(l);
  const col = document.createElement("div");
  col.className = "col" + (gt.open ? "" : " locked");
  const pre = gt.items.length
    ? `<p class="pre">${gt.items.map(x => `<span class="${x.ok?'ok':''}">${x.ok?'✓':'·'} ${esc(x.name)}</span>`).join("")}</p>` : "";
  col.innerHTML = `<h2>${esc(l.n)}</h2>${pre}<p class="frac">${lv} of ${l.m.length}</p>`;
  const lad = document.createElement("div");
  lad.className = "ladder";
  shown.forEach(({mv,i}) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rung" + (mv.ms?" ms":"") + (i < lv ? " done" : i === lv ? " next" : "");
    b.setAttribute("aria-pressed", i < lv);
    b.innerHTML = `<span class="t">${esc(mv.n)}</span><span class="rx">${target(mv.n)}</span>`;
    b.onclick = () => tap(key, i);
    lad.appendChild(b);
  });
  col.appendChild(lad);
  return col;
}

const MAX_FOCUS = 4;

// every ladder needed to reach a move, prereqs first, with how deep each must go
function requirements(gn, ln, upto, need){
  const k = gn + "|" + ln;
  if (need.has(k) && need.get(k) >= upto) return need;
  need.set(k, Math.max(need.has(k) ? need.get(k) : -1, upto));
  const l = findLadder(gn, ln);
  (l && l.from || []).forEach(p => {
    const pl = findLadder(p[0], p[1]);
    if (!pl) return;
    requirements(p[0], p[1], pl.m.findIndex(x => x.n === p[2]), need);
  });
  return need;
}
function orderLegs(gn, ln, need, seen, out){
  const k = gn + "|" + ln;
  if (seen.has(k)) return;
  seen.add(k);
  const l = findLadder(gn, ln);
  (l && l.from || []).forEach(p => orderLegs(p[0], p[1], need, seen, out));
  out.push({ g:gn, l:ln, upto: need.get(k) });
}
function routeTo(m){
  const need = requirements(m.g, m.l, m.i, new Map());
  const legs = [];
  orderLegs(m.g, m.l, need, new Set(), legs);
  let total = 0, cleared = 0;
  legs.forEach(leg => {
    const lv = level[id(leg.g, leg.l)] || 0;
    leg.rungs = findLadder(leg.g, leg.l).m.slice(0, leg.upto + 1)
      .map((mv,i) => ({ ...mv, i, done: i < lv }));
    total += leg.rungs.length;
    cleared += leg.rungs.filter(r => r.done).length;
  });
  return { legs, total, cleared };
}

function goalPicker(){
  const wrap = document.createElement("div");
  wrap.className = "chips";
  focus.forEach(k => {
    const m = byKey[k];
    const c = document.createElement("span");
    c.className = "chip";
    c.textContent = m.n;
    const x = document.createElement("button");
    x.type = "button"; x.innerHTML = "&times;";
    x.setAttribute("aria-label", "Stop focusing on " + m.n);
    x.onclick = () => { focus = focus.filter(f => f !== k); renderLadders(); saveFocus(); };
    c.appendChild(x);
    wrap.appendChild(c);
  });
  if (focus.length < MAX_FOCUS){
    const sel = document.createElement("select");
    sel.setAttribute("aria-label","Add a focus");
    sel.innerHTML = '<option value="">' + (focus.length ? "Add another…" : "Choose what you're working toward…") + "</option>"
      + groups.map(g => {
        const opts = g.ladders.map(l => l.m.map((mv,i) => {
          const key = g.g+"|"+l.n+"|"+mv.n;
          if (!mv.ms || focus.includes(key)) return "";
          return `<option value="${esc(key)}">${esc(mv.n)}</option>`;
        }).join("")).join("");
        return opts ? `<optgroup label="${esc(g.g)}">${opts}</optgroup>` : "";
      }).join("");
    sel.onchange = () => {
      if (!sel.value) return;
      focus.push(sel.value); renderLadders(); saveFocus();
    };
    wrap.appendChild(sel);
  }
  return wrap;
}

function goalEl(k, markedNext){
  const m = byKey[k];
  const r = routeTo(m);
  const col = document.createElement("div");
  col.className = "goal";
  col.innerHTML = `<h2>${esc(m.n)}</h2><p class="gsub">${esc(m.g)} &middot; ${esc(m.l)}</p>
    <p class="gcount">${r.cleared} of ${r.total} checkpoints cleared</p>
    <div class="gmeter"><i style="width:${r.total ? (r.cleared/r.total*100) : 0}%"></i></div>`;
  let first = true;
  r.legs.forEach(leg => {
    const left = leg.rungs.filter(x => !x.done);
    const h = document.createElement("p");
    h.className = "leg";
    h.textContent = leg.l + (left.length ? "" : " — cleared");
    col.appendChild(h);
    if (!left.length) return;
    const doneCount = leg.rungs.length - left.length;
    if (doneCount){
      const c = document.createElement("p");
      c.className = "cleared";
      c.textContent = doneCount + " already cleared";
      col.appendChild(c);
    }
    left.forEach(rg => {
      const b = document.createElement("button");
      b.type = "button";
      const isNow = first;
      first = false;
      b.className = "step" + (rg.ms ? " ms" : "") + (isNow ? " now" : "");
      b.innerHTML = `<span class="t">${esc(rg.n)}</span><span class="rx">${target(rg.n)}</span>`;
      b.onclick = () => tap(id(leg.g, leg.l), rg.i);
      col.appendChild(b);
    });
  });
  if (r.cleared === r.total){
    const p = document.createElement("p");
    p.className = "cleared";
    p.textContent = "Everything on the way here is cleared.";
    col.appendChild(p);
  }
  return col;
}

function priorityView(){
  const box = document.createElement("div");
  box.appendChild(goalPicker());
  if (!focus.length){
    const st = document.createElement("div");
    st.className = "start";
    st.innerHTML = `<h3>Pick something to work toward</h3>
      <p>Everything standing between you and it gets laid out in order — including prerequisites
         from other categories — with your next checkpoint marked. Start with one of these, or use
         the menu above for any of the ${MOVES.filter(m=>m.ms).length} milestones.</p>`;
    const row = document.createElement("div");
    row.className = "sugg";
    ["Vertical pull|Pull up|Pull Up","Dips & L-sit|Dip|Dip","Handstand|Handstand|Handstand",
     "Legs|Pistol squat|Pistol Squat","Vertical pull|Muscle up|Muscle Up",
     "Horizontal pull|Front lever|Front Lever"].forEach(k => {
      if (!byKey[k]) return;
      const b = document.createElement("button");
      b.type = "button"; b.textContent = byKey[k].n;
      b.onclick = () => { focus.push(k); renderLadders(); saveFocus(); };
      row.appendChild(b);
    });
    st.appendChild(row);
    box.appendChild(st);
    return box;
  }
  const grid = document.createElement("div");
  grid.className = "goals";
  focus.forEach(k => grid.appendChild(goalEl(k)));
  box.appendChild(grid);
  return box;
}

function renderLadders(){
  const d = done();
  if ($("count")) $("count").innerHTML = `${d} <span>of ${total} rungs</span>`;
  if ($("meter")) $("meter").style.width = (d/total*100) + "%";
  const tabs = $("tabs");
  if (!tabs) return;
  tabs.innerHTML = "";
  DATA.forEach((g,i) => {
    const b = document.createElement("button");
    b.type = "button"; b.setAttribute("role","tab");
    b.setAttribute("aria-selected", i === active);
    if (g.next) b.textContent = g.g;
    else {
      const t = g.ladders.reduce((s,l)=> s + l.m.length, 0);
      const c = g.ladders.reduce((s,l)=> s + (level[id(g.g,l.n)]||0), 0);
      b.innerHTML = `${esc(g.g)}<span class="n">${c}/${t}</span>`;
    }
    b.onclick = () => { active = i; renderLadders(); };
    tabs.appendChild(b);
  });
  const g = DATA[active], view = $("view");
  view.innerHTML = "";
  $("onlyWrap").style.display = g.next ? "none" : "inline-flex";
  $("only").checked = msOnly;
  if (g.next){
    $("hint").textContent = "What stands between you and the things you're chasing.";
    view.appendChild(priorityView());
  } else {
    $("hint").textContent = "Tap the highest rung you can hold — everything below fills in. Tap a filled rung to drop back to it.";
    const grid = document.createElement("div");
    grid.className = "grid";
    g.ladders.forEach(l => { const el = ladderEl(g,l); if (el) grid.appendChild(el); });
    view.appendChild(grid);
  }
}

/* ---------- build ---------- */
function migrate(w){
  if (!w.blocks) w.blocks = [{ id: uid(), name: "A", items: w.items || [] }];
  delete w.items;
  w.blocks.forEach(b => {
    if (b.sets == null)
      b.sets = b.items.length ? Math.max(...b.items.map(i => i.sets || 3)) : 3;
    b.items.forEach(i => { delete i.sets; });
  });
  return w;
}
const allItems = w => w.blocks.reduce((s,b) => s.concat(b.items), []);
const hasItem = (w,key) => allItems(w).some(i => i.key === key);
const letter = i => String.fromCharCode(65 + (i % 26));

function moveSelect(){
  const s = document.createElement("select");
  s.innerHTML = '<option value="">Add an exercise…</option>' + groups.map(g =>
    `<optgroup label="${esc(g.g)}">` + g.ladders.map(l => l.m.map(mv =>
      `<option value="${esc(g.g+"|"+l.n+"|"+mv.n)}">${esc(l.n)} — ${esc(mv.n)}</option>`).join("")).join("") + "</optgroup>"
  ).join("");
  return s;
}
const pickTree = {};   // block id -> "Group|Ladder"
let carrying = null;   // { bi, ii }
let carryBlock = null; // block index being moved

function moveBlock(from, to){
  const w = workouts.find(x => x.id === editing);
  if (!w || from === to || to == null) return;
  const [b] = w.blocks.splice(from, 1);
  w.blocks.splice(to > from ? to - 1 : to, 0, b);
  carryBlock = null;
  renderBuild(); saveWork();
}

function pickerEl(w, block){
  const wrap = document.createElement("div");
  wrap.className = "picker";
  const tSel = document.createElement("select");
  tSel.setAttribute("aria-label","Tree");
  tSel.innerHTML = '<option value="">Choose a tree…</option>' + groups.map(g =>
    `<optgroup label="${esc(g.g)}">` + g.ladders.map(l =>
      `<option value="${esc(g.g+"|"+l.n)}">${esc(l.n)}</option>`).join("") + "</optgroup>").join("");
  tSel.value = pickTree[block.id] || "";

  const xSel = document.createElement("select");
  xSel.setAttribute("aria-label","Exercise");
  function fillX(){
    const v = tSel.value;
    if (!v){ xSel.innerHTML = '<option value="">Then an exercise…</option>'; xSel.disabled = true; return; }
    const [gn, ln] = v.split("|");
    const l = findLadder(gn, ln);
    const lv = level[id(gn,ln)] || 0;
    xSel.disabled = false;
    xSel.innerHTML = '<option value="">Then an exercise…</option>' + l.m.map((mv,i) => {
      const key = gn+"|"+ln+"|"+mv.n;
      const taken = hasItem(w, key);
      const tag = taken ? " ✓" : (i === lv ? " ← you're here" : "");
      return `<option value="${esc(key)}"${taken?" disabled":""}>${esc(mv.n)} · ${target(mv.n)}${tag}</option>`;
    }).join("");
  }
  fillX();
  tSel.onchange = () => { pickTree[block.id] = tSel.value; fillX(); };
  xSel.onchange = () => { if (xSel.value && addItem(block, xSel.value, w)){ renderBuild(); saveWork(); } };
  wrap.append(tSel, xSel);
  return wrap;
}

function moveItem(fromB, fromI, toB, toI){
  const w = workouts.find(x => x.id === editing);
  if (!w) return;
  const it = w.blocks[fromB].items[fromI];
  if (!it) return;
  w.blocks[fromB].items.splice(fromI, 1);
  const dest = w.blocks[toB].items;
  if (toI == null || toI > dest.length) toI = dest.length;
  if (fromB === toB && fromI < toI) toI--;
  dest.splice(toI, 0, it);
  carrying = null;
  renderBuild(); saveWork();
}

function addItem(block, key, w){
  const m = byKey[key];
  if (!m || (w && hasItem(w, key))) return false;
  const t = itemTarget(m.n);
  if (block.sets == null) block.sets = parseTarget(target(m.n)).sets || 3;
  block.items.push({ key, target: t });
  return true;
}

function itemsTable(w, block, bi){
  const tb = document.createElement("table");
  tb.className = "items";
  tb.innerHTML = "<thead><tr><th></th><th>Exercise</th><th>Target</th><th>Notes</th><th></th></tr></thead>";
  const body = document.createElement("tbody");
  block.items.forEach((it, idx) => {
    const m = byKey[it.key] || { n: it.key, l:"", g:"" };
    const tr = document.createElement("tr");
    tr.draggable = true;
    if (carrying && carrying.bi === bi && carrying.ii === idx) tr.className = "lifted";
    tr.ondragstart = ev => {
      carrying = { bi, ii: idx };
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", m.n);
      tr.classList.add("lifted");
    };
    tr.ondragend = () => { carrying = null; renderBuild(); };
    tr.ondragover = ev => { ev.preventDefault(); ev.stopPropagation(); };
    tr.ondrop = ev => {
      ev.preventDefault(); ev.stopPropagation();
      if (carryBlock !== null) moveBlock(carryBlock, bi);
      else if (carrying) moveItem(carrying.bi, carrying.ii, bi, idx);
    };
    const tdG = document.createElement("td");
    tdG.className = "gripcell";
    const grip = document.createElement("button");
    grip.className = "grip"; grip.type = "button"; grip.textContent = "⠿";
    grip.setAttribute("aria-label", "Move " + m.n + " to another block");
    grip.onclick = () => {
      carrying = (carrying && carrying.bi === bi && carrying.ii === idx) ? null : { bi, ii: idx };
      renderBuild();
    };
    tdG.appendChild(grip);
    tr.appendChild(tdG);
    const tdN = document.createElement("td");
    tdN.innerHTML = `<span class="mvname">${esc(m.n)}</span><br><span class="sub">${esc(m.g)} &middot; ${esc(m.l)}</span>`;
    tr.appendChild(tdN);
    const tdT = document.createElement("td");
    const inT = document.createElement("input");
    inT.className = "tin"; inT.value = it.target; inT.setAttribute("aria-label","Target");
    inT.onchange = () => { it.target = inT.value; saveWork(); };
    tdT.appendChild(inT);
    const tdNote = document.createElement("td");
    tdNote.className = "notecell";
    const inN = document.createElement("input");
    inN.className = "tin"; inN.value = it.note || "";
    inN.placeholder = "tempo, grip, cue…";
    inN.setAttribute("aria-label", "Notes for " + m.n);
    inN.onchange = () => { it.note = inN.value; saveWork(); };
    tdNote.appendChild(inN);
    const tdX = document.createElement("td");
    tdX.className = "rm";
    const bx = document.createElement("button");
    bx.className = "x"; bx.type = "button"; bx.innerHTML = "&times;";
    bx.setAttribute("aria-label", "Remove " + m.n);
    bx.onclick = () => { block.items.splice(idx,1); renderBuild(); saveWork(); };
    tdX.appendChild(bx);
    tr.append(tdT, tdNote, tdX);
    body.appendChild(tr);
  });
  tb.appendChild(body);
  return tb;
}

function blockEl(w, block, bi){
  const sec = document.createElement("div");
  const isSrc = (carrying && carrying.bi === bi) || carryBlock === bi;
  const held = carrying || carryBlock !== null;
  sec.className = "block" + (block.items.length > 1 ? " super" : "")
    + (held && !isSrc ? " target" : "") + (carryBlock === bi ? " lifted" : "");
  sec.ondragover = ev => { ev.preventDefault(); sec.classList.add("over"); };
  sec.ondragleave = () => sec.classList.remove("over");
  sec.ondrop = ev => {
    ev.preventDefault(); sec.classList.remove("over");
    if (carryBlock !== null) moveBlock(carryBlock, bi);
    else if (carrying) moveItem(carrying.bi, carrying.ii, bi, null);
  };
  const head = document.createElement("div");
  head.className = "bhead";
  const bg = document.createElement("button");
  bg.className = "grip"; bg.type = "button"; bg.textContent = "⠿";
  bg.draggable = true;
  bg.setAttribute("aria-label", "Reorder block " + block.name);
  bg.ondragstart = ev => { carryBlock = bi; ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", block.name); };
  bg.ondragend = () => { carryBlock = null; renderBuild(); };
  bg.onclick = () => { carryBlock = carryBlock === bi ? null : bi; carrying = null; renderBuild(); };
  const nm = document.createElement("input");
  nm.className = "bname"; nm.value = block.name; nm.setAttribute("aria-label","Block name");
  nm.oninput = () => { block.name = nm.value; saveWork(); };
  const setWrap = document.createElement("label");
  setWrap.className = "bsets";
  const inB = document.createElement("input");
  inB.type = "number"; inB.min = 1; inB.max = 12; inB.className = "num";
  inB.value = block.sets == null ? 3 : block.sets;
  inB.setAttribute("aria-label", "Sets for block " + block.name);
  inB.onchange = () => { block.sets = Math.max(1, +inB.value || 1); saveWork(); };
  setWrap.append(inB, document.createTextNode(block.items.length > 1 ? " rounds" : " sets"));
  const sub = document.createElement("span");
  sub.className = "sub";
  sub.textContent = block.items.length > 1
    ? "Superset — alternate through, rest after each round"
    : block.items.length ? "One exercise" : "Empty";
  head.append(bg, nm, setWrap, sub);
  if (w.blocks.length > 1){
    const rm = document.createElement("button");
    rm.className = "x"; rm.type = "button"; rm.innerHTML = "&times;";
    rm.setAttribute("aria-label", "Remove block " + block.name);
    rm.onclick = () => {
      if (block.items.length && !confirm("Remove block " + block.name + " and its exercises?")) return;
      w.blocks.splice(bi,1); renderBuild(); saveWork();
    };
    head.appendChild(rm);
  }
  if (held && !isSrc){
    const drop = document.createElement("button");
    drop.className = "btn mini drophere";
    drop.textContent = carryBlock !== null ? "Move above" : "Drop here";
    drop.onclick = () => carryBlock !== null
      ? moveBlock(carryBlock, bi)
      : moveItem(carrying.bi, carrying.ii, bi, null);
    head.appendChild(drop);
  }
  sec.appendChild(head);
  if (block.items.length) sec.appendChild(itemsTable(w, block, bi));
  sec.appendChild(pickerEl(w, block));
  return sec;
}

function renderBuild(){
  workouts.forEach(migrate);
  const list = $("wlist");
  list.innerHTML = "";
  if (!workouts.length) list.innerHTML = '<li style="cursor:default;color:var(--muted);border:0">No workouts yet.</li>';
  workouts.forEach(w => {
    const li = document.createElement("li");
    li.setAttribute("aria-current", w.id === editing);
    li.innerHTML = `<span class="wn">${esc(w.name)}</span><span class="wc">${allItems(w).length}</span>`;
    li.onclick = () => { editing = w.id; renderBuild(); };
    list.appendChild(li);
  });

  const ed = $("weditor");
  ed.innerHTML = "";
  const w = workouts.find(x => x.id === editing);
  if (!w){
    ed.innerHTML = '<p class="empty">Make a workout and it becomes something you can log against. Exercises are picked from the ladders, so each one arrives with its target already set. Group them into blocks to run a pair as a superset.</p>';
    ed.appendChild(transferEl());
    return;
  }

  const name = document.createElement("input");
  name.className = "name"; name.value = w.name; name.setAttribute("aria-label","Workout name");
  name.oninput = () => { w.name = name.value; saveWork();
    const li = [...list.children][workouts.indexOf(w)];
    if (li && li.querySelector) li.querySelector(".wn").textContent = w.name; };
  ed.appendChild(name);

  if (carryBlock !== null && w.blocks[carryBlock]){
    const bar = document.createElement("div");
    bar.className = "carry";
    bar.innerHTML = `<span>Moving block <b>${esc(w.blocks[carryBlock].name)}</b> — drag it, or pick where it goes.</span>`;
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.onclick = () => { carryBlock = null; renderBuild(); };
    bar.appendChild(cancel);
    ed.appendChild(bar);
  }
  if (carrying){
    const c = w.blocks[carrying.bi] && w.blocks[carrying.bi].items[carrying.ii];
    if (c){
      const m = byKey[c.key] || { n:c.key };
      const bar = document.createElement("div");
      bar.className = "carry";
      bar.innerHTML = `<span>Moving <b>${esc(m.n)}</b> — drag it, or pick a block below.</span>`;
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.onclick = () => { carrying = null; renderBuild(); };
      bar.appendChild(cancel);
      ed.appendChild(bar);
    } else carrying = null;
  }
  w.blocks.forEach((b,bi) => ed.appendChild(blockEl(w, b, bi)));

  const add = document.createElement("div");
  add.className = "adder";
  const nb = document.createElement("button");
  nb.className = "btn"; nb.textContent = "Add block";
  nb.onclick = () => {
    w.blocks.push({ id: uid(), name: letter(w.blocks.length), sets: 3, items: [] });
    renderBuild(); saveWork();
  };
  const fill = document.createElement("button");
  fill.className = "btn"; fill.textContent = "Add my next rungs";
  fill.onclick = () => {
    const block = { id: uid(), name: letter(w.blocks.length), sets: 3, items: [] };
    groups.forEach(g => g.ladders.forEach(l => {
      if (!(level[id(g.g,l.n)] || 0)) return;
      const r = nextRung(g, l);
      if (r) addItem(block, g.g+"|"+l.n+"|"+r.n, w);
    }));
    if (!block.items.length) ["Horizontal pull|Rows","Vertical pull|Pull up","Dips & L-sit|Dip","Horizontal push|Push up","Legs|Squat","Core|Plank"]
      .forEach(k => { const [gn,ln] = k.split("|"); const l = findLadder(gn,ln); if (l) addItem(block, gn+"|"+ln+"|"+l.m[0].n, w); });
    if (block.items.length) w.blocks.push(block);
    renderBuild(); saveWork();
  };
  const del = document.createElement("button");
  del.className = "btn"; del.textContent = "Delete workout";
  del.onclick = () => {
    if (!confirm("Delete " + w.name + "?")) return;
    workouts = workouts.filter(x => x.id !== w.id);
    editing = workouts.length ? workouts[0].id : null;
    renderBuild(); saveWork();
  };
  add.append(nb, fill, del);
  ed.appendChild(add);
  ed.appendChild(transferEl());
}

/* ---------- log ---------- */
function startSession(wid){
  const w = workouts.find(x => x.id === wid);
  session = {
    id: uid(),
    date: new Date().toISOString().slice(0,10),
    wid: w ? w.id : null,
    name: w ? w.name : "Free session",
    entries: (w ? w.blocks.reduce((acc,b) => acc.concat(b.items.map(it => {
      const m = byKey[it.key] || { n:it.key };
      return { key:it.key, name:m.n, block:b.name, target:it.target, note:it.note || "", sets:Array(b.sets || 3).fill(""), rpe:"" };
    })), []) : [])
  };
  nudges = [];
  renderLog();
}
function finishSession(){
  session.entries = session.entries.filter(e => e.sets.some(v => v !== "" && v !== null));
  if (!session.entries.length){ session = null; renderLog(); return; }
  nudges = [];
  session.entries.forEach(e => {
    const t = parseTarget(e.target);
    const vals = e.sets.filter(v => v !== "").map(Number);
    const needSets = t.sets || e.sets.length || 1;
    if (vals.length >= needSets && t.val && vals.every(v => v >= t.val)){
      const m = byKey[e.key];
      if (m && (level[id(m.g,m.l)] || 0) <= m.i) nudges.push({ ...m, hard: +e.rpe >= 9 });
    }
  });
  logbook.unshift(session);
  session = null;
  renderAll(); saveLog();
}

function renderLog(){
  const top = $("logtop");
  top.innerHTML = "";
  if (!session){
    const box = document.createElement("div");
    box.className = "adder";
    box.style.marginTop = "20px";
    const sel = document.createElement("select");
    sel.innerHTML = workouts.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join("")
      + '<option value="">Free session</option>';
    const go = document.createElement("button");
    go.className = "btn solid"; go.textContent = "Start session";
    go.onclick = () => startSession(sel.value);
    box.append(sel, go);
    top.appendChild(box);
    if (!workouts.length){
      const p = document.createElement("p");
      p.className = "empty"; p.style.marginTop = "14px";
      p.textContent = "Build a workout first and it'll show up here, with every set already laid out and its target attached.";
      top.appendChild(p);
    }
  } else {
    const s = document.createElement("div");
    s.className = "session";
    s.innerHTML = `<h2>${esc(session.name)}</h2>`;
    const when = document.createElement("p");
    when.className = "when";
    const dt = document.createElement("input");
    dt.type = "date"; dt.value = session.date; dt.className = "tin"; dt.style.width = "150px";
    dt.onchange = () => session.date = dt.value;
    when.appendChild(dt);
    s.appendChild(when);

    const tb = document.createElement("table");
    tb.className = "items";
    tb.innerHTML = "<thead><tr><th>Exercise</th><th>Target</th><th>Sets</th><th>RPE</th></tr></thead>";
    const body = document.createElement("tbody");
    const multi = new Set(session.entries.map(e => e.block || "")).size > 1;
    let lastBlock = null;
    session.entries.forEach(e => {
      const t = parseTarget(e.target);
      if (multi && e.block !== lastBlock){
        lastBlock = e.block;
        const br = document.createElement("tr");
        br.className = "blockrow";
        br.innerHTML = `<td colspan="4">${esc(e.block || "")}</td>`;
        body.appendChild(br);
      }
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><span class="mvname">${esc(e.name)}</span>${e.note ? `<br><span class="sub">${esc(e.note)}</span>` : ""}</td><td class="sub">${esc(e.target)}</td>`;
      const td = document.createElement("td");
      const wrap = document.createElement("div");
      wrap.className = "sets";
      e.sets.forEach((v,i) => {
        const inp = document.createElement("input");
        inp.type = "number"; inp.min = 0; inp.className = "num"; inp.value = v;
        inp.placeholder = t.unit === "s" ? "s" : "r";
        inp.setAttribute("aria-label", e.name + " set " + (i+1));
        inp.oninput = () => e.sets[i] = inp.value;
        wrap.appendChild(inp);
      });
      const more = document.createElement("button");
      more.className = "btn mini"; more.textContent = "+";
      more.setAttribute("aria-label","Add a set");
      more.onclick = () => { e.sets.push(""); renderLog(); };
      wrap.appendChild(more);
      td.appendChild(wrap);
      const tdR = document.createElement("td");
      const rp = document.createElement("input");
      rp.type = "number"; rp.min = 1; rp.max = 10; rp.step = 0.5; rp.className = "num";
      rp.value = e.rpe || ""; rp.placeholder = "–";
      rp.title = "Rate of perceived exertion: 10 is nothing left, 8 is about two reps in reserve";
      rp.setAttribute("aria-label", e.name + " rate of perceived exertion");
      rp.oninput = () => e.rpe = rp.value;
      tdR.appendChild(rp);
      tr.append(td, tdR);
      body.appendChild(tr);
    });
    tb.appendChild(body);
    s.appendChild(tb);
    const scale = document.createElement("p");
    scale.className = "sub";
    scale.style.margin = "8px 0 0";
    scale.textContent = "RPE 10 leaves nothing in the tank, 8 leaves about two reps, 6 feels easy.";
    s.appendChild(scale);

    if (!session.entries.length){
      const sel = moveSelect();
      sel.style.marginTop = "14px";
      sel.onchange = () => {
        const m = byKey[sel.value];
        if (!m) return;
        const t = target(m.n);
        session.entries.push({ key:m.key, name:m.n, block:"", target:t, sets:Array(parseTarget(t).sets).fill(""), rpe:"" });
        renderLog();
      };
      s.appendChild(sel);
    }

    const nt = document.createElement("textarea");
    nt.className = "note"; nt.placeholder = "How did it feel?"; nt.style.marginTop = "14px";
    nt.value = session.note || "";
    nt.oninput = () => session.note = nt.value;
    s.appendChild(nt);

    const acts = document.createElement("div");
    acts.className = "acts";
    const done_ = document.createElement("button");
    done_.className = "btn solid"; done_.textContent = "Save session";
    done_.onclick = finishSession;
    const drop = document.createElement("button");
    drop.className = "btn"; drop.textContent = "Discard";
    drop.onclick = () => { session = null; renderLog(); };
    acts.append(done_, drop);
    s.appendChild(acts);
    top.appendChild(s);
  }

  const nb = $("nudge");
  nb.innerHTML = "";
  if (nudges.length){
    const d = document.createElement("div");
    d.className = "nudge";
    const hard = nudges.filter(m => m.hard).length;
    d.innerHTML = `<p>You hit the target on ${nudges.length === 1 ? "one exercise" : nudges.length + " exercises"}. Move up?` +
      (hard ? ` ${hard === 1 ? "One was" : hard + " were"} logged at RPE 9 or above — worth another session at this rung first.` : "") + `</p>`;
    nudges.forEach(m => {
      const b = document.createElement("button");
      b.className = "btn mini"; b.style.marginRight = "8px";
      b.textContent = "Clear " + m.n;
      b.onclick = () => { advance(m.g, m.l, m.i); nudges = nudges.filter(x => x !== m); renderAll(); };
      d.appendChild(b);
    });
    nb.appendChild(d);
  }

  const h = $("hist");
  h.innerHTML = "";
  if (!logbook.length){
    h.innerHTML = '<p class="empty">No sessions logged yet.</p>';
    return;
  }
  logbook.forEach(sn => {
    const row = document.createElement("div");
    row.className = "entry";
    const lines = sn.entries.map(e =>
      `<p class="ex"><b>${esc(e.name)}</b> ${e.sets.filter(v=>v!=="").join(" · ")}${e.rpe ? ` &nbsp;RPE ${esc(e.rpe)}` : ""}</p>`).join("");
    row.innerHTML = `<div class="d">${esc(sn.date)}</div>
      <div class="body"><p class="wn">${esc(sn.name)}</p>${lines}
      ${sn.note ? `<p class="ex">${esc(sn.note)}</p>` : ""}</div>`;
    const x = document.createElement("button");
    x.className = "btn mini"; x.textContent = "Delete";
    x.onclick = () => { logbook = logbook.filter(z => z.id !== sn.id); renderLog(); saveLog(); };
    row.appendChild(x);
    h.appendChild(row);
  });
}

/* ---------- moving data between devices ---------- */
function snapshot(){
  return JSON.stringify({ v:1, saved:new Date().toISOString().slice(0,10),
    level, workouts, logbook, focus }, null, 0);
}
function restore(text){
  const d = JSON.parse(text);
  if (!d || typeof d !== "object") throw new Error("not a backup");
  if (d.level && typeof d.level === "object") level = d.level;
  if (Array.isArray(d.workouts)) workouts = d.workouts.map(migrate);
  if (Array.isArray(d.logbook)) logbook = d.logbook;
  if (Array.isArray(d.focus)) focus = d.focus.filter(k => byKey[k]);
  editing = workouts.length ? workouts[0].id : null;
  saveProg(); saveWork(); saveLog(); saveFocus();
}

function transferEl(){
  const box = document.createElement("div");
  box.className = "xfer";
  box.innerHTML = `<h2>Move this to another device</h2>
    <p>Your progress and workouts are stored against your Claude account, so opening this artifact
       in the Claude app, on the web or on desktop shows the same data. Outside Claude — a downloaded
       copy opened in a plain browser — there's nowhere to save, so use the text below to carry
       everything across by hand.</p>`;
  const ta = document.createElement("textarea");
  ta.value = snapshot();
  ta.setAttribute("aria-label","Backup text");
  ta.spellcheck = false;
  box.appendChild(ta);

  const acts = document.createElement("div");
  acts.className = "acts";
  const stat = document.createElement("span");
  stat.className = "xstat";

  const copy = document.createElement("button");
  copy.className = "btn"; copy.textContent = "Copy backup";
  copy.onclick = async () => {
    ta.value = snapshot();
    try{ await navigator.clipboard.writeText(ta.value); stat.textContent = "Copied."; }
    catch(e){ ta.select(); stat.textContent = "Selected — copy it yourself."; }
  };
  const load = document.createElement("button");
  load.className = "btn"; load.textContent = "Restore from text";
  load.onclick = () => {
    if (!confirm("Replace everything on this device with the pasted backup?")) return;
    try{ restore(ta.value); stat.textContent = "Restored."; renderAll(); }
    catch(e){ stat.textContent = "That doesn't look like a backup."; }
  };
  const dl = document.createElement("button");
  dl.className = "btn"; dl.textContent = "Download file";
  dl.onclick = () => {
    try{
      const blob = new Blob([snapshot()], { type:"application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "bodyweight-ladders-backup.json";
      a.click();
      URL.revokeObjectURL(a.href);
      stat.textContent = "Downloaded.";
    } catch(e){ stat.textContent = "Download blocked here — copy the text instead."; }
  };
  acts.append(copy, load, dl, stat);
  box.appendChild(acts);
  return box;
}

/* ---------- shell ---------- */
const TABS = [
  { t:"Ladders", i:'<path d="M7 3v18M17 3v18M7 8h10M7 13h10M7 18h10"/>' },
  { t:"Log",     i:'<path d="M4 6h11M4 12h8M4 18h6"/><path d="M14 16.5l2 2 4.5-4.5"/>' },
  { t:"Build",   i:'<rect x="3.5" y="4" width="17" height="6" rx="1"/><rect x="3.5" y="14" width="17" height="6" rx="1"/>' }
];
function renderTop(){
  const n = $("top");
  n.innerHTML = "";
  TABS.forEach((tab,i) => {
    const b = document.createElement("button");
    b.type = "button"; b.setAttribute("role","tab");
    b.setAttribute("aria-selected", i === topTab);
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${tab.i}</svg><span>${tab.t}</span>`;
    b.onclick = () => { topTab = i; window.scrollTo(0,0); renderAll(); };
    n.appendChild(b);
  });
  $("v-ladders").hidden = topTab !== 0;
  $("v-log").hidden = topTab !== 1;
  $("v-build").hidden = topTab !== 2;
  document.querySelectorAll(".ladonly").forEach(e => e.style.display = topTab === 0 ? "" : "none");
}
function renderAll(){
  try { renderAllInner(); }
  catch(err){
    const b = $("boot");
    if (b){ b.style.display = "block"; b.textContent = "Something went wrong drawing the page: " + err.message; }
    console.error(err);
  }
}
function renderAllInner(){
  renderTop();
  if (topTab === 0) renderLadders();
  if (topTab === 1) renderLog();
  if (topTab === 2) renderBuild();
  const d = done();
  if ($("count")) $("count").innerHTML = `${d} <span>of ${total} rungs</span>`;
  if ($("save")) $("save").textContent = saveNote;
}

if ($("only")) $("only").onchange = e => { msOnly = e.target.checked; renderLadders(); };
if ($("newW")) $("newW").onclick = () => {
  const w = { id: uid(), name: "Workout " + (workouts.length + 1), items: [] };
  workouts.push(w); editing = w.id; topTab = 2; renderAll(); saveWork();
};
if ($("reset")) $("reset").onclick = () => {
  if (!confirm("Clear every ladder, workout and logged session?")) return;
  level = {}; workouts = []; logbook = []; editing = null; session = null; nudges = [];
  renderAll(); saveProg(); saveWork(); saveLog();
};

renderAll();
const boot = $("boot"), wrap = $("wrap");
if (wrap && wrap.children.length){ wrap.style.display = ""; if (boot) boot.style.display = "none"; }
loadAll();

</script>
</body>
</html>
```
