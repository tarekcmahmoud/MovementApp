/* Bodyweight Ladders v2 - the screens.

   Classic script. Needs data.js (Data) and ui.js (UI) first. Nothing here writes
   storage except through Data: mutate Data.state, then Data.save(), then render.

   THE RULE (docs/v2/SPEC.md): the app never makes a training decision. It never
   moves a rung or a position, never swaps an exercise, never derives an
   achievement. Everything that changes training data is a tap by the user.

   Layout of this file
     helpers - toast/save - navigation - screens (Week, Logger, Plan, Cycle,
     Workout editor, Ladders, Collection builder) - boot
*/
(function () {
  'use strict';

  var h = UI.h;

  /* ====================================================================
     Constants and small helpers
     ==================================================================== */

  var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var TABS = [{ id: 'week', label: 'Week', icon: 'week' }, { id: 'plan', label: 'Plan', icon: 'plan' }];
  var UI_KEY = 'bwl-v2-ui';   // which drift notice was dismissed
  var THEME_KEY = 'bwl-appearance';   // 'light' | 'dark'; absent means Auto. Read before paint in index.html.

  var chart = null;
  var storage = null;
  var booted = false;
  var stack = [{ name: 'week' }];
  var lastRendered = null;
  var appEl = null;
  var motion = '';      // set by switchTab: 'tab-left' | 'tab-right'. Otherwise render() infers it.
  var lastDepth = 0, motionToken = 0;

  // Transient, in-memory screen state that is not part of any route.
  var ui = { newCycleHint: false, importDraft: null, importNote: '', importError: '', drift: null };

  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function isISO(s) { return /^\d{4}-\d{2}-\d{2}/.test(String(s || '')); }
  function fmtDM(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] : '—';
  }
  function fmtDMY(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : '—';
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function cap(s) { s = String(s || ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function dayLabel(d) { return DAY_LABEL[d] || (d ? cap(d) : '—'); }
  function dayRank(d) { var i = DAYS.indexOf(d); return i < 0 ? 100 : i; }
  function blockLetter(i) { return String.fromCharCode(65 + (i % 26)); }
  // A workout has at most one warm-up / prep block (flagged warmup). It is always
  // shown first, has no rungs and records nothing; the lettered blocks A, B... are the rest.
  function warmupOf(w) { return w ? w.blocks.filter(function (b) { return b.warmup; })[0] || null : null; }
  function mainBlocks(w) { return w ? w.blocks.filter(function (b) { return !b.warmup; }) : []; }
  function todayStamp() { return Data.todayISO(); }

  function cycleById(id) {
    return Data.state.cycles.filter(function (c) { return c.id === id; })[0] || null;
  }
  function exerciseCount(w) {
    return w ? w.blocks.reduce(function (n, b) { return n + b.exercises.length; }, 0) : 0;
  }
  function workoutOf(cycle, id) {
    return id ? cycle.workouts.filter(function (w) { return w.id === id; })[0] || null : null;
  }
  // "Mon, Fri" for the days a workout is scheduled on; '' when none.
  function daysText(cycle, workoutId) {
    var ds = cycle.slots.filter(function (s) { return s.workoutId === workoutId && s.day; })
      .map(function (s) { return s.day; });
    ds.sort(function (a, b) { return dayRank(a) - dayRank(b); });
    return ds.filter(function (d, i) { return ds.indexOf(d) === i; }).map(dayLabel).join(', ');
  }
  function cycleEnd(c) { return isISO(c.start) ? Data.addDays(c.start, 7 * (+c.weeks || 1) - 1) : null; }
  function periodText(c) {
    var end = cycleEnd(c);
    if (!end) return '—';
    var thisYear = String(new Date().getFullYear());
    var showYear = c.start.slice(0, 4) !== thisYear || end.slice(0, 4) !== thisYear;
    var f = showYear ? fmtDMY : fmtDM;
    return f(c.start) + ' – ' + f(end);
  }
  function weekRangeText(c, wk) {
    if (!isISO(c.start)) return '—';
    var r = Data.weekRange(c, wk);
    return fmtDM(r[0]) + ' – ' + fmtDM(r[1]);
  }
  function deloadText(c) {
    var d = c.deload || [];
    if (!d.length) return 'None';
    return (d.length > 1 ? 'Weeks ' : 'Week ') + d.join(', ');
  }
  function activeCollections() { return Data.state.collections.filter(function (c) { return c.on; }); }

  // Map rungId -> ['Pull Up · Upper A', ...] for exercises in the ACTIVE cycle.
  function activeLinks() {
    var map = {}, cycle = Data.activeCycle();
    if (!cycle) return map;
    cycle.workouts.forEach(function (w) {
      w.blocks.forEach(function (b) {
        b.exercises.forEach(function (e) {
          if (!e.link) return;
          (map[e.link] = map[e.link] || []).push((e.name || 'Untitled') + ' · ' + (w.name || 'Untitled workout'));
        });
      });
    });
    return map;
  }

  function findLadder(ladderId) {
    var cs = Data.state.collections;
    for (var a = 0; a < cs.length; a++)
      for (var b = 0; b < cs[a].categories.length; b++)
        for (var c = 0; c < cs[a].categories[b].ladders.length; c++)
          if (cs[a].categories[b].ladders[c].id === ladderId)
            return { collection: cs[a], category: cs[a].categories[b], ladder: cs[a].categories[b].ladders[c] };
    return null;
  }
  // The position rung's index in the ladder, or -1.
  function positionIndex(ladder) {
    var id = Data.state.positions[ladder.id];
    if (!id) return -1;
    for (var i = 0; i < ladder.rungs.length; i++) if (ladder.rungs[i].id === id) return i;
    return -1;
  }
  function collectionCounts(col) {
    var lads = 0, rungs = 0;
    col.categories.forEach(function (c) {
      lads += c.ladders.length;
      c.ladders.forEach(function (l) { rungs += l.rungs.length; });
    });
    return plural(col.categories.length, 'category', 'categories') + ' · ' + plural(lads, 'ladder', 'ladders') +
      ' · ' + plural(rungs, 'rung', 'rungs');
  }

  /* ====================================================================
     Errors, saving
     ==================================================================== */

  var toastEl = null, toastKind = null;

  function showError(msg, kind) {
    if (!toastEl) {
      toastEl = h('div', { class: 'toast', role: 'alert' },
        h('span', {}, ''),
        UI.btn('Dismiss', { small: true, onClick: function () { clearError(); } }));
      document.body.appendChild(toastEl);
    }
    toastEl.firstChild.textContent = msg;
    toastKind = kind || 'misc';
  }
  function clearError(kind) {
    if (!toastEl || (kind && kind !== toastKind)) return;
    var el = toastEl;
    el.classList.add('is-leaving');   // slides out, then goes
    setTimeout(function () { el.remove(); }, 260);
    toastEl = null; toastKind = null;
  }

  var SAVE_FAILED = "Couldn't save. This phone's storage may be full, so your latest change is not stored. " +
    'Export your data from Plan if you can.';

  function saveNow() {
    var ok = false;
    try { ok = Data.save(); } catch (e) { ok = false; }
    if (!ok) showError(SAVE_FAILED, 'save'); else clearError('save');
    return ok;
  }

  // One discrete change: mutate, save, and if the save fails put the data back as
  // it was so the screen never shows something that is not stored. Returns ok.
  function tx(fn) {
    var snap = JSON.stringify(Data.state);
    var ok = true;
    try { fn(); }
    catch (e) {
      console.error(e);
      showError('Something went wrong: ' + (e && e.message || e));
      ok = false;
    }
    if (ok) ok = saveNow();
    if (!ok) {
      Data.state = JSON.parse(snap);
      stack.forEach(function (r) { r.session = null; });
    }
    return ok;
  }
  function commit(fn) { var ok = tx(fn); render(); return ok; }

  /* ====================================================================
     Navigation: an in-memory stack kept in step with browser history
     ==================================================================== */

  function top() { return stack[stack.length - 1]; }

  function remember() {
    var sc = appEl && appEl.querySelector('.screen');
    if (sc) top().scroll = sc.scrollTop;
  }
  function push(route) {
    remember();
    ui.newCycleHint = false;
    stack.push(route);
    history.pushState({ depth: stack.length - 1 }, '');
    render();
  }
  function replaceTop(route) {
    stack[stack.length - 1] = route;
    history.replaceState({ depth: stack.length - 1 }, '');
    render();
  }
  function goRoot(name) {
    ui.newCycleHint = false;
    stack = [{ name: name }];
    history.replaceState({ depth: 0 }, '');
    render();
  }
  function back() {
    if (stack.length < 2) return;
    if (history.state && history.state.depth === stack.length - 1) history.back();
    else { stack.pop(); render(); }
  }
  function switchTab(id) {
    if (stack.length === 1 && stack[0].name === id) return;
    var ids = TABS.map(function (t) { return t.id; });
    motion = ids.indexOf(id) === 0 ? 'tab-left' : 'tab-right';   // from the side of its dock tab
    goRoot(id);
  }

  function isDirty(route) {
    return !route.force && typeof route.dirty === 'function' && !!route.dirty();
  }
  // The header back button. A screen with unsaved edits asks first.
  function attemptBack() {
    var r = top();
    if (isDirty(r)) {
      r.guardArmed = true;
      r.scroll = 0;
      lastRendered = null;
      render();
      return;
    }
    back();
  }

  window.addEventListener('popstate', function (e) {
    var depth = e.state && typeof e.state.depth === 'number' ? e.state.depth : 0;
    if (depth + 1 >= stack.length) { render(); return; }
    var leaving = top();
    if (isDirty(leaving)) {
      // The Android back button or a browser back on a screen with unsaved edits:
      // step forward again and ask.
      leaving.guardArmed = true;
      history.go(stack.length - 1 - depth);
      return;
    }
    stack.length = depth + 1;
    render();
  });

  /* ====================================================================
     Rendering
     ==================================================================== */

  var SCREENS = {};

  function shell(o) {
    var screen = h('div', { class: 'screen' + (o.cls ? ' ' + o.cls : '') }, o.body);
    var node = h('div', { class: 'app' },
      o.header || null,
      screen,
      o.foot || null,
      o.dock ? UI.dock(TABS, o.dock, switchTab) : null);
    node.screenEl = screen;
    return node;
  }

  function notFound(msg) {
    return shell({
      header: UI.header({ onBack: back, title: 'Not found' }),
      body: UI.card({
        body: h('p', { class: 'note-text is-soft' }, msg),
        foot: UI.btn('Go to Plan', { variant: 'tertiary', block: true, onClick: function () { goRoot('plan'); } })
      })
    });
  }

  function failScreen(route, err) {
    var boot = document.getElementById('boot');
    if (!booted && boot) {
      boot.hidden = false;
      boot.textContent = 'Something went wrong drawing the page: ' + (err && err.message || err);
    }
    return shell({
      header: stack.length > 1 ? UI.header({ onBack: back, title: 'Something went wrong' }) : null,
      cls: 'is-airy' + (stack.length > 1 ? '' : ' has-dock'),
      dock: stack.length > 1 ? null : (route.name === 'plan' ? 'plan' : 'week'),
      body: UI.card({
        title: 'This screen could not be drawn',
        sub: String(err && err.message || err),
        body: h('p', { class: 'note-text' }, 'Your data is not affected. Go back and try again; if it keeps happening, export your data from Plan.'),
        foot: UI.btn('Go to Plan', { variant: 'tertiary', block: true, onClick: function () { goRoot('plan'); } })
      })
    });
  }

  /* ---- Motion: every render is animated. The View Transitions API morphs the old
     page into the new one; the curves and durations are tokens in styles.css. ---- */

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  // What kind of change this render is, read from the stack and the route.
  function motionFor(route) {
    if (motion) return motion;
    if (route === lastRendered) {
      var was = route.shownWeek;   // set by weekScreen to the week it drew
      if (route.week && was && route.week !== was) return route.week > was ? 'week-next' : 'week-prev';
      return 'same';
    }
    if (stack.length > lastDepth) return 'forward';
    if (stack.length < lastDepth) return 'back';
    return 'fade';
  }
  function hashKey(s) {
    var x = 5381;
    for (var i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0;
    return x.toString(36);
  }
  // Names the parts that should morph rather than crossfade. In place, each visible
  // block of the screen keeps its identity, so it glides to its new size and place.
  function nameParts(scope, kind) {
    if (!scope) return;
    function set(el, n) { el.style.viewTransitionName = n || ''; }
    var slide = kind === 'forward' || kind === 'back';
    var dock = scope.querySelector('.dock');
    if (dock) set(dock, slide ? '' : 'dock');
    Array.prototype.forEach.call(scope.querySelectorAll('.dock-tab'), function (t, i) {
      set(t, slide ? '' : 'dock-tab-' + i);
    });
    var hdr = scope.querySelector('.hdr');
    if (hdr) set(hdr, kind === 'same' ? 'hdr' : '');
    // A week change moves only what differs: parts marked data-vt keep their identity
    // across the render, everything else is identical and stays perfectly still.
    var week = kind === 'week-next' || kind === 'week-prev';
    Array.prototype.forEach.call(scope.querySelectorAll('[data-vt]'), function (el) {
      set(el, week ? 'vt-' + el.dataset.vt : '');
    });
    var sc = scope.querySelector('.screen');
    if (!sc) return;
    var vh = window.innerHeight, seen = {};
    Array.prototype.forEach.call(sc.children, function (el) {
      if (kind !== 'same') { set(el, ''); return; }   // the page moves as one, or only its marked parts
      var r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh || !r.height) { set(el, ''); return; }
      var title = el.querySelector('.card-title, .row-title, .cycle-name, .week-heading');
      var key = (el.className || el.tagName) + '|' + (title ? title.textContent : '');
      seen[key] = (seen[key] || 0) + 1;
      set(el, 'p-' + hashKey(key + '|' + seen[key]));
    });
  }

  function render() {
    var route = top();
    var kind = motionFor(route);
    motion = '';
    // A render that focuses a field stays inside the tap, or iOS won't raise the keyboard.
    var animate = booted && !reducedMotion() && route.afterRender !== focusMarked;
    if (!animate || !document.startViewTransition) {
      paint(animate ? kind : '');
      return;
    }
    var root = document.documentElement;
    var token = ++motionToken;
    nameParts(appEl, kind);
    root.setAttribute('data-motion', kind);
    var t = document.startViewTransition(function () { paint('', kind); });
    var done = function () { if (token === motionToken) root.removeAttribute('data-motion'); };
    t.finished.then(done, done);
    // A quick second tap, or a hidden page, skips a transition. The page still updates.
    t.ready.catch(function () {});
    t.updateCallbackDone.catch(function (e) { console.error(e); });
  }

  // fallbackKind: no View Transitions here, so the new screen eases in with CSS instead.
  function paint(fallbackKind, vtKind) {
    var route = top();
    var old = appEl.querySelector('.screen');
    var keep = lastRendered === route && old ? old.scrollTop : (route.scroll || 0);
    var node, failed = false;
    try { node = SCREENS[route.name](route); }
    catch (e) { console.error(e); failed = true; node = failScreen(route, e); }
    appEl.replaceChildren(node);
    var sc = appEl.querySelector('.screen');
    if (sc) sc.scrollTop = keep;
    var enter = { 'tab-left': 'left', back: 'left', 'week-prev': 'left', 'tab-right': 'right', forward: 'right', 'week-next': 'right' }[fallbackKind];
    if (sc && enter) sc.classList.add('enter-' + enter);
    if (vtKind) nameParts(appEl, vtKind);
    lastRendered = route;
    lastDepth = stack.length;
    if (!failed && !booted) {
      booted = true;
      var boot = document.getElementById('boot');
      if (boot) boot.hidden = true;
    }
    if (typeof route.afterRender === 'function') {
      var fn = route.afterRender;
      route.afterRender = null;
      try { fn(node); } catch (e2) { console.error(e2); }
    }
  }

  /* ====================================================================
     Week and Past-cycle
     ==================================================================== */

  // Marks a part that should keep its identity across a week change (see nameParts).
  function markVt(el, key) { el.dataset.vt = key; return el; }

  function weekPills(cycle, route, live, current, selected, total) {
    var cells = [];
    for (var k = 1; k <= total; k++) (function (k) {
      var cls = 'week-pill';
      if (live ? k < current : true) cls += ' is-done';
      if (cycle.deload.indexOf(k) >= 0) cls += ' is-deload';
      if (k === selected) cls += ' is-selected';
      var tag = live && k === current ? 'Now' : (cycle.deload.indexOf(k) >= 0 ? 'Deload' : '');
      cells.push(h('div', { class: 'week-pill-cell' },
        // The selected week's dark fill is its own element, so on a week change it glides across.
        k === selected ? h('span', { class: 'week-pill-thumb', 'aria-hidden': 'true', dataset: { vt: 'week-thumb' } }) : null,
        h('button', {
          type: 'button', class: cls, dataset: { vt: 'week-pill-' + k },
          'aria-label': 'Week ' + k + ((live ? k < current : true) ? ', completed' : ''),
          'aria-current': k === selected ? 'true' : null,
          onClick: function () { route.week = k; render(); }
        }, String(k)),
        h('div', { class: 'week-pill-tag' }, tag)));
    })(k);
    return h('div', { class: 'week-pills' + (total > 7 ? ' is-many' : '') }, cells);
  }

  function sessionCard(cycle, route, live, n, current, slot) {
    var workout = workoutOf(cycle, slot.workoutId);
    var session = Data.sessionFor(cycle.id, n, slot.id);
    var done = !!(session && session.completedAt);
    var isDeload = cycle.deload.indexOf(n) >= 0;
    var name = workout ? (workout.name || 'Untitled workout') : (session && session.workoutName) || 'No workout';
    var sub = workout ? plural(exerciseCount(workout), 'exercise', 'exercises') : 'No workout';
    if (isDeload) sub += ' · deload';
    var past = !live || n < current;
    var trail;
    if (done) trail = UI.pill('Done', { dark: true, icon: 'check' });
    else if (past) trail = h('span', { class: 'session-state' }, 'Not done');
    else trail = UI.icon('forward', 20);
    var openable = live && (workout || session);
    return h('button', {
      type: 'button', class: 'session-card', disabled: !openable, dataset: { vt: 'week-session-' + hashKey(String(slot.id)) },
      onClick: function () {
        route.week = n;
        push({ name: 'logger', cycleId: cycle.id, week: n, slotId: slot.id });
      }
    },
      h('span', { class: 'day-badge' }, dayLabel(slot.day)),
      h('span', { class: 'session-main' },
        h('span', { class: 'session-name' }, name),
        h('span', { class: 'session-sub' }, sub)),
      trail);
  }

  function weekScreen(route) {
    var live = route.name === 'week';
    var cycle = live ? Data.activeCycle() : cycleById(route.cycleId);

    if (!cycle) {
      if (!live) return notFound('That cycle no longer exists.');
      return shell({
        cls: 'is-airy is-centred has-dock', dock: 'week',
        body: UI.empty({
          title: 'No cycle running',
          text: 'Start a new cycle from Plan. Your last cycle is in Past cycles.',
          action: { label: 'Go to Plan', onClick: function () { goRoot('plan'); } }
        })
      });
    }

    var total = Math.max(1, Math.floor(+cycle.weeks) || 1);
    var current = Data.currentWeek(cycle);
    var n = Math.min(Math.max(route.week || (live ? current : 1), 1), total);
    route.shownWeek = n;
    var isDeload = cycle.deload.indexOf(n) >= 0;

    function setWeek(k) { route.week = Math.min(Math.max(k, 1), total); render(); }

    // How many of this week's sessions are done, and over the whole cycle.
    var weekDone = 0, cycleDone = 0;
    cycle.slots.forEach(function (s) {
      for (var wk = 1; wk <= total; wk++) {
        var ss = Data.sessionFor(cycle.id, wk, s.id);
        if (ss && ss.completedAt) { cycleDone++; if (wk === n) weekDone++; }
      }
    });

    var statusEl;
    if (!live) statusEl = UI.status(weekDone + ' of ' + cycle.slots.length + ' done', 'dark');
    else if (n === current) statusEl = UI.status('This week', 'accent');
    else if (n < current) statusEl = UI.status('Past week', 'grey');
    else statusEl = UI.status('Upcoming', 'light');

    var head = h('div', { class: 'week-head' },
      h('div', { class: 'week-head-text' },
        h('span', { class: 'week-range', dataset: { vt: 'week-range' } }, weekRangeText(cycle, n)),
        h('h1', { class: 'week-heading' }, 'Week ',
          h('span', { class: 'week-num', dataset: { vt: 'week-num' } }, String(n)), ' ',
          h('span', { class: 'of', dataset: { vt: 'week-of' } }, 'of ' + total))),
      h('div', { class: 'week-nav' },
        UI.iconBtn('back', function () { setWeek(n - 1); }, 'Previous week', { outline: true, disabled: n <= 1 }),
        UI.iconBtn('forward', function () { setWeek(n + 1); }, 'Next week', { outline: true, disabled: n >= total })));
    head.querySelectorAll('.week-nav .icon-btn').forEach(function (b, i) { markVt(b, i ? 'week-next-btn' : 'week-prev-btn'); });
    markVt(statusEl, 'week-status');

    var tags = h('div', { class: 'tag-row' },
      statusEl,
      isDeload ? markVt(UI.pill('Deload week', { dashed: true }), 'week-deload') : null,
      live && n !== current
        ? h('button', { type: 'button', class: 'tag-link', dataset: { vt: 'week-back' }, onClick: function () { setWeek(current); } }, 'Back to this week')
        : null);

    var cycleCard = UI.card({
      body: [
        h('div', { class: 'between' },
          h('span', { class: 'muted' }, 'Cycle'),
          h('span', { class: 'muted' }, 'Started ' + fmtDM(cycle.start))),
        weekPills(cycle, route, live, current, n, total)
      ],
      foot: 'Swipe left or right to change week.'
    });

    var summary = null;
    if (!live) {
      summary = UI.card({
        body: UI.inset([['Sessions done', cycleDone + ' of ' + (cycle.slots.length * total), 'strong']]),
        foot: cycle.achievements
          ? [h('span', {}, 'Key achievements'), h('span', { class: 'card-foot-value pre' }, cycle.achievements)]
          : null,
        footStack: true
      });
    }

    var sessions = cycle.slots.length
      ? h('div', { class: 'stack', style: { gap: '8px' } },
        cycle.slots.map(function (s) { return sessionCard(cycle, route, live, n, current, s); }))
      : UI.card({
        body: h('p', { class: 'note-text' }, live
          ? 'No sessions planned. Open the cycle from Plan, edit a workout and choose its days.'
          : 'This cycle had no sessions planned.')
      });

    var header = live ? null : UI.header({
      onBack: back, sub: 'Past cycle', title: cycle.name || 'Cycle',
      right: UI.status('Read only', 'grey')
    });

    var node = shell({
      header: header,
      cls: 'is-airy swipe-area' + (live ? ' has-dock' : ''),
      dock: live ? 'week' : null,
      body: [head, tags, cycleCard, summary, h('h2', { class: 'section-label' }, 'Sessions'), sessions]
    });

    // Defer the re-render so the click that follows the swipe is swallowed by
    // the element it started on, not by the freshly built one.
    UI.onSwipe(node.screenEl, {
      onLeft: function () { setTimeout(function () { if (top() === route) setWeek(n + 1); }, 0); },
      onRight: function () { setTimeout(function () { if (top() === route) setWeek(n - 1); }, 0); }
    });
    return node;
  }
  SCREENS.week = weekScreen;
  SCREENS.past = weekScreen;

  /* ====================================================================
     Logger
     ==================================================================== */

  function newEntry(ex, block) {
    return {
      exerciseId: ex.id, name: ex.name, link: ex.link || null, target: ex.target, note: ex.note,
      block: block.name, sets: Array(Math.max(1, +block.sets || 1)).fill(''), rpe: ''
    };
  }

  function loggerScreen(route) {
    var cycle = cycleById(route.cycleId);
    var slot = cycle && cycle.slots.filter(function (s) { return s.id === route.slotId; })[0];
    if (!cycle || !slot) return notFound('That session slot no longer exists.');
    var workout = workoutOf(cycle, slot.workoutId);

    function getSession() { return route.session || Data.sessionFor(cycle.id, route.week, slot.id); }
    var session = getSession();
    var completed = !!(session && session.completedAt);
    var multiOn = activeCollections().length > 1;

    // Nothing exists until the first keystroke (or Complete). Then one draft
    // session, with an entry per exercise, goes to the front of the list.
    function ensureSession() {
      var s = getSession();
      if (s) { route.session = s; return s; }
      s = {
        id: Data.uid(), cycleId: cycle.id, week: route.week, slotId: slot.id,
        workoutId: slot.workoutId, workoutName: workout ? workout.name : '',
        date: Data.todayISO(), completedAt: null,
        deload: cycle.deload.indexOf(route.week) >= 0,
        entries: [], milestones: [], note: ''
      };
      if (workout) workout.blocks.forEach(function (b) {
        if (b.warmup) return;   // nothing is recorded for warm-up / prep
        b.exercises.forEach(function (ex) { s.entries.push(newEntry(ex, b)); });
      });
      Data.state.sessions.unshift(s);
      route.session = s;
      return s;
    }
    function entryFor(s, ex, block) {
      var en = s.entries.filter(function (e) { return e.exerciseId === ex.id; })[0];
      if (!en) { en = newEntry(ex, block); s.entries.push(en); }
      return en;
    }
    function onSet(ex, block, r, value) {
      var s = ensureSession();
      var en = entryFor(s, ex, block);
      while (en.sets.length <= r) en.sets.push('');
      en.sets[r] = value;
      if (!s.completedAt) {   // keep a draft's copies of name/target in step with the workout
        en.name = ex.name; en.link = ex.link || null; en.target = ex.target; en.note = ex.note; en.block = block.name;
      }
      saveNow();
    }

    function onRpe(ex, block, value) {
      var s = ensureSession();
      entryFor(s, ex, block).rpe = value;
      saveNow();
    }

    function badgeEl(link) {
      var b = link ? Data.rungBadge(link) : null;
      if (!b || !b.on) return null;
      return UI.rungBadge((multiOn ? b.short + ' · ' : '') + b.ladderName + ' ' + b.index1 + '/' + b.total);
    }
    function setInput(value, aria, onValue, extra) {
      var v = value == null ? '' : String(value);
      var numeric = v === '' || !isNaN(Number(v));   // an old free-text value must stay readable
      var attrs = {
        class: 'logger-input', type: numeric ? 'number' : 'text', inputmode: 'numeric',
        value: v, 'aria-label': aria, onInput: function (e) { onValue(e.target.value); }
      };
      Object.keys(extra || {}).forEach(function (k) { attrs[k] = extra[k]; });
      return h('input', attrs);
    }
    function lastText(v) { return v != null && v !== '' ? 'Last ' + v : 'No previous'; }

    // One block: its exercises listed first (tag, name, target and last time,
    // note, ladder), then an inset grid with a column per exercise, a row per
    // set or round, and an RPE row. items: [{ tag, src, sets(r), last(r),
    // onSet(r, v), rpe, lastRpe, onRpe(v) }].
    function blockCard(title, pillText, items, rows, label) {
      var list = items.map(function (it) {
        var lastAll = it.lastSets && it.lastSets.some(function (x) { return x !== '' && x != null; })
          ? it.lastSets.filter(function (x) { return x !== '' && x != null; }).join(' · ') : null;
        return h('div', { class: 'lx-ex' },
          h('span', { class: 'lx-tag' }, it.tag),
          h('div', { class: 'lx-ex-main' },
            h('span', { class: 'lx-ex-name' }, it.src.name || 'Untitled'),
            h('span', { class: 'lx-ex-sub' },
              'Target ' + (it.src.target || '—') + ' · ' + (lastAll ? 'Last ' + lastAll : 'No previous')),
            it.src.note || badgeEl(it.src.link)
              ? h('div', { class: 'lx-ex-chips' },
                it.src.note ? h('span', { class: 'note-pill' }, it.src.note) : null,
                badgeEl(it.src.link))
              : null));
      });
      var grid = [h('div', { class: 'lx-row lx-head' },
        h('span', { class: 'lx-label' }),
        items.map(function (it) { return h('span', { class: 'lx-col-tag' }, it.tag); }))];
      for (var r = 0; r < rows; r++) (function (r) {
        grid.push(h('div', { class: 'lx-row' },
          h('span', { class: 'lx-label' }, label + (r + 1)),
          items.map(function (it) {
            var lastV = it.lastSets && it.lastSets[r] != null && it.lastSets[r] !== '' ? it.lastSets[r] : null;
            return h('div', { class: 'lx-cell' },
              setInput(it.sets(r), (it.src.name || 'Exercise') + ', ' + (label === 'R' ? 'round ' : 'set ') + (r + 1) +
                (lastV != null ? ', last time ' + lastV : ''), function (v) { it.onSet(r, v); }),
              h('span', { class: 'lx-last' }, lastText(lastV)));
          })));
      })(r);
      grid.push(h('div', { class: 'lx-row lx-rpe' },
        h('span', { class: 'lx-label' }, 'RPE'),
        items.map(function (it) {
          return h('div', { class: 'lx-cell' },
            setInput(it.rpe, 'RPE for ' + (it.src.name || 'exercise') +
              (it.lastRpe ? ', last time ' + it.lastRpe : ''), it.onRpe,
              { placeholder: '1–10', min: '1', max: '10', class: 'logger-input is-rpe' }),
            h('span', { class: 'lx-last' }, lastText(it.lastRpe)));
        })));
      return UI.card({
        class: 'lx-card',
        body: [
          h('div', { class: 'between lx-head-row' },
            h('span', { class: 'card-title', style: { padding: 0 } }, title),
            UI.pill(pillText)),
          h('div', { class: 'lx-list' }, list),
          h('div', { class: 'lx-grid' + (items.length > 3 ? ' is-wide' : '') }, grid)
        ]
      });
    }

    // Warm-up / prep: the exercises as a list, nothing to record.
    function warmupCard(b) {
      var multi = b.exercises.length > 1;
      return UI.card({
        class: 'lx-card is-warmup',
        body: [
          h('div', { class: 'between lx-head-row' },
            h('span', { class: 'card-title', style: { padding: 0 } }, 'Warm-up / prep'),
            UI.pill('Nothing to log')),
          h('div', { class: 'lx-list' }, b.exercises.map(function (ex, i) {
            var src = ex;
            return h('div', { class: 'lx-ex' },
              h('span', { class: 'lx-tag is-light' }, 'W' + (multi ? (i + 1) : '')),
              h('div', { class: 'lx-ex-main' },
                h('span', { class: 'lx-ex-name' }, src.name || 'Untitled'),
                src.target ? h('span', { class: 'lx-ex-sub' }, src.target) : null,
                src.note ? h('div', { class: 'lx-ex-chips' }, h('span', { class: 'note-pill' }, src.note)) : null));
          }))
        ]
      });
    }

    var claimed = [];
    var cards = [];

    var warm = warmupOf(workout);
    if (warm && warm.exercises.length) cards.push(warmupCard(warm));
    mainBlocks(workout).forEach(function (b, bi) {
      if (!b.exercises.length) return;
      var multi = b.exercises.length > 1;
      var items = b.exercises.map(function (ex, i) {
        var en = session ? session.entries.filter(function (e) { return e.exerciseId === ex.id; })[0] : null;
        if (en) claimed.push(en);
        var last = Data.lastEntry(slot.workoutId, ex.id, session && session.id);
        return {
          tag: blockLetter(bi) + (multi ? (i + 1) : ''),
          src: completed && en ? en : ex,
          en: en,
          lastSets: last ? last.sets : null,
          lastRpe: last && last.rpe !== '' ? last.rpe : null,
          sets: function (r) { return en ? en.sets[r] : ''; },
          rpe: en ? en.rpe : '',
          onSet: function (r, v) { onSet(ex, b, r, v); },
          onRpe: function (v) { onRpe(ex, b, v); }
        };
      });
      var rows = Math.max(+b.sets || 1, Math.max.apply(null, items.map(function (it) { return it.en ? it.en.sets.length : 0; })));
      cards.push(blockCard(b.name || 'Block ' + blockLetter(bi),
        multi ? 'Superset · ' + plural(b.sets, 'round', 'rounds') : plural(b.sets, 'set', 'sets'),
        items, rows, multi ? 'R' : 'S'));
    });

    // Entries the workout no longer has an exercise for stay visible and editable.
    var orphans = session ? session.entries.filter(function (e) { return claimed.indexOf(e) < 0; }) : [];
    if (orphans.length) {
      cards.push(blockCard('Other logged exercises', 'Not in this workout',
        orphans.map(function (en, i) {
          return {
            tag: String(i + 1), src: en, en: en, lastSets: null, lastRpe: null,
            sets: function (r) { return en.sets[r]; },
            rpe: en.rpe,
            onSet: function (r, v) { while (en.sets.length <= r) en.sets.push(''); en.sets[r] = v; saveNow(); },
            onRpe: function (v) { en.rpe = v; saveNow(); }
          };
        }),
        Math.max.apply(null, orphans.map(function (en) { return en.sets.length || 1; })), 'S'));
    }

    if (!cards.length) {
      cards.push(UI.card({ body: h('p', { class: 'note-text' }, 'This session has no exercises. Edit its workout from the Cycle screen.') }));
    }

    function complete() {
      var ok = tx(function () {
        var s = ensureSession();
        if (!s.completedAt) s.completedAt = new Date().toISOString();
      });
      if (ok) back(); else render();
    }

    return shell({
      header: UI.header({
        onBack: back,
        sub: dayLabel(slot.day) + ' · Week ' + route.week,
        title: workout ? (workout.name || 'Untitled workout') : ((session && session.workoutName) || 'Session')
      }),
      body: cards,
      foot: h('div', { class: 'foot-bar' },
        UI.btn(completed ? 'Update session' : 'Complete session', { large: true, block: true, onClick: complete }))
    });
  }
  SCREENS.logger = loggerScreen;

  /* ====================================================================
     Plan
     ==================================================================== */

  function nextMonday() {
    var today = Data.todayISO();
    var dow = new Date(today + 'T00:00:00Z').getUTCDay();   // 0 = Sunday
    return Data.addDays(today, (8 - dow) % 7);
  }

  function newCycle() {
    if (Data.activeCycle()) { ui.newCycleHint = true; render(); return; }
    var created = null;
    var ok = tx(function () {
      var src = Data.endedCycles()[0] || null;
      // Workouts keep their ids (the "Last N" lookup matches on workoutId across
      // cycles). Blocks and exercises are new, and so are the slots.
      var workouts = src ? clone(src.workouts) : [];
      workouts.forEach(function (w) {
        delete w.v1;
        w.blocks.forEach(function (b) {
          b.id = Data.uid(); delete b.v1;
          b.exercises.forEach(function (e) { e.id = Data.uid(); delete e.v1; });
        });
      });
      var slots = src ? src.slots.map(function (s) { var c = clone(s); c.id = Data.uid(); delete c.v1; return c; }) : [];
      created = {
        id: Data.uid(), name: 'Cycle ' + (Data.state.cycles.length + 1), objective: '',
        start: nextMonday(), weeks: 6, deload: [], workouts: workouts, slots: slots,
        status: 'active', achievements: '', endedAt: null
      };
      Data.state.cycles.push(created);
    });
    if (!ok) { render(); return; }
    push({ name: 'cycle' });
  }

  function exportData() {
    var text;
    try { text = Data.exportJSON(); } catch (e) { showError("Couldn't build the export: " + e.message); return; }
    download('bodyweight-ladders-' + todayStamp() + '.json', text);
  }

  function download(name, text) {
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var a = h('a', { href: url, download: name, style: { display: 'none' } });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 1000);
  }

  function pickImportFile() {
    var input = h('input', {
      type: 'file', accept: 'application/json,.json', class: 'sr-only', tabindex: '-1',
      onChange: function () {
        var file = input.files && input.files[0];
        input.remove();
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          ui.importError = ''; ui.importNote = '';
          try {
            var state = Data.importJSON(String(reader.result));
            ui.importDraft = { state: state, name: file.name, backup: Data.importedBackup };
          } catch (e) {
            ui.importDraft = null;
            ui.importError = e && e.message || String(e);
          }
          render();
        };
        reader.onerror = function () { ui.importError = "Couldn't read that file."; render(); };
        reader.readAsText(file);
      }
    });
    document.body.appendChild(input);
    input.click();
  }

  function stateSummary(st) {
    var done = st.sessions.filter(function (s) { return s.completedAt; }).length;
    return plural(st.cycles.length, 'cycle', 'cycles') + ', ' + plural(st.sessions.length, 'session', 'sessions') +
      (done !== st.sessions.length ? ' (' + done + ' completed)' : '') + ', ' +
      plural(st.collections.length, 'collection', 'collections');
  }

  function adoptState(state, backup) {
    try {
      Data.importedBackup = backup || null;
      var ok = Data.adopt(state);
      if (!ok) { showError(SAVE_FAILED, 'save'); return false; }
      clearError('save');
      return true;
    } catch (e) {
      console.error(e);
      showError("Couldn't replace your data: " + (e && e.message || e) + '. Nothing was changed.');
      return false;
    }
  }

  function importCard() {
    var d = ui.importDraft;
    var body = [h('p', { class: 'note-text' }, 'Data lives on this phone only.')];
    if (ui.importNote) body.push(h('p', { class: 'note-text is-soft' }, ui.importNote));
    if (ui.importError) body.push(h('p', { class: 'note-text is-soft' }, ui.importError));
    if (d) {
      body.push(UI.inset([
        ['File', d.name],
        ['Contains', stateSummary(d.state)]
      ]));
      body.push(h('p', { class: 'note-text' }, 'Replacing swaps everything on this phone for the contents of this file. What is here now is kept as a safety copy.'));
      body.push(h('div', { class: 'builder-actions' },
        UI.twoStep('Replace all data', 'Replace all data?', function () {
          if (adoptState(d.state, d.backup)) {
            ui.importDraft = null;
            ui.importNote = 'Imported ' + d.name + '.';
            goRoot('plan');
          } else render();
        }, { small: true }),
        UI.btn('Discard', { variant: 'outline', small: true, onClick: function () { ui.importDraft = null; render(); } })));
    }
    return UI.card({
      title: 'Backup', body: body,
      foot: h('div', { class: 'foot-pair' },
        UI.btn('Export data', { variant: 'tertiary', onClick: exportData }),
        UI.btn('Import', { variant: 'outline', onClick: pickImportFile }))
    });
  }

  /* ---- v1 drift: the old version saved data after the upgrade ---- */

  function hashStr(s) {
    var x = 5381;
    for (var i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0;
    return x.toString(36);
  }
  function driftSignature(keys) {
    return keys.map(function (k) { return k + ':' + hashStr(storage.getItem(k) || ''); }).join('|');
  }
  function driftDismissed(sig) {
    try { return (JSON.parse(storage.getItem(UI_KEY) || '{}') || {}).driftDismissed === sig; }
    catch (e) { return false; }
  }
  function dismissDrift() {
    if (ui.drift) {
      try {
        var cur = {};
        try { cur = JSON.parse(storage.getItem(UI_KEY) || '{}') || {}; } catch (e) { cur = {}; }
        cur.driftDismissed = ui.drift.sig;
        storage.setItem(UI_KEY, JSON.stringify(cur));
      } catch (e2) { /* a notice that comes back is not a data problem */ }
    }
    ui.drift = null;
  }
  function checkDrift() {
    try {
      var keys = Data.v1Drift(storage);
      if (!keys.length) return;
      var sig = driftSignature(keys);
      if (!driftDismissed(sig)) ui.drift = { keys: keys, sig: sig, state: null, raws: null, error: '' };
    } catch (e) { console.error(e); }
  }
  function importDrift() {
    var d = ui.drift;
    try {
      var raws = {};
      Object.keys(Data.V1_KEYS).forEach(function (n) {
        var v = storage.getItem(Data.V1_KEYS[n]);
        if (v != null) raws[Data.V1_KEYS[n]] = v;
      });
      var v1 = Data.v1FromRaw(raws);
      d.state = Data.migrateV1(v1, chart);
      d.raws = raws;
      d.error = '';
    } catch (e) {
      d.state = null;
      d.error = "Couldn't read the old data: " + (e && e.message || e);
    }
    render();
  }
  function driftCard() {
    var d = ui.drift;
    var body = [h('p', { class: 'note-text' },
      'Something wrote to the old version\'s storage after your data was moved here. Your current data is untouched. ' +
      'You can bring the old data in, but it replaces what is here now.')];
    if (d.error) body.push(h('p', { class: 'note-text is-soft' }, d.error));
    if (d.state) {
      body.push(UI.inset([['Old data contains', stateSummary(d.state)]]));
      body.push(h('p', { class: 'note-text' },
        'Anything logged in this version since the upgrade will not be in it. What is here now is kept as a safety copy.'));
    }
    var foot = d.state
      ? [UI.btn('Not now', { variant: 'outline', small: true, onClick: function () { d.state = null; render(); } }),
        UI.twoStep('Replace with old data', 'Replace all data?', function () {
          if (adoptState(d.state, { takenAt: new Date().toISOString(), keys: d.raws })) {
            dismissDrift();
            ui.importNote = 'Brought in the old data.';
            goRoot('plan');
          } else render();
        }, { small: true })]
      : [UI.btn('Dismiss', { variant: 'outline', small: true, onClick: function () { dismissDrift(); render(); } }),
        UI.btn('Import it', { small: true, onClick: importDrift })];
    return UI.card({ title: 'The old version saved data after the upgrade', body: body, foot: foot });
  }

  /* ---- Appearance: Auto follows the system, Light and Dark pin it ---- */

  function appearance() {
    try { var t = storage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'auto'; }
    catch (e) { return 'auto'; }
  }
  function applyAppearance(t) {
    var root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
    var meta = document.querySelector('meta[name="theme-color"]');
    var bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (meta && bg) meta.setAttribute('content', bg);
  }
  function appearanceCard() {
    return UI.card({
      title: 'Appearance',
      body: UI.seg([
        { value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }
      ], appearance(), function (v) {
        try {
          if (v === 'auto') storage.removeItem(THEME_KEY);
          else storage.setItem(THEME_KEY, v);
        } catch (e) { /* the choice still applies until reload */ }
        applyAppearance(v);
        render();
      })
    });
  }

  // The deployed version, read from app.js's own ?v= so there is no second number to bump.
  function appVersion() {
    var el = document.querySelector('script[src*="app.js"]');
    var m = el && /[?&]v=([^&]+)/.exec(el.getAttribute('src'));
    return m ? m[1] : 'unknown';
  }

  function planScreen() {
    var cycle = Data.activeCycle();
    var ended = Data.endedCycles();
    var cols = Data.state.collections;
    var onCols = activeCollections();
    var body = [];

    if (ui.drift) body.push(driftCard());

    if (cycle) {
      var sessionsPerWeek = cycle.slots.length;
      body.push(UI.card({
        onClick: function () { push({ name: 'cycle' }); },
        body: [
          h('div', { class: 'between', style: { alignItems: 'flex-start' } },
            h('div', { class: 'stack', style: { gap: '6px', minWidth: 0 } },
              h('span', { class: 'screen-kicker' }, 'Current cycle'),
              h('span', { class: 'cycle-name' }, cycle.name || 'Untitled cycle')),
            h('span', { class: 'icon-btn', 'aria-hidden': 'true' }, UI.icon('forward', 20))),
          h('div', {}, UI.status('Week ' + Data.currentWeek(cycle) + ' of ' + cycle.weeks, 'accent')),
          UI.inset([
            ['Workouts', cycle.workouts.length + ' · ' + plural(sessionsPerWeek, 'session', 'sessions') + ' a week'],
            ['Weeks', String(cycle.weeks)],
            ['Start', fmtDM(cycle.start)],
            'divider',
            ['Deload', deloadText(cycle), 'strong']
          ])
        ],
        foot: [h('span', {}, 'Key objective'), h('span', { class: 'card-foot-value' }, cycle.objective || 'Not set')],
        footStack: true
      }));
    } else {
      body.push(UI.empty({ title: 'No cycle running', text: 'A new cycle imports the workouts from your last one.' }));
    }

    body.push(h('div', { class: 'stack centre' },
      UI.btn('New cycle', { large: true, icon: 'plus', onClick: newCycle }),
      ui.newCycleHint && cycle
        ? h('p', { class: 'note-text is-soft is-center' }, 'End the current cycle before starting a new one. Open it and use End cycle.')
        : null));

    body.push(UI.card({
      title: 'Past cycles', sub: 'When they ran and what they got you.', list: true,
      body: ended.length
        ? ended.map(function (c) {
          return UI.row({
            title: periodText(c), sub: c.achievements || 'No achievements written',
            onClick: function () { push({ name: 'past', cycleId: c.id, week: 1 }); }
          });
        })
        : h('div', { class: 'list-empty' }, 'None yet')
    }));

    body.push(UI.card({
      title: 'Ladders', sub: 'Collections you can link exercises to. Nothing moves automatically.', list: true,
      body: cols.map(function (col) {
        return UI.row({
          title: col.name, sub: collectionCounts(col),
          trail: UI.toggle(col.on, function (checked) { commit(function () { col.on = checked; }); }, 'Use ' + col.name)
        });
      }),
      foot: [
        UI.btn('Add collection', { variant: 'outline', onClick: function () { push(builderRoute(null)); } }),
        onCols.length ? UI.btn('Open ladders', {
          onClick: function () {
            if (onCols.length === 1) push({ name: 'collection', collId: onCols[0].id });
            else push({ name: 'collections' });
          }
        }) : null
      ]
    }));

    body.push(appearanceCard());
    body.push(importCard());
    body.push(h('p', { class: 'note-text is-center version-line' }, 'Version ' + appVersion()));

    return shell({ cls: 'is-airy has-dock', dock: 'plan', body: body });
  }
  SCREENS.plan = planScreen;

  /* ====================================================================
     Cycle
     ==================================================================== */

  function cycleScreen(route) {
    var cycle = Data.activeCycle();
    if (!cycle) return notFound('There is no active cycle.');

    var header = UI.header({ onBack: back, sub: 'Current cycle', title: cycle.name || 'Untitled cycle' });
    var titleEl = header.querySelector('.hdr-title');

    var nameIn = UI.input({
      value: cycle.name, label: 'Name',
      onInput: function (e) { cycle.name = e.target.value; titleEl.textContent = cycle.name || 'Untitled cycle'; saveNow(); }
    });
    var objIn = UI.input({
      value: cycle.objective, label: 'Key objective', placeholder: 'What this cycle is for',
      onInput: function (e) { cycle.objective = e.target.value; saveNow(); }
    });
    var weeksIn = UI.input({
      type: 'number', inputmode: 'numeric', min: 1, max: 52, value: cycle.weeks, label: 'Weeks',
      onChange: function (e) {
        var v = parseInt(e.target.value, 10);
        v = isNaN(v) ? cycle.weeks : Math.max(1, Math.min(52, v));
        cycle.weeks = v;
        cycle.deload = cycle.deload.filter(function (w) { return w <= v; });
        e.target.value = v;
        deloadIn.value = cycle.deload.length > 1 ? cycle.deload.join(', ') : (cycle.deload[0] || '');
        saveNow();
      }
    });
    // deload is stored as an array; this one field reads deload[0] and writes [n] or [].
    var several = cycle.deload.length > 1;
    var deloadIn = UI.input({
      type: several ? 'text' : 'number', inputmode: 'numeric', min: 1,
      value: several ? cycle.deload.join(', ') : (cycle.deload[0] || ''),
      placeholder: 'None', label: 'Deload week',
      onChange: function (e) {
        var v = parseInt(e.target.value, 10);
        cycle.deload = isNaN(v) || v < 1 ? [] : [Math.min(v, cycle.weeks)];
        e.target.value = cycle.deload.length ? cycle.deload[0] : '';
        saveNow();
      }
    });
    var startIn = UI.input({
      type: 'date', value: cycle.start, label: 'Start',
      onChange: function (e) {
        if (isISO(e.target.value)) { cycle.start = e.target.value; saveNow(); }
        else e.target.value = cycle.start;
      }
    });

    var details = UI.card({
      title: 'Details', sub: 'Name, objective and schedule for this cycle.',
      body: [
        UI.field('Name', nameIn),
        UI.field('Key objective', objIn),
        h('div', { class: 'field-row' }, UI.field('Weeks', weeksIn), UI.field('Deload week', deloadIn)),
        UI.field('Start', startIn)
      ]
    });

    var workouts = UI.card({
      title: 'Workouts', list: true,
      body: cycle.workouts.length
        ? cycle.workouts.map(function (w) {
          var days = daysText(cycle, w.id);
          return UI.row({
            title: w.name || 'Untitled workout',
            sub: plural(exerciseCount(w), 'exercise', 'exercises') + ' · ' + (days || 'Not scheduled'),
            onClick: function () { push(editorRoute(cycle, w)); }
          });
        })
        : h('div', { class: 'list-empty' }, 'No workouts yet'),
      foot: UI.btn('New workout', { variant: 'tertiary', block: true, onClick: function () { push(editorRoute(cycle, null)); } })
    });

    var endArea;
    if (!route.ending) {
      endArea = h('div', { class: 'stack centre' },
        UI.btn('End cycle', { variant: 'outline', onClick: function () { route.ending = true; render(); } }));
    } else {
      var endBtn = UI.btn('End cycle', {
        disabled: !(route.ach || '').trim(),
        onClick: function () {
          var text = (route.ach || '').trim();
          if (!text) return;
          var prev = { status: cycle.status, achievements: cycle.achievements, endedAt: cycle.endedAt };
          cycle.status = 'ended'; cycle.achievements = text; cycle.endedAt = new Date().toISOString();
          if (!saveNow()) {
            cycle.status = prev.status; cycle.achievements = prev.achievements; cycle.endedAt = prev.endedAt;
            return;
          }
          back();
        }
      });
      var ta = UI.textarea({
        rows: 4, value: route.ach || '', placeholder: 'e.g. First strict pull up', label: 'Key achievements',
        onInput: function (e) { route.ach = e.target.value; endBtn.disabled = !e.target.value.trim(); }
      });
      endArea = h('div', { class: 'card' },
        h('div', { class: 'card-body' },
          h('div', { class: 'between', style: { alignItems: 'flex-start' } },
            h('div', { class: 'stack', style: { gap: '2px' } },
              h('span', { class: 'card-title', style: { padding: 0 } }, 'End ' + (cycle.name || 'cycle')),
              h('span', { class: 'card-sub' }, 'Write what this cycle got you. It moves to Past cycles and its log becomes read only.')),
            UI.iconBtn('close', function () { route.ending = false; render(); }, 'Close')),
          UI.field('Key achievements', ta)),
        h('div', { class: 'card-foot' },
          UI.btn('Cancel', { variant: 'outline', onClick: function () { route.ending = false; render(); } }),
          endBtn));
    }

    return shell({ header: header, body: [details, workouts, endArea] });
  }
  SCREENS.cycle = cycleScreen;

  /* ====================================================================
     Workout editor
     ==================================================================== */

  function blankExercise() { return { id: Data.uid(), name: '', target: '', note: '', link: null }; }
  function blankBlock(letter) { return { id: Data.uid(), name: 'Block ' + letter, sets: 3, exercises: [blankExercise()] }; }
  function blankWarmup() { return { id: Data.uid(), name: 'Warm-up', warmup: true, sets: 1, exercises: [blankExercise()] }; }

  function slotDays(cycle, workoutId) {
    var out = [];
    cycle.slots.forEach(function (s) {
      if (s.workoutId === workoutId && DAYS.indexOf(s.day) >= 0 && out.indexOf(s.day) < 0) out.push(s.day);
    });
    return out;
  }
  function sessionsInSlot(cycle, slotId) {
    return Data.state.sessions.filter(function (s) { return s.cycleId === cycle.id && s.slotId === slotId; }).length;
  }

  function editorRoute(cycle, workout) {
    var isNew = !workout;
    var draft = isNew ? { id: Data.uid(), name: 'New workout', blocks: [blankBlock('A')] } : clone(workout);
    var route = {
      name: 'editor', cycleId: cycle.id, isNew: isNew, draft: draft, original: clone(draft),
      days: isNew ? [] : slotDays(cycle, workout.id), origDays: isNew ? [] : slotDays(cycle, workout.id),
      pickFor: null, removeDay: null, guardArmed: false
    };
    route.dirty = function () {
      return !Data.deepEqual(route.draft, route.original) ||
        !Data.deepEqual(route.days.slice().sort(), route.origDays.slice().sort());
    };
    return route;
  }

  function guardCard(route) {
    return UI.card({
      title: 'Unsaved changes', sub: 'Save them, or discard to leave this screen.',
      foot: [
        UI.btn('Keep editing', { variant: 'outline', small: true, onClick: function () { route.guardArmed = false; render(); } }),
        UI.twoStep('Discard changes', 'Really discard?', function () { route.force = true; back(); }, { small: true, armed: true })
      ]
    });
  }

  function rungLabel(link) {
    var f = Data.findRung(link);
    if (!f) return null;
    var multi = activeCollections().length > 1;
    return (multi ? f.collection.short + ' · ' : '') + f.ladder.name + ' — ' + f.rung.name +
      ' (' + (f.index + 1) + '/' + f.ladder.rungs.length + ')';
  }

  function pickerList(ex, route) {
    var kids = [h('button', {
      type: 'button', class: 'picker-opt' + (!ex.link ? ' is-selected' : ''),
      onClick: function () { ex.link = null; route.pickFor = null; render(); }
    }, 'Not linked')];
    activeCollections().forEach(function (col) {
      kids.push(h('div', { class: 'picker-group' }, col.name));
      col.categories.forEach(function (cat) {
        cat.ladders.forEach(function (lad) {
          kids.push(h('div', { class: 'picker-group is-sub' }, (cat.name || 'Untitled category') + ' · ' + (lad.name || 'Untitled ladder')));
          lad.rungs.forEach(function (r, i) {
            kids.push(h('button', {
              type: 'button', class: 'picker-opt' + (r.id === ex.link ? ' is-selected' : ''),
              onClick: function () { ex.link = r.id; route.pickFor = null; render(); }
            }, (r.name || 'Untitled rung') + ' (' + (i + 1) + '/' + lad.rungs.length + ')'));
          });
        });
      });
    });
    return h('div', { class: 'picker-list', role: 'listbox' }, kids);
  }

  function exerciseEditor(route, block, ex, tag, noRung) {
    var open = route.pickFor === ex.id;
    var label = ex.link ? (rungLabel(ex.link) || 'Unknown rung') : '';
    var nameIn = UI.input({
      value: ex.name, placeholder: 'e.g. Archer Pull Up', label: 'Exercise',
      onInput: function (e) { ex.name = e.target.value; }
    });
    if (route.focusId === ex.id) { nameIn.setAttribute('data-focus', ''); route.focusId = null; }
    var picker = null;
    if (!noRung && activeCollections().length) {
      picker = h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Rung ', h('span', { class: 'muted' }, '· optional')),
        h('button', {
          type: 'button', class: 'picker-btn', 'aria-expanded': open ? 'true' : 'false',
          'aria-label': 'Rung: ' + (label || 'not linked'),
          onClick: function () { route.pickFor = open ? null : ex.id; if (!open) route.afterRender = scrollPickerToSelection; render(); }
        },
          h('span', { class: 'picker-value' + (label ? '' : ' is-empty') }, label || 'Not linked'),
          UI.icon('updown', 18)),
        open ? pickerList(ex, route) : null);
    }
    return h('div', { class: 'ex-edit' },
      h('div', { class: 'ex-edit-top' },
        UI.chip(tag),
        UI.twoStep('Remove', 'Really remove?', function () {
          block.exercises = block.exercises.filter(function (x) { return x !== ex; });
          if (route.pickFor === ex.id) route.pickFor = null;
          render();
        }, { small: true })),
      UI.field('Exercise', nameIn),
      h('div', { class: 'field-row' },
        UI.field('Target', UI.input({ value: ex.target, placeholder: '3×8', label: 'Target', onInput: function (e) { ex.target = e.target.value; } })),
        h('div', { style: { flex: '1.4 1 0', minWidth: 0 } },
          UI.field('Default note', UI.input({ value: ex.note, placeholder: 'Optional', label: 'Default note', onInput: function (e) { ex.note = e.target.value; } })))),
      picker);
  }

  // Bring the linked rung into view when the picker opens.
  function scrollPickerToSelection(node) {
    var list = node.querySelector('.picker-list');
    var opts = list ? list.querySelectorAll('.picker-opt') : [];
    var sel = list && list.querySelector('.picker-opt.is-selected');
    if (!sel || sel === opts[0]) return;
    list.scrollTop += sel.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientHeight / 2;
  }

  function blockEditor(route, block, bi) {
    var multi = block.exercises.length > 1;
    var nameIn = UI.input({ value: block.name, placeholder: 'Block name', label: 'Block name', onInput: function (e) { block.name = e.target.value; } });
    var setsIn = UI.input({
      type: 'number', inputmode: 'numeric', min: 1, max: 10, value: block.sets, label: multi ? 'Rounds' : 'Sets',
      onChange: function (e) {
        var v = parseInt(e.target.value, 10);
        block.sets = isNaN(v) ? 1 : Math.max(1, Math.min(10, v));
        e.target.value = block.sets;
      }
    });
    return h('div', { class: 'card' },
      h('div', { class: 'block-head' },
        h('div', { class: 'block-label' },
          'Block ' + blockLetter(bi),
          multi ? h('span', { class: 'pill' }, h('span', { class: 'pill-dot dot-dark' }), 'Superset') : null),
        h('div', { class: 'name-row' }, nameIn,
          h('div', { class: 'sets-box' }, setsIn, h('span', {}, multi ? 'Rounds' : 'Sets')))),
      block.exercises.map(function (ex, ei) {
        return exerciseEditor(route, block, ex, blockLetter(bi) + (multi ? (ei + 1) : ''));
      }),
      h('div', { class: 'card-foot is-col', style: { marginTop: '4px' } },
        UI.btn('Add exercise', {
          variant: 'tertiary', block: true, icon: 'plus',
          onClick: function () {
            var ex = blankExercise();
            block.exercises.push(ex);
            route.focusId = ex.id;
            route.afterRender = focusMarked;
            render();
          }
        }),
        UI.twoStep('Remove block', 'Really remove block?', function () {
          route.draft.blocks = route.draft.blocks.filter(function (b) { return b !== block; });
          render();
        }, { block: true, small: true })));
  }

  // The warm-up / prep card: exercises with a target and note, no sets, no rungs.
  function warmupEditor(route, block) {
    return h('div', { class: 'card is-warmup' },
      h('div', { class: 'block-head' },
        h('div', { class: 'block-label' }, 'Warm-up / prep'),
        h('p', { class: 'note-text' }, 'Listed at the top of the session. Nothing to record.')),
      block.exercises.map(function (ex, ei) {
        return exerciseEditor(route, block, ex, 'W' + (block.exercises.length > 1 ? (ei + 1) : ''), true);
      }),
      h('div', { class: 'card-foot is-col', style: { marginTop: '4px' } },
        UI.btn('Add exercise', {
          variant: 'tertiary', block: true, icon: 'plus',
          onClick: function () {
            var ex = blankExercise();
            block.exercises.push(ex);
            route.focusId = ex.id;
            route.afterRender = focusMarked;
            render();
          }
        }),
        UI.twoStep('Remove warm-up', 'Really remove warm-up?', function () {
          route.draft.blocks = route.draft.blocks.filter(function (b) { return b !== block; });
          render();
        }, { block: true, small: true })));
  }

  function focusMarked(node) {
    var el = node.querySelector('[data-focus]');
    if (el) { el.removeAttribute('data-focus'); el.focus(); }
  }

  function daysCard(route, cycle) {
    var chips = DAYS.map(function (d) {
      var on = route.days.indexOf(d) >= 0;
      return h('button', {
        type: 'button', class: 'day-chip' + (on ? ' is-on' : ''), 'aria-pressed': on ? 'true' : 'false',
        onClick: function () {
          if (!on) { route.days.push(d); route.removeDay = null; render(); return; }
          var n = 0;
          cycle.slots.forEach(function (s) {
            if (s.workoutId === route.draft.id && s.day === d) n += sessionsInSlot(cycle, s.id);
          });
          if (n > 0) route.removeDay = d;
          else { route.days = route.days.filter(function (x) { return x !== d; }); route.removeDay = null; }
          render();
        }
      }, DAY_LABEL[d]);
    });
    var body = [h('div', { class: 'day-chips' }, chips)];
    if (route.removeDay) {
      var d = route.removeDay, n = 0;
      cycle.slots.forEach(function (s) {
        if (s.workoutId === route.draft.id && s.day === d) n += sessionsInSlot(cycle, s.id);
      });
      body.push(h('div', { class: 'confirm-line' },
        h('p', { class: 'note-text is-soft' }, dayLabel(d) + ' has ' + plural(n, 'logged session', 'logged sessions') +
          '. They stay in your data, but the day leaves the Week screen.'),
        h('div', { class: 'builder-actions' },
          UI.twoStep('Remove ' + dayLabel(d), 'Really remove?', function () {
            route.days = route.days.filter(function (x) { return x !== d; });
            route.removeDay = null;
            render();
          }, { small: true, armed: true }),
          UI.btn('Keep day', { variant: 'outline', small: true, onClick: function () { route.removeDay = null; render(); } }))));
    }
    var stray = route.isNew ? 0 : cycle.slots.filter(function (s) {
      return s.workoutId === route.draft.id && DAYS.indexOf(s.day) < 0;
    }).length;
    if (stray) body.push(h('p', { class: 'note-text' }, plural(stray, 'session', 'sessions') +
      ' a week on no particular day. Pick days and its logged sessions move onto them.'));
    return UI.card({
      title: 'Days', sub: 'Each day is one session a week. Applied when you save.', body: body
    });
  }

  function saveWorkout(route) {
    var cycle = cycleById(route.cycleId);
    if (!cycle) return;
    var d = clone(route.draft);
    d.name = (d.name || '').trim() || 'Untitled workout';
    var ok = tx(function () {
      var idx = -1;
      cycle.workouts.forEach(function (w, i) { if (w.id === d.id) idx = i; });
      if (idx >= 0) cycle.workouts[idx] = d; else cycle.workouts.push(d);
      var current = cycle.slots.filter(function (s) { return s.workoutId === d.id && DAYS.indexOf(s.day) >= 0; });
      route.days.forEach(function (day) {
        if (current.some(function (s) { return s.day === day; })) return;
        var slot = { id: Data.uid(), day: day, workoutId: d.id };
        var at = -1, r = dayRank(day);
        cycle.slots.forEach(function (s, i) { if (at < 0 && dayRank(s.day) > r) at = i; });
        if (at < 0) cycle.slots.push(slot); else cycle.slots.splice(at, 0, slot);
      });
      current.forEach(function (s) {
        if (route.days.indexOf(s.day) < 0) cycle.slots.splice(cycle.slots.indexOf(s), 1);
      });
      Data.absorbDaylessSlots(cycle);
    });
    if (!ok) { render(); return; }
    route.force = true;
    back();
  }

  function deleteWorkout(route) {
    var cycle = cycleById(route.cycleId);
    if (!cycle) return;
    var ok = tx(function () {
      cycle.workouts = cycle.workouts.filter(function (w) { return w.id !== route.draft.id; });
      cycle.slots = cycle.slots.filter(function (s) { return s.workoutId !== route.draft.id; });
    });
    if (!ok) { render(); return; }
    route.force = true;
    back();
  }

  function editorScreen(route) {
    var cycle = cycleById(route.cycleId);
    if (!cycle) return notFound('That cycle no longer exists.');
    var d = route.draft;

    var header = UI.header({
      onBack: attemptBack, sub: route.isNew ? 'New workout' : 'Edit workout', title: d.name || 'Untitled workout',
      right: UI.btn('Save', { small: true, onClick: function () { saveWorkout(route); } })
    });
    var titleEl = header.querySelector('.hdr-title');

    var body = [];
    if (route.guardArmed) body.push(guardCard(route));
    body.push(h('div', { class: 'pad-x' },
      UI.field('Workout name', UI.input({
        value: d.name, label: 'Workout name',
        onInput: function (e) { d.name = e.target.value; titleEl.textContent = d.name || 'Untitled workout'; }
      }))));
    body.push(daysCard(route, cycle));
    var warm = warmupOf(d);
    if (warm) body.push(warmupEditor(route, warm));
    else body.push(h('div', { class: 'stack centre' },
      UI.btn('Add warm-up', {
        variant: 'outline', icon: 'plus',
        onClick: function () {
          var w = blankWarmup();
          d.blocks.unshift(w);
          route.focusId = w.exercises[0].id;
          route.afterRender = focusMarked;
          render();
        }
      })));
    mainBlocks(d).forEach(function (b, bi) { body.push(blockEditor(route, b, bi)); });
    body.push(h('div', { class: 'stack centre' },
      UI.btn('Add block', {
        large: true, icon: 'plus',
        onClick: function () { d.blocks.push(blankBlock(blockLetter(mainBlocks(d).length))); render(); }
      })));
    if (!route.isNew) {
      var logged = 0;
      cycle.slots.forEach(function (s) { if (s.workoutId === d.id) logged += sessionsInSlot(cycle, s.id); });
      body.push(h('div', { class: 'stack' },
        logged ? h('p', { class: 'note-text is-center' }, plural(logged, 'logged session', 'logged sessions') +
          ' stay in your data, but this workout\'s days leave the Week screen.') : null,
        UI.twoStep('Delete workout', 'Really delete workout?', function () { deleteWorkout(route); }, { block: true })));
    }
    return shell({ header: header, body: body });
  }
  SCREENS.editor = editorScreen;

  /* ====================================================================
     Ladders: collection list, collection, ladder
     ==================================================================== */

  function collectionsScreen() {
    var onCols = activeCollections();
    return shell({
      header: UI.header({ onBack: back, sub: 'Plan', title: 'Ladders' }),
      body: onCols.map(function (col) {
        return UI.card({
          onClick: function () { push({ name: 'collection', collId: col.id }); },
          body: h('div', { class: 'between', style: { alignItems: 'center' } },
            h('div', { class: 'stack', style: { gap: '4px', minWidth: 0 } },
              h('span', { class: 'row-title', style: { fontSize: '17px' } }, col.name),
              h('span', { class: 'row-sub' }, collectionCounts(col))),
            h('span', { class: 'icon-btn', 'aria-hidden': 'true' }, UI.icon('forward', 20)))
        });
      })
    });
  }
  SCREENS.collections = collectionsScreen;

  function collectionScreen(route) {
    var col = Data.state.collections.filter(function (c) { return c.id === route.collId; })[0];
    if (!col) return notFound('That collection no longer exists.');
    var links = activeLinks();
    var cards = col.categories.map(function (cat) {
      return UI.card({
        title: cat.name || 'Untitled category', list: true,
        body: cat.ladders.map(function (lad) {
          var pi = positionIndex(lad);
          var nLinked = lad.rungs.reduce(function (n, r) { return n + (links[r.id] ? links[r.id].length : 0); }, 0);
          var sub = pi >= 0
            ? 'At ' + (lad.rungs[pi].name || 'Untitled rung') + ' · ' + (pi + 1) + '/' + lad.rungs.length
            : 'No position set · ' + plural(lad.rungs.length, 'rung', 'rungs');
          if (nLinked) sub += ' · ' + nLinked + ' linked';
          return UI.row({
            title: lad.name || 'Untitled ladder', sub: sub,
            onClick: function () { push({ name: 'ladder', ladderId: lad.id, mode: 'position' }); }
          });
        })
      });
    });
    return shell({
      header: UI.header({
        onBack: back, sub: 'Ladders', title: col.name,
        right: UI.btn('Edit', { variant: 'outline', small: true, onClick: function () { push(builderRoute(col)); } })
      }),
      body: cards
    });
  }
  SCREENS.collection = collectionScreen;

  function ladderScreen(route) {
    var f = findLadder(route.ladderId);
    if (!f) return notFound('That ladder no longer exists.');
    var lad = f.ladder, col = f.collection;
    var pi = positionIndex(lad);
    var links = activeLinks();
    var goals = route.mode === 'goals';

    var body = [
      UI.seg([{ value: 'position', label: 'Position' }, { value: 'goals', label: 'Goals' }], route.mode,
        function (v) { route.mode = v; render(); }),
      h('p', { class: 'note-text pad-x' }, goals
        ? 'Set a target for each rung — reps, a hold time, anything. It shows on the rung; nothing checks it for you.'
        : 'Tap a rung to mark where you are. Only you move it.')
    ];

    if (!goals) {
      body.push(h('div', { class: 'rung-list' }, lad.rungs.map(function (r, i) {
        var cleared = pi >= 0 && i < pi, current = i === pi;
        var chips = [];
        if (r.goal) chips.push(UI.chip('Goal ' + r.goal));
        (links[r.id] || []).forEach(function (t) { chips.push(UI.chip('Linked: ' + t)); });
        return h('button', {
          type: 'button', class: 'rung' + (cleared ? ' is-cleared' : '') + (current ? ' is-current' : ''),
          'aria-pressed': current ? 'true' : 'false',
          onClick: function () { commit(function () { Data.state.positions[lad.id] = r.id; }); }
        },
          h('span', { class: 'rung-marker' }, cleared ? UI.icon('check', 14, 2) : String(i + 1)),
          h('span', { class: 'rung-main' },
            h('span', { class: 'rung-name' }, r.name || 'Untitled rung'),
            chips.length ? h('span', { class: 'rung-chips' }, chips) : null),
          current ? h('span', { class: 'here-pill' }, h('span', { class: 'pill-dot' }), "You're here") : null);
      })));
      if (pi >= 0) {
        body.push(h('div', { class: 'stack centre' },
          UI.btn('Clear position', { variant: 'outline', small: true, onClick: function () { commit(function () { delete Data.state.positions[lad.id]; }); } })));
      }
    } else {
      body.push(h('div', { class: 'goal-list' }, lad.rungs.map(function (r, i) {
        var id = 'goal-' + r.id;
        return h('div', { class: 'goal-row' },
          h('span', { class: 'goal-num' }, String(i + 1)),
          h('label', { class: 'goal-name', for: id }, r.name || 'Untitled rung'),
          h('input', {
            class: 'goal-input', id: id, type: 'text', value: r.goal || '', placeholder: 'e.g. 3×8',
            onInput: function (e) { r.goal = e.target.value; saveNow(); }
          }));
      })));
    }
    return shell({
      header: UI.header({ onBack: back, sub: col.name, title: lad.name || 'Untitled ladder' }),
      body: body
    });
  }
  SCREENS.ladder = ladderScreen;

  /* ====================================================================
     Collection builder
     ==================================================================== */

  function autoShort(name) { return String(name || '').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase(); }
  function blankRung() { return { id: Data.uid(), name: '', goal: '' }; }
  function blankLadder() { return { id: Data.uid(), name: '', rungs: [blankRung()] }; }
  function blankCategory() { return { id: Data.uid(), name: '', ladders: [blankLadder()] }; }

  function builderRoute(col) {
    var draft = col
      ? { name: col.name, short: col.short || '', categories: clone(col.categories) }
      : { name: '', short: '', categories: [blankCategory()] };
    var route = {
      name: 'builder', collId: col ? col.id : null, draft: draft, original: clone(draft),
      shortEdited: !!col, confirm: null, guardArmed: false
    };
    route.dirty = function () { return !Data.deepEqual(route.draft, route.original); };
    return route;
  }

  function rungIdsOf(categories) {
    var out = [];
    categories.forEach(function (c) { c.ladders.forEach(function (l) { l.rungs.forEach(function (r) { out.push(r.id); }); }); });
    return out;
  }
  // What removing these rungs would disturb: positions on them, exercises linked to them.
  function impactOf(rungIds) {
    var ids = {};
    rungIds.forEach(function (i) { ids[i] = true; });
    var pos = 0, links = 0;
    Object.keys(Data.state.positions).forEach(function (k) { if (ids[Data.state.positions[k]]) pos++; });
    Data.state.cycles.forEach(function (c) {
      c.workouts.forEach(function (w) { w.blocks.forEach(function (b) { b.exercises.forEach(function (e) { if (e.link && ids[e.link]) links++; }); }); });
    });
    return { pos: pos, links: links };
  }
  function impactText(rungIds, what) {
    var im = impactOf(rungIds), parts = [];
    if (im.pos) parts.push('clears ' + plural(im.pos, 'position', 'positions'));
    if (im.links) parts.push('unlinks ' + plural(im.links, 'exercise', 'exercises'));
    return parts.length ? 'Removing ' + what + ' ' + parts.join(' and ') + '.' : '';
  }

  function builderScreen(route) {
    var d = route.draft;
    var isNew = !route.collId;
    var existingRungs = {}, existingLadders = {}, existingCats = {};
    route.original.categories.forEach(function (c) {
      existingCats[c.id] = true;
      c.ladders.forEach(function (l) { existingLadders[l.id] = true; l.rungs.forEach(function (r) { existingRungs[r.id] = true; }); });
    });

    var header = UI.header({
      onBack: attemptBack, backIcon: 'close', sub: isNew ? 'New collection' : 'Edit collection',
      title: d.name || 'Untitled collection',
      right: UI.btn('Save', { small: true, onClick: function () { saveBuilder(route); } })
    });
    var titleEl = header.querySelector('.hdr-title');

    var shortIn = UI.input({
      value: d.short, label: 'Short name', placeholder: 'e.g. RING',
      onInput: function (e) { d.short = e.target.value; route.shortEdited = true; }
    });
    var nameIn = UI.input({
      value: d.name, label: 'Collection name', placeholder: 'e.g. Ring skills',
      onInput: function (e) {
        d.name = e.target.value;
        titleEl.textContent = d.name || 'Untitled collection';
        if (!route.shortEdited) { d.short = autoShort(d.name); shortIn.value = d.short; }
      }
    });

    var body = [];
    if (route.guardArmed) body.push(guardCard(route));
    body.push(h('div', { class: 'stack pad-x' },
      UI.field('Collection name', nameIn),
      UI.field(h('span', {}, 'Short name ', h('span', { class: 'muted' }, '· shown on badges')), shortIn)));

    d.categories.forEach(function (cat, ci) {
      var catRungs = rungIdsOf([cat]);
      var ladderEls = cat.ladders.map(function (lad, li) {
        var ladRungs = lad.rungs.map(function (r) { return r.id; });
        var rows = [];
        lad.rungs.forEach(function (r, ri) {
          var linked = existingRungs[r.id] ? impactText([r.id], 'this rung') : '';
          var confirming = route.confirm === r.id;
          rows.push(h('div', { class: 'rung-edit' },
            h('span', { class: 'rung-num' }, String(ri + 1)),
            UI.input({ value: r.name, label: 'Rung ' + (ri + 1), placeholder: 'Rung name', onInput: function (e) { r.name = e.target.value; } }),
            h('input', {
              class: 'input is-goal', type: 'text', value: r.goal || '', placeholder: '3×8', 'aria-label': 'Goal for rung ' + (ri + 1),
              onInput: function (e) { r.goal = e.target.value; }
            }),
            UI.iconBtn('close', function () { route.confirm = confirming ? null : r.id; render(); }, 'Remove rung ' + (ri + 1), { size: 16 })));
          rows[rows.length - 1].querySelector('.icon-btn').classList.add('is-small');
          if (confirming) {
            rows.push(h('div', { class: 'confirm-line' },
              linked ? h('p', { class: 'note-text is-soft' }, linked) : null,
              UI.twoStep('Remove rung', 'Really remove?', function () {
                lad.rungs = lad.rungs.filter(function (x) { return x !== r; });
                route.confirm = null; render();
              }, { small: true, armed: true })));
          }
        });
        var ladConfirm = route.confirm === lad.id;
        var ladImpact = existingLadders[lad.id] ? impactText(ladRungs.filter(function (i) { return existingRungs[i]; }), 'this ladder') : '';
        return h('div', { class: 'builder-ladder' },
          UI.field('Ladder', UI.input({ value: lad.name, label: 'Ladder name', placeholder: 'e.g. Muscle Up', onInput: function (e) { lad.name = e.target.value; } })),
          h('div', { class: 'builder-head' }, h('span', {}, 'Rungs, easiest first'), h('span', {}, 'Goal')),
          rows,
          h('div', { class: 'builder-actions' },
            UI.btn('Add rung', { variant: 'outline', small: true, icon: 'plus', onClick: function () { lad.rungs.push(blankRung()); render(); } }),
            UI.btn('Remove ladder', { variant: 'outline', small: true, onClick: function () { route.confirm = ladConfirm ? null : lad.id; render(); } })),
          ladConfirm ? h('div', { class: 'confirm-line' },
            ladImpact ? h('p', { class: 'note-text is-soft' }, ladImpact) : null,
            UI.twoStep('Remove ladder', 'Really remove?', function () {
              cat.ladders = cat.ladders.filter(function (x) { return x !== lad; });
              route.confirm = null; render();
            }, { small: true, armed: true })) : null);
      });

      var catConfirm = route.confirm === cat.id;
      var catImpact = existingCats[cat.id] ? impactText(catRungs.filter(function (i) { return existingRungs[i]; }), 'this category') : '';
      body.push(h('div', { class: 'card' },
        h('div', { class: 'block-head' },
          h('label', { class: 'block-label', for: 'cat-' + cat.id }, 'Category'),
          h('input', {
            class: 'input', id: 'cat-' + cat.id, type: 'text', value: cat.name, placeholder: 'e.g. Pull', style: { fontWeight: '600' },
            onInput: function (e) { cat.name = e.target.value; }
          })),
        ladderEls,
        h('div', { class: 'card-foot is-col', style: { marginTop: '14px' } },
          UI.btn('Add ladder', { variant: 'tertiary', block: true, icon: 'plus', onClick: function () { cat.ladders.push(blankLadder()); render(); } }),
          UI.btn('Remove category', { variant: 'outline', small: true, onClick: function () { route.confirm = catConfirm ? null : cat.id; render(); } }),
          catConfirm ? h('div', { class: 'confirm-line' },
            catImpact ? h('p', { class: 'note-text is-soft' }, catImpact) : null,
            UI.twoStep('Remove category', 'Really remove?', function () {
              d.categories = d.categories.filter(function (x) { return x !== cat; });
              route.confirm = null; render();
            }, { small: true, armed: true })) : null)));
    });

    body.push(h('div', { class: 'stack centre' },
      UI.btn('Add category', { large: true, icon: 'plus', onClick: function () { d.categories.push(blankCategory()); render(); } })));

    return shell({ header: header, body: body });
  }
  SCREENS.builder = builderScreen;

  function saveBuilder(route) {
    var d = clone(route.draft);
    var name = (d.name || '').trim();
    if (!name) { showError('Give the collection a name first.'); return; }

    var origRungs = {}, origLadders = {}, origCats = {};
    route.original.categories.forEach(function (c) {
      origCats[c.id] = true;
      c.ladders.forEach(function (l) { origLadders[l.id] = true; l.rungs.forEach(function (r) { origRungs[r.id] = true; }); });
    });

    // Blank rungs/ladders/categories that were just added are noise; blank
    // names on things that already existed are kept, as "Untitled ...".
    var cats = [];
    d.categories.forEach(function (c) {
      var ladders = [];
      c.ladders.forEach(function (l) {
        var rungs = l.rungs.filter(function (r) { return origRungs[r.id] || (r.name || '').trim(); });
        if (!origLadders[l.id] && !(l.name || '').trim() && !rungs.length) return;
        rungs.forEach(function (r) { r.name = (r.name || '').trim() || 'Untitled rung'; r.goal = (r.goal || '').trim(); });
        l.rungs = rungs;
        l.name = (l.name || '').trim() || 'Untitled ladder';
        ladders.push(l);
      });
      if (!origCats[c.id] && !(c.name || '').trim() && !ladders.length) return;
      c.ladders = ladders;
      c.name = (c.name || '').trim() || 'Untitled category';
      cats.push(c);
    });
    var empty = null;
    cats.forEach(function (c) { c.ladders.forEach(function (l) { if (!l.rungs.length) empty = l; }); });
    if (empty) { showError('"' + empty.name + '" needs at least one rung.'); return; }
    if (!cats.length) { showError('Add at least one category with a ladder.'); return; }

    var newIds = {};
    rungIdsOf(cats).forEach(function (i) { newIds[i] = true; });
    var removed = Object.keys(origRungs).filter(function (i) { return !newIds[i]; });
    var short = (d.short || '').trim() || autoShort(name);
    var createdId = null;

    var ok = tx(function () {
      var S = Data.state;
      if (route.collId) {
        var col = S.collections.filter(function (c) { return c.id === route.collId; })[0];
        if (!col) throw new Error('That collection no longer exists.');
        col.name = name; col.short = short; col.categories = cats;
      } else {
        createdId = Data.uid();
        S.collections.push({ id: createdId, name: name, short: short, builtin: false, on: true, categories: cats });
      }
      // Removed rungs: forget positions on them and unlink exercises that pointed at them.
      var gone = {};
      removed.forEach(function (i) { gone[i] = true; });
      Object.keys(S.positions).forEach(function (k) { if (gone[S.positions[k]]) delete S.positions[k]; });
      S.cycles.forEach(function (c) {
        c.workouts.forEach(function (w) { w.blocks.forEach(function (b) { b.exercises.forEach(function (e) { if (e.link && gone[e.link]) e.link = null; }); }); });
      });
    });
    if (!ok) { render(); return; }
    route.force = true;
    if (createdId) replaceTop({ name: 'collection', collId: createdId });
    else back();
  }

  /* ====================================================================
     Boot
     ==================================================================== */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Reads only. The v1 keys (and, if the v2 blob is what is broken, the v2 ones)
  // go into one JSON file so the data can be repaired from it.
  function exportRaw() {
    var out = {};
    try {
      var s = window.localStorage;
      for (var i = 0; i < s.length; i++) {
        var k = s.key(i);
        if (k && (k.indexOf('bwf-') === 0 || k.indexOf('bwl-') === 0)) out[k] = s.getItem(k);
      }
    } catch (e) { out.error = String(e && e.message || e); }
    var text = JSON.stringify(out, null, 2);
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'bwf-v1-raw-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 1000);
  }

  // A plain error screen that writes nothing. No dependency on Data or UI.
  function fatal(err) {
    console.error(err);
    var root = document.getElementById('app');
    var boot = document.getElementById('boot');
    if (boot) boot.hidden = true;
    var card = el('div', 'card');
    var body = el('div', 'card-body');
    body.appendChild(el('h1', 'cycle-name', "Couldn't start"));
    body.appendChild(el('p', 'note-text is-soft pre', String(err && err.message || err)));
    body.appendChild(el('p', 'note-text', 'Nothing was changed on this phone. Export your data and send it to be repaired.'));
    var foot = el('div', 'card-foot');
    var b = el('button', 'btn btn-tertiary btn-block', 'Export v1 data');
    b.type = 'button';
    b.addEventListener('click', exportRaw);
    foot.appendChild(b);
    card.appendChild(body);
    card.appendChild(foot);
    var screen = el('div', 'screen is-centred');
    screen.appendChild(card);
    var app = el('div', 'app');
    app.appendChild(screen);
    root.textContent = '';
    root.appendChild(app);
  }

  function start() {
    appEl = document.getElementById('app');
    try {
      storage = window.localStorage;
      storage.getItem(UI_KEY);   // a read only: blocked storage throws here
    } catch (e) {
      fatal(new Error('This browser is blocking storage, so the app cannot read or save your data.'));
      return;
    }
    applyAppearance(appearance());
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var follow = function () { applyAppearance(appearance()); };
      if (mq.addEventListener) mq.addEventListener('change', follow);
      else if (mq.addListener) mq.addListener(follow);
    }

    fetch('chart.json')
      .then(function (r) {
        if (!r.ok) throw new Error("Couldn't load chart.json (" + r.status + ')');
        return r.json();
      })
      .then(function (c) {
        chart = c;
        Data.load(storage, chart);
        // Repairs a cycle saved before day-less slots were absorbed on Save.
        var repaired = false;
        Data.state.cycles.forEach(function (c) { if (Data.absorbDaylessSlots(c)) repaired = true; });
        if (repaired) Data.save();
        checkDrift();
        if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
        history.replaceState({ depth: 0 }, '');
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden' && Data.state) saveNow();
        });
        window.addEventListener('pagehide', function () { if (Data.state) saveNow(); });
        render();
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.register('sw.js')
            .catch(function (err) { console.warn('service worker registration failed', err); });
        }
      })
      .catch(fatal);
  }

  start();
})();
