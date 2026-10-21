/* Bodyweight Ladders v2 - data layer and the v1 -> v2 migration.

   Classic script (not a module): defines the global `Data`. Node can require it
   (see the last line), which is how tools/test-migration.js exercises it. No DOM
   access; storage is injected into Data.load() as anything with getItem/setItem.

   THE RULE FOR THIS FILE: the user's whole training history lives in
   localStorage on one phone. Nothing here may remove or rewrite a v1 key, and
   the migration may not drop a field it does not understand - leftovers are
   parked under a `v1` property on the object they came from.

   ---- State (one JSON blob under "bwl-v2") ----
   { v:2, migratedAt, cycles, sessions, collections, positions, legacy }
   See docs/v2/SPEC.md "Data model". Deviations from the spec's wording:
     cycle.deload        stays an ARRAY of week numbers (v1 allowed several)
     slot.v1 / *.v1      anything from v1 the v2 shape has no field for
     session.milestones  [{ key, name, link }] - v1 keys kept verbatim, plus the
                         resolved rung id when the key is on the chart
     session.v1          original wid / slot / cycle / week / deload as v1
                         stamped them, plus flags saying what was inferred
     rung.tier / ms / ladder.from   chart metadata, kept on the built-in
     positions           the LAST CLEARED rung (user decision, not the spec)
   Sessions are ordered newest first by convention (v1's order). Anything that
   adds a session should unshift it.

   ---- Public API ----
   load(storage, chartJson)        boot; migrates v1 once, returns Data.state
   save()                          writes Data.state; true / false (Data.lastError)
   migrateV1(v1, chartJson, opts)  pure; v1 export shape (+ optional inProgress)
   buildBuiltin(chartJson)         the built-in "bwf" collection, stable ids
   v1FromRaw(rawKeys)              raw v1 localStorage strings -> v1 export shape
   conservationProblems(v1, v2)    cheap in-app loss check; [] means fine
   exportJSON()                    v2 state + v1Backup, as a string
   importJSON(text)                v2 or v1 export -> new state (not saved);
                                   sets Data.importedBackup
   adopt(state)                    make an imported state current and save it,
                                   keeping the previous state under bwl-v2-prev
   v1Drift(storage)                v1 keys that changed since the backup
   currentWeek(cycle, today?)      1..weeks, arithmetic from start
   weekRange(cycle, wk)            [startISO, endISO] - end is the Sunday, inclusive
   activeCycle() / endedCycles()   the active cycle / ended ones, newest start first
   sessionFor(cycleId, wk, slotId) session (completed preferred over draft) or null
   lastValues(workoutId, exId, excludeSessionId)   "Last 6" source, or null
   lastEntry(workoutId, exId, excludeSessionId)    the whole entry behind it (sets, rpe), or null
   findExercise(exerciseId)        { cycle, workout, block, exercise } or null
   findRung(rungId)                { collection, category, ladder, rung, index } or null
   rungBadge(rungId)               { short, ladderName, index1, total, on, ... } or null
   uid(), slug(s), todayISO(), addDays(iso, n), deepEqual(a, b)
*/
var Data = (function () {
  "use strict";

  var KEY = "bwl-v2";
  var BACKUP_KEY = "bwl-v1-backup";
  var PREV_KEY = "bwl-v2-prev";
  // v1 storage keys, by the name each has in the v1 export. Nothing in here is
  // ever written to or removed - see load().
  var V1_KEYS = {
    level: "bwf-ladders-v3", workouts: "bwf-workouts-v1", logbook: "bwf-log-v1",
    focus: "bwf-focus-v1", inProgress: "bwf-session-v1", cycle: "bwf-cycle-v1",
    cycleArchive: "bwf-cycle-archive-v1", seeded: "bwf-seeded-v1"
  };

  /* ---------- small utilities ---------- */
  function uid() { return (Math.random().toString(36) + "0000000").slice(2, 9); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function str(x) { return x == null ? "" : x; }
  function nonEmpty(v) { return v !== "" && v != null; }
  function anyValue(sets) { return Array.isArray(sets) && sets.some(nonEmpty); }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(function (k) { return own(b, k) && deepEqual(a[k], b[k]); });
  }

  // Keys of obj not in `known`, or null. This is how nothing from v1 is dropped.
  function extras(obj, known) {
    var out = null;
    Object.keys(obj).forEach(function (k) {
      if (known.indexOf(k) < 0) { out = out || {}; out[k] = obj[k]; }
    });
    return out;
  }

  // lowercase, accents folded, everything else to "-". "RTO 75° Dip" -> "rto-75-dip".
  function slug(s) {
    return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  /* ---------- dates ----------
     Everything is "YYYY-MM-DD" strings, and arithmetic goes through UTC so a
     daylight-saving change can never shift a week boundary. */
  function ymdToMs(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }
  function msToYmd(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function addDays(iso, n) { return msToYmd(ymdToMs(iso) + n * 86400000); }
  function localYmd(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function todayISO() { return localYmd(new Date()); }
  function toYmd(x) {
    if (x instanceof Date) return localYmd(x);
    return x ? String(x).slice(0, 10) : todayISO();
  }
  // Unclamped week number of `date` within the cycle (week 1 starts on `start`).
  function rawWeek(cycle, date) {
    var days = (ymdToMs(date) - ymdToMs(cycle.start)) / 86400000;
    return isFinite(days) ? Math.floor(days / 7) + 1 : NaN;
  }
  function clampWeek(cycle, wk) {
    var weeks = Math.max(1, +cycle.weeks || 1);
    return Math.min(Math.max(wk, 1), weeks);
  }
  function currentWeek(cycle, today) {
    if (!cycle) return 1;
    var wk = rawWeek(cycle, toYmd(today));
    return clampWeek(cycle, isFinite(wk) ? wk : 1);
  }
  function weekRange(cycle, wk) {
    var s = addDays(cycle.start, (wk - 1) * 7);
    return [s, addDays(s, 6)];
  }

  /* ---------- the built-in collection ----------
     Ids are derived from names, never from position, so they survive chart
     edits and reordering: bwf:<cat>  bwf:<cat>/<ladder>  bwf:<cat>/<ladder>/<rung>.
     Built once and then stored (the user may edit it); never rebuilt on load. */
  function buildBuiltin(chart) {
    if (!chart || !Array.isArray(chart.categories)) throw new Error("chart.json has no categories");
    var seen = {};
    function claim(id, what, name) {
      if (/(^|[:/])$/.test(id)) throw new Error(what + " " + JSON.stringify(name) + " has an empty id slug");
      if (own(seen, id)) throw new Error("Duplicate " + what + " id " + id + " (" + JSON.stringify(name) + ")");
      seen[id] = 1;
      return id;
    }
    var categories = chart.categories.map(function (g) {
      var cid = claim("bwf:" + slug(g.g), "category", g.g);
      return {
        id: cid, name: g.g,
        ladders: (g.ladders || []).map(function (l) {
          var lid = claim(cid + "/" + slug(l.n), "ladder", l.n);
          var ladder = {
            id: lid, name: l.n,
            rungs: l.m.map(function (x) {
              var rung = { id: claim(lid + "/" + slug(x[0]), "rung", x[0]), name: x[0], goal: "", ms: !!x[1] };
              if (x[2]) rung.tier = x[2];
              return rung;
            })
          };
          if (l.from) ladder.from = clone(l.from);   // [Category, Ladder, Move] triples, as in the chart
          return ladder;
        })
      };
    });
    var coll = { id: "bwf", name: "r/bodyweightfitness Progressions", short: "BWF", builtin: true, on: true, categories: categories };
    if (chart.meta) coll.meta = clone(chart.meta);
    return coll;
  }

  // Lookups by v1's names, for the migration: item key "Cat|Ladder|Move" -> rung,
  // and progress key "Cat/Ladder" -> ladder.
  function indexByNames(coll) {
    var rungByKey = new Map(), ladderByLevelKey = new Map();
    coll.categories.forEach(function (c) {
      c.ladders.forEach(function (l) {
        ladderByLevelKey.set(c.name + "/" + l.name, l);
        l.rungs.forEach(function (r) { rungByKey.set(c.name + "|" + l.name + "|" + r.name, r); });
      });
    });
    return { rungByKey: rungByKey, ladderByLevelKey: ladderByLevelKey };
  }

  function emptyState(chart, now) {
    return { v: 2, migratedAt: now || new Date().toISOString(), cycles: [], sessions: [],
      collections: [buildBuiltin(chart)], positions: {}, legacy: { workouts: [], focus: [], level: {} } };
  }

  /* ---------- v1 workout normalisation ----------
     Mirrors v1's migrate(w) but deletes nothing: v1 threw away `role` and each
     item's `sets`; here they survive as `v1` extras on the v2 objects. */
  function normaliseWorkout(w, fresh) {
    if (!Array.isArray(w.blocks)) {
      w.blocks = [{ id: fresh(), name: "A", items: Array.isArray(w.items) ? w.items : [] }];
      delete w.items;
    }
    w.blocks.forEach(function (b) {
      if (!Array.isArray(b.items)) b.items = [];
      if (b.sets == null)
        b.sets = b.items.length ? Math.max.apply(null, b.items.map(function (i) { return i.sets || 3; })) : 3;
    });
    return w;
  }

  /* ---------- the migration ---------- */
  function migrateV1(v1in, chart, opts) {
    opts = opts || {};
    var now = opts.now || new Date().toISOString();
    var v1 = clone(isObj(v1in) ? v1in : {});      // never touch the caller's object
    var builtin = buildBuiltin(chart);
    var ix = indexByNames(builtin);

    // Every id v1 used, so ids minted here can never collide with one.
    var used = new Set();
    (function walk(x) {
      if (Array.isArray(x)) x.forEach(walk);
      else if (isObj(x)) {
        if (typeof x.id === "string") used.add(x.id);
        Object.keys(x).forEach(function (k) { walk(x[k]); });
      }
    })(v1);
    function fresh() { var s; do { s = uid(); } while (used.has(s)); used.add(s); return s; }

    var rejected = [];   // anything that was not even an object - parked, not dropped
    var poolRaw = Array.isArray(v1.workouts) ? v1.workouts : [];
    var pool = poolRaw.filter(isObj).map(function (w) { return normaliseWorkout(clone(w), fresh); });

    // One v1 workout -> v2. exKeys records each exercise's v1 key, which is the
    // only way to match a session entry back to its exercise afterwards.
    function toV2Workout(w, id, exKeys) {
      var out = {
        id: id, name: str(w.name),
        blocks: w.blocks.map(function (b) {
          var block = {
            id: b.id || fresh(), name: str(b.name), sets: b.sets,
            exercises: b.items.map(function (it) {
              var rung = ix.rungByKey.get(it.key);
              var ex = {
                id: fresh(), name: rung ? rung.name : str(it.key),
                target: str(it.target), note: str(it.note), link: rung ? rung.id : null
              };
              var x = extras(it, ["key", "target", "note"]);
              if (x) ex.v1 = x;
              exKeys.push({ ex: ex, key: it.key });
              return ex;
            })
          };
          var bx = extras(b, ["id", "name", "sets", "items"]);
          if (bx) block.v1 = bx;
          return block;
        })
      };
      var wx = extras(w, ["id", "name", "blocks"]);
      if (wx) out.v1 = wx;
      return out;
    }

    /* -- cycles -- */
    var cycles = [], meta = [], seenCycleIds = new Set(), firstByOrigId = new Map();

    function convertCycle(raw, status) {
      var cyc = isObj(raw) ? raw : {};
      if (!isObj(raw)) rejected.push({ from: "cycle", value: raw });
      var cv1 = {}, cid = cyc.id;
      if (!cid || seenCycleIds.has(cid)) { if (cid) cv1.originalId = cid; cid = fresh(); }
      seenCycleIds.add(cid);
      if (cyc.id && !firstByOrigId.has(cyc.id)) firstByOrigId.set(cyc.id, meta.length);

      var variants = [], slots = [], slotMeta = {}, slotOrder = [], slotIds = new Set();
      (Array.isArray(cyc.plan) ? cyc.plan : []).forEach(function (p0) {
        var p = isObj(p0) ? p0 : {};
        var sv1 = {};
        if (!isObj(p0)) sv1.raw = p0;
        var sid = p.id;
        if (!sid || slotIds.has(sid)) { if (sid) sv1.originalId = sid; sid = fresh(); }
        slotIds.add(sid);

        // v1's migrateCyclePlan: a legacy {wid, day} entry becomes a deep copy of
        // the pool workout. An unresolvable wid leaves the slot with no workout.
        var w = null, origWid = null;
        if (p.workout != null) {
          if (isObj(p.workout)) { w = normaliseWorkout(clone(p.workout), fresh); origWid = w.id == null ? null : w.id; }
          else sv1.workoutRaw = p.workout;
        } else if (p.wid) {
          origWid = p.wid;
          var src = pool.filter(function (x) { return x.id === p.wid; })[0];
          if (src) w = clone(src);
        }
        if (p.wid != null) sv1.wid = p.wid;

        // Identical copies of one workout collapse to a single cycle workout
        // that keeps the v1 id; a copy that was edited becomes its own workout.
        var variant = null;
        if (w) {
          variant = variants.filter(function (v) { return v.origId === origWid && deepEqual(v.norm, w); })[0] || null;
          if (!variant) {
            var vid = origWid && !variants.some(function (v) { return v.v2.id === origWid; }) ? origWid : fresh();
            var exKeys = [];
            variant = { origId: origWid, norm: w, v2: toV2Workout(w, vid, exKeys), exKeys: exKeys };
            variants.push(variant);
          }
        }
        var slot = { id: sid, day: str(p.day), workoutId: variant ? variant.v2.id : null };
        var sx = extras(p, ["id", "day", "workout", "wid"]);
        if (sx) Object.keys(sx).forEach(function (k) { sv1[k] = sx[k]; });
        if (Object.keys(sv1).length) slot.v1 = sv1;
        slots.push(slot);
        slotMeta[sid] = { origWid: origWid, variant: variant };
        slotOrder.push(sid);
      });

      var deload = Array.isArray(cyc.deload) ? cyc.deload.slice()
        : (+cyc.deload > 0 ? [+cyc.deload] : []);
      if (!Array.isArray(cyc.deload) && cyc.deload != null) cv1.deload = cyc.deload;
      var weeks = Math.floor(+cyc.weeks);
      if (!(weeks >= 1)) { weeks = 6; if (cyc.weeks != null) cv1.weeks = cyc.weeks; }
      var cx = extras(cyc, ["id", "name", "weeks", "start", "deload", "plan"]);
      if (cx) Object.keys(cx).forEach(function (k) { cv1[k] = cx[k]; });

      var out = {
        id: cid, name: cyc.name == null ? "Cycle" : cyc.name, objective: "",
        start: str(cyc.start), weeks: weeks, deload: deload,
        workouts: variants.map(function (v) { return v.v2; }), slots: slots,
        status: status, achievements: "", endedAt: null
      };
      if (Object.keys(cv1).length) out.v1 = cv1;
      cycles.push(out);
      meta.push({ v2: out, variants: variants, slotMeta: slotMeta, slotOrder: slotOrder });
    }

    (Array.isArray(v1.cycleArchive) ? v1.cycleArchive : []).forEach(function (c) { convertCycle(c, "ended"); });
    if (isObj(v1.cycle)) convertCycle(v1.cycle, "active");

    /* -- sessions -- */
    var recs = [];
    (Array.isArray(v1.logbook) ? v1.logbook : []).forEach(function (sn, i) {
      if (isObj(sn)) recs.push({ sn: sn, idx: i, draft: false });
      else rejected.push({ from: "logbook", index: i, value: sn });
    });
    if (isObj(v1.inProgress)) {
      var dup = v1.inProgress.id != null
        ? recs.filter(function (r) { return r.sn.id === v1.inProgress.id; })[0] : null;
      // Same id: the logbook copy is the saved one. The draft is kept beside it.
      if (dup) dup.draftV1 = v1.inProgress;
      else recs.unshift({ sn: v1.inProgress, idx: -1, draft: true });
    } else if (v1.inProgress != null) rejected.push({ from: "inProgress", value: v1.inProgress });

    function inWindow(m, ms) {
      var s = ymdToMs(m.v2.start);
      return isFinite(s) && isFinite(ms) && ms >= s && ms < s + m.v2.weeks * 7 * 86400000;
    }

    // Pass 1 - which cycle and week. Order of evidence: the slot's owner, the
    // cycle v1 stamped, then (pre-slot sessions) the cycle whose dates contain
    // the session and whose plan has that workout - which is how v1 matched them.
    recs.forEach(function (r) {
      var sn = r.sn, ms = ymdToMs(sn.date), idx = -1, src = null;
      if (sn.slot) {
        var cands = [];
        meta.forEach(function (m, i) { if (own(m.slotMeta, sn.slot)) cands.push(i); });
        if (cands.length > 1) {
          var byDate = cands.filter(function (i) { return inWindow(meta[i], ms); });
          var byStamp = cands.filter(function (i) { return meta[i].v2.id === sn.cycle || firstByOrigId.get(sn.cycle) === i; });
          cands = byDate.length ? byDate : (byStamp.length ? byStamp : [cands[cands.length - 1]]);
        }
        if (cands.length) { idx = cands[0]; src = "slot"; }
      }
      if (idx < 0 && sn.cycle != null && firstByOrigId.has(sn.cycle)) { idx = firstByOrigId.get(sn.cycle); src = "cycle-field"; }
      if (idx < 0 && sn.wid) {
        var hits = [];
        meta.forEach(function (m, i) {
          var has = m.slotOrder.some(function (s) { return m.slotMeta[s].origWid === sn.wid; });
          if (has && inWindow(m, ms)) hits.push(i);
        });
        if (hits.length) {
          hits.sort(function (a, b) { return ymdToMs(meta[b].v2.start) - ymdToMs(meta[a].v2.start); });
          idx = hits[0]; src = "date-window";
        }
      }
      r.cycleIdx = idx; r.cycleSource = src; r.weekClamped = false;
      if (idx >= 0) {
        var c = meta[idx].v2, wk = rawWeek(c, sn.date);
        if (isFinite(wk)) {
          var cl = clampWeek(c, wk);
          r.weekClamped = cl !== wk; r.week = cl;
        } else r.week = +sn.week >= 1 ? clampWeek(c, +sn.week) : null;
      } else r.week = null;
      r.slotId = sn.slot || null;
    });

    // Pass 1b - a cycle whose v1 plan was EMPTY. v1 let you log any pool workout
    // as an "other session" without planning it, and the user did exactly that:
    // without this, v2 would show the cycle with no workouts and none of its
    // sessions. Bring in each pool workout actually logged in that cycle (and
    // only those - the user's choice), keeping its v1 id so "Last" still finds
    // its history, with one day-less weekly slot. Pass 2 then attaches the
    // sessions to it. Synthesized slots are flagged and excluded from the slot
    // count in the loss checks, since v1 never had them.
    meta.forEach(function (m, i) {
      if (m.slotOrder.length) return;
      var wids = [];
      recs.forEach(function (r) {
        if (r.cycleIdx === i && r.sn.wid && wids.indexOf(r.sn.wid) < 0) wids.push(r.sn.wid);
      });
      wids.forEach(function (wid) {
        var src = pool.filter(function (x) { return x.id === wid; })[0];
        if (!src) return;
        var w = clone(src), exKeys = [];
        var variant = { origId: wid, norm: w, v2: toV2Workout(w, wid, exKeys), exKeys: exKeys };
        m.variants.push(variant);
        m.v2.workouts.push(variant.v2);
        var sid = fresh();
        m.v2.slots.push({ id: sid, day: "", workoutId: wid, v1: { synthesized: "empty v1 plan; workout was logged in this cycle" } });
        m.slotMeta[sid] = { origWid: wid, variant: variant };
        m.slotOrder.push(sid);
      });
    });

    // Pass 2 - a pre-slot session (wid only) completed whichever slot of the
    // right workout v1's loggedThisWeek found. Give it one slot that nothing
    // else has claimed that week, oldest session first, so a workout planned
    // twice a week does not collapse two sessions onto one slot.
    var claimed = new Set();
    function claimKey(r, slotId) { return r.cycleIdx + "|" + r.week + "|" + slotId; }
    recs.forEach(function (r) {
      if (r.slotId && r.cycleIdx >= 0 && own(meta[r.cycleIdx].slotMeta, r.slotId)) claimed.add(claimKey(r, r.slotId));
    });
    recs.slice().sort(function (a, b) {
      var da = String(a.sn.date), db = String(b.sn.date);
      return da < db ? -1 : da > db ? 1 : b.idx - a.idx;
    }).forEach(function (r) {
      if (r.draft || r.slotId || !r.sn.wid || r.cycleIdx < 0 || r.week == null) return;
      var m = meta[r.cycleIdx];
      var free = m.slotOrder.filter(function (s) {
        return m.slotMeta[s].origWid === r.sn.wid && !claimed.has(claimKey(r, s));
      });
      if (free.length) { r.slotId = free[0]; r.slotInferred = true; claimed.add(claimKey(r, free[0])); }
    });

    var seenSessionIds = new Set(), sessions = [];
    var SESSION_KNOWN = ["id", "date", "wid", "slot", "name", "entries", "cycle", "week", "deload", "milestones", "note"];
    var ENTRY_KNOWN = ["key", "name", "block", "target", "note", "sets", "rpe"];

    recs.forEach(function (r) {
      var sn = r.sn, m = r.cycleIdx >= 0 ? meta[r.cycleIdx] : null;
      var slotRec = m && r.slotId && own(m.slotMeta, r.slotId) ? m.slotMeta[r.slotId] : null;
      var variant = slotRec && slotRec.variant
        ? slotRec.variant
        : (m && sn.wid ? m.variants.filter(function (v) { return v.origId === sn.wid; })[0] || null : null);
      var workoutId = slotRec && slotRec.variant ? slotRec.variant.v2.id : (sn.wid || null);

      var sv1 = {};
      ["wid", "slot", "cycle", "week", "deload"].forEach(function (k) { if (own(sn, k)) sv1[k] = sn[k]; });
      var sx = extras(sn, SESSION_KNOWN);
      if (sx) Object.keys(sx).forEach(function (k) { sv1[k] = sx[k]; });
      if (r.cycleSource) sv1.cycleSource = r.cycleSource;
      if (r.weekClamped) sv1.weekClamped = true;
      if (r.slotInferred) sv1.slotInferred = true;
      if (r.draftV1) sv1.inProgressDraft = r.draftV1;

      var sid = sn.id;
      if (!sid || seenSessionIds.has(sid)) { if (sid) sv1.originalId = sid; sid = fresh(); }
      seenSessionIds.add(sid);

      // Entry -> exercise: first unclaimed exercise in that workout with the
      // same v1 key. A key that is no longer in the workout stays unlinked.
      var pending = variant ? variant.exKeys.slice() : [];
      var entries = [];
      var rawEntries = Array.isArray(sn.entries) ? sn.entries : [];
      if (sn.entries != null && !Array.isArray(sn.entries)) sv1.entriesRaw = sn.entries;
      rawEntries.forEach(function (e, i) {
        if (!isObj(e)) { (sv1.badEntries = sv1.badEntries || []).push({ index: i, value: e }); return; }
        var key = typeof e.key === "string" ? e.key : null;
        var rung = key ? ix.rungByKey.get(key) : null;
        var exId = null;
        for (var j = 0; j < pending.length; j++) {
          if (key != null && pending[j].key === key) { exId = pending[j].ex.id; pending.splice(j, 1); break; }
        }
        var ev1 = { key: e.key };
        var ex = extras(e, ENTRY_KNOWN);
        if (ex) Object.keys(ex).forEach(function (k) { ev1[k] = ex[k]; });
        if (e.sets != null && !Array.isArray(e.sets)) ev1.setsRaw = e.sets;
        entries.push({
          exerciseId: exId, name: e.name != null ? e.name : (rung ? rung.name : str(key)),
          link: rung ? rung.id : null, target: str(e.target), note: str(e.note), block: str(e.block),
          sets: Array.isArray(e.sets) ? e.sets.slice() : [], rpe: str(e.rpe), v1: ev1
        });
      });

      var ms = Array.isArray(sn.milestones) ? sn.milestones : [];
      if (sn.milestones != null && !Array.isArray(sn.milestones)) sv1.milestonesRaw = sn.milestones;
      var milestones = ms.map(function (k) {
        var rung = typeof k === "string" ? ix.rungByKey.get(k) : null;
        return { key: k, name: rung ? rung.name : (typeof k === "string" ? (k.split("|")[2] || k) : String(k)), link: rung ? rung.id : null };
      });

      var deload = sn.deload != null ? !!sn.deload
        : (m && r.week != null ? m.v2.deload.indexOf(r.week) >= 0 : false);

      sessions.push({
        id: sid, cycleId: m ? m.v2.id : null, week: r.week, slotId: r.slotId,
        workoutId: workoutId, workoutName: str(sn.name), date: str(sn.date),
        completedAt: r.draft ? null : (sn.date || now), deload: deload,
        entries: entries, milestones: milestones, note: str(sn.note), v1: sv1
      });
    });

    /* -- positions: count N cleared -> the last cleared rung, rungs[N-1] -- */
    var positions = {};
    var level = isObj(v1.level) ? v1.level : {};
    Object.keys(level).forEach(function (k) {
      var ladder = ix.ladderByLevelKey.get(k), n = Math.floor(Number(level[k]));
      if (!ladder || !(n >= 1)) return;
      positions[ladder.id] = ladder.rungs[Math.min(n, ladder.rungs.length) - 1].id;
    });

    var known = ["v", "saved", "level", "workouts", "logbook", "focus", "cycle", "cycleArchive", "inProgress"];
    var legacy = {
      workouts: Array.isArray(v1.workouts) ? clone(v1.workouts) : [],
      focus: Array.isArray(v1.focus) ? clone(v1.focus) : [],
      level: isObj(v1.level) ? clone(v1.level) : {}
    };
    if (v1.saved != null) legacy.saved = v1.saved;
    var lx = extras(v1, known);
    if (lx) legacy.extra = lx;
    if (rejected.length) legacy.rejected = rejected;

    return { v: 2, migratedAt: now, cycles: cycles, sessions: sessions,
      collections: [builtin], positions: positions, legacy: legacy };
  }

  /* ---------- cheap loss check ----------
     Runs inside load() before bwl-v2 is written. tools/test-migration.js has the
     thorough audit; this is the version that can stop a bad migration on the
     phone itself. Returns a list of problems, [] when all is well. */
  function conservationProblems(v1, v2) {
    var p = [];
    function eq(label, a, b) { if (a !== b) p.push(label + ": v1 has " + a + ", v2 has " + b); }
    var arch = Array.isArray(v1.cycleArchive) ? v1.cycleArchive : [];
    var all = arch.concat(isObj(v1.cycle) ? [v1.cycle] : []);
    eq("cycles", all.length, v2.cycles.length);
    eq("slots", all.reduce(function (n, c) { return n + (isObj(c) && Array.isArray(c.plan) ? c.plan.length : 0); }, 0),
      v2.cycles.reduce(function (n, c) { return n + c.slots.filter(function (s) { return !(s.v1 && s.v1.synthesized); }).length; }, 0));
    var log = Array.isArray(v1.logbook) ? v1.logbook.filter(isObj) : [];
    var d = isObj(v1.inProgress) ? v1.inProgress : null;
    var draftSeparate = d && !(d.id != null && log.some(function (s) { return s.id === d.id; }));
    var sess = log.concat(draftSeparate ? [d] : []);
    eq("sessions", sess.length, v2.sessions.length);
    function sum(list, f) { return list.reduce(function (n, x) { return n + f(x); }, 0); }
    var ents = function (s) { return Array.isArray(s.entries) ? s.entries.filter(isObj) : []; };
    eq("non-empty set values",
      sum(sess, function (s) { return sum(ents(s), function (e) { return Array.isArray(e.sets) ? e.sets.filter(nonEmpty).length : 0; }); }),
      sum(v2.sessions, function (s) { return sum(s.entries, function (e) { return e.sets.filter(nonEmpty).length; }); }));
    eq("rpe values", sum(sess, function (s) { return sum(ents(s), function (e) { return nonEmpty(e.rpe) ? 1 : 0; }); }),
      sum(v2.sessions, function (s) { return sum(s.entries, function (e) { return nonEmpty(e.rpe) ? 1 : 0; }); }));
    eq("milestones", sum(sess, function (s) { return Array.isArray(s.milestones) ? s.milestones.length : 0; }),
      sum(v2.sessions, function (s) { return s.milestones.length; }));
    eq("notes", sum(sess, function (s) { return nonEmpty(s.note) ? 1 : 0; }),
      sum(v2.sessions, function (s) { return nonEmpty(s.note) ? 1 : 0; }));
    var ids = new Set(v2.sessions.map(function (s) { return s.id; }));
    sess.forEach(function (s) { if (s.id != null && !ids.has(s.id) && !v2.sessions.some(function (x) { return x.v1 && x.v1.originalId === s.id; })) p.push("session " + s.id + " is missing from v2"); });
    return p;
  }

  /* ---------- reading v1 storage ---------- */
  function readRaw(storage) {
    var raws = {};
    Object.keys(V1_KEYS).forEach(function (name) {
      var v = storage.getItem(V1_KEYS[name]);
      if (v != null) raws[V1_KEYS[name]] = v;
    });
    return raws;
  }
  // A key that exists but will not parse is a stop, not a shrug: v1 treated it
  // as empty, but migrating without it would quietly lose that part of the history.
  function v1FromRaw(raws) {
    var v1 = { v: 1 };
    Object.keys(V1_KEYS).forEach(function (name) {
      var key = V1_KEYS[name];
      if (name === "seeded" || !own(raws, key)) return;
      try { v1[name] = JSON.parse(raws[key]); }
      catch (e) { throw new Error("stored value for " + key + " is not valid JSON (" + e.message + ")"); }
    });
    return v1;
  }
  function hasV1Data(raws) {
    return Object.keys(V1_KEYS).some(function (n) { return n !== "seeded" && own(raws, V1_KEYS[n]); });
  }
  function sameRaws(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(function (k) { return b[k] === a[k]; });
  }
  // The first backup keeps the plain name. A later, different one (v1 was used
  // again after a failed migration, say) goes beside it - nothing is overwritten.
  function putBackup(storage, backup) {
    var existing = storage.getItem(BACKUP_KEY), name = BACKUP_KEY;
    if (existing != null) {
      var prev; try { prev = JSON.parse(existing); } catch (e) { prev = null; }
      if (prev && sameRaws(prev.keys || {}, backup.keys)) return;
      name = BACKUP_KEY + "-" + Date.now();
    }
    var json = JSON.stringify(backup);
    storage.setItem(name, json);
    if (storage.getItem(name) !== json) throw new Error("could not write " + name);
  }

  function isState(st) {
    return isObj(st) && st.v === 2 && Array.isArray(st.cycles) && Array.isArray(st.sessions) &&
      Array.isArray(st.collections) && isObj(st.positions) && isObj(st.legacy);
  }

  /* ---------- load / save ---------- */
  var Data = {
    state: null, storage: null, chart: null, lastError: null, importedBackup: null,
    KEY: KEY, BACKUP_KEY: BACKUP_KEY, V1_KEYS: V1_KEYS
  };

  Data.load = function (storage, chart) {
    Data.storage = storage; Data.chart = chart;
    var raw = storage.getItem(KEY);
    if (raw != null) {                       // already migrated: never again
      var st;
      try { st = JSON.parse(raw); }
      catch (e) { throw new Error("Saved data (" + KEY + ") could not be read and was left untouched: " + e.message); }
      if (!isState(st)) throw new Error("Saved data (" + KEY + ") has an unexpected shape and was left untouched.");
      Data.state = st;
      return st;
    }
    var raws = readRaw(storage), state;
    if (!hasV1Data(raws)) {
      state = emptyState(chart);
    } else {
      try {
        // Copy first. If anything below fails, v1's keys are still exactly as they were.
        putBackup(storage, { takenAt: new Date().toISOString(), keys: raws });
        var v1 = v1FromRaw(raws);
        state = migrateV1(v1, chart);
        var problems = conservationProblems(v1, state);
        if (problems.length) throw new Error("the migration would have lost data - " + problems.join("; "));
      } catch (e) {
        var err = new Error("Couldn't upgrade your saved data: " + e.message +
          ". Nothing was changed - your v1 data is intact. Please export it and send it to be fixed.");
        err.cause = e;
        throw err;
      }
    }
    var json = JSON.stringify(state);
    try {
      storage.setItem(KEY, json);
      if (storage.getItem(KEY) !== json) throw new Error("read-back did not match");
    } catch (e) {
      try { storage.removeItem(KEY); } catch (e2) { /* nothing more to do */ }
      var err2 = new Error("Couldn't save the upgraded data: " + e.message + ". Your v1 data is intact.");
      err2.cause = e;
      throw err2;
    }
    Data.state = state;
    return state;
  };

  Data.save = function () {
    try { Data.storage.setItem(KEY, JSON.stringify(Data.state)); Data.lastError = null; return true; }
    catch (e) { Data.lastError = e; return false; }
  };

  /* ---------- export / import ---------- */
  Data.exportJSON = function () {
    var out = clone(Data.state), b = Data.storage && Data.storage.getItem(BACKUP_KEY);
    var parsed = null;
    if (b != null) { try { parsed = JSON.parse(b); } catch (e) { parsed = { takenAt: null, keys: { raw: b } }; } }
    out.v1Backup = parsed;
    return JSON.stringify(out);
  };

  Data.importJSON = function (text) {
    var d;
    try { d = JSON.parse(text); } catch (e) { throw new Error("That is not valid JSON: " + e.message); }
    if (!isObj(d)) throw new Error("That does not look like a backup.");
    Data.importedBackup = null;
    if (d.v === 2) {
      if (!isState(d)) throw new Error("That v2 backup is missing parts and was not loaded.");
      var s = clone(d);
      Data.importedBackup = s.v1Backup || null;
      delete s.v1Backup;
      return s;
    }
    if (d.v === 1 || own(d, "logbook")) {
      if (!Data.chart) throw new Error("Chart not loaded yet.");
      Data.importedBackup = { takenAt: new Date().toISOString(), keys: { "v1-export": text } };
      return migrateV1(d, Data.chart);
    }
    throw new Error("That does not look like a backup.");
  };

  // The caller has already asked "really replace everything?". The state being
  // replaced is kept under bwl-v2-prev, and an imported v1 backup is kept too.
  Data.adopt = function (state) {
    var s = Data.storage, cur = s.getItem(KEY);
    if (cur != null) s.setItem(PREV_KEY, cur);
    if (Data.importedBackup && Data.importedBackup.keys) putBackup(s, Data.importedBackup);
    Data.state = state;
    return Data.save();
  };

  Data.v1Drift = function (storage) {
    var b = storage.getItem(BACKUP_KEY);
    if (b == null) return [];
    var keys; try { keys = JSON.parse(b).keys || {}; } catch (e) { return []; }
    var now = readRaw(storage), out = [];
    Object.keys(V1_KEYS).forEach(function (n) {
      var k = V1_KEYS[n];
      var was = keys[k] == null ? null : keys[k], is = now[k] == null ? null : now[k];
      if (was === is) return;
      // A v1 page still open in memory re-saves its in-progress session just by
      // resuming it (it flags `resumed`, and `rest` holds the rest timer). That
      // is not new training data, and reporting it would invite the user to
      // replace their v2 data for nothing.
      if (k === V1_KEYS.inProgress && sameSessionIgnoringBookkeeping(was, is)) return;
      out.push(k);
    });
    return out;
  };
  function sameSessionIgnoringBookkeeping(a, b) {
    var x, y;
    try { x = JSON.parse(a); y = JSON.parse(b); } catch (e) { return false; }
    if (!isObj(x) || !isObj(y)) return false;
    delete x.resumed; delete x.rest; delete y.resumed; delete y.rest;
    return deepEqual(x, y);
  }

  /* ---------- queries ---------- */
  Data.activeCycle = function () {
    return Data.state.cycles.filter(function (c) { return c.status === "active"; })[0] || null;
  };
  Data.endedCycles = function () {
    return Data.state.cycles.filter(function (c) { return c.status === "ended"; })
      .sort(function (a, b) { return a.start < b.start ? 1 : a.start > b.start ? -1 : 0; });
  };

  // Most recent first: date, then completedAt (full timestamps beat the bare
  // dates migrated sessions carry), then array position (earlier = newer).
  function recency(a, b) {
    if (a.s.date !== b.s.date) return a.s.date < b.s.date ? 1 : -1;
    var ca = a.s.completedAt || "", cb = b.s.completedAt || "";
    if (ca !== cb) return ca < cb ? 1 : -1;
    return a.i - b.i;
  }
  function indexed(list) { return list.map(function (s, i) { return { s: s, i: i }; }); }

  // A day-less slot exists only because the migration synthesized one for a
  // workout v1 never planned. Once the user gives that workout real days, the
  // day-less slot would show on Week as an extra session. Move its sessions,
  // week by week, onto the workout's day slots (earliest day first, only into
  // a week that slot has nothing logged for), then drop the day-less slot -
  // but only if every one of its sessions found a home. Nothing is deleted.
  // Mutates the cycle and Data.state.sessions; returns true if anything moved.
  var WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  Data.absorbDaylessSlots = function (cycle) {
    if (!cycle || !Array.isArray(cycle.slots)) return false;
    var changed = false, sessions = Data.state.sessions;
    var strays = cycle.slots.filter(function (s) { return WEEKDAYS.indexOf(s.day) < 0; });
    strays.forEach(function (stray) {
      var dayed = cycle.slots.filter(function (s) { return s.workoutId === stray.workoutId && WEEKDAYS.indexOf(s.day) >= 0; })
        .sort(function (a, b) { return WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day); });
      if (!dayed.length || !stray.workoutId) return;
      var mine = sessions.filter(function (s) { return s.cycleId === cycle.id && s.slotId === stray.id; });
      var weeks = [];
      mine.forEach(function (s) { if (weeks.indexOf(s.week) < 0) weeks.push(s.week); });
      var stuck = false;
      weeks.forEach(function (wk) {
        var target = dayed.filter(function (d) {
          return !sessions.some(function (s) { return s.cycleId === cycle.id && s.week === wk && s.slotId === d.id; });
        })[0];
        if (!target) { stuck = true; return; }
        mine.forEach(function (s) {
          if (s.week !== wk) return;
          s.v1 = isObj(s.v1) ? s.v1 : {};
          if (s.v1.movedFromSlot == null) s.v1.movedFromSlot = stray.id;
          s.slotId = target.id;
          changed = true;
        });
      });
      if (!stuck) { cycle.slots.splice(cycle.slots.indexOf(stray), 1); changed = true; }
    });
    return changed;
  };

  Data.sessionFor = function (cycleId, week, slotId) {
    var hits = indexed(Data.state.sessions).filter(function (c) {
      return c.s.cycleId === cycleId && c.s.week === week && c.s.slotId === slotId;
    });
    if (!hits.length) return null;
    hits.sort(function (a, b) {
      var da = a.s.completedAt ? 0 : 1, db = b.s.completedAt ? 0 : 1;
      return da !== db ? da - db : recency(a, b);
    });
    return hits[0].s;
  };

  Data.findExercise = function (exerciseId) {
    if (exerciseId == null) return null;
    var cs = Data.state.cycles;
    for (var a = 0; a < cs.length; a++)
      for (var b = 0; b < cs[a].workouts.length; b++) {
        var w = cs[a].workouts[b];
        for (var c = 0; c < w.blocks.length; c++)
          for (var d = 0; d < w.blocks[c].exercises.length; d++)
            if (w.blocks[c].exercises[d].id === exerciseId)
              return { cycle: cs[a], workout: w, block: w.blocks[c], exercise: w.blocks[c].exercises[d] };
      }
    return null;
  };

  // The entry from last time: its sets give "Last 6", its rpe "Last 8". Most recent completed, non-deload
  // session of the same workout - any slot, any cycle, pre-cycle ones included.
  // Entries are matched by exercise id, then by rung link, then by name, each
  // pass over all candidate sessions before the next, so an exact match from a
  // little further back beats a loose one from yesterday.
  Data.lastEntry = function (workoutId, exerciseId, excludeSessionId) {
    var found = Data.findExercise(exerciseId), ex = found && found.exercise;
    var cands = indexed(Data.state.sessions).filter(function (c) {
      return c.s.completedAt && !c.s.deload && c.s.workoutId === workoutId && c.s.id !== excludeSessionId;
    }).sort(recency);
    function pass(match) {
      for (var i = 0; i < cands.length; i++) {
        var es = cands[i].s.entries.filter(function (e) { return match(e) && anyValue(e.sets); });
        if (es.length) return es[0];
      }
      return null;
    }
    var hit = exerciseId != null ? pass(function (e) { return e.exerciseId === exerciseId; }) : null;
    if (!hit && ex && ex.link) hit = pass(function (e) { return e.link === ex.link; });
    var nm = ex ? String(ex.name).trim().toLowerCase() : "";
    if (!hit && nm) hit = pass(function (e) { return String(e.name).trim().toLowerCase() === nm; });
    return hit;
  };
  Data.lastValues = function (workoutId, exerciseId, excludeSessionId) {
    var en = Data.lastEntry(workoutId, exerciseId, excludeSessionId);
    return en ? en.sets.slice() : null;
  };

  Data.findRung = function (rungId) {
    var cs = Data.state.collections;
    for (var a = 0; a < cs.length; a++)
      for (var b = 0; b < cs[a].categories.length; b++) {
        var cat = cs[a].categories[b];
        for (var c = 0; c < cat.ladders.length; c++) {
          var lad = cat.ladders[c];
          for (var d = 0; d < lad.rungs.length; d++)
            if (lad.rungs[d].id === rungId)
              return { collection: cs[a], category: cat, ladder: lad, rung: lad.rungs[d], index: d };
        }
      }
    return null;
  };
  Data.rungBadge = function (rungId) {
    var f = Data.findRung(rungId);
    if (!f) return null;
    return { short: f.collection.short, ladderName: f.ladder.name, index1: f.index + 1, total: f.ladder.rungs.length,
      rungName: f.rung.name, collectionId: f.collection.id, on: !!f.collection.on };
  };

  Data.migrateV1 = migrateV1;
  Data.buildBuiltin = buildBuiltin;
  Data.v1FromRaw = v1FromRaw;
  Data.conservationProblems = conservationProblems;
  Data.currentWeek = currentWeek;
  Data.weekRange = weekRange;
  Data.uid = uid;
  Data.slug = slug;
  Data.todayISO = todayISO;
  Data.addDays = addDays;
  Data.deepEqual = deepEqual;
  return Data;
})();
if (typeof module === "object") module.exports = Data;
