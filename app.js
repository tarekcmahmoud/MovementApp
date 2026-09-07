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
const K = { prog:"bwf-ladders-v3", seeded:"bwf-seeded-v1", work:"bwf-workouts-v1", log:"bwf-log-v1", focus:"bwf-focus-v1" };
let level = {}, workouts = [], logbook = [], focus = [];
let topTab = 0, active = 0, msOnly = false, editing = null, session = null, nudges = [];
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
