/* Bodyweight Ladders.
   Ported from the single-file prototype kept at docs/prototype.html.
   Exactly two things changed in the port:
     1. the chart moved out of this file into chart.json  (provenance: CLAUDE.md)
     2. window.storage — a Claude-artifact-only API — became localStorage
   Everything else is the prototype's logic, unchanged. */

/* ---------- chart data ---------- */
// Filled in by initChart() before the first render. "Priority" is a UI tab
// rather than chart data, so it is assembled here and not stored in chart.json.
let CHART = null, DATA = [], groups = [], total = 0, MOVES = [], byKey = {};

const id = (g,n) => g + "/" + n;

async function initChart(){
  const res = await fetch("chart.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("chart.json returned " + res.status);
  CHART = await res.json();

  // normalise ["name", milestone, tier] into objects
  CHART.categories.forEach(g => (g.ladders||[]).forEach(l =>
    l.m = l.m.map(x => ({ n:x[0], ms:!!x[1], tier:x[2] || null }))
  ));

  DATA = [{ g:"Priority", next:true }, ...CHART.categories];
  groups = DATA.filter(d => d.ladders);
  total = groups.reduce((s,g)=> s + g.ladders.reduce((t,l)=> t + l.m.length, 0), 0);

  MOVES = [];
  groups.forEach(g => g.ladders.forEach(l => l.m.forEach((mv,i) =>
    MOVES.push({ g:g.g, l:l.n, n:mv.n, i, ms:mv.ms, key:g.g+"|"+l.n+"|"+mv.n })
  )));
  byKey = Object.fromEntries(MOVES.map(m => [m.key, m]));
}

// The chart's four difficulty tiers, recovered from cell colour. Shown as a
// single muted letter so a rung stays readable at phone width; the footer
// carries the key. Straight Bar Dip isn't on the source chart, so it has none.
const TIER_ABBR = { Beginner:"B", Intermediate:"I", Advanced:"A", Elite:"E" };
const tierTag = t =>
  t && TIER_ABBR[t] ? `<span class="tier" title="${esc(t)}">${TIER_ABBR[t]}</span>` : "";

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
const K = { prog:"bwf-ladders-v3", seeded:"bwf-seeded-v1", work:"bwf-workouts-v1", log:"bwf-log-v1", focus:"bwf-focus-v1", sess:"bwf-session-v1", cycle:"bwf-cycle-v1", cycleArchive:"bwf-cycle-archive-v1" };
let level = {}, workouts = [], logbook = [], focus = [];
// The active cycle (Phase 2) plus a retained-but-unbrowsable archive of earlier
// ones (Phase 3 will make the archive browsable; for now it is just not lost).
let cycle = null, cycleArchive = [];
// TAB_* name the three top-level sections by position, since the tab order
// changed (Week is now first) and several places branch on which is active.
const TAB_WEEK = 0, TAB_PROGRESS = 1, TAB_PLAN = 2;
let topTab = TAB_WEEK, active = 0, msOnly = false, editing = null, session = null;
// weekView switches the Week tab between its three faces: the box row, the
// drill-in logger, and the post-Complete review. reviewData carries what the
// review screen needs, since session is cleared before it is shown.
let weekView = "list", reviewData = null, showHistory = false;
// Plan entry (cycle.plan[].id — the "slot") currently expanded for in-place
// editing in the Plan tab. Only one editor (this, or the legacy pool editor
// below it) is ever mounted at a time — see renderPlan().
let editingSlot = null;
let saveNote = "";
const done = () => Object.values(level).reduce((s,v)=> s + v, 0);
const $ = s => document.getElementById(s) || null;
const uid = () => Math.random().toString(36).slice(2,9);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ---------- storage ----------
   This is the whole reason for the rebuild (HANDOVER §5.1). The prototype used
   window.storage, which exists only inside a Claude artifact, so a downloaded
   copy had nowhere to save. localStorage is per-origin and survives a PWA
   restart and a reboot. get/put keep their async signatures, so every caller
   further down this file is untouched.

   Capacity is ~5 MB per origin; a full logbook is a few KB, so the quota is not
   a practical concern. Data lives only on this device — the export/restore panel
   at the bottom of Build is how it moves. */
const store = (() => {
  try {
    const probe = "__bwf_probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (e) {
    return null;   // private browsing, or site data blocked
  }
})();
if (!store) saveNote = "Storage blocked — nothing will persist";

const stamp = () => new Date().toTimeString().slice(0,5);

async function get(k){
  if (!store) return null;
  try{ const v = store.getItem(k); return v == null ? null : JSON.parse(v); }
  catch(e){ return null; }
}
async function put(k,v){
  if (!store){ saveNote = "Not saved — storage blocked here"; }
  else {
    try{ store.setItem(k, JSON.stringify(v)); saveNote = "Saved " + stamp(); }
    catch(e){ saveNote = "Couldn't save — device storage full?"; }
  }
  const el = $("save"); if (el) el.textContent = saveNote;
}
const saveProg = () => put(K.prog, level);
const saveWork = () => put(K.work, workouts);
const saveLog  = () => put(K.log, logbook);
const saveFocus = () => put(K.focus, focus);
const saveCycle = () => put(K.cycle, cycle);
const saveCycleArchive = () => put(K.cycleArchive, cycleArchive);

/* An in-progress session used to live only in the `session` variable, so
   backgrounding the app long enough for the phone to reclaim the tab threw the
   whole workout away. It is now written on every keystroke. */
function drop(k){ if (store){ try{ store.removeItem(k); }catch(e){} } }
const saveSess = () => { if (session) put(K.sess, session); else drop(K.sess); };
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && session) saveSess();
});

async function loadAll(){
  const [a,b,c,d,seeded,sv,cy,cyA] = await Promise.all([get(K.prog), get(K.work), get(K.log), get(K.focus), get(K.seeded), get(K.sess), get(K.cycle), get(K.cycleArchive)]);
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
  if (cy && typeof cy === "object") cycle = cy;
  if (Array.isArray(cyA)) cycleArchive = cyA;
  workouts.forEach(migrate);
  migrateCyclePlan(cycle);
  cycleArchive.forEach(migrateCyclePlan);
  if (workouts.length && !editing) editing = workouts[0].id;
  resumeSession(sv);
  renderAll();
}

// A session left running when the app was killed comes back where it was. Open
// on it too — if you are mid-workout, hunting for the Week tab is the friction.
function resumeSession(sv){
  if (!sv || !Array.isArray(sv.entries)) return;
  session = sv;
  session.resumed = true;
  if (session.rest && session.rest.end <= Date.now()) delete session.rest;
  topTab = TAB_WEEK;
  weekView = "logger";
}

/* ---------- in-place confirm ----------
   window.confirm() is silently suppressed by Chrome on origins where the user
   (or the OS) has dismissed enough dialogs, and it then returns false — so a
   destructive button just does nothing, with no sign anything is wrong. That
   is what was happening to "Delete workout" on the phone. Replaced everywhere
   it guarded a destructive action with a two-step press in place: first press
   swaps the control to "Really <do the thing>?" plus a Cancel; second press
   (or the original key pressed again) acts; either Cancel or ~5s of nothing
   reverts it. Only one control is ever armed at a time. */
let confirmArmed = null, confirmTimer = null;
function disarmConfirm(){
  confirmArmed = null;
  if (confirmTimer){ clearTimeout(confirmTimer); confirmTimer = null; }
}
function armConfirm(key, onRender){
  confirmArmed = key;
  if (confirmTimer) clearTimeout(confirmTimer);
  confirmTimer = setTimeout(() => { confirmArmed = null; onRender(); }, 5000);
  onRender();
}
// A ready-made two-step button for the common case: a control that just needs
// to become "Really …?" + Cancel, then call onConfirm(). onRender is whatever
// redraws the screen this control lives on — needed so the armed/disarmed
// label actually shows, and safe here because none of these buttons sit next
// to unsaved free-text state (see the bespoke handling on the backup-restore
// and Clear-everything buttons, which do, and so avoid this helper).
function confirmBtn(opts){
  const armed = confirmArmed === opts.key;
  const wrap = document.createElement("span");
  wrap.className = "confirmwrap";
  const b = document.createElement("button");
  b.type = "button";
  b.className = (opts.className || "btn mini") + (armed ? " danger" : "");
  b.textContent = armed ? (opts.armedLabel || "Really?") : opts.label;
  b.setAttribute("aria-label", armed ? (opts.armedLabel || "Really?") : (opts.ariaLabel || opts.label));
  b.onclick = () => {
    if (armed){ disarmConfirm(); opts.onConfirm(); }
    else armConfirm(opts.key, opts.onRender);
  };
  wrap.appendChild(b);
  if (armed){
    const c = document.createElement("button");
    c.type = "button"; c.className = "btn mini";
    c.textContent = "Cancel";
    c.onclick = () => { disarmConfirm(); opts.onRender(); };
    wrap.appendChild(c);
  }
  return wrap;
}

/* ---------- ladders ---------- */
function tap(key, i){
  const cur = level[key] || 0;
  level[key] = (i < cur) ? i : i + 1;
  if (!level[key]) delete level[key];
  saveProg(); renderAll();
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
    b.innerHTML = `<span class="t">${esc(mv.n)}</span>${tierTag(mv.tier)}<span class="rx">${target(mv.n)}</span>`;
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
    x.onclick = () => { focus = focus.filter(f => f !== k); saveFocus(); renderLadders(); };
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
      focus.push(sel.value); saveFocus(); renderLadders();
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
      b.innerHTML = `<span class="t">${esc(rg.n)}</span>${tierTag(rg.tier)}<span class="rx">${target(rg.n)}</span>`;
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
      b.onclick = () => { focus.push(k); saveFocus(); renderLadders(); };
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
  // One dropdown swaps between Priority and the eight chart categories,
  // instead of nine peer tabs that wrapped to ~157px at phone width.
  const tabs = $("tabs");
  if (!tabs) return;
  tabs.innerHTML = "";
  const sel = document.createElement("select");
  sel.setAttribute("aria-label", "Ladder view");
  sel.innerHTML = DATA.map((g,i) => {
    let label = g.g;
    if (!g.next){
      const t = g.ladders.reduce((s,l)=> s + l.m.length, 0);
      const c = g.ladders.reduce((s,l)=> s + (level[id(g.g,l.n)]||0), 0);
      label += ` (${c}/${t})`;
    }
    return `<option value="${i}"${i === active ? " selected" : ""}>${esc(label)}</option>`;
  }).join("");
  sel.onchange = () => { active = +sel.value; renderLadders(); };
  tabs.appendChild(sel);
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
  delete w.role; // Dev/Maint was dropped — see CLAUDE.md corrective pass, item 3
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

// w/save are threaded through explicitly (rather than derived from the global
// `editing`) because there are now two places a workout gets edited: the pool
// (workouts, saved with saveWork) and a cycle plan entry's own embedded copy
// (saved with saveCycle) — see the "cycles own their workouts" note below.
function moveBlock(w, save, from, to){
  if (!w || from === to || to == null) return;
  const [b] = w.blocks.splice(from, 1);
  w.blocks.splice(to > from ? to - 1 : to, 0, b);
  carryBlock = null;
  save(); renderPlan();
}

function pickerEl(w, save, block){
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
  xSel.onchange = () => { if (xSel.value && addItem(block, xSel.value, w)){ save(); renderPlan(); } };
  wrap.append(tSel, xSel);
  return wrap;
}

function moveItem(w, save, fromB, fromI, toB, toI){
  if (!w) return;
  const it = w.blocks[fromB].items[fromI];
  if (!it) return;
  w.blocks[fromB].items.splice(fromI, 1);
  const dest = w.blocks[toB].items;
  if (toI == null || toI > dest.length) toI = dest.length;
  if (fromB === toB && fromI < toI) toI--;
  dest.splice(toI, 0, it);
  carrying = null;
  save(); renderPlan();
}

function addItem(block, key, w){
  const m = byKey[key];
  if (!m || (w && hasItem(w, key))) return false;
  const t = itemTarget(m.n);
  if (block.sets == null) block.sets = parseTarget(target(m.n)).sets || 3;
  block.items.push({ key, target: t });
  return true;
}

function itemsTable(w, save, block, bi){
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
    tr.ondragend = () => { carrying = null; renderPlan(); };
    tr.ondragover = ev => { ev.preventDefault(); ev.stopPropagation(); };
    tr.ondrop = ev => {
      ev.preventDefault(); ev.stopPropagation();
      if (carryBlock !== null) moveBlock(w, save, carryBlock, bi);
      else if (carrying) moveItem(w, save, carrying.bi, carrying.ii, bi, idx);
    };
    const tdG = document.createElement("td");
    tdG.className = "gripcell";
    const grip = document.createElement("button");
    grip.className = "grip"; grip.type = "button"; grip.textContent = "⠿";
    grip.setAttribute("aria-label", "Move " + m.n + " to another block");
    grip.onclick = () => {
      carrying = (carrying && carrying.bi === bi && carrying.ii === idx) ? null : { bi, ii: idx };
      renderPlan();
    };
    tdG.appendChild(grip);
    tr.appendChild(tdG);
    const tdN = document.createElement("td");
    tdN.innerHTML = `<span class="mvname">${esc(m.n)}</span><br><span class="sub">${esc(m.g)} &middot; ${esc(m.l)}</span>`;
    tr.appendChild(tdN);
    const tdT = document.createElement("td");
    const inT = document.createElement("input");
    inT.className = "tin"; inT.value = it.target; inT.setAttribute("aria-label","Target");
    inT.onchange = () => { it.target = inT.value; save(); };
    tdT.appendChild(inT);
    const tdNote = document.createElement("td");
    tdNote.className = "notecell";
    const inN = document.createElement("input");
    inN.className = "tin"; inN.value = it.note || "";
    inN.placeholder = "tempo, grip, cue…";
    inN.setAttribute("aria-label", "Notes for " + m.n);
    inN.onchange = () => { it.note = inN.value; save(); };
    tdNote.appendChild(inN);
    const tdX = document.createElement("td");
    tdX.className = "rm";
    const bx = document.createElement("button");
    bx.className = "x"; bx.type = "button"; bx.innerHTML = "&times;";
    bx.setAttribute("aria-label", "Remove " + m.n);
    bx.onclick = () => { block.items.splice(idx,1); save(); renderPlan(); };
    tdX.appendChild(bx);
    tr.append(tdT, tdNote, tdX);
    body.appendChild(tr);
  });
  tb.appendChild(body);
  return tb;
}

function blockEl(w, save, block, bi){
  const sec = document.createElement("div");
  const isSrc = (carrying && carrying.bi === bi) || carryBlock === bi;
  const held = carrying || carryBlock !== null;
  sec.className = "block" + (block.items.length > 1 ? " super" : "")
    + (held && !isSrc ? " target" : "") + (carryBlock === bi ? " lifted" : "");
  sec.ondragover = ev => { ev.preventDefault(); sec.classList.add("over"); };
  sec.ondragleave = () => sec.classList.remove("over");
  sec.ondrop = ev => {
    ev.preventDefault(); sec.classList.remove("over");
    if (carryBlock !== null) moveBlock(w, save, carryBlock, bi);
    else if (carrying) moveItem(w, save, carrying.bi, carrying.ii, bi, null);
  };
  const head = document.createElement("div");
  head.className = "bhead";
  const bg = document.createElement("button");
  bg.className = "grip"; bg.type = "button"; bg.textContent = "⠿";
  bg.draggable = true;
  bg.setAttribute("aria-label", "Reorder block " + block.name);
  bg.ondragstart = ev => { carryBlock = bi; ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", block.name); };
  bg.ondragend = () => { carryBlock = null; renderPlan(); };
  bg.onclick = () => { carryBlock = carryBlock === bi ? null : bi; carrying = null; renderPlan(); };
  const nm = document.createElement("input");
  nm.className = "bname"; nm.value = block.name; nm.setAttribute("aria-label","Block name");
  nm.oninput = () => { block.name = nm.value; save(); };
  const setWrap = document.createElement("label");
  setWrap.className = "bsets";
  const inB = document.createElement("input");
  inB.type = "number"; inB.min = 1; inB.max = 12; inB.className = "num";
  inB.value = block.sets == null ? 3 : block.sets;
  inB.setAttribute("aria-label", "Sets for block " + block.name);
  inB.onchange = () => { block.sets = Math.max(1, +inB.value || 1); save(); };
  setWrap.append(inB, document.createTextNode(block.items.length > 1 ? " rounds" : " sets"));
  const sub = document.createElement("span");
  sub.className = "sub";
  sub.textContent = block.items.length > 1
    ? "Superset — alternate through, rest after each round"
    : block.items.length ? "One exercise" : "Empty";
  head.append(bg, nm, setWrap, sub);
  if (w.blocks.length > 1){
    if (block.items.length){
      // Two-step in place, not window.confirm — see the "in-place confirm" note.
      head.appendChild(confirmBtn({
        key: "rmblock:" + block.id,
        label: "×", ariaLabel: "Remove block " + block.name,
        armedLabel: "Really remove " + block.name + "?",
        className: "x",
        onConfirm: () => { w.blocks.splice(bi,1); save(); renderPlan(); },
        onRender: renderPlan
      }));
    } else {
      const rm = document.createElement("button");
      rm.className = "x"; rm.type = "button"; rm.textContent = "×";
      rm.setAttribute("aria-label", "Remove block " + block.name);
      rm.onclick = () => { w.blocks.splice(bi,1); save(); renderPlan(); };
      head.appendChild(rm);
    }
  }
  if (held && !isSrc){
    const drop = document.createElement("button");
    drop.className = "btn mini drophere";
    drop.textContent = carryBlock !== null ? "Move above" : "Drop here";
    drop.onclick = () => carryBlock !== null
      ? moveBlock(w, save, carryBlock, bi)
      : moveItem(w, save, carrying.bi, carrying.ii, bi, null);
    head.appendChild(drop);
  }
  sec.appendChild(head);
  if (block.items.length) sec.appendChild(itemsTable(w, save, block, bi));
  sec.appendChild(pickerEl(w, save, block));
  return sec;
}

// Builds the "Add block" / "Add my next rungs" block for whichever workout is
// being edited — the pool's or a cycle plan entry's own embedded copy. Shared
// so the logic (and the ladder-progress fallback) lives in exactly one place.
function nextRungsBlock(w){
  const block = { id: uid(), name: letter(w.blocks.length), sets: 3, items: [] };
  groups.forEach(g => g.ladders.forEach(l => {
    if (!(level[id(g.g,l.n)] || 0)) return;
    const r = nextRung(g, l);
    if (r) addItem(block, g.g+"|"+l.n+"|"+r.n, w);
  }));
  if (!block.items.length) ["Horizontal pull|Rows","Vertical pull|Pull up","Dips & L-sit|Dip","Horizontal push|Push up","Legs|Squat","Core|Plank"]
    .forEach(k => { const [gn,ln] = k.split("|"); const l = findLadder(gn,ln); if (l) addItem(block, gn+"|"+ln+"|"+l.m[0].n, w); });
  return block.items.length ? block : null;
}

function renderBuild(){
  workouts.forEach(migrate);
  const list = $("wlist");
  list.innerHTML = "";
  if (!workouts.length) list.innerHTML = '<li style="cursor:default;color:var(--muted);border:0">No workouts yet.</li>';
  workouts.forEach(w => {
    const li = document.createElement("li");
    li.setAttribute("aria-current", w.id === editing);
    li.innerHTML = `<span class="wn">${esc(w.name)}</span>`;
    li.insertAdjacentHTML("beforeend", `<span class="wc">${allItems(w).length}</span>`);
    li.onclick = () => { editing = w.id; renderBuild(); };
    list.appendChild(li);
  });

  const ed = $("weditor");
  ed.innerHTML = "";
  const w = workouts.find(x => x.id === editing);
  if (!w){
    ed.innerHTML = '<p class="empty">Make a workout and it becomes something you can log against. Exercises are picked from the ladders, so each one arrives with its target already set. Group them into blocks to run a pair as a superset. This pool is a legacy/importable set — the "Import into plan" picker in Plan copies from it, but a cycle keeps its own copy of what it imports, so nothing here can move the ground under an active cycle.</p>';
    ed.appendChild(transferEl());
    return;
  }
  const save = saveWork;

  const name = document.createElement("input");
  name.className = "name"; name.value = w.name; name.setAttribute("aria-label","Workout name");
  name.oninput = () => { w.name = name.value; save();
    const li = [...list.children][workouts.indexOf(w)];
    if (li && li.querySelector) li.querySelector(".wn").textContent = w.name; };
  ed.appendChild(name);

  if (carryBlock !== null && w.blocks[carryBlock]){
    const bar = document.createElement("div");
    bar.className = "carry";
    bar.innerHTML = `<span>Moving block <b>${esc(w.blocks[carryBlock].name)}</b> — drag it, or pick where it goes.</span>`;
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.onclick = () => { carryBlock = null; renderPlan(); };
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
      cancel.onclick = () => { carrying = null; renderPlan(); };
      bar.appendChild(cancel);
      ed.appendChild(bar);
    } else carrying = null;
  }
  w.blocks.forEach((b,bi) => ed.appendChild(blockEl(w, save, b, bi)));

  const add = document.createElement("div");
  add.className = "adder";
  const nb = document.createElement("button");
  nb.className = "btn"; nb.textContent = "Add block";
  nb.onclick = () => {
    w.blocks.push({ id: uid(), name: letter(w.blocks.length), sets: 3, items: [] });
    save(); renderPlan();
  };
  const fill = document.createElement("button");
  fill.className = "btn"; fill.textContent = "Add my next rungs";
  fill.onclick = () => {
    const block = nextRungsBlock(w);
    if (block) w.blocks.push(block);
    save(); renderPlan();
  };
  const del = confirmBtn({
    key: "delworkout:" + w.id,
    label: "Delete workout", ariaLabel: "Delete " + w.name,
    armedLabel: "Really delete " + w.name + "?",
    className: "btn",
    onConfirm: () => {
      workouts = workouts.filter(x => x.id !== w.id);
      editing = workouts.length ? workouts[0].id : null;
      save(); renderPlan();
    },
    onRender: renderPlan
  });
  add.append(nb, fill, del);
  ed.appendChild(add);
  ed.appendChild(transferEl());
}

/* ---------- cycle ----------
   One active cycle at a time. Every week of it runs the same ordered set of
   workouts — that order is what the Week tab draws as its row of boxes.
   Starting a new cycle keeps the old one under a separate key (nothing is
   lost) but does not make it browsable; that is Phase 3. */
const DAY_ABBR = { mon:"Mon", tue:"Tue", wed:"Wed", thu:"Thu", fri:"Fri", sat:"Sat", sun:"Sun" };

function cycleWeek(cyc){
  if (!cyc || !cyc.start) return 1;
  const start = new Date(cyc.start + "T00:00:00");
  const today = new Date(new Date().toISOString().slice(0,10) + "T00:00:00");
  const days = Math.floor((today - start) / 86400000);
  let wk = Math.floor(days / 7) + 1;
  if (wk < 1) wk = 1;                 // before the cycle starts: treat as week 1
  if (wk > cyc.weeks) wk = cyc.weeks; // past the end: clamp to the last week
  return wk;
}
function currentWeekInfo(){
  if (!cycle) return null;
  const wk = cycleWeek(cycle);
  return { wk, deload: cycle.deload.includes(wk) };
}
function weekRangeFor(cyc, wk){
  const start = new Date(cyc.start + "T00:00:00");
  const s = new Date(start.getTime() + (wk - 1) * 7 * 86400000);
  return [s, new Date(s.getTime() + 7 * 86400000)];
}
function dateInRange(dateStr, s, e){
  const d = new Date(dateStr + "T00:00:00");
  return d >= s && d < e;
}
// A Week box reads "Completed" when a saved session for that plan slot falls
// in this week's date window — checked by date, not by the cycle/week stamped
// on the session at save time, so editing a session's date still moves it.
// Matched by slot (the plan entry's own id) so two boxes for the same workout
// in one week complete independently; legacyWid (the slot's embedded
// workout's original pool id) catches sessions logged before slots existed.
function loggedThisWeek(slotId, wk, legacyWid){
  if (!cycle) return null;
  const [s,e] = weekRangeFor(cycle, wk);
  return logbook.find(sn => dateInRange(sn.date, s, e) &&
    (sn.slot === slotId || (!sn.slot && legacyWid && sn.wid === legacyWid))) || null;
}

// Old cycle data (before a cycle owned deep copies of its own workouts, see
// CLAUDE.md corrective pass, item 4) stored plan entries as {wid, day}
// pointing into the pool. Upgrades those to {id, day, workout} in place by
// deep-copying from the pool once, at load time — from then on this cycle is
// unaffected by pool edits, same as one built under the new format. A wid
// that no longer resolves is left with no workout at all; every renderer
// already treats a slot with no workout as "fade this row", not a crash.
function migrateCyclePlan(cyc){
  if (!cyc || !Array.isArray(cyc.plan)) return;
  cyc.plan.forEach(p => {
    if (!p.id) p.id = uid();
    if (!p.workout && p.wid){
      const src = workouts.find(x => x.id === p.wid);
      p.workout = src ? JSON.parse(JSON.stringify(src)) : null;
    }
    delete p.wid;
  });
}

function newCycleDraft(){
  return { id: uid(), name: "Cycle " + (cycleArchive.length + 1), weeks: 6,
    start: new Date().toISOString().slice(0,10), deload: [], plan: [] };
}
// Confirmation (when there's an existing cycle to archive) is the caller's
// job now — see the confirmBtn wired up around "Start a different cycle" and
// the plain call from the first-time "Start a cycle" button below.
function startNewCycle(){
  if (cycle) cycleArchive.push(cycle);
  cycle = newCycleDraft();
  editingSlot = null; carrying = null; carryBlock = null;
  saveCycle(); saveCycleArchive();
  renderAll();
}

// The workout embedded in a plan entry, guarded against a malformed or
// missing copy (a backup restored from an older format, say) so one bad
// entry fades that row instead of throwing and blanking the whole tab.
function slotWorkout(p){
  return p && p.workout && Array.isArray(p.workout.blocks) ? p.workout : null;
}

function planListEl(){
  const box = document.createElement("div");
  box.className = "planlist";
  box.insertAdjacentHTML("beforeend", "<h3>Plan — the same workouts every week</h3>");
  if (!cycle.plan.length)
    box.insertAdjacentHTML("beforeend", '<p class="empty">Nothing in the plan yet — import a workout below.</p>');
  const DAY_OPTS = ["", "mon","tue","wed","thu","fri","sat","sun"];
  cycle.plan.forEach((p,i) => {
    const w = slotWorkout(p);
    const row = document.createElement("div");
    row.className = "planrow";
    const nmS = document.createElement("span");
    nmS.className = "wn";
    nmS.textContent = w ? w.name : "(missing workout)";
    row.appendChild(nmS);
    const daySel = document.createElement("select");
    daySel.setAttribute("aria-label", "Weekday for " + (w ? w.name : "this entry"));
    daySel.innerHTML = DAY_OPTS.map(d =>
      `<option value="${d}"${(p.day || "") === d ? " selected" : ""}>${d ? DAY_ABBR[d] : "No day"}</option>`).join("");
    daySel.onchange = () => { p.day = daySel.value || null; saveCycle(); };
    row.appendChild(daySel);
    const up = document.createElement("button");
    up.type = "button"; up.className = "btn mini"; up.textContent = "↑"; up.disabled = i === 0;
    up.setAttribute("aria-label", "Move " + (w ? w.name : "entry") + " earlier in the week");
    up.onclick = () => { cycle.plan.splice(i - 1, 0, cycle.plan.splice(i, 1)[0]); saveCycle(); renderCycleSetup(); };
    row.appendChild(up);
    const down = document.createElement("button");
    down.type = "button"; down.className = "btn mini"; down.textContent = "↓"; down.disabled = i === cycle.plan.length - 1;
    down.setAttribute("aria-label", "Move " + (w ? w.name : "entry") + " later in the week");
    down.onclick = () => { cycle.plan.splice(i + 1, 0, cycle.plan.splice(i, 1)[0]); saveCycle(); renderCycleSetup(); };
    row.appendChild(down);
    if (w){
      const ed = document.createElement("button");
      ed.type = "button"; ed.className = "btn mini";
      ed.textContent = editingSlot === p.id ? "Done editing" : "Edit";
      ed.setAttribute("aria-label", (editingSlot === p.id ? "Done editing " : "Edit ") + w.name);
      ed.onclick = () => {
        carrying = null; carryBlock = null;
        editingSlot = editingSlot === p.id ? null : p.id;
        renderPlan();
      };
      row.appendChild(ed);
    }
    const rm = document.createElement("button");
    rm.type = "button"; rm.className = "x"; rm.innerHTML = "&times;";
    rm.setAttribute("aria-label", "Remove " + (w ? w.name : "entry") + " from the plan");
    rm.onclick = () => {
      cycle.plan.splice(i, 1);
      if (editingSlot === p.id) editingSlot = null;
      saveCycle(); renderPlan();
    };
    row.appendChild(rm);
    box.appendChild(row);
    if (w && editingSlot === p.id) box.appendChild(slotEditorEl(p));
  });

  const add = document.createElement("div");
  add.className = "adder";
  // Importing deep-copies the pool workout into a new plan entry, so the
  // cycle owns it from that point on — see CLAUDE.md corrective pass, item 4.
  // The pool is otherwise just a legacy/importable set, and the same workout
  // can be imported more than once (item 5): two boxes for it in one week
  // complete independently, keyed by this entry's own id, not the workout's.
  const sel = document.createElement("select");
  sel.setAttribute("aria-label", "Workout to import into the plan");
  sel.innerHTML = workouts.length
    ? workouts.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join("")
    : '<option value="">No workouts in the pool yet</option>';
  const ab = document.createElement("button");
  ab.type = "button"; ab.className = "btn mini"; ab.textContent = "Import into plan";
  ab.disabled = !workouts.length;
  ab.onclick = () => {
    const src = workouts.find(x => x.id === sel.value);
    if (!src) return;
    cycle.plan.push({ id: uid(), day: null, workout: JSON.parse(JSON.stringify(src)) });
    saveCycle(); renderPlan();
  };
  add.append(sel, ab);
  box.appendChild(add);
  return box;
}

// In-place editor for one plan entry's own embedded workout copy — reuses the
// same block/item builder as the pool editor (blockEl/itemsTable/pickerEl),
// just pointed at p.workout and saved with saveCycle instead of saveWork.
function slotEditorEl(p){
  const w = p.workout, save = saveCycle;
  const wrap = document.createElement("div");
  wrap.className = "editor slotEditor";

  const nameIn = document.createElement("input");
  nameIn.className = "name"; nameIn.value = w.name; nameIn.setAttribute("aria-label","Workout name");
  nameIn.oninput = () => {
    w.name = nameIn.value; save();
    const rowLabel = wrap.previousElementSibling && wrap.previousElementSibling.querySelector(".wn");
    if (rowLabel) rowLabel.textContent = w.name;
  };
  wrap.appendChild(nameIn);

  if (carryBlock !== null && w.blocks[carryBlock]){
    const bar = document.createElement("div");
    bar.className = "carry";
    bar.innerHTML = `<span>Moving block <b>${esc(w.blocks[carryBlock].name)}</b> — drag it, or pick where it goes.</span>`;
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.onclick = () => { carryBlock = null; renderPlan(); };
    bar.appendChild(cancel);
    wrap.appendChild(bar);
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
      cancel.onclick = () => { carrying = null; renderPlan(); };
      bar.appendChild(cancel);
      wrap.appendChild(bar);
    } else carrying = null;
  }
  w.blocks.forEach((b,bi) => wrap.appendChild(blockEl(w, save, b, bi)));

  const add = document.createElement("div");
  add.className = "adder";
  const nb = document.createElement("button");
  nb.className = "btn"; nb.textContent = "Add block";
  nb.onclick = () => {
    w.blocks.push({ id: uid(), name: letter(w.blocks.length), sets: 3, items: [] });
    save(); renderPlan();
  };
  const fill = document.createElement("button");
  fill.className = "btn"; fill.textContent = "Add my next rungs";
  fill.onclick = () => {
    const block = nextRungsBlock(w);
    if (block) w.blocks.push(block);
    save(); renderPlan();
  };
  add.append(nb, fill);
  wrap.appendChild(add);
  return wrap;
}

function renderCycleSetup(){
  const el = $("cyclesetup");
  if (!el) return;
  el.innerHTML = "";

  if (!cycle){
    const box = document.createElement("div");
    box.className = "start";
    box.innerHTML = `<h3>Set up a cycle</h3>
      <p>Name it, give it a length and a start date, then pick the workouts that repeat every
         week of it. Week and history read from this.</p>`;
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn solid"; b.textContent = "Start a cycle";
    b.onclick = startNewCycle;
    box.appendChild(b);
    el.appendChild(box);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "cyclebox";

  const row1 = document.createElement("div");
  row1.className = "adder";
  const nm = document.createElement("input");
  nm.className = "tin"; nm.style.width = "180px"; nm.value = cycle.name;
  nm.setAttribute("aria-label", "Cycle name");
  nm.oninput = () => { cycle.name = nm.value; saveCycle(); };
  row1.appendChild(nm);
  const wkLbl = document.createElement("label");
  wkLbl.append("Weeks ");
  const wkIn = document.createElement("input");
  wkIn.type = "number"; wkIn.min = 1; wkIn.max = 52; wkIn.className = "num";
  wkIn.value = cycle.weeks;
  wkIn.setAttribute("aria-label", "Number of weeks");
  wkIn.onchange = () => {
    cycle.weeks = Math.max(1, +wkIn.value || 1);
    cycle.deload = cycle.deload.filter(w => w <= cycle.weeks);
    saveCycle(); renderCycleSetup();
  };
  wkLbl.appendChild(wkIn);
  row1.appendChild(wkLbl);
  const stLbl = document.createElement("label");
  stLbl.append("Start ");
  const stIn = document.createElement("input");
  stIn.type = "date"; stIn.className = "tin"; stIn.value = cycle.start;
  stIn.setAttribute("aria-label", "Start date");
  stIn.onchange = () => { cycle.start = stIn.value; saveCycle(); renderCycleSetup(); };
  stLbl.appendChild(stIn);
  row1.appendChild(stLbl);
  wrap.appendChild(row1);

  const row2 = document.createElement("div");
  row2.className = "adder";
  const dlLbl = document.createElement("label");
  dlLbl.append("Deload weeks (e.g. 5) ");
  const dlIn = document.createElement("input");
  dlIn.className = "tin"; dlIn.style.width = "100px";
  dlIn.value = cycle.deload.join(", ");
  dlIn.setAttribute("aria-label", "Deload week numbers, comma separated");
  dlIn.onchange = () => {
    cycle.deload = dlIn.value.split(/[,\s]+/).map(Number).filter(n => n >= 1 && n <= cycle.weeks);
    saveCycle(); renderCycleSetup();
  };
  dlLbl.appendChild(dlIn);
  row2.appendChild(dlLbl);
  wrap.appendChild(row2);

  const info = currentWeekInfo();
  const pos = document.createElement("p");
  pos.className = "sub";
  pos.textContent = `Currently week ${info.wk} of ${cycle.weeks}` + (info.deload ? " — a deload week" : "") + ".";
  wrap.appendChild(pos);

  wrap.appendChild(planListEl());

  const nb = confirmBtn({
    key: "newcycle",
    label: "Start a different cycle",
    armedLabel: `Really archive "${cycle.name}" and start a new cycle?`,
    onConfirm: startNewCycle,
    onRender: renderPlan
  });
  nb.style.marginTop = "12px";
  wrap.appendChild(nb);

  el.appendChild(wrap);
}

// Only one workout editor is ever mounted at a time: the plan-entry (slot)
// editor inline in the plan rows above, or the legacy pool editor below —
// switching to slot editing hides the pool split view rather than mounting
// both, so the module-level carrying/carryBlock drag state (shared by
// blockEl/itemsTable/pickerEl either way) can never straddle two workouts.
function renderPlan(){
  renderCycleSetup();
  const split = $("poolSplit");
  if (editingSlot){
    if (split) split.style.display = "none";
  } else {
    if (split) split.style.display = "";
    renderBuild();
  }
}

/* ---------- log: starting and completing a session ---------- */
// w is an already-resolved workout object (a plan entry's embedded copy, or a
// pool workout for an ad-hoc/free session) — never looked up by id here, so
// this works the same whichever source it came from. slotId is the plan
// entry's own id when this is a Week-tab box, null for an ad-hoc or free
// session; wid is kept alongside it so legacy (pre-slot) sessions still have
// something to match on.
function startSession(w, slotId){
  session = {
    id: uid(),
    date: new Date().toISOString().slice(0,10),
    wid: w ? w.id : null,
    slot: slotId || null,
    name: w ? w.name : "Free session",
    entries: (w ? w.blocks.reduce((acc,b) => acc.concat(b.items.map(it => {
      const m = byKey[it.key] || { n:it.key };
      return { key:it.key, name:m.n, block:b.name, target:it.target, note:it.note || "", sets:Array(b.sets || 3).fill(""), rpe:"" };
    })), []) : [])
  };
  saveSess();
}

// What "hit the target" means, apart from any UI: every logged set at or above
// the target value, for at least as many sets as the target calls for.
function targetsHit(sess){
  const hits = [];
  sess.entries.forEach(e => {
    const t = parseTarget(e.target);
    const vals = e.sets.filter(v => v !== "").map(Number);
    const needSets = t.sets || e.sets.length || 1;
    if (vals.length >= needSets && t.val && vals.every(v => v >= t.val)) hits.push(e);
  });
  return hits;
}
// This-session-vs-last-time, one line per exercise, for the review screen.
// Must run against `logbook` before the current session is written into it,
// or a session would end up compared against itself.
function compareRows(sess){
  return sess.entries.map(e => {
    const prev = lastFor(e.key);
    return { name: e.name, cur: e.sets.filter(v => v !== ""), prev: prev ? prev.sets : null, other: prev ? prev.other : null };
  });
}

// Saves the session, marks its Week box done, and hands off to the review
// screen. Upserts by id, so completing an already-logged box again updates it
// in place instead of appending a duplicate.
function completeSession(){
  session.entries = session.entries.filter(e => e.sets.some(v => v !== "" && v !== null));
  if (!session.entries.length){ session = null; drop(K.sess); weekView = "list"; renderAll(); return; }

  const hits = targetsHit(session);
  const msHits = hits.filter(e => byKey[e.key] && byKey[e.key].ms);
  const compare = compareRows(session);

  let weekNo = null, isDeload = false;
  if (cycle){
    weekNo = cycleWeek(cycle);
    isDeload = cycle.deload.includes(weekNo);
    session.cycle = cycle.id; session.week = weekNo; session.deload = isDeload;
  }

  // Milestones hit this session start out confirmed (the review screen shows
  // them pre-checked) — a record of what happened, not a change to anything
  // in Progress. The checkboxes there toggle this same array; nothing here
  // ever touches `level`.
  session.milestones = msHits.map(e => e.key);

  delete session.rest; delete session.resumed;
  const idx = logbook.findIndex(s => s.id === session.id);
  if (idx >= 0) logbook[idx] = session; else logbook.unshift(session);

  reviewData = { id: session.id, name: session.name, note: session.note || "", hits, msHits, compare,
    week: weekNo, weeks: cycle ? cycle.weeks : null, deload: isDeload };

  session = null;
  drop(K.sess);
  weekView = "review";
  saveLog(); renderAll();
}

/* ---------- reading the last session back ----------
   The one thing you want while standing under the bar: the reps you did last
   time, and nothing else. Preference order (CLAUDE.md corrective pass, item
   5): the same plan slot first (same box, same place in the week — the most
   comparable), then any session logged under the same workout name (covers
   a slot re-imported or a legacy session with no slot at all), then any
   session that contains the move, which is the only case that says where the
   numbers came from. Deload sessions are skipped — completeSession() is what
   writes that flag now, from the cycle's own deload-week list. */
function lastFor(key){
  const slot = session ? session.slot : null;
  const wname = session ? session.name : null;
  const filled = sn => {
    const e = sn.entries && sn.entries.find(x => x.key === key);
    const vals = e && e.sets ? e.sets.filter(v => v !== "" && v != null) : [];
    return vals.length ? { e, vals } : null;
  };
  const scan = pred => {
    for (const sn of logbook){                       // logbook is newest first
      if (sn.deload) continue;
      if (pred && !pred(sn)) continue;
      const h = filled(sn);
      if (h) return { sn, ...h };
    }
    return null;
  };
  const hit = (slot && scan(sn => sn.slot === slot))
    || (wname && scan(sn => sn.name === wname))
    || scan(null);
  if (!hit) return null;
  return { sets:hit.vals, other: (wname && hit.sn.name !== wname) ? hit.sn.name : null };
}
function lastLine(p){
  return "Last " + p.sets.join(" · ") + (p.other ? " · in " + p.other : "");
}

/* ---------- rest timer ----------
   Manual only — nothing auto-starts, because the app does not get opinions
   about your training. The end time is stored as a timestamp inside the
   session, so it survives a re-render, a tab switch and the phone sleeping;
   setInterval only paints, it never counts. Sits inside the fixed tab bar
   (inserted before .tabbar .inner by restHost(), below) so it stacks above
   the tab buttons without having to guess their height, and inherits the
   safe-area padding already there. */
let restTick = null, restAudio = null;
const REST_PRESETS = [60, 90, 120, 180];
const mmss = s => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");

function restHost(){
  let el = $("restbar");
  if (!el){
    el = document.createElement("div");
    el.id = "restbar"; el.className = "restbar";
    const bar = document.querySelector(".tabbar");
    if (!bar) return null;
    bar.insertBefore(el, bar.firstChild);
  }
  return el;
}
function unlockBeep(){
  try {
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return;
    restAudio = restAudio || new A();
    if (restAudio.state === "suspended") restAudio.resume();
  } catch(e){ /* no audio on this device; the vibration still fires */ }
}
function alarm(){
  try { if (navigator.vibrate) navigator.vibrate([180,90,180]); } catch(e){}
  try {
    if (!restAudio) return;
    const t = restAudio.currentTime;
    const o = restAudio.createOscillator(), g = restAudio.createGain();
    o.type = "sine"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g); g.connect(restAudio.destination);
    o.start(t); o.stop(t + 0.6);
  } catch(e){}
}
function startRest(secs){
  if (!session) return;
  unlockBeep();
  session.rest = { end: Date.now() + secs * 1000, len: secs, rung: false };
  saveSess(); renderRest();
}
function stopRest(){
  if (session) delete session.rest;
  saveSess(); renderRest();
}
function stopTick(){ if (restTick){ clearInterval(restTick); restTick = null; } }
const loggerLive = () => topTab === TAB_WEEK && weekView === "logger" && !!session;
function tickRest(){
  if (!session || !session.rest || !loggerLive()){ stopTick(); return; }
  const r = session.rest;
  const left = Math.max(0, Math.ceil((r.end - Date.now()) / 1000));
  const el = $("restbar"), t = el && el.querySelector(".t");
  if (t) t.textContent = mmss(left);
  if (!left && !r.rung){ r.rung = true; alarm(); saveSess(); renderRest(); }
}
function renderRest(){
  const el = restHost();
  if (!el) return;
  const live = loggerLive();
  document.body.classList.toggle("hasrest", live);
  if (!live){ stopTick(); el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = "";
  const r = session.rest;

  if (!r){
    stopTick();
    el.className = "restbar";
    el.insertAdjacentHTML("beforeend", '<span class="lbl">Rest</span>');
    REST_PRESETS.forEach(secs => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = mmss(secs);
      b.setAttribute("aria-label", "Start a " + mmss(secs) + " rest");
      b.onclick = () => startRest(secs);
      el.appendChild(b);
    });
    return;
  }

  const left = Math.max(0, Math.ceil((r.end - Date.now()) / 1000));
  el.className = "restbar" + (left ? " run" : " up");
  el.insertAdjacentHTML("beforeend",
    `<span class="lbl">${left ? "Rest" : "Go"}</span><b class="t">${mmss(left)}</b>`);
  if (left){
    const more = document.createElement("button");
    more.type = "button"; more.textContent = "+30";
    more.setAttribute("aria-label", "Add thirty seconds");
    more.onclick = () => { r.end += 30000; r.rung = false; saveSess(); renderRest(); };
    el.appendChild(more);
  }
  const x = document.createElement("button");
  x.type = "button"; x.className = "sp"; x.textContent = left ? "Stop" : "Clear";
  x.onclick = stopRest;
  el.appendChild(x);
  if (left) restTick = restTick || setInterval(tickRest, 250);
  else stopTick();
}

/* ---------- a session, laid out the way it is performed ----------
   Set boxes used to stack per exercise, so a four-round superset read as four
   Pull Up boxes and then four Dip boxes — nothing like the order you train it
   in. Blocks of two or more now render as a grid: one column per exercise, one
   row per round, so scanning across a row is one round. A block with a single
   exercise has no rounds worth grouping and keeps the inline row. */
function blocksOf(sn){
  const out = [];
  sn.entries.forEach(e => {
    const name = e.block || "";
    const last = out[out.length - 1];
    if (last && last.name === name) last.entries.push(e);
    else out.push({ name, entries:[e] });
  });
  return out;
}
function roundsIn(bk){ return bk.entries.reduce((n,e) => Math.max(n, e.sets.length), 0) || 1; }

function setInput(e, j){
  const t = parseTarget(e.target);
  const inp = document.createElement("input");
  inp.type = "number"; inp.min = 0; inp.className = "num";
  inp.inputMode = "numeric";
  inp.value = e.sets[j];
  inp.placeholder = t.unit === "s" ? "s" : "r";
  inp.setAttribute("aria-label", e.name + " round " + (j + 1));
  inp.oninput = () => { e.sets[j] = inp.value; saveSess(); };
  return inp;
}
function rpeInput(e){
  const rp = document.createElement("input");
  rp.type = "number"; rp.min = 1; rp.max = 10; rp.step = 0.5; rp.className = "num";
  rp.inputMode = "decimal";
  rp.value = e.rpe || ""; rp.placeholder = "–";
  rp.title = "Rate of perceived exertion: 10 is nothing left, 8 is about two reps in reserve";
  rp.setAttribute("aria-label", e.name + " rate of perceived exertion");
  rp.oninput = () => { e.rpe = rp.value; saveSess(); };
  return rp;
}

function exHeadEl(e, i, bk){
  const multi = bk.entries.length > 1;
  const d = document.createElement("div");
  d.className = "lex";
  d.insertAdjacentHTML("beforeend",
    `<div class="lexhead">${multi ? `<span class="col">${letter(i)}</span>` : ""}` +
    `<span class="mvname">${esc(e.name)}</span>` +
    `<span class="tgt"><span class="lb">Target</span> ${esc(e.target)}</span></div>`);

  const prev = lastFor(e.key);
  const p = document.createElement("p");
  p.className = "last" + (prev ? "" : " none");
  p.textContent = prev ? lastLine(prev) : "First time logging this";
  d.appendChild(p);

  // Carried through from the builder and read-only here: a note is part of the
  // plan, so it is edited in Build, not mid-session.
  if (e.note) d.insertAdjacentHTML("beforeend",
    `<p class="exnote"><span class="lb">Note</span> ${esc(e.note)}</p>`);

  if (!multi){
    const row = document.createElement("div");
    row.className = "lsingle";
    const sets = document.createElement("div");
    sets.className = "sets";
    e.sets.forEach((v,j) => sets.appendChild(setInput(e, j)));
    const rl = document.createElement("label");
    rl.className = "rpe";
    rl.append("RPE", rpeInput(e));
    row.append(sets, rl);
    d.appendChild(row);
  }
  return d;
}

function roundGridEl(bk){
  const rounds = roundsIn(bk);
  const box = document.createElement("div");
  const t = document.createElement("table");
  t.className = "rounds";
  t.innerHTML = `<thead><tr><th><span class="vh">Round</span></th>` +
    bk.entries.map((e,i) => `<th><abbr title="${esc(e.name)}">${letter(i)}</abbr></th>`).join("") +
    `</tr></thead>`;
  const body = document.createElement("tbody");
  for (let r = 0; r < rounds; r++){
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row"; th.textContent = r + 1;
    tr.appendChild(th);
    bk.entries.forEach(e => {
      const td = document.createElement("td");
      if (r < e.sets.length) td.appendChild(setInput(e, r));
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
  const rr = document.createElement("tr");
  rr.className = "rperow";
  rr.innerHTML = '<th scope="row">RPE</th>';
  bk.entries.forEach(e => {
    const td = document.createElement("td");
    td.appendChild(rpeInput(e));
    rr.appendChild(td);
  });
  body.appendChild(rr);
  t.appendChild(body);
  box.appendChild(t);
  return box;
}

function blockLogEl(bk){
  const multi = bk.entries.length > 1;
  const sec = document.createElement("section");
  sec.className = "lblock" + (multi ? " super" : "");
  const rounds = roundsIn(bk);
  sec.insertAdjacentHTML("beforeend",
    `<div class="lbhead"><h3>${esc(bk.name || "Session")}</h3>` +
    `<span class="sub">${rounds} round${rounds === 1 ? "" : "s"}` +
    `${multi ? " · superset" : ""}</span></div>`);
  bk.entries.forEach((e,i) => sec.appendChild(exHeadEl(e, i, bk)));
  if (multi) sec.appendChild(roundGridEl(bk));
  return sec;
}

/* ---------- Week tab ----------
   Three faces sharing one root div, switched by `weekView`: the box row
   ("list"), the drill-in logger ("logger"), and the post-Complete review
   ("review"). Nothing here ever advances a rung or reports a miss — Complete
   only saves what was typed and hands off to a screen that states what was
   observed. */

// Opens (or reopens) the drill-in logger. slotId is a plan entry's own id for
// a Week-tab box, null otherwise; wid is a pool workout id for an ad-hoc
// "other session", null for a free session. Reopening a box already logged
// this week loads that saved session back in for editing — completeSession()
// upserts by id, so finishing again updates it rather than creating a
// second entry.
function openSession(slotId, wid){
  let w = null;
  if (slotId){
    const p = cycle && cycle.plan.find(x => x.id === slotId);
    w = slotWorkout(p);
    if (!p || !w) return; // stale/malformed slot
  } else if (wid){
    w = workouts.find(x => x.id === wid) || null;
    if (!w) return; // stale id — the workout was deleted since
  }

  const info = currentWeekInfo();
  // "Other session" (an ad-hoc pool workout, not tied to a plan slot) still
  // resumes an existing ad-hoc session for the same workout this week rather
  // than starting a second one — scoped to sessions with no slot, so it can
  // never pick up (or collide with) a plan box's own completed session.
  let already = null;
  if (info && slotId) already = loggedThisWeek(slotId, info.wk, w.id);
  else if (info && wid){
    const [s,e] = weekRangeFor(cycle, info.wk);
    already = logbook.find(sn => !sn.slot && sn.wid === wid && dateInRange(sn.date, s, e)) || null;
  }
  if (already){
    session = JSON.parse(JSON.stringify(already));
    session.resumed = false;
  } else {
    startSession(w, slotId);
  }
  weekView = "logger";
  saveSess();
  renderAll();
}

// Every place a session can be opened from (a Week box, "Start other
// session", or resuming the same one you're already in) funnels through
// here, so there is exactly one confirmation path when doing so would
// discard a session already in progress. Two-step in place rather than
// window.confirm: a first tap arms the box itself ("Tap again to discard &
// open"); a second tap, or ~5s of nothing, resolves it — see the
// "in-place confirm" note above.
function boxClick(slotId, wid){
  const matches = session && (slotId
    ? session.slot === slotId
    : (!session.slot && session.wid === (wid || null)));
  if (matches){ weekView = "logger"; renderAll(); return; }
  if (!session){ openSession(slotId, wid); return; }
  const key = "openbox:" + (slotId || ("wid:" + (wid || "")));
  if (confirmArmed === key){
    disarmConfirm();
    session = null; drop(K.sess);
    openSession(slotId, wid);
  } else {
    armConfirm(key, renderWeek);
  }
}

function weekRowEl(){
  const row = document.createElement("div");
  row.className = "weekrow";
  const info = currentWeekInfo();
  cycle.plan.forEach(p => {
    const w = slotWorkout(p);
    if (!w) return; // a malformed/unresolved plan entry fades from the row rather than throwing
    const doneSn = loggedThisWeek(p.id, info.wk, w.id);
    const armed = confirmArmed === "openbox:" + p.id;
    const box = document.createElement("button");
    box.type = "button";
    box.className = "wkbox" + (doneSn ? " done" : "") + (armed ? " armed" : "");
    box.innerHTML = (p.day ? `<span class="day">${esc(DAY_ABBR[p.day] || p.day)}</span>` : "") +
      `<span class="wn">${esc(w.name)}</span>` +
      (armed ? '<span class="st">Tap again to discard current &amp; open</span>'
        : doneSn ? '<span class="st">Completed</span>' : "");
    box.onclick = () => boxClick(p.id, null);
    row.appendChild(box);
  });
  return row;
}

function otherSessionEl(){
  const wrap = document.createElement("div");
  wrap.className = "adder";
  const sel = document.createElement("select");
  sel.setAttribute("aria-label", "Other session");
  sel.innerHTML = workouts.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join("")
    + '<option value="">Free session</option>';
  const go = document.createElement("button");
  go.type = "button"; go.className = "btn";
  go.onclick = () => boxClick(null, sel.value || null);
  const setLabel = () => {
    const key = "openbox:wid:" + (sel.value || "");
    go.textContent = confirmArmed === key ? "Tap again to discard & start" : "Start other session";
    go.className = "btn" + (confirmArmed === key ? " danger" : "");
  };
  sel.onchange = setLabel;
  setLabel();
  wrap.append(sel, go);
  if (!workouts.length){
    const p = document.createElement("p");
    p.className = "empty"; p.style.marginTop = "10px";
    p.textContent = "Build a workout first and it'll show up here, with every set already laid out and its target attached.";
    wrap.appendChild(p);
  }
  return wrap;
}

function historyToggleEl(){
  const b = document.createElement("button");
  b.type = "button"; b.className = "btn mini";
  b.textContent = showHistory ? "Hide past weeks" : "Show past weeks";
  b.onclick = () => { showHistory = !showHistory; renderWeek(); };
  return b;
}

function historyListEl(){
  const h = document.createElement("div");
  h.className = "hist";
  if (!logbook.length){
    h.innerHTML = '<p class="empty">No sessions logged yet.</p>';
    return h;
  }
  logbook.forEach(sn => {
    const row = document.createElement("div");
    row.className = "entry";
    const lines = sn.entries.map(e =>
      `<p class="ex"><b>${esc(e.name)}</b> ${e.sets.filter(v=>v!=="").join(" · ")}${e.rpe ? ` &nbsp;RPE ${esc(e.rpe)}` : ""}</p>`).join("");
    const msLine = sn.milestones && sn.milestones.length
      ? `<p class="ex histms">Milestone: ${sn.milestones.map(k => esc(byKey[k] ? byKey[k].n : k)).join(", ")}</p>` : "";
    row.innerHTML = `<div class="d">${esc(sn.date)}</div>
      <div class="body"><p class="wn">${esc(sn.name)}</p>${lines}${msLine}
      ${sn.note ? `<p class="ex">${esc(sn.note)}</p>` : ""}</div>`;
    row.appendChild(confirmBtn({
      key: "delhist:" + sn.id,
      label: "Delete", ariaLabel: "Delete session from " + sn.date,
      armedLabel: "Really delete this entry?",
      onConfirm: () => { logbook = logbook.filter(z => z.id !== sn.id); saveLog(); renderWeek(); },
      onRender: renderWeek
    }));
    h.appendChild(row);
  });
  return h;
}

// The drill-in logger: a full screen with a back control and, at the very
// foot, the rest timer and one button — Complete.
function loggerScreen(){
  const s = document.createElement("div");
  s.className = "session weeklogger";

  const head = document.createElement("div");
  head.className = "loghead";
  const back = document.createElement("button");
  back.type = "button"; back.className = "btn mini";
  back.textContent = "‹ Week";
  back.onclick = () => { weekView = "list"; renderAll(); };
  head.appendChild(back);
  head.appendChild(confirmBtn({
    key: "discardsession",
    label: "Discard", ariaLabel: "Discard this session",
    armedLabel: "Really throw this away?",
    onConfirm: () => { session = null; drop(K.sess); weekView = "list"; renderAll(); },
    onRender: renderWeek
  }));
  s.appendChild(head);

  s.insertAdjacentHTML("beforeend", `<h2>${esc(session.name)}</h2>`);
  const when = document.createElement("p");
  when.className = "when";
  const dt = document.createElement("input");
  dt.type = "date"; dt.value = session.date; dt.className = "tin"; dt.style.width = "150px";
  dt.onchange = () => { session.date = dt.value; saveSess(); };
  when.appendChild(dt);
  if (session.resumed)
    when.insertAdjacentHTML("beforeend", '<span class="resumed">Picked up where you left off</span>');
  s.appendChild(when);

  blocksOf(session).forEach(bk => s.appendChild(blockLogEl(bk)));

  s.insertAdjacentHTML("beforeend",
    '<p class="sub scale">RPE 10 leaves nothing in the tank, 8 leaves about two reps, 6 feels easy.</p>');

  // A free session has no plan to work through, so the picker stays open.
  if (!session.wid){
    const sel = moveSelect();
    sel.style.marginTop = "14px";
    sel.onchange = () => {
      const m = byKey[sel.value];
      if (!m) return;
      const t = target(m.n);
      session.entries.push({ key:m.key, name:m.n, block:"", target:t,
                             sets:Array(parseTarget(t).sets || 3).fill(""), rpe:"", note:"" });
      saveSess(); renderWeek();
    };
    s.appendChild(sel);
  }

  const nt = document.createElement("textarea");
  nt.className = "note"; nt.placeholder = "How did it feel?"; nt.style.marginTop = "14px";
  nt.value = session.note || "";
  nt.oninput = () => { session.note = nt.value; saveSess(); };
  s.appendChild(nt);

  // The rest timer itself lives in the fixed tab bar (index.html's own
  // #restbar, filled in by renderRest() right after renderWeek() in
  // renderAllInner()) — not in this screen's own flow. See the rest-timer
  // section for why.
  const acts = document.createElement("div");
  acts.className = "acts foot";
  const comp = document.createElement("button");
  comp.type = "button"; comp.className = "btn solid"; comp.textContent = "Complete";
  comp.onclick = completeSession;
  acts.appendChild(comp);
  s.appendChild(acts);

  return s;
}

// After Complete: cycle position, which targets were cleared, how this
// session compared to last time, the note, and any milestone badge —
// pre-selected, never applied. The user ticks the progression tree themselves
// in Progress; nothing here can.
function reviewEl(){
  const r = reviewData;
  const box = document.createElement("div");
  box.className = "review";

  if (r.week)
    box.insertAdjacentHTML("beforeend",
      `<p class="wk">Week ${r.week} of ${r.weeks}${r.deload ? " · deload" : ""}</p>`);
  box.insertAdjacentHTML("beforeend", `<h2>${esc(r.name)} — logged</h2>`);

  const hitBox = document.createElement("div");
  hitBox.className = "nudge";
  hitBox.innerHTML = r.hits.length
    ? `<p>Hit target on ${r.hits.length === 1 ? "one exercise" : r.hits.length + " exercises"}: ${r.hits.map(e => esc(e.name)).join(", ")}.</p>`
    : "<p>No targets cleared this session.</p>";
  box.appendChild(hitBox);

  if (r.compare.length){
    const cwrap = document.createElement("div");
    cwrap.className = "compare";
    r.compare.forEach(c => {
      const curTxt = c.cur.length ? c.cur.join(" · ") : "—";
      const prevTxt = c.prev ? c.prev.join(" · ") + (c.other ? " (" + c.other + ")" : "") : "no prior data";
      const p = document.createElement("p");
      p.className = "cmp";
      p.innerHTML = `<b>${esc(c.name)}</b> ${esc(curTxt)} <span class="vs">vs last ${esc(prevTxt)}</span>`;
      cwrap.appendChild(p);
    });
    box.appendChild(cwrap);
  }

  if (r.msHits.length){
    // The session is already sitting in `logbook` by the time this screen
    // shows (completeSession() upserted it before handing off) — so a toggle
    // here writes straight into that entry and saves. Pre-checked because
    // completeSession() pre-fills session.milestones with every hit; nothing
    // here ever touches `level` or the ladders themselves.
    const sn = logbook.find(x => x.id === r.id);
    const mwrap = document.createElement("div");
    mwrap.className = "msbadges";
    r.msHits.forEach(e => {
      const lab = document.createElement("label");
      lab.className = "msbadge";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!(sn && Array.isArray(sn.milestones) && sn.milestones.includes(e.key));
      cb.setAttribute("aria-label", "Confirm milestone: " + e.name);
      cb.onchange = () => {
        const target = logbook.find(x => x.id === r.id);
        if (!target) return;
        if (!Array.isArray(target.milestones)) target.milestones = [];
        if (cb.checked){ if (!target.milestones.includes(e.key)) target.milestones.push(e.key); }
        else target.milestones = target.milestones.filter(k => k !== e.key);
        saveLog();
      };
      lab.append(cb, document.createTextNode(" Milestone hit: " + e.name));
      mwrap.appendChild(lab);
    });
    box.appendChild(mwrap);
    box.insertAdjacentHTML("beforeend",
      '<p class="sub">Confirming just notes it here — move the rung itself in Progress whenever you decide to.</p>');
  }

  if (r.note) box.insertAdjacentHTML("beforeend",
    `<p class="revnote"><span class="lb">Note</span> ${esc(r.note)}</p>`);

  const back = document.createElement("button");
  back.type = "button"; back.className = "btn solid"; back.style.marginTop = "16px";
  back.textContent = "Back to week";
  back.onclick = () => { reviewData = null; weekView = "list"; renderAll(); };
  box.appendChild(back);

  return box;
}

function renderWeek(){
  const root = $("weekroot");
  if (!root) return;
  root.innerHTML = "";

  if (weekView === "review" && reviewData){ root.appendChild(reviewEl()); return; }
  if (weekView === "logger" && session){ root.appendChild(loggerScreen()); return; }
  weekView = "list"; // normalises stray state, e.g. session cleared elsewhere

  if (!cycle){
    const p = document.createElement("p");
    p.className = "empty";
    p.innerHTML = "No cycle yet — set one up in <b>Plan</b> to see this week's workouts here.";
    root.appendChild(p);
  } else {
    const info = currentWeekInfo();
    const head = document.createElement("p");
    head.className = "wk";
    head.textContent = `Week ${info.wk} of ${cycle.weeks}` + (info.deload ? " · deload" : "");
    root.appendChild(head);
    root.appendChild(weekRowEl());
  }

  const other = otherSessionEl();
  other.style.marginTop = "18px";
  root.appendChild(other);

  const toggleWrap = document.createElement("div");
  toggleWrap.style.marginTop = "18px";
  toggleWrap.appendChild(historyToggleEl());
  root.appendChild(toggleWrap);

  if (showHistory) root.appendChild(historyListEl());
}

/* ---------- moving data between devices ---------- */
function snapshot(){
  return JSON.stringify({ v:1, saved:new Date().toISOString().slice(0,10),
    level, workouts, logbook, focus, cycle, cycleArchive }, null, 0);
}
function restore(text){
  const d = JSON.parse(text);
  if (!d || typeof d !== "object") throw new Error("not a backup");
  if (d.level && typeof d.level === "object") level = d.level;
  if (Array.isArray(d.workouts)) workouts = d.workouts.map(migrate);
  if (Array.isArray(d.logbook)) logbook = d.logbook;
  if (Array.isArray(d.focus)) focus = d.focus.filter(k => byKey[k]);
  if (d.cycle && typeof d.cycle === "object") cycle = d.cycle;
  if (Array.isArray(d.cycleArchive)) cycleArchive = d.cycleArchive;
  migrateCyclePlan(cycle);
  cycleArchive.forEach(migrateCyclePlan);
  editing = workouts.length ? workouts[0].id : null;
  editingSlot = null; carrying = null; carryBlock = null;
  saveProg(); saveWork(); saveLog(); saveFocus(); saveCycle(); saveCycleArchive();
}

function transferEl(){
  const box = document.createElement("div");
  box.className = "xfer";
  box.innerHTML = `<h2>Back up and move data</h2>
    <p>Everything is stored on this device only — nothing is uploaded, and clearing the browser's
       site data for this app would wipe it. Download a backup now and then, and use the text box
       to carry your progress onto another phone or browser.</p>`;
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
  // A bespoke two-step (not the shared confirmBtn helper) because arming it
  // must not redraw this box — that would recreate `ta` from snapshot() and
  // throw away whatever the user had just pasted in, which is the one thing
  // this control cannot do.
  const load = document.createElement("button");
  load.className = "btn"; load.textContent = "Restore from text";
  let loadCancel = null, loadTimer = null;
  const disarmLoad = () => {
    load.textContent = "Restore from text"; load.classList.remove("danger");
    if (loadCancel){ loadCancel.remove(); loadCancel = null; }
    if (loadTimer){ clearTimeout(loadTimer); loadTimer = null; }
  };
  load.onclick = () => {
    if (!loadCancel){
      load.textContent = "Really replace everything?"; load.classList.add("danger");
      loadCancel = document.createElement("button");
      loadCancel.type = "button"; loadCancel.className = "btn"; loadCancel.textContent = "Cancel";
      loadCancel.onclick = disarmLoad;
      load.insertAdjacentElement("afterend", loadCancel);
      loadTimer = setTimeout(disarmLoad, 5000);
      return;
    }
    disarmLoad();
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
  { t:"Week",     i:'<path d="M4 6h11M4 12h8M4 18h6"/><path d="M14 16.5l2 2 4.5-4.5"/>' },
  { t:"Progress", i:'<path d="M7 3v18M17 3v18M7 8h10M7 13h10M7 18h10"/>' },
  { t:"Plan",     i:'<rect x="3.5" y="4" width="17" height="6" rx="1"/><rect x="3.5" y="14" width="17" height="6" rx="1"/>' }
];
function renderTop(){
  const n = $("top");
  n.innerHTML = "";
  TABS.forEach((tab,i) => {
    const b = document.createElement("button");
    b.type = "button"; b.setAttribute("role","tab");
    b.setAttribute("aria-selected", i === topTab);
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${tab.i}</svg><span>${tab.t}</span>`;
    b.onclick = () => { disarmConfirm(); topTab = i; window.scrollTo(0,0); renderAll(); };
    n.appendChild(b);
  });
  $("v-week").hidden = topTab !== TAB_WEEK;
  $("v-progress").hidden = topTab !== TAB_PROGRESS;
  $("v-plan").hidden = topTab !== TAB_PLAN;
  document.querySelectorAll(".ladonly").forEach(e => e.style.display = topTab === TAB_PROGRESS ? "" : "none");
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
  if (topTab === TAB_WEEK) renderWeek();
  if (topTab === TAB_PROGRESS) renderLadders();
  if (topTab === TAB_PLAN) renderPlan();
  renderRest();
  const d = done();
  if ($("count")) $("count").innerHTML = `${d} <span>of ${total} rungs</span>`;
  if ($("save")) $("save").textContent = saveNote;
}

if ($("only")) $("only").onchange = e => { msOnly = e.target.checked; renderLadders(); };
if ($("newW")) $("newW").onclick = () => {
  const w = { id: uid(), name: "Workout " + (workouts.length + 1), items: [] };
  workouts.push(w); editing = w.id; topTab = TAB_PLAN; saveWork(); renderAll();
};
/* ---------- boot ----------
   The chart has to be in memory before the first render, so unlike the
   prototype this is async. Everything here is script-rendered, so a silent
   throw leaves a blank page (HANDOVER §5.10) — every failure path below has to
   put something on screen. */
(async () => {
  const boot = $("boot"), wrap = $("wrap");
  try {
    await initChart();
  } catch (err) {
    if (boot){
      boot.style.display = "block";
      boot.textContent = "Couldn't load the exercise chart: " + err.message
        + ". If you're offline and this is the first run, reconnect once and reopen.";
    }
    console.error(err);
    return;
  }

  renderAll();
  if (wrap && wrap.children.length){
    wrap.style.display = "";
    if (boot) boot.style.display = "none";
  }
  await loadAll();

  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js")
      .catch(err => console.warn("service worker registration failed", err));
  }
})();
