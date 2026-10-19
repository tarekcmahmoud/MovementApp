# Bodyweight Ladders v2 — implementation spec

Implement v2 of the app in this repo from this spec. It was produced from a clickable prototype Tarek reviewed and approved on 2026-10-14. Everything below is decided unless marked **Confirm**.

## The rule

The app never makes a training decision. It never advances a rung, swaps an exercise, derives an achievement, or tells Tarek he missed something. It holds structure and shows evidence; Tarek moves things by hand. Every feature below respects this — when a detail is unclear, the reading that keeps the app passive is the right one.

## Stack

Stay on v1's stack: vanilla JS, no framework, no build step, no dependencies, `localStorage`, GitHub Pages PWA. Tarek's shadcn preset and the BeUI dock are **visual references**, reproduced in plain CSS — not packages to install. (**Confirm** with Tarek only if something here genuinely can't be done in vanilla.)

Carry over v1's hard-won rules:
- Destructive actions are an in-app two-step; native `confirm()` stays banned.
- Save before render in every handler that changes data.
- The logger autosaves on every keystroke.
- Everything is script-rendered into a static shell, so one early exception blanks the page: guard rendering of each screen.

## Steps

1. **Read the codebase.** Map v1's storage keys, data shapes, screens and the chart data file. Done when you can name where cycles, workouts, sessions, progress and the chart live today.
2. **Data model and migration** (see *Data model*). Write a one-shot, idempotent migration from v1 storage to v2 shapes, run on load, that keeps a copy of the v1 data under a backup key. Done when every v1 cycle, workout, session and progress count has a v2 home and nothing is dropped.
3. **Visual system** (see *Visual system*). Tokens and shared components first, so screens are built from them. Done when every component in that section exists and the font loads offline.
4. **Screens** (see *Screens*), in this order: Week → Logger → Plan → Cycle → Workout editor → Ladders (list, collection, ladder) → Collection builder → Past-cycle view. Done when every screen and interaction listed exists.
5. **Verify** (see *Verification*). Done when every check passes.

## Data model

Reconcile names with what v1 already uses; the shapes are what matter.

```
cycle      { id, name, objective, start (ISO date, a Monday), weeks, deload (week no. or 0),
             workouts: [workout], status: 'active' | 'ended', achievements (text), endedAt }
workout    { id, name, blocks: [block] }
block      { id, name, sets, exercises: [exercise] }      // 2+ exercises = superset, run round by round
exercise   { id, name (free text), target (free text), note, link: rungId | null }
slot       { id, day, workoutId }                          // existing v1 plan entries; keep as-is
session    { cycleId, week, slotId, values per exercise per set, completedAt }
collection { id, name, short, builtin, on, categories: [{ id, name, ladders: [{ id, name, rungs: [{ id, name, goal }] }] }] }
positions  { [ladderId]: rungId }                          // where Tarek is on each ladder
```

- **Cycles own deep copies of their workouts** (unchanged from v1). Only one cycle is `active` at a time.
- **Current week** stays arithmetic from `start`.
- **Positions are stored as rung ids**, not counts. This resolves v1's open question: inserting a rung mid-ladder no longer silently promotes him.
- **The v1 chart becomes a built-in collection** (`builtin: true`, name "r/bodyweightfitness Progressions", short "BWF", on by default). Rung ids must be stable across app updates. `goal` starts empty for every rung.
- **Exercises become free text with an optional link.** Migrate each v1 exercise picked from the chart to `name` = chart name, `link` = that rung's id.
- **Migrating progress:** v1 stores a count N of cleared rungs per ladder. Map it to `positions[ladder] = rungs[N]` (the first uncleared rung — "where he's working"); if N equals the ladder length, use the last rung. **Confirm** this reading with Tarek before shipping the migration.
- **Last session's reps** = the most recent completed session for the same workout (any slot), per exercise per set. Deload weeks are excluded, as in v1.

## Screens

Navigation: a floating dock with **Week** and **Plan**. Ladders are reached from Plan only. Every other screen is full-screen with a round back button top-left.

### Week
- Header: date range of the viewed week (small, muted), then **"Week 3 of 6"** (32px bold, "of 6" muted), with round prev/next buttons on the right.
- A fixed-height single-line tag row under the heading, so the card below never moves: status pill with dot (**This week** yellow dot · **Past week** grey · **Upcoming** light grey), a dashed **Deload week** pill when relevant, and a **Back to this week** text link when viewing another week.
- Cycle card: "Cycle" + "Started 29 Sep"; a row of small pill buttons, one per week. Selected week = dark fill. Completed weeks (before the current week) = struck-through number. Deload week = dashed border. Tags under the pills: "Now" under the current week, "Deload" under the deload week. Tapping a pill jumps to that week. Grey footer band: "Swipe left or right to change week."
- **Swipe** left/right anywhere on the screen changes week: horizontal travel > 50px and greater than vertical travel. A swipe must not also open the session card it started on.
- Sessions list: one card per slot — round day badge, workout name, "3 exercises" (+ " · deload"), and on the right: **Done** dark pill, or muted **Not done** for past weeks, or a chevron. Any week's sessions open in the logger (past ones to log late, future ones too).
- No active cycle: centred empty state (plus in a grey circle, "No cycle running", muted line, **Go to Plan** dark pill).

### Logger
- Header: back, "Mon · Week 3", workout name.
- One card per block: block name + an outline pill ("Superset · 3 rounds" or "3 sets"). Exercise headers side by side for supersets: name, "Target 3×6", note pill if any, rung badge if linked and its collection is on ("Pull Ups 4/9", prefixed with the collection short name when 2+ collections are on).
- Rows per set/round ("S1"/"R1"): a numeric input per exercise, and **under each input** last session's value ("Last 6", or "No previous").
- Footer band: full-width dark pill **Complete session** → saves, marks the slot done, returns to that week. Reopening a done session shows saved values and reads **Update session**.

### Plan (no page heading)
1. **Current cycle card** (tappable → Cycle screen): "Current cycle" label, cycle name (22px bold), yellow-dot pill "Week 3 of 6", inset grey panel with rows Workouts ("2 · 3 sessions a week"), Weeks, Start, and Deload below a divider; grey footer band with **Key objective** + text. No cycle: empty-state card.
2. **New cycle** dark pill, centred. If a cycle is active, it shows an inline note instead: end the current cycle first. Otherwise it creates a cycle importing the workouts of the most recent ended cycle and opens the Cycle screen.
3. **Past cycles** card: one row per ended cycle, newest first — the period ("18 Aug – 28 Sep") and Tarek's achievements text; tap → Past-cycle view.
4. **Ladders** card: one row per collection (name, counts or note, toggle switch); footer band with **Add collection** outline pill and **Open ladders** dark pill (hidden when none are on). Open ladders goes straight to the collection when exactly one is on, else to the collection list.
5. **Backup** card: "Data lives on this phone only." + grey full-width **Export data** pill (v1's export).

### Cycle (from the current cycle card)
- Details card: Name, Key objective, Weeks, Deload week (empty = none), Start (date). Saved on change.
- Workouts card: rows (name, "3 exercises · Mon, Fri") → Workout editor; footer **New workout** grey pill (creates one with an empty block and opens the editor).
- **End cycle** outline pill → expands a card: title "End Cycle 2", close button, **Key achievements** textarea (required, written by Tarek), footer **Cancel** outline + **End cycle** dark pill (disabled until text is entered). Ending sets `status: 'ended'`, stores achievements, returns to Plan.

### Workout editor
- Header: back, "Edit workout", name, **Save** dark pill top-right.
- Workout name field.
- One card per block: "Block A" label (+ dark-dot "Superset" pill when 2+ exercises), editable block name, Sets/Rounds number. Each exercise (separated by dividers): tag ("A1"), Exercise, Target, Default note, and **Rung · optional** — a button showing the linked rung that expands an inline list grouped by collection (only collections that are on), plus "Not linked". Hidden when no collection is on.
- Card footer: grey **Add exercise** pill (adds to this block). Below all cards: dark **Add block** pill.

### Ladders
- **Collection list** (only when 2+ are on): a card per collection → collection.
- **Collection**: header with **Edit** outline pill (opens the builder on a copy). One card per category; rows per ladder: name, "At Pull Up · 4/9" or "No position set · 9 rungs", plus "· 2 linked" when current-cycle exercises link into it.
- **Ladder**: segmented control **Position | Goals**.
  - *Position*: rungs top to bottom (easiest first): numbered circle (check for cleared rungs), name, chips for **Goal 3×8** and "Linked: Pull Up · Upper A". Tapping a rung sets it as the position; the current rung is a dark row with a yellow-dot "You're here" pill. **Clear position** outline pill below.
  - *Goals*: each rung with a text field for its goal (reps, hold time, anything). Shown as a chip; nothing checks it.

### Collection builder
- Header: close, "New collection"/"Edit collection", **Save** dark pill. Cancel discards the draft.
- Collection name; one card per category (name field), each with ladders as inset grey panels: ladder name, numbered rung rows (name + goal), **Add rung**. Card footer **Add ladder**; dark **Add category** below.
- Saving a new collection turns it on. The built-in collection is editable too.

### Past-cycle view
- The Week screen, read-only: header "Past cycle" + name + "Read only" pill, the same swipeable weeks, a card with "Sessions done 17 of 18" in an inset panel and Tarek's achievements in the footer band. Session cards don't open; each week's status pill reads "3 of 3 done".

## Visual system

Zinc palette, Oxanium for everything, icons in Hugeicons' style (1.5 stroke, round caps). **Self-host Oxanium** (400/500/600/700) so the PWA works offline.

| Token | Value |
|---|---|
| Page background | `#f3f3f4` with a sparse grain (dark: `#09090b`). Light and dark themes since 2026-10-19 |
| Card | `#ffffff`, 1px `#e4e4e7` border, radius 28px |
| Card footer band | `#fafafa`, top border `#e4e4e7`, bottom radius 27px |
| Inset panel | `#f4f4f5`, radius 20px, label/value rows |
| Text / muted / soft | `#09090b` / `#71717a` / `#3f3f46` |
| Primary | `#18181b` on `#fafafa` |
| Accent dot | cherry red `#d2042d` (dark `#ef2b4f`): this week, you're here — the only colour. Was `#eab308` until 2026-10-19 |
| Inputs | 44px tall, radius 16px, 15px text; logger inputs 17px semibold |
| Buttons | pills (radius 999): dark primary, white outline secondary, `#f0f0f0` full-width tertiary in footer bands |
| Round icon button | 40px, `#f4f4f5`, radius 999 (back, close) |
| Toggle | 52×32 track, dark when on, `#d4d4d8` off, 24px white knob |

Type scale: week heading 32px bold · cycle name 22px bold · screen header title 17px semibold · card title 14px semibold · row title 15px semibold · body/descriptions 13–14px · labels 13px medium · tags 11–12px. Tabular numerals throughout.

**Status pill**: white, 1px border, radius 999, 8px coloured dot + label.

**Dock** (after BeUI's expandable tabs): floating, centred, 20px above the bottom edge; white, 1px border, radius 26px, soft shadow, 6px padding. Tabs are 40px tall; inactive = icon only, muted; active = icon + label on a `rgba(9,9,11,0.08)` pill, the label sliding open via `max-width`/opacity transitions on `cubic-bezier(0.16, 1, 0.3, 1)`. Respect `prefers-reduced-motion`. Screens with the dock reserve ~112px of bottom padding.

**Cards never clip**: give scroll containers' children `flex-shrink: 0` and keep `overflow: hidden` off cards.

## Verification

At a 390×844 viewport in Chrome:
- [ ] v1 data migrates: every cycle, workout, session and position is present; a reload doesn't re-migrate; the v1 backup key exists.
- [ ] Swiping changes week and never also opens a session; the cycle card doesn't shift as tags change.
- [ ] Logging, completing, reopening and updating a session works; "Last N" shows the previous session's values; Android reclaiming the tab mid-session loses nothing.
- [ ] Ending a cycle requires achievements and moves it to Past cycles; New cycle imports its workouts.
- [ ] Turning collections on/off shows and hides badges, the rung picker and Open ladders; with 2+ on, badges carry the short name.
- [ ] Setting a position and goals persists across reloads; editing a collection keeps existing links working.
- [ ] Offline (airplane mode): the app, font and icons load.
- [ ] No native `confirm()`; every destructive action is a two-step.

## Out of scope

- Phase 3 items not shown here: deload scaling presets and the two-consecutive target tally.
- Google Calendar (Phase 4).
- Prototype sample data (workouts, rungs, goals, achievements) — it was illustrative only.
