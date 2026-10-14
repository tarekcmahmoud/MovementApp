#!/usr/bin/env node
/* Tests for data.js: the v1 -> v2 migration and the helpers around it.

     node tools/test-migration.js                    synthetic fixture + unit checks
     node tools/test-migration.js path/to/export.json   ...and audit a REAL export

   The path may be a v1 export (the snapshot() JSON from the old app) or a v2
   export (which carries the v1 backup inside it - so the state on the phone can
   be audited against the data it was migrated from).

   Exit code is 0 only if every check passes. A lost session, set value, rpe,
   milestone, note, slot, cycle or position is a failure; the audit table says
   which. Run it against the phone's real export before deploying. */
"use strict";
const fs = require("fs");
const path = require("path");
const Data = require("../data.js");
const chart = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "chart.json"), "utf8"));

const clone = x => JSON.parse(JSON.stringify(x));
const eq = (a, b) => Data.deepEqual(a, b);
const nonEmpty = v => v !== "" && v != null;

/* ---------- an in-memory localStorage that remembers what was done to it ---------- */
function fakeStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  const s = {
    log: [],
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem(k, v) { s.log.push(["set", k]); m.set(k, String(v)); },
    removeItem(k) { s.log.push(["remove", k]); m.delete(k); },
    dump: () => Object.fromEntries(m),
    keys: () => [...m.keys()]
  };
  return s;
}
// What v1 itself would have put in localStorage for this export.
function rawFromV1(v1) {
  const K = Data.V1_KEYS, raw = {};
  const put = (k, v) => { if (v !== undefined) raw[k] = JSON.stringify(v); };
  put(K.level, v1.level); put(K.workouts, v1.workouts); put(K.logbook, v1.logbook);
  put(K.focus, v1.focus); put(K.cycle, v1.cycle); put(K.cycleArchive, v1.cycleArchive);
  put(K.inProgress, v1.inProgress);
  raw[K.seeded] = "true";
  return raw;
}

/* ============================================================
   audit(v1, v2): conservation checks. Independent of data.js's own logic
   wherever it can be - it re-derives what v2 must contain from v1 + chart.json.
   Returns { rows, failed }; prints the table unless quiet.
   ============================================================ */
function audit(v1, v2, opts) {
  opts = opts || {};
  const rows = [];
  const add = (check, a, b, ok) => rows.push({ check, a, b, ok: ok === undefined ? a === b : ok });
  const arr = x => (Array.isArray(x) ? x : []);
  const obj = x => (x && typeof x === "object" && !Array.isArray(x) ? x : {});

  // chart facts, straight from chart.json
  const chartKeys = new Set(), ladderLens = new Map();
  chart.categories.forEach(g => g.ladders.forEach(l => {
    ladderLens.set(g.g + "/" + l.n, l);
    l.m.forEach(x => chartKeys.add(g.g + "|" + l.n + "|" + x[0]));
  }));

  const builtin = v2.collections.filter(c => c.builtin)[0];
  const rungKey = new Map(), rungIds = new Set(), ladderByName = new Map();
  let nCat = 0, nLad = 0, nRung = 0, dupIds = 0;
  if (builtin) builtin.categories.forEach(c => {
    nCat++;
    c.ladders.forEach(l => {
      nLad++; ladderByName.set(c.name + "/" + l.name, l);
      l.rungs.forEach(r => {
        nRung++;
        if (rungIds.has(r.id)) dupIds++;
        rungIds.add(r.id);
        rungKey.set(r.id, c.name + "|" + l.name + "|" + r.name);
      });
    });
  });
  add("built-in categories", 8, nCat); add("built-in ladders", 37, nLad); add("built-in rungs", 244, nRung);
  add("built-in rung id collisions", 0, dupIds);

  // cycles and slots
  const v1cycles = arr(v1.cycleArchive).concat(v1.cycle && typeof v1.cycle === "object" ? [v1.cycle] : []);
  add("cycles", v1cycles.length, v2.cycles.length);
  add("  of which active", v1.cycle ? 1 : 0, v2.cycles.filter(c => c.status === "active").length);
  const v1slots = v1cycles.reduce((n, c) => n + arr(c.plan).length, 0);
  add("slots", v1slots, v2.cycles.reduce((n, c) => n + c.slots.filter(s => !(s.v1 && s.v1.synthesized)).length, 0));

  const pool = arr(v1.workouts);
  const expectedWorkout = p => {
    let w = p && p.workout;
    if (w == null && p && p.wid) w = pool.filter(x => x && x.id === p.wid)[0] || null;
    if (!w || typeof w !== "object") return null;
    const blocks = Array.isArray(w.blocks) ? w.blocks : [{ name: "A", items: w.items || [] }];
    return { name: w.name == null ? "" : w.name, blocks: blocks.map(b => {
      const items = arr(b.items);
      return { name: b.name == null ? "" : b.name,
        sets: b.sets != null ? b.sets : (items.length ? Math.max(...items.map(i => i.sets || 3)) : 3),
        items: items.map(i => [i.key, i.target == null ? "" : i.target, i.note == null ? "" : i.note]) };
    }) };
  };
  const actualWorkout = (cyc, slot) => {
    const w = cyc.workouts.filter(x => x.id === slot.workoutId)[0];
    if (!w) return null;
    return { name: w.name, blocks: w.blocks.map(b => ({ name: b.name, sets: b.sets,
      items: b.exercises.map(e => [e.link ? rungKey.get(e.link) : e.name, e.target, e.note]) })) };
  };
  let slotIdMissing = 0, slotWorkoutBad = 0, cycleFieldBad = 0, chartItems = 0, linkedItems = 0, unlinkedChart = 0;
  v1cycles.forEach((c, i) => {
    const c2 = v2.cycles[i];
    if (!c2) return;
    if (!eq(c.deload == null ? [] : c.deload, c2.deload) || c.name !== c2.name || c.start !== c2.start || c.weeks !== c2.weeks) cycleFieldBad++;
    arr(c.plan).forEach((p, j) => {
      const s2 = c2.slots[j];
      if (!s2 || (p.id && s2.id !== p.id) || (p.day || "") !== s2.day) slotIdMissing++;
      const want = expectedWorkout(p), have = s2 && s2.workoutId != null ? actualWorkout(c2, s2) : null;
      if (!eq(want, have)) slotWorkoutBad++;
      if (want) want.blocks.forEach(b => b.items.forEach(it => {
        if (chartKeys.has(it[0])) chartItems++;
      }));
      if (have && s2) c2.workouts.filter(x => x.id === s2.workoutId)[0].blocks.forEach(b => b.exercises.forEach(e => { if (e.link) linkedItems++; }));
    });
  });
  add("slot ids/days kept (mismatches)", 0, slotIdMissing);
  add("cycle name/start/weeks/deload kept (mismatches)", 0, cycleFieldBad);
  add("slot workouts identical in content (mismatches)", 0, slotWorkoutBad);
  add("exercises on the chart -> linked (per slot)", chartItems, linkedItems);
  v2.cycles.forEach(c => c.workouts.forEach(w => w.blocks.forEach(b => b.exercises.forEach(e => {
    if (!e.link && chartKeys.has(e.name)) unlinkedChart++;
  }))));
  add("  chart-named exercises left unlinked", 0, unlinkedChart);

  // sessions
  const log = arr(v1.logbook).filter(s => s && typeof s === "object");
  const d = v1.inProgress && typeof v1.inProgress === "object" ? v1.inProgress : null;
  const draftSeparate = !!d && !(d.id != null && log.some(s => s.id === d.id));
  const v1sess = (draftSeparate ? [d] : []).concat(log);
  add("logbook sessions", log.length, v2.sessions.filter(s => s.completedAt).length);
  add("in-progress draft", d ? 1 : 0, d ? (draftSeparate ? v2.sessions.filter(s => !s.completedAt).length
    : v2.sessions.filter(s => s.v1 && eq(s.v1.inProgressDraft, d)).length) : v2.sessions.filter(s => !s.completedAt).length);
  add("sessions total", v1sess.length, v2.sessions.length);

  const ents = s => arr(s.entries).filter(e => e && typeof e === "object");
  const sumOf = (list, f) => list.reduce((n, x) => n + f(x), 0);
  add("non-empty set values", sumOf(v1sess, s => sumOf(ents(s), e => arr(e.sets).filter(nonEmpty).length)),
    sumOf(v2.sessions, s => sumOf(s.entries, e => e.sets.filter(nonEmpty).length)));
  add("rpe values", sumOf(v1sess, s => sumOf(ents(s), e => nonEmpty(e.rpe) ? 1 : 0)),
    sumOf(v2.sessions, s => sumOf(s.entries, e => nonEmpty(e.rpe) ? 1 : 0)));
  add("milestones", sumOf(v1sess, s => arr(s.milestones).length), sumOf(v2.sessions, s => s.milestones.length));
  add("notes", sumOf(v1sess, s => nonEmpty(s.note) ? 1 : 0), sumOf(v2.sessions, s => nonEmpty(s.note) ? 1 : 0));
  add("exercise entries", sumOf(v1sess, s => ents(s).length), sumOf(v2.sessions, s => s.entries.length));

  const v2ids = new Set(v2.sessions.map(s => s.id));
  add("v1 session ids missing from v2", 0, v1sess.filter(s => s.id != null && !v2ids.has(s.id)
    && !v2.sessions.some(x => x.v1 && x.v1.originalId === s.id)).length);
  add("v2 session ids unique", v2.sessions.length, v2ids.size);

  // field-for-field, by position (v2 keeps v1's order, draft first)
  let sessBad = 0, entryBad = 0, keyBad = 0, linkBad = 0;
  if (v1sess.length === v2.sessions.length) v1sess.forEach((s, i) => {
    const t = v2.sessions[i], e1 = ents(s);
    if (t.date !== (s.date == null ? "" : s.date) || t.workoutName !== (s.name == null ? "" : s.name)
      || t.note !== (s.note == null ? "" : s.note) || !eq(t.milestones.map(m => m.key), arr(s.milestones))
      || (s.deload != null && t.deload !== !!s.deload)
      || (i === 0 && draftSeparate ? t.completedAt !== null : t.completedAt !== (s.date || t.completedAt)))
      sessBad++;
    if (t.entries.length !== e1.length) { entryBad++; return; }
    e1.forEach((e, j) => {
      const x = t.entries[j];
      if (!eq(x.sets, arr(e.sets)) || x.rpe !== (e.rpe == null ? "" : e.rpe) || x.target !== (e.target == null ? "" : e.target)
        || x.block !== (e.block == null ? "" : e.block) || x.note !== (e.note == null ? "" : e.note)) entryBad++;
      if (x.v1.key !== e.key) keyBad++;
      if (chartKeys.has(e.key) !== !!x.link || (x.link && rungKey.get(x.link) !== e.key)) linkBad++;
    });
  });
  add("sessions: date/name/note/milestones/completedAt (mismatches)", 0, sessBad);
  add("entries: sets/rpe/target/block/note (mismatches)", 0, entryBad);
  add("entries: v1 key kept (mismatches)", 0, keyBad);
  add("entries: chart key <-> link (mismatches)", 0, linkBad);

  // slot membership: every v1 slot id still exists, in a cycle, for any session that named it
  const cyc2 = new Map(v2.cycles.map(c => [c.id, c]));
  let refBad = 0, exBad = 0, weekBad = 0;
  v2.sessions.forEach(s => {
    if (s.cycleId != null) {
      const c = cyc2.get(s.cycleId);
      if (!c) { refBad++; return; }
      if (s.week != null && (s.week < 1 || s.week > c.weeks)) weekBad++;
      const w = c.workouts.filter(x => x.id === s.workoutId)[0];
      s.entries.forEach(e => {
        if (e.exerciseId != null && !(w && w.blocks.some(b => b.exercises.some(x => x.id === e.exerciseId)))) exBad++;
      });
    } else if (s.entries.some(e => e.exerciseId != null)) exBad++;
  });
  add("sessions pointing at a missing cycle", 0, refBad);
  add("entries pointing at a missing exercise", 0, exBad);
  add("weeks outside 1..weeks", 0, weekBad);
  const exIds = [];
  v2.cycles.forEach(c => c.workouts.forEach(w => w.blocks.forEach(b => b.exercises.forEach(e => exIds.push(e.id)))));
  add("exercise ids unique", exIds.length, new Set(exIds).size);
  add("cycle ids unique", v2.cycles.length, new Set(v2.cycles.map(c => c.id)).size);

  // positions: the last cleared rung
  const level = obj(v1.level);
  let withCount = 0, posBad = 0, extraPos = 0;
  Object.keys(level).forEach(k => {
    const l2 = ladderByName.get(k), n = Math.floor(Number(level[k]));
    if (!l2 || !(n >= 1)) return;
    withCount++;
    if (v2.positions[l2.id] !== l2.rungs[Math.min(n, l2.rungs.length) - 1].id) posBad++;
  });
  Object.keys(v2.positions).forEach(id => {
    const ok = [...ladderByName.values()].some(l => l.id === id && l.rungs.some(r => r.id === v2.positions[id]));
    if (!ok) extraPos++;
  });
  add("ladders with progress -> position = rungs[N-1] (wrong)", 0, posBad);
  add("ladders with progress (known)", withCount, Object.keys(v2.positions).length);
  add("positions that point nowhere", 0, extraPos);
  const unknownLevel = Object.keys(level).filter(k => !ladderByName.has(k));
  add("unknown ladder keys still in legacy.level", unknownLevel.length, unknownLevel.filter(k => k in v2.legacy.level).length);

  // verbatim legacy copies
  add("legacy.level verbatim", true, eq(v2.legacy.level, obj(v1.level)));
  add("legacy.workouts verbatim", true, eq(v2.legacy.workouts, arr(v1.workouts)));
  add("legacy.focus verbatim", true, eq(v2.legacy.focus, arr(v1.focus)));
  add("JSON round-trip identical", true, eq(JSON.parse(JSON.stringify(v2)), v2));

  const failed = rows.filter(r => !r.ok);
  if (!opts.quiet) printRows(rows, opts.title);
  return { rows, failed };
}
function printRows(rows, title) {
  const w = Math.max(...rows.map(r => r.check.length), 10);
  if (title) console.log("\n" + title);
  console.log("  " + "check".padEnd(w) + "  " + "v1".padStart(7) + "  " + "v2".padStart(7) + "  result");
  console.log("  " + "-".repeat(w) + "  " + "-".repeat(7) + "  " + "-".repeat(7) + "  ------");
  rows.forEach(r => console.log("  " + r.check.padEnd(w) + "  " + String(r.a).padStart(7) + "  " + String(r.b).padStart(7) + "  " + (r.ok ? "ok" : "** LOSS **")));
}

/* ============================================================
   The synthetic v1 fixture. Every rule in the brief is exercised somewhere.
   ============================================================ */
const it = (key, target, note) => { const o = { key, target }; if (note) o.note = note; return o; };
const PU = "Vertical pull|Pull up|Pull Up", DIP = "Dips & L-sit|Dip|Dip", PLANK = "Core|Plank|Plank";
const CUSTOM = "Custom|Thing|Bar Hang", RTO = "Dips & L-sit|Ring dip|RTO 75° Dip", P360 = "Horizontal pull|Front lever|360° Pull";
const PUSHUP = "Horizontal push|Push up|Push Up", PIKE = "Horizontal push|Push up|Pike Push Up";

function upper(variant) {
  const core = [it(PLANK, "30s"), it(CUSTOM, "30s", "not on the chart")];
  if (variant) core.push(it(PUSHUP, "10"));
  return { id: "w-upper", name: "Upper A", blocks: [
    { id: "b-u1", name: "Main 1", sets: 4, items: [it(PU, variant ? "12" : "10", "Chin over bar"), it(DIP, "8")] },
    { id: "b-u2", name: "Core", sets: 3, items: core },
    { id: "b-u3", name: "Rings", sets: 3, items: [it(RTO, "5"), it(P360, "3")] }] };
}
// Old-shape workout: no block `sets`, per-item `sets`, and the dropped `role`.
function push() {
  return { id: "w-push", name: "Push", role: "dev", blocks: [
    { id: "b-p1", name: "A", items: [{ key: PUSHUP, target: "10", sets: 4 }, { key: PIKE, target: "5", sets: 3 }] }] };
}
const ent = (key, name, block, target, sets, rpe, note) => ({ key, name, block, target, note: note || "", sets, rpe: rpe || "" });

function buildFixture() {
  const legacyPool = { id: "w-legacy", name: "Legacy pool", items: [it(PU, "10"), it(PUSHUP, "8")] };
  const a1 = { id: "cyc-a1", name: "Cycle 1", weeks: 4, start: "2026-05-04", deload: [4], plan: [
    { id: "sl-a1-1", day: "mon", workout: push() },
    { wid: "w-legacy", day: "wed" }] };                                      // legacy {wid, day}, no id
  const a2 = { id: "cyc-a2", name: "Cycle 2", weeks: 6, start: "2026-06-08", deload: [3, 6], plan: [
    { id: "sl-a2-1", day: "mon", workout: upper(false) },
    { id: "sl-a2-2", day: "thu", workout: upper(false) },                    // identical copy of slot 1
    { id: "sl-a2-3", day: "sat", workout: upper(true) },                     // diverged copy, same v1 id
    { id: "sl-a2-4", day: "", wid: "w-gone" },                               // pool workout no longer exists
    { id: "sl-a2-5", day: "fri", workout: push() }] };
  const act = { id: "cyc-act", name: "Cycle 3", weeks: 6, start: "2026-09-21", deload: [4], plan: [
    { id: "sl-ac-1", day: "mon", workout: upper(false) },
    { id: "sl-ac-2", day: "fri", workout: push() }] };

  const logbook = [
    // active cycle
    { id: "s-ac-dl", date: "2026-10-12", wid: "w-upper", slot: "sl-ac-1", name: "Upper A", cycle: "cyc-act", week: 4, deload: true,
      entries: [ent(PU, "Pull Up", "Main 1", "10", ["99", "", ""], "6")], milestones: [], note: "" },
    { id: "s-ac-w3", date: "2026-10-06", wid: "w-push", slot: "sl-ac-2", name: "Push", cycle: "cyc-act", week: 2, deload: false,
      entries: [ent(PUSHUP, "Push Up", "A", "10", ["10", "9", "8"], "8", "slow tempo"), ent(PIKE, "Pike Push Up", "A", "5", ["5", "5", ""], "")],
      milestones: [], note: "week stamp (2) disagrees with the date (week 3)" },
    { id: "s-free", date: "2026-10-01", wid: null, slot: null, name: "Free session", cycle: "cyc-act", week: 2, deload: false,
      entries: [ent(CUSTOM, CUSTOM, "", "30s", ["20", "25"], "7")], note: "" },
    { id: "s-ac-w2", date: "2026-09-29", wid: "w-upper", slot: "sl-ac-1", name: "Upper A", cycle: "cyc-act", week: 2, deload: false,
      entries: [ent(PU, "Pull Up", "Main 1", "10", ["8", "8", "7", "6"], "8", "Chin over bar"),
        ent(PUSHUP, "Push Up", "", "10", ["12", "11", "10"], "9")],           // key not in this workout
      milestones: [PU], note: "mid-cycle" },
    { id: "s-ac-w1", date: "2026-09-22", wid: "w-upper", slot: "sl-ac-1", name: "Upper A", cycle: "cyc-act", week: 1, deload: false,
      entries: [ent(PU, "Pull Up", "Main 1", "10", ["7", "6", "6", "5"], "8", "Chin over bar"), ent(DIP, "Dip", "Main 1", "8", ["8", "8", "8", "7"], "7"),
        ent(CUSTOM, CUSTOM, "Core", "30s", ["20", "", ""], ""), ent(RTO, "RTO 75° Dip", "Rings", "5", ["3", "3", "2"], "9"),
        ent(P360, "360° Pull", "Rings", "3", ["1", "", ""], "")],
      milestones: [PU, RTO], note: "felt good" },
    // archived cycle 2 (June 8 - July 19)
    { id: "s-late", date: "2026-07-30", wid: "w-upper", slot: "sl-a2-1", name: "Upper A", cycle: "cyc-a2", week: 6, deload: true,
      entries: [ent(PU, "Pull Up", "Main 1", "10", ["6", "5", "5", "4"], "8")], note: "logged after the cycle's end date" },
    { id: "s-dang", date: "2026-07-03", wid: "w-upper", slot: "sl-gone", name: "Upper A", cycle: "cyc-a2", week: 4, deload: false,
      entries: [ent(PU, "Pull Up", "Main 1", "10", ["6", "6", "6"], "7")], note: "slot no longer exists" },
    { id: "s-a2-dl", date: "2026-06-24", wid: "w-upper", slot: "sl-a2-1", name: "Upper A", cycle: "cyc-a2", week: 3, deload: true,
      entries: [ent(PU, "Pull Up", "Main 1", "10", ["4", "4"], "5")], note: "deload week" },
    { id: "s-leg2", date: "2026-06-10", wid: "w-upper", name: "Upper A",                // pre-slot: wid only
      entries: [ent(PU, "Pull Up", "Main 1", "10", ["5", "5", "5", "5"], "7")] },
    { id: "s-a2-2", date: "2026-06-11", wid: "w-upper", slot: "sl-a2-2", name: "Upper A", cycle: "cyc-a2", week: 1, deload: false,
      entries: [ent(PU, "Pull Up", "Main 1", "10", ["5", "5", "4", "4"], "8")], note: "same workout, second slot, same week" },
    { id: "s-a2-1", date: "2026-06-08", wid: "w-upper", slot: "sl-a2-1", name: "Upper A", cycle: "cyc-a2", week: 1, deload: false,
      entries: [ent(PU, "Pull Up", "Main 1", "10", ["5", "5", "5", "4"], "8", "n1")] },
    // archived cycle 1 (May 4 - May 31): pre-slot sessions matched by date + wid
    { id: "s-leg3", date: "2026-05-27", wid: "w-legacy", name: "Legacy pool", entries: [ent(PU, "Pull Up", "A", "10", ["4", "4"], "")] },
    { id: "s-leg1", date: "2026-05-20", wid: "w-legacy", name: "Legacy pool", entries: [ent(PU, "Pull Up", "A", "10", ["3", "3"], "")], note: "legacy" },
    { id: "s-a1-1", date: "2026-05-04", wid: "w-push", slot: "sl-a1-1", name: "Push", cycle: "cyc-a1", week: 1, deload: false,
      entries: [ent(PUSHUP, "Push Up", "A", "10", ["8", "8", "7"], "8")] },
    // before any cycle
    { id: "s-pre", date: "2026-04-20", wid: null, slot: null, name: "Free session", entries: [ent(PU, "Pull Up", "", "10", ["2", "2"], "9")], milestones: [PU], note: "before cycles" },
    { id: "s-pre-up", date: "2026-02-01", wid: "w-upper", slot: null, name: "Upper A",
      entries: [ent(PU, "Pull Up", "Main 1", "10", ["3", "3", "3"], ""), ent(CUSTOM, CUSTOM, "Core", "30s", ["15", "15"], "")] }
  ];
  const inProgress = { id: "s-draft", date: "2026-10-13", wid: "w-push", slot: "sl-ac-2", name: "Push",
    entries: [ent(PUSHUP, "Push Up", "A", "10", ["10", "", ""], ""), ent(PIKE, "Pike Push Up", "A", "5", ["", "", ""], "")],
    rest: { end: 1790000000000, len: 90, rung: false }, resumed: true, note: "halfway" };

  return {
    v: 1, saved: "2026-10-13",
    level: { "Vertical pull/Pull up": 0, "Horizontal pull/Rows": 4, "Dips & L-sit/Dip": 6, "Legs/Squat": 3,
      "Handstand/Handstand": 99, "Dips & L-sit/Ring dip": 10, "Horizontal pull/Front lever": 9, "Bogus/Ladder": 2 },
    workouts: [legacyPool, { id: "w-unused", name: "Unused", blocks: [{ id: "b-x", name: "A", sets: 3, items: [it(PU, "5")] }] }],
    logbook, focus: ["Vertical pull|Muscle up|Muscle Up", "Gone|Gone|Gone"],
    cycle: act, cycleArchive: [a1, a2], inProgress
  };
}

/* ============================================================
   assertions
   ============================================================ */
let nChecks = 0; const fails = [];
function T(name, cond, detail) {
  nChecks++;
  if (!cond) { fails.push(name); console.log("  FAIL  " + name + (detail ? "  -> " + detail : "")); }
}
function throws(fn, re) { try { fn(); } catch (e) { return re ? re.test(e.message) : true; } return false; }

function runFixtureTests() {
  const v1 = buildFixture();
  const v1Before = clone(v1);
  const st = Data.migrateV1(v1, chart, { now: "2026-10-14T09:00:00.000Z" });
  T("migrateV1 does not mutate its input", eq(v1, v1Before));

  const r = audit(v1, st, { title: "AUDIT - synthetic fixture" });
  r.failed.forEach(f => fails.push("audit: " + f.check));

  // --- cycles
  const byId = id => st.cycles.filter(c => c.id === id)[0];
  const A1 = byId("cyc-a1"), A2 = byId("cyc-a2"), ACT = byId("cyc-act");
  T("3 cycles, order archive..active", st.cycles.map(c => c.id).join() === "cyc-a1,cyc-a2,cyc-act");
  T("statuses", A1.status === "ended" && A2.status === "ended" && ACT.status === "active");
  T("ended cycles have empty achievements/endedAt", A1.achievements === "" && A1.endedAt === null && A2.objective === "");
  T("deload stays an array", eq(A2.deload, [3, 6]) && eq(ACT.deload, [4]));

  // --- legacy {wid, day} plan entry
  const legSlot = A1.slots[1];
  T("legacy slot got an id", typeof legSlot.id === "string" && legSlot.id.length > 0 && legSlot.id !== "sl-a1-1");
  T("legacy slot day kept", legSlot.day === "wed");
  const legW = A1.workouts.filter(w => w.id === legSlot.workoutId)[0];
  T("legacy slot became a deep copy of the pool workout", legW && legW.name === "Legacy pool" && legW.blocks.length === 1
    && legW.blocks[0].exercises.length === 2 && legW.blocks[0].sets === 3 && legW.id === "w-legacy");
  T("legacy slot remembers its wid", legSlot.v1 && legSlot.v1.wid === "w-legacy");
  T("pool copy is independent of legacy.workouts", legW !== st.legacy.workouts[0] && st.legacy.workouts[0].items.length === 2);

  // --- workouts per cycle
  T("A2: identical copies share one workout, diverged copy is separate", A2.workouts.length === 3
    && A2.slots[0].workoutId === "w-upper" && A2.slots[1].workoutId === "w-upper"
    && A2.slots[2].workoutId !== "w-upper" && A2.slots[2].workoutId != null);
  const div = A2.workouts.filter(w => w.id === A2.slots[2].workoutId)[0];
  T("diverged copy has its own contents", div.name === "Upper A" && div.blocks[0].exercises[0].target === "12" && div.blocks[1].exercises.length === 3);
  T("unresolvable wid -> slot without workout, pointer kept", A2.slots[3].workoutId === null && A2.slots[3].v1.wid === "w-gone");
  T("every slot keeps its v1 id", A2.slots.map(s => s.id).join() === "sl-a2-1,sl-a2-2,sl-a2-3,sl-a2-4,sl-a2-5");
  T("same workout id in two cycles is fine", A1.workouts[0].id === "w-push" && A2.workouts.some(w => w.id === "w-push"));
  const pushW = A1.workouts.filter(w => w.id === "w-push")[0];
  T("block.sets default derived like v1 (max of item sets)", pushW.blocks[0].sets === 4);
  T("dropped v1 fields are parked (role, item sets)", pushW.v1.role === "dev" && pushW.blocks[0].exercises[0].v1.sets === 4);
  T("block ids kept", ACT.workouts[0].blocks.map(b => b.id).join() === "b-u1,b-u2,b-u3");

  // --- exercises
  const actU = ACT.workouts.filter(w => w.id === "w-upper")[0];
  const exOf = (w, name) => w.blocks.reduce((a, b) => a.concat(b.exercises), []).filter(e => e.name === name)[0];
  const pu = exOf(actU, "Pull Up");
  T("chart key -> name + link", pu.link === "bwf:vertical-pull/pull-up/pull-up" && pu.target === "10" && pu.note === "Chin over bar");
  const cu = exOf(actU, CUSTOM);
  T("non-chart key -> name is the key, link null", cu && cu.link === null && cu.note === "not on the chart");
  T("degree-sign rungs link", exOf(actU, "RTO 75° Dip").link === "bwf:dips-l-sit/ring-dip/rto-75-dip"
    && exOf(actU, "360° Pull").link === "bwf:horizontal-pull/front-lever/360-pull");
  T("exercise ids are fresh and unique", new Set(actU.blocks.flatMap(b => b.exercises.map(e => e.id))).size === 6);

  // --- sessions
  const S = id => st.sessions.filter(s => s.id === id)[0];
  T("17 sessions = 16 logbook + 1 draft", st.sessions.length === 17 && v1.logbook.length === 16);
  T("order: draft first, then logbook order", st.sessions[0].id === "s-draft" && st.sessions[1].id === "s-ac-dl" && st.sessions[16].id === "s-pre-up");
  const draft = S("s-draft");
  T("draft is a draft in the active cycle", draft.completedAt === null && draft.cycleId === "cyc-act" && draft.week === 4
    && draft.slotId === "sl-ac-2" && draft.workoutId === "w-push");
  T("draft transient fields parked, not dropped", draft.v1.rest.len === 90 && draft.v1.resumed === true && draft.note === "halfway");
  T("completedAt = date for logbook sessions", S("s-ac-w1").completedAt === "2026-09-22");
  const w3 = S("s-ac-w3");
  T("stamped week disagrees with date: date wins, original kept", w3.week === 3 && w3.v1.week === 2 && w3.v1.cycle === "cyc-act");
  T("week arithmetic (week 1, week 2)", S("s-ac-w1").week === 1 && S("s-ac-w2").week === 2);
  T("deload flag kept as stamped", S("s-ac-dl").deload === true && S("s-ac-w1").deload === false && S("s-a2-dl").deload === true);
  T("v1 deload flag beats the cycle's list (week 6 session flagged by v1)", S("s-late").deload === true);
  const free = S("s-free");
  T("free session in a cycle: cycle via v1 field, no slot, no workout", free.cycleId === "cyc-act" && free.slotId === null && free.workoutId === null
    && free.v1.cycleSource === "cycle-field" && free.entries[0].link === null && free.entries[0].exerciseId === null);
  T("pre-cycle sessions kept with null cycle/week", S("s-pre").cycleId === null && S("s-pre").week === null && S("s-pre").slotId === null
    && S("s-pre-up").cycleId === null && S("s-pre-up").workoutId === "w-upper");
  const l1 = S("s-leg1"), l3 = S("s-leg3"), l2 = S("s-leg2");
  T("legacy wid-only session -> cycle by date window + wid", l1.cycleId === "cyc-a1" && l1.week === 3 && l1.v1.cycleSource === "date-window");
  T("legacy session -> slot that v1 would have marked done", l1.slotId === legSlot.id && l1.v1.slotInferred === true && l1.workoutId === "w-legacy");
  T("deload recomputed from cycle when v1 had no flag", l3.deload === true && l3.week === 4 && l1.deload === false);
  T("legacy session takes a slot nothing else claimed that week", l2.cycleId === "cyc-a2" && l2.week === 1 && l2.slotId === "sl-a2-3");
  T("...and the slot's workout id (the diverged copy)", l2.workoutId === A2.slots[2].workoutId);
  T("explicit slots win: two sessions of one workout in one week", S("s-a2-1").slotId === "sl-a2-1" && S("s-a2-2").slotId === "sl-a2-2"
    && S("s-a2-1").week === 1 && S("s-a2-2").week === 1 && S("s-a2-1").workoutId === "w-upper");
  const late = S("s-late");
  T("date outside the cycle: week clamped, flagged, original kept", late.week === 6 && late.v1.weekClamped === true && late.v1.week === 6);
  const dang = S("s-dang");
  T("dangling slot id kept, cycle from v1 field", dang.slotId === "sl-gone" && dang.cycleId === "cyc-a2" && dang.week === 4 && dang.workoutId === "w-upper");
  T("a slot's session lives in the slot's cycle", S("s-a1-1").cycleId === "cyc-a1" && S("s-a1-1").slotId === "sl-a1-1");
  T("v1 original wid/slot/cycle/week kept", S("s-a2-1").v1.slot === "sl-a2-1" && S("s-a2-1").v1.cycle === "cyc-a2" && S("s-a2-1").v1.wid === "w-upper" && S("s-a2-1").v1.week === 1
    && !("slot" in S("s-leg1").v1) && S("s-leg1").v1.wid === "w-legacy");
  const w2 = S("s-ac-w2"), w1 = S("s-ac-w1");
  T("entry -> exercise by v1 key", w2.entries[0].exerciseId === pu.id && w1.entries[0].exerciseId === pu.id && w1.entries[3].exerciseId === exOf(actU, "RTO 75° Dip").id);
  T("entry whose key is not in the workout stays unlinked to an exercise, link kept", w2.entries[1].exerciseId === null && w2.entries[1].link === "bwf:horizontal-push/push-up/push-up");
  T("sets/rpe/note/target/block/name preserved", eq(w1.entries[0].sets, ["7", "6", "6", "5"]) && w1.entries[0].rpe === "8" && w1.note === "felt good"
    && w1.entries[0].target === "10" && w1.entries[0].block === "Main 1" && w1.entries[0].name === "Pull Up");
  T("milestones keep the v1 key and gain a link", w1.milestones.length === 2 && w1.milestones[0].key === PU && w1.milestones[0].link === "bwf:vertical-pull/pull-up/pull-up"
    && w1.milestones[1].link === "bwf:dips-l-sit/ring-dip/rto-75-dip");
  T("workoutName", w1.workoutName === "Upper A" && free.workoutName === "Free session");

  // --- positions
  const P = st.positions;
  T("count 0 -> no entry", !("bwf:vertical-pull/pull-up" in P));
  T("mid-ladder N=4 -> rungs[3] (Wide Row)", P["bwf:horizontal-pull/rows"] === "bwf:horizontal-pull/rows/wide-row");
  T("N = ladder length -> last rung", P["bwf:dips-l-sit/dip"] === "bwf:dips-l-sit/dip/l-sit-dip");
  T("N=3 squat -> Full Squat", P["bwf:legs/squat"] === "bwf:legs/squat/full-squat");
  T("N beyond the ladder -> last rung", P["bwf:handstand/handstand"] === "bwf:handstand/handstand/tuck-handstand");
  T("degree-sign position", P["bwf:dips-l-sit/ring-dip"] === "bwf:dips-l-sit/ring-dip/rto-75-dip" && P["bwf:horizontal-pull/front-lever"] === "bwf:horizontal-pull/front-lever/360-pull");
  T("unknown ladder: no position, still in legacy.level", Object.keys(P).length === 6 && st.legacy.level["Bogus/Ladder"] === 2);
  T("legacy verbatim", eq(st.legacy.level, v1.level) && eq(st.legacy.focus, v1.focus) && eq(st.legacy.workouts, v1.workouts) && st.legacy.saved === "2026-10-13");

  // --- collections
  T("one collection, built-in, on", st.collections.length === 1 && st.collections[0].id === "bwf" && st.collections[0].builtin && st.collections[0].on
    && st.collections[0].short === "BWF" && st.collections[0].name === "r/bodyweightfitness Progressions");
  const ring = st.collections[0].categories.filter(c => c.name === "Dips & L-sit")[0].ladders.filter(l => l.name === "Ring dip")[0];
  const chartRing = chart.categories.filter(g => g.g === "Dips & L-sit")[0].ladders.filter(l => l.n === "Ring dip")[0];
  T("rung metadata kept (tier, ms, goal)", ring.rungs.every((x, i) => x.goal === "" && x.ms === !!chartRing.m[i][1] && x.tier === chartRing.m[i][2]));
  const fl = st.collections[0].categories.filter(c => c.name === "Horizontal pull")[0].ladders.filter(l => l.name === "Rows")[0];
  const ic = st.collections[0].categories.filter(c => c.name === "Horizontal pull")[0].ladders.filter(l => l.name === "Iron cross")[0];
  T("ladder prerequisites (from) kept", !fl.from && ic.from && ic.from.length > 0 && ic.from[0].length === 3);
  const allFrom = [];
  chart.categories.forEach(g => g.ladders.forEach(l => (l.from || []).forEach(p => allFrom.push(p.join("|")))));
  const known = new Set();
  chart.categories.forEach(g => g.ladders.forEach(l => l.m.forEach(x => known.add(g.g + "|" + l.n + "|" + x[0]))));
  T("every prerequisite triple resolves on the chart", allFrom.every(k => known.has(k)));

  return { v1, st };
}

function runUnitTests(st, v1) {
  // --- ids
  T("slug: degree signs and accents", Data.slug("RTO 75° Dip") === "rto-75-dip" && Data.slug("360° Pull") === "360-pull" && Data.slug("  Café -- Au Lait ") === "cafe-au-lait");
  const b1 = Data.buildBuiltin(chart), b2 = Data.buildBuiltin(chart);
  T("buildBuiltin is deterministic", eq(b1, b2));
  const shuffled = clone(chart); shuffled.categories.reverse(); shuffled.categories.forEach(g => g.ladders.reverse());
  const id1 = {}, id2 = {};
  b1.categories.forEach(c => c.ladders.forEach(l => l.rungs.forEach(r => { id1[c.name + "|" + l.name + "|" + r.name] = r.id; })));
  Data.buildBuiltin(shuffled).categories.forEach(c => c.ladders.forEach(l => l.rungs.forEach(r => { id2[c.name + "|" + l.name + "|" + r.name] = r.id; })));
  T("rung ids do not depend on chart order", eq(id1, id2));
  const bad = clone(chart); bad.categories[0].ladders[0].m.push(["Wide  Row!", 0, null]);
  T("slug collision inside a ladder is refused", throws(() => Data.buildBuiltin(bad), /Duplicate rung id/));
  const bad2 = clone(chart); bad2.categories[0].ladders[0].m.push(["°°", 0, null]);
  T("empty slug is refused", throws(() => Data.buildBuiltin(bad2), /empty id slug/));

  // --- load: migrate once, never touch v1 keys, idempotent
  const raw = rawFromV1(v1), before = clone(raw);
  const store = fakeStorage(raw);
  const s1 = Data.load(store, chart);
  const writes1 = store.log.slice();
  T("load wrote bwl-v2 and the backup, nothing else", writes1.every(w => w[0] === "set" && (w[1] === "bwl-v2" || w[1] === "bwl-v1-backup")) && writes1.length === 2);
  T("load never removes a key", !store.log.some(w => w[0] === "remove"));
  const afterV1 = {}; Object.keys(before).forEach(k => { afterV1[k] = store.getItem(k); });
  T("every v1 key is byte-identical after load", eq(afterV1, before));
  const backup = JSON.parse(store.getItem("bwl-v1-backup"));
  T("backup holds the raw strings of every v1 key", eq(backup.keys, before) && !!backup.takenAt);
  T("bwl-v2 parses back to the state", eq(JSON.parse(store.getItem("bwl-v2")), s1));
  T("load result passes the audit", audit(v1, s1, { quiet: true }).failed.length === 0);

  // tamper with v1 after the migration: a second load must not re-migrate or notice
  const v2Raw = store.getItem("bwl-v2");
  store.setItem("bwf-log-v1", JSON.stringify([]));
  store.log.length = 0;
  const s2 = Data.load(store, chart);
  T("second load does not re-migrate (v1 changes ignored)", eq(s2, s1) && s2.sessions.length === s1.sessions.length && s2.migratedAt === s1.migratedAt);
  T("second load writes nothing", store.log.length === 0);
  T("bwl-v2 unchanged by second load", store.getItem("bwl-v2") === v2Raw);
  T("v1Drift names the key that changed after migration", eq(Data.v1Drift(store), ["bwf-log-v1"]));
  store.setItem("bwf-log-v1", before["bwf-log-v1"]);
  T("v1Drift is empty when v1 is as it was", Data.v1Drift(store).length === 0);

  // --- failure paths: nothing written to bwl-v2, v1 untouched, clear message
  const corrupt = Object.assign({}, before, { "bwf-log-v1": "{not json" });
  const sc = fakeStorage(corrupt);
  let msg = ""; try { Data.load(sc, chart); } catch (e) { msg = e.message; }
  T("unparseable v1 key: load throws naming the key", /bwf-log-v1/.test(msg) && /intact/.test(msg), msg);
  T("...and bwl-v2 was not written, v1 untouched", sc.getItem("bwl-v2") === null && eq(Object.fromEntries(Object.keys(corrupt).map(k => [k, sc.getItem(k)])), corrupt));
  const sq = fakeStorage(before); const realSet = sq.setItem;
  sq.setItem = (k, v) => { if (k === "bwl-v2") throw new Error("QuotaExceededError"); return realSet(k, v); };
  msg = ""; try { Data.load(sq, chart); } catch (e) { msg = e.message; }
  T("storage full on bwl-v2: load throws, no bwl-v2, v1 intact", /Quota/.test(msg) && sq.getItem("bwl-v2") === null && eq(Object.fromEntries(Object.keys(before).map(k => [k, sq.getItem(k)])), before));
  const sb = fakeStorage(Object.assign({}, before, { "bwl-v2": "{oops" }));
  msg = ""; try { Data.load(sb, chart); } catch (e) { msg = e.message; }
  T("corrupt bwl-v2 is refused and left alone, not re-migrated over", /untouched/.test(msg) && sb.getItem("bwl-v2") === "{oops" && sb.log.length === 0);
  const sx = fakeStorage(Object.assign({}, before, { "bwl-v2": JSON.stringify({ v: 3 }) }));
  T("bwl-v2 of unknown shape is refused", throws(() => Data.load(sx, chart), /unexpected shape/) && sx.log.length === 0);

  // the in-app guard: a state that lost something is caught before it is written
  const lossy = clone(s1); lossy.sessions.pop();
  const lossy2 = clone(s1); lossy2.sessions[3].entries[0].sets[0] = "";
  T("conservationProblems catches a dropped session / set value", Data.conservationProblems(v1, lossy).length > 0 && Data.conservationProblems(v1, lossy2).length > 0
    && Data.conservationProblems(v1, s1).length === 0);

  // --- no v1 data at all
  const se = fakeStorage({});
  const e1 = Data.load(se, chart);
  T("fresh install: only the built-in collection, no sample data", e1.cycles.length === 0 && e1.sessions.length === 0 && e1.collections.length === 1
    && e1.collections[0].id === "bwf" && Object.keys(e1.positions).length === 0 && se.log.length === 1 && se.log[0][1] === "bwl-v2");
  const sSeed = fakeStorage({ "bwf-seeded-v1": "true" });
  T("only the seeded flag counts as no data", Data.load(sSeed, chart).sessions.length === 0);

  // --- helpers on the loaded state (Data.state = the migrated fixture)
  Data.load(fakeStorage(before), chart);
  const ACT = Data.state.cycles.filter(c => c.id === "cyc-act")[0];
  T("activeCycle / endedCycles (newest start first)", Data.activeCycle().id === "cyc-act" && eq(Data.endedCycles().map(c => c.id), ["cyc-a2", "cyc-a1"]));
  T("currentWeek", Data.currentWeek(ACT, "2026-10-14") === 4 && Data.currentWeek(ACT, "2026-09-21") === 1 && Data.currentWeek(ACT, "2026-09-27") === 1
    && Data.currentWeek(ACT, "2026-09-28") === 2 && Data.currentWeek(ACT, "2026-09-01") === 1 && Data.currentWeek(ACT, "2027-03-01") === 6 && Data.currentWeek(null) === 1);
  T("currentWeek accepts a Date and survives a DST change", Data.currentWeek(ACT, new Date(2026, 9, 14)) === 4
    && Data.currentWeek({ start: "2026-03-23", weeks: 6 }, "2026-03-30") === 2 && Data.currentWeek({ start: "2026-10-19", weeks: 6 }, "2026-11-02") === 3);
  T("weekRange (end = Sunday, inclusive)", eq(Data.weekRange(ACT, 1), ["2026-09-21", "2026-09-27"]) && eq(Data.weekRange(ACT, 4), ["2026-10-12", "2026-10-18"]));
  T("sessionFor: completed", Data.sessionFor("cyc-act", 1, "sl-ac-1").id === "s-ac-w1" && Data.sessionFor("cyc-act", 1, "sl-ac-1").completedAt);
  T("sessionFor: draft, and null when none", Data.sessionFor("cyc-act", 4, "sl-ac-2").id === "s-draft" && Data.sessionFor("cyc-act", 1, "sl-ac-2") === null
    && Data.sessionFor("cyc-act", 3, "sl-ac-1") === null);
  T("sessionFor: same workout twice a week resolves per slot", Data.sessionFor("cyc-a2", 1, "sl-a2-1").id === "s-a2-1" && Data.sessionFor("cyc-a2", 1, "sl-a2-2").id === "s-a2-2");
  T("sessionFor: a draft is not 'done'", !Data.sessionFor("cyc-act", 4, "sl-ac-2").completedAt);
  const badge = Data.rungBadge("bwf:vertical-pull/pull-up/pull-up");
  T("rungBadge", badge.short === "BWF" && badge.ladderName === "Pull up" && badge.index1 === 4 && badge.total === 7 && badge.on === true);
  T("findRung / unknown", Data.findRung("bwf:legs/squat/full-squat").index === 2 && Data.findRung("nope") === null && Data.rungBadge("nope") === null);
  T("uid is a non-empty string", typeof Data.uid() === "string" && Data.uid().length >= 5);

  // --- lastValues
  const actU = ACT.workouts.filter(w => w.id === "w-upper")[0];
  const flat = actU.blocks.flatMap(b => b.exercises);
  const puId = flat.filter(e => e.name === "Pull Up")[0].id, cuId = flat.filter(e => e.name === CUSTOM)[0].id;
  T("lastValues: most recent completed, skips deload (99), skips the draft", eq(Data.lastValues("w-upper", puId, null), ["8", "8", "7", "6"]));
  T("lastValues: excludeSessionId", eq(Data.lastValues("w-upper", puId, "s-ac-w2"), ["7", "6", "6", "5"]));
  T("lastValues: fallback to link across cycles, any slot, deload skipped",
    eq(Data.lastValues("w-upper", puId, "s-ac-w1") /* w2 still wins */, ["8", "8", "7", "6"]));
  const keep = Data.state;
  Data.state = clone(keep);
  Data.state.sessions = Data.state.sessions.filter(s => s.id !== "s-ac-w2" && s.id !== "s-ac-w1");
  T("lastValues: link fallback finds s-late (most recent w-upper, deload flag from v1 = true -> skipped) then s-dang", eq(Data.lastValues("w-upper", puId, null), ["6", "6", "6"]));
  Data.state = clone(keep);
  Data.state.sessions.filter(s => s.id === "s-ac-w2")[0].entries[0].exerciseId = null;
  T("lastValues: exact id from further back beats a loose match from more recently", eq(Data.lastValues("w-upper", puId, null), ["7", "6", "6", "5"]));
  Data.state.sessions.filter(s => s.id === "s-ac-w1")[0].entries[0].exerciseId = null;
  T("lastValues: then the link match (most recent wins)", eq(Data.lastValues("w-upper", puId, null), ["8", "8", "7", "6"]));
  Data.state = clone(keep);
  T("lastValues: name fallback when there is no link, and pre-cycle sessions count", eq(Data.lastValues("w-upper", cuId, "s-ac-w1"), ["15", "15"]));
  T("lastValues: unknown workout -> null", Data.lastValues("nope", puId, null) === null);
  const dipId = flat.filter(e => e.name === "Dip")[0].id;
  T("lastValues: exercise with values only in the excluded session -> null", Data.lastValues("w-upper", dipId, "s-ac-w1") === null);
  const sets = Data.lastValues("w-upper", puId, null); sets[0] = "X";
  T("lastValues returns a copy", Data.state.sessions.filter(s => s.id === "s-ac-w2")[0].entries[0].sets[0] === "8");
  Data.state = keep;

  // --- save / export / import
  const stS = fakeStorage(before); Data.load(stS, chart);
  Data.state.positions["bwf:legs/squat"] = "bwf:legs/squat/parallel-squat";
  T("save writes bwl-v2", Data.save() === true && JSON.parse(stS.getItem("bwl-v2")).positions["bwf:legs/squat"].endsWith("parallel-squat"));
  const text = Data.exportJSON(), ex = JSON.parse(text);
  T("exportJSON: v2 state + v1Backup", ex.v === 2 && ex.v1Backup && eq(ex.v1Backup.keys, before) && ex.sessions.length === 17);
  const imp = Data.importJSON(text);
  T("importJSON(v2 export) round-trips and keeps the backup aside", eq(imp, Data.state) && !("v1Backup" in imp) && eq(Data.importedBackup.keys, before));
  const imp1 = Data.importJSON(JSON.stringify({ v: 1, saved: "x", level: v1.level, workouts: v1.workouts, logbook: v1.logbook, focus: v1.focus, cycle: v1.cycle, cycleArchive: v1.cycleArchive }));
  T("importJSON(v1 export) migrates (no draft: exports carry none)", imp1.v === 2 && imp1.cycles.length === 3 && imp1.sessions.length === 16 && Data.importedBackup.keys["v1-export"].length > 100);
  T("importJSON detects v1 by logbook even without v", Data.importJSON(JSON.stringify({ logbook: [], level: {} })).v === 2);
  T("importJSON refuses junk", throws(() => Data.importJSON("nope")) && throws(() => Data.importJSON("[]")) && throws(() => Data.importJSON('{"v":2}')) && throws(() => Data.importJSON('{"x":1}')));
  Data.importJSON(JSON.stringify({ v: 1, logbook: v1.logbook }));
  const prevState = Data.state;
  T("adopt: replaces state, keeps the previous under bwl-v2-prev, backs up the import",
    Data.adopt(Data.importJSON(JSON.stringify({ v: 1, logbook: v1.logbook }))) === true
    && JSON.parse(stS.getItem("bwl-v2-prev")).positions["bwf:legs/squat"].endsWith("parallel-squat")
    && Data.state !== prevState && JSON.parse(stS.getItem("bwl-v2")).sessions.length === 16
    && stS.keys().some(k => k.indexOf("bwl-v1-backup-") === 0));
  T("adopt never touches v1 keys", Object.keys(before).every(k => stS.getItem(k) === before[k]));

  // --- edge shapes
  const dup = Data.migrateV1({ logbook: [
    { id: "x", date: "2026-01-02", name: "A", entries: [ent(PU, "Pull Up", "", "5", ["1"], "")] },
    { id: "x", date: "2026-01-01", name: "B", entries: [ent(PU, "Pull Up", "", "5", ["2"], "")] }, null],
    inProgress: { id: "x", date: "2026-01-03", name: "A", entries: [ent(PU, "Pull Up", "", "5", ["1", "9"], "")] } }, chart);
  T("duplicate session ids: both kept, second renamed, original recorded", dup.sessions.length === 2 && dup.sessions[0].id === "x" && dup.sessions[1].id !== "x" && dup.sessions[1].v1.originalId === "x");
  T("draft with a logbook id: logbook wins, draft parked in v1.inProgressDraft", dup.sessions[0].v1.inProgressDraft.entries[0].sets.length === 2 && dup.sessions[0].completedAt === "2026-01-02");
  T("non-object logbook entries are parked in legacy.rejected", dup.legacy.rejected.length === 1 && dup.legacy.rejected[0].from === "logbook");
  const odd = Data.migrateV1({ cycle: { id: "c", name: "N", weeks: 3, start: "2026-01-05", deload: 2, plan: [{ id: "s", day: "mon", workout: { id: "w", name: "W", items: [it(PU, "5")], role: "x" } }], foo: 1 },
    cycleArchive: [{ id: "c", name: "same id", plan: [] }] }, chart);
  T("duplicate cycle ids are renamed; numeric deload upgraded; extras parked",
    odd.cycles.length === 2 && odd.cycles[0].id === "c" && odd.cycles[1].id !== "c" && odd.cycles[1].v1.originalId === "c" && eq(odd.cycles[1].deload, [2]) && odd.cycles[1].v1.foo === 1 && odd.cycles[1].v1.deload === 2);
  T("old-shape workout (items, no blocks) becomes one block", odd.cycles[1].workouts[0].blocks.length === 1 && odd.cycles[1].workouts[0].blocks[0].exercises.length === 1 && odd.cycles[1].workouts[0].v1.role === "x");
  T("empty export migrates to an empty state", Data.migrateV1({}, chart).sessions.length === 0 && Data.migrateV1(null, chart).cycles.length === 0);

  // --- empty v1 plan: the user's real shape. Sessions logged from the pool as
  // "other sessions", stamped with the cycle, and a plan with nothing in it.
  const emptyPlan = Data.migrateV1({
    workouts: [
      { id: "wp-a", name: "Logged", blocks: [{ id: "b", name: "A", sets: 2, items: [{ key: "Vertical pull|Pull up|Pull Up", target: "10" }] }] },
      { id: "wp-b", name: "Never logged", blocks: [{ id: "b2", name: "A", sets: 2, items: [{ key: "Dips & L-sit|Dip|Dip", target: "10" }] }] }
    ],
    cycle: { id: "c-e", name: "Cycle 1", weeks: 6, start: "2026-09-19", deload: [5], plan: [] },
    logbook: [
      { id: "e2", date: "2026-09-30", wid: "wp-a", slot: null, cycle: "c-e", entries: [{ key: "Vertical pull|Pull up|Pull Up", sets: ["9", "8"] }] },
      { id: "e1", date: "2026-09-23", wid: "wp-a", slot: null, cycle: "c-e", entries: [{ key: "Vertical pull|Pull up|Pull Up", sets: ["8", "8"] }] },
      { id: "e0", date: "2026-09-10", wid: "wp-a", entries: [{ key: "Vertical pull|Pull up|Pull Up", sets: ["7"] }] }
    ]
  }, chart);
  const ce = emptyPlan.cycles[0];
  T("empty plan: only the workout logged in the cycle is brought in, keeping its v1 id",
    ce.workouts.length === 1 && ce.workouts[0].id === "wp-a");
  T("empty plan: one day-less slot, flagged synthesized",
    ce.slots.length === 1 && ce.slots[0].day === "" && ce.slots[0].workoutId === "wp-a" && !!ce.slots[0].v1.synthesized);
  const es = id => emptyPlan.sessions.filter(s => s.id === id)[0];
  T("empty plan: the cycle's sessions attach to that slot, one per week",
    es("e1").slotId === ce.slots[0].id && es("e1").week === 1 && es("e2").slotId === ce.slots[0].id && es("e2").week === 2);
  T("empty plan: entries map to the copied workout's exercises", !!es("e1").entries[0].exerciseId);
  T("empty plan: a pre-cycle session stays outside the cycle", es("e0").cycleId === null && es("e0").slotId === null);
  T("empty plan: the loss check does not count synthesized slots",
    Data.conservationProblems({ cycle: { id: "c-e", plan: [] }, logbook: [] }, { cycles: [ce], sessions: [] }).every(p => !/slots/.test(p)));
  // --- absorbing the day-less slot once the user picks days
  Data.state = emptyPlan;
  T("absorb: nothing happens while the workout has no days", !Data.absorbDaylessSlots(ce) && ce.slots.length === 1);
  ce.slots.push({ id: "d-mon", day: "mon", workoutId: "wp-a" }, { id: "d-thu", day: "thu", workoutId: "wp-a" });
  emptyPlan.sessions.unshift({ id: "clash", cycleId: ce.id, week: 2, slotId: "d-mon", workoutId: "wp-a", completedAt: "x", entries: [], milestones: [] });
  const nSess = emptyPlan.sessions.length;
  T("absorb: day-less slot removed once days exist", Data.absorbDaylessSlots(ce) && ce.slots.map(s => s.id).join() === "d-mon,d-thu");
  T("absorb: sessions move to the earliest free day slot per week",
    es("e1").slotId === "d-mon" && es("e2").slotId === "d-thu" && es("clash").slotId === "d-mon");
  T("absorb: no session lost, original slot recorded, idempotent",
    emptyPlan.sessions.length === nSess && !!es("e1").v1.movedFromSlot && !Data.absorbDaylessSlots(ce));

}

/* ---------- a real export ---------- */
function auditRealFile(file) {
  console.log("\nReal export: " + file);
  let d;
  try { d = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { fails.push("could not read " + file + ": " + e.message); console.log("  cannot read it: " + e.message); return; }
  let v1, v2 = null;
  if (d && d.v === 2) {
    // a v2 export: audit what is on the phone against the v1 data inside its backup
    const keys = d.v1Backup && d.v1Backup.keys;
    if (!keys) { fails.push("v2 export has no v1Backup to audit against"); console.log("  This is a v2 export with no v1Backup, so there is nothing to compare against."); return; }
    v1 = keys["v1-export"] ? JSON.parse(keys["v1-export"]) : Data.v1FromRaw(keys);
    v2 = clone(d); delete v2.v1Backup;
    console.log("  v2 export: auditing the saved v2 state against the v1 data in its backup.");
  } else {
    v1 = d;
    console.log("  v1 export: migrating it and auditing the result.");
    v2 = Data.migrateV1(v1, chart);
  }
  const sumLine = [`${(v1.cycleArchive || []).length + (v1.cycle ? 1 : 0)} cycles`, `${(v1.logbook || []).length} sessions`,
    `${Object.keys(v1.level || {}).length} ladders with progress`, `${(v1.workouts || []).length} pool workouts`].join(", ");
  console.log("  v1 contains: " + sumLine);
  const r = audit(v1, v2, { title: "AUDIT - real export" });
  r.failed.forEach(f => fails.push("REAL EXPORT: " + f.check));
  if (!r.failed.length) console.log("\n  Nothing lost: every row above is ok.");
  else console.log("\n  " + r.failed.length + " check(s) failed - DO NOT DEPLOY until these are explained.");

  // the same data through the real boot path, from raw storage strings
  if (!(d && d.v === 2)) {
    const raw = rawFromV1(v1), before = clone(raw), store = fakeStorage(raw);
    try {
      const s = Data.load(store, chart);
      const same = Object.keys(before).every(k => store.getItem(k) === before[k]);
      const bk = JSON.parse(store.getItem("bwl-v1-backup")).keys;
      const ok = same && eq(bk, before) && audit(v1, s, { quiet: true }).failed.length === 0 && !store.log.some(w => w[0] === "remove");
      console.log("  boot path (Data.load on raw v1 keys): " + (ok ? "ok - v1 keys untouched, backup written" : "FAILED"));
      if (!ok) fails.push("REAL EXPORT: boot path");
    } catch (e) { console.log("  boot path threw: " + e.message); fails.push("REAL EXPORT: boot path threw"); }
  }
}

/* ---------- run ---------- */
module.exports = { audit, buildFixture, rawFromV1, fakeStorage };
if (require.main === module) {
  const { v1, st } = runFixtureTests();
  runUnitTests(st, v1);
  if (process.argv[2]) auditRealFile(process.argv[2]);

  console.log("\n" + (nChecks - fails.length) + " of " + nChecks + " assertions passed" + (fails.length ? ", " + fails.length + " failed:" : "."));
  fails.forEach(f => console.log("  - " + f));
  process.exit(fails.length ? 1 : 0);
}
