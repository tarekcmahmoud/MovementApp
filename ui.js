/*
 * Bodyweight Ladders v2 - small DOM helpers for the screens.
 * Classic script (no modules). Defines one global, UI.
 * Strings become text nodes, never innerHTML, so user text is always safe.
 * Markup and classes match styles.css.
 */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Hugeicons-style paths (24x24 grid, stroke 1.5, round caps and joins).
  // back, forward, close, plus, check, week, plan, ladder and updown are copied from
  // docs/v2/prototype.html. link and export are drawn here, not taken from Hugeicons.
  var PATHS = {
    back: ['M15 6C15 6 9 10.4189 9 12C9 13.5812 15 18 15 18'],
    forward: ['M9 6C9 6 15 10.4189 15 12C15 13.5812 9 18 9 18'],
    close: ['M18 6L6 18M6 6L18 18'],
    plus: ['M12 4V20M20 12H4'],
    check: ['M5 14L8.5 17.5L19 6.5'],
    week: [
      'M16 2V6M8 2V6',
      'M13 4H11C7.229 4 5.343 4 4.172 5.172C3 6.343 3 8.229 3 12V14C3 17.771 3 19.657 4.172 20.828C5.343 22 7.229 22 11 22H13C16.771 22 18.657 22 19.828 20.828C21 19.657 21 17.771 21 14V12C21 8.229 21 6.343 19.828 5.172C18.657 4 16.771 4 13 4Z',
      'M3 10H21'
    ],
    plan: [
      'M11 6H21M11 12H21M11 18H21',
      'M3 7.393C3 7.393 4 8.045 4.5 9C4.5 9 6 5.25 8 4',
      'M3 18.393C3 18.393 4 19.045 4.5 20C4.5 20 6 16.25 8 15'
    ],
    ladder: ['M7 3V21M17 3V21M7 8H17M7 13H17M7 18H17'],
    updown: ['M7 9.5L12 4.5L17 9.5M7 14.5L12 19.5L17 14.5'],
    link: [
      'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
      'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
    ],
    export: [
      'M12 3V15M12 3L8 7.5M12 3L16 7.5',
      'M4 14V18A2 2 0 0 0 6 20H18A2 2 0 0 0 20 18V14'
    ]
  };
  PATHS.chevron = PATHS.forward;

  // How long a control's own motion runs before its change is applied (matches --t-med).
  var SETTLE = 260;

  // ---------- Hyperscript ----------

  function isNode(x) {
    return !!x && typeof x === 'object' && typeof x.nodeType === 'number';
  }

  function appendChildren(parent, list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c === null || c === undefined || c === false || c === true) continue;
      if (Array.isArray(c)) { appendChildren(parent, c); continue; }
      if (isNode(c)) { parent.appendChild(c); continue; }
      parent.appendChild(document.createTextNode(String(c)));
    }
  }

  function setAttrs(el, attrs) {
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];

      if (k === 'class' || k === 'className') {
        if (v != null && v !== false) {
          el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v));
        }
        return;
      }
      if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else if (v) Object.keys(v).forEach(function (p) {
          if (p.indexOf('--') === 0) el.style.setProperty(p, v[p]);
          else el.style[p] = v[p];
        });
        return;
      }
      if (k === 'dataset') {
        Object.keys(v || {}).forEach(function (d) { el.dataset[d] = v[d]; });
        return;
      }
      if (/^on[A-Za-z]/.test(k)) {
        if (typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        return;
      }
      if (k === 'value') { el.value = v == null ? '' : String(v); return; }
      if (k === 'checked') { el.checked = !!v; return; }

      if (v === null || v === undefined) { el.removeAttribute(k); return; }
      // aria-selected="false" must stay a string, so aria-* is never treated as a boolean flag.
      if (/^aria-/.test(k)) { el.setAttribute(k, String(v)); return; }
      if (v === false) { el.removeAttribute(k); return; }
      if (v === true) { el.setAttribute(k, ''); return; }
      el.setAttribute(k, String(v));
    });
  }

  // h(tag, attrs?, ...children). attrs is optional; a non-object first argument is a child.
  function h(tag, attrs) {
    var el = document.createElement(tag);
    var children = Array.prototype.slice.call(arguments, 2);
    if (attrs === null || attrs === undefined || attrs === false || attrs === true) {
      // no attributes
    } else if (typeof attrs === 'object' && !Array.isArray(attrs) && !isNode(attrs)) {
      setAttrs(el, attrs);
    } else {
      children.unshift(attrs);
    }
    appendChildren(el, children);
    // A select's value only sticks once its options exist.
    if (tag === 'select' && attrs && typeof attrs === 'object' && attrs.value != null) {
      el.value = String(attrs.value);
    }
    return el;
  }

  // ---------- Icons ----------

  // icon(name, size = 20, stroke = 1.5) -> <svg>
  function icon(name, size, stroke) {
    var d = PATHS[name];
    if (!d) {
      console.warn('UI.icon: unknown icon "' + name + '"');
      d = [];
    }
    var svg = document.createElementNS(SVG_NS, 'svg');
    var attrs = {
      width: size || 20,
      height: size || 20,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': stroke || 1.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      class: 'icon',
      'aria-hidden': 'true',
      focusable: 'false'
    };
    Object.keys(attrs).forEach(function (k) { svg.setAttribute(k, String(attrs[k])); });
    d.forEach(function (p) {
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', p);
      svg.appendChild(path);
    });
    return svg;
  }

  // ---------- Buttons ----------

  // btn(label, {variant: 'primary'|'outline'|'tertiary', small, large, block, icon, disabled, onClick, ariaLabel})
  function btn(label, o) {
    o = o || {};
    var variant = o.variant || 'primary';
    var cls = 'btn btn-' + variant +
      (o.small ? ' btn-sm' : '') +
      (o.large ? ' btn-lg' : '') +
      (o.block ? ' btn-block' : '');
    return h('button', {
      type: 'button',
      class: cls,
      disabled: !!o.disabled,
      'aria-label': o.ariaLabel,
      onClick: o.onClick
    }, o.icon ? icon(o.icon, o.small ? 16 : 18) : null, label);
  }

  // iconBtn(iconName, onClick, label, {outline, disabled, size})
  function iconBtn(iconName, onClick, label, o) {
    o = o || {};
    var size = o.size || (iconName === 'close' ? 18 : 20);
    return h('button', {
      type: 'button',
      class: 'icon-btn' + (o.outline ? ' icon-btn--outline' : ''),
      'aria-label': label,
      disabled: !!o.disabled,
      onClick: onClick
    }, icon(iconName, size));
  }

  // ---------- Status, pills, chips ----------

  // status(label, dot?: 'accent'|'grey'|'light'|'dark')
  function status(label, dot) {
    return h('span', { class: 'status' },
      h('span', { class: 'dot' + (dot ? ' dot-' + dot : ''), 'aria-hidden': 'true' }),
      label);
  }

  // pill(text, {dark, dashed, icon, dot})  dot: 'accent'|'grey'|'light'|'dark'
  function pill(text, o) {
    o = o || {};
    var cls = o.dark ? 'pill-dark' : (o.dashed ? 'pill-dashed' : 'pill');
    var kids = [];
    if (o.dot) kids.push(h('span', { class: 'pill-dot dot-' + o.dot, 'aria-hidden': 'true' }));
    if (o.icon) kids.push(icon(o.icon, o.dark ? 13 : 12, o.dark ? 2 : 1.5));
    return h('span', { class: cls }, kids, text);
  }

  function chip(text) {
    return h('span', { class: 'chip' }, text);
  }

  // Logger badge, e.g. "Pull Ups 4/9" or "BWF - Pull Ups 4/9".
  function rungBadge(text) {
    return h('span', { class: 'rung-badge' }, icon('ladder', 12), text);
  }

  // ---------- Cards, rows, insets, empty ----------

  // card({title, sub, body, foot, list, footStack, onClick, class})
  //   list: body is a list of rows inside the card (dividers inset 18px).
  //   footStack: foot is stacked text (label above value).
  //   onClick: makes the whole card one tap target. Do not nest buttons inside it.
  function card(o) {
    o = o || {};
    var el = null;
    var attrs = { class: 'card' + (o.onClick ? ' card-tap' : '') + (o.class ? ' ' + o.class : '') };
    if (o.onClick) {
      attrs.role = 'button';
      attrs.tabindex = '0';
      attrs.onClick = o.onClick;
      attrs.onKeydown = function (e) {
        if (e.target !== el) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          o.onClick(e);
        }
      };
    }
    var kids = [];
    if (o.title !== null && o.title !== undefined) {
      kids.push(h('div', { class: 'card-title' }, o.title,
        o.sub ? h('span', { class: 'card-sub' }, o.sub) : null));
    }
    if (o.body !== null && o.body !== undefined) {
      kids.push(h('div', { class: o.list ? 'card-list' : 'card-body' }, o.body));
    }
    if (o.foot !== null && o.foot !== undefined) {
      kids.push(h('div', { class: 'card-foot' + (o.footStack ? ' is-stack' : '') }, o.foot));
    }
    el = h('div', attrs, kids);
    return el;
  }

  // inset(rows): rows are [label, value] or [label, value, 'strong'], or the string 'divider'.
  function inset(rows) {
    return h('div', { class: 'inset' }, (rows || []).map(function (r) {
      if (r === 'divider') return h('div', { class: 'inset-div', role: 'separator' });
      var strong = r[2] === 'strong';
      return h('div', { class: 'inset-row' },
        h('span', { class: 'inset-label' }, r[0]),
        h('span', { class: 'inset-value' + (strong ? ' is-strong' : '') }, r[1]));
    }));
  }

  // row({lead, title, sub, trail, onClick, class})
  //   trail defaults to a chevron when tappable. Pass a node (pill, toggle) to replace it.
  function row(o) {
    o = o || {};
    var tappable = typeof o.onClick === 'function';
    var trail = o.trail;
    if (trail === undefined && tappable) trail = icon('forward', 20);
    var kids = [];
    if (o.lead) kids.push(h('span', { class: 'row-lead' }, o.lead));
    kids.push(h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, o.title),
      o.sub ? h('span', { class: 'row-sub' }, o.sub) : null));
    if (trail !== null && trail !== undefined && trail !== false) {
      kids.push(h('span', { class: 'row-trail' }, trail));
    }
    var attrs = { class: 'row' + (o.class ? ' ' + o.class : '') };
    if (tappable) {
      attrs.type = 'button';
      attrs.onClick = o.onClick;
      return h('button', attrs, kids);
    }
    return h('div', attrs, kids);
  }

  // empty({title, text, action}) action: {label, onClick, variant} or a node.
  function empty(o) {
    o = o || {};
    var action = o.action;
    var actionEl = null;
    if (isNode(action)) actionEl = action;
    else if (action) actionEl = btn(action.label, { variant: action.variant || 'primary', onClick: action.onClick });
    return h('div', { class: 'card empty' },
      h('span', { class: 'empty-icon', 'aria-hidden': 'true' }, icon('plus', 20)),
      o.title ? h('h2', { class: 'empty-title' }, o.title) : null,
      o.text ? h('p', { class: 'empty-text' }, o.text) : null,
      actionEl);
  }

  // ---------- Forms ----------

  // field(label, control): a label element wrapping the control.
  function field(label, control) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control);
  }

  // input({value, type, placeholder, inputmode, label, id, name, min, max, step, onInput, onChange})
  function input(o) {
    o = o || {};
    return h('input', {
      class: 'input',
      type: o.type || 'text',
      value: o.value,
      placeholder: o.placeholder,
      inputmode: o.inputmode,
      id: o.id,
      name: o.name,
      min: o.min,
      max: o.max,
      step: o.step,
      'aria-label': o.label,
      autocomplete: o.autocomplete || 'off',
      onInput: o.onInput,
      onChange: o.onChange
    });
  }

  // textarea({value, placeholder, rows, label, id, onInput, onChange})
  function textarea(o) {
    o = o || {};
    return h('textarea', {
      class: 'input',
      rows: o.rows || 4,
      value: o.value,
      placeholder: o.placeholder,
      id: o.id,
      'aria-label': o.label,
      onInput: o.onInput,
      onChange: o.onChange
    });
  }

  // toggle(checked, onChange(checked, event), label). A real checkbox with role="switch".
  function toggle(checked, onChange, label) {
    var box = h('input', {
      type: 'checkbox',
      role: 'switch',
      'aria-label': label,
      checked: !!checked,
      // The knob slides first (CSS), then the change lands, so a re-render never cuts the motion short.
      onChange: function (e) {
        var c = e.target.checked;
        if (onChange) setTimeout(function () { onChange(c, e); }, SETTLE);
      }
    });
    return h('label', { class: 'toggle' },
      box,
      h('span', { class: 'toggle-track', 'aria-hidden': 'true' }),
      h('span', { class: 'toggle-knob', 'aria-hidden': 'true' }));
  }

  // seg(options, value, onChange). options: ['Position', 'Goals'] or [{value, label}].
  function seg(options, value, onChange) {
    var list = (options || []).map(function (o) {
      return (o && typeof o === 'object') ? o : { value: o, label: String(o) };
    });
    var at = 0;
    list.forEach(function (o, i) { if (o.value === value) at = i; });
    // One thumb slides between the options; the callback waits until it has arrived.
    var thumb = h('span', { class: 'seg-thumb', 'aria-hidden': 'true', style: { '--i': at, '--n': list.length } });
    var wrap = h('div', { class: 'seg has-thumb', role: 'tablist' }, thumb, list.map(function (o, i) {
      var on = o.value === value;
      return h('button', {
        type: 'button',
        role: 'tab',
        class: 'seg-opt' + (on ? ' is-selected' : ''),
        'aria-selected': on,
        onClick: function (e) {
          if (on || !onChange) return;
          on = true;
          thumb.style.setProperty('--i', i);
          Array.prototype.forEach.call(wrap.querySelectorAll('.seg-opt'), function (b) {
            var me = b === e.currentTarget;
            b.classList.toggle('is-selected', me);
            b.setAttribute('aria-selected', String(me));
          });
          setTimeout(function () { onChange(o.value); }, SETTLE);
        }
      }, o.label);
    }));
    return wrap;
  }

  // ---------- Header and dock ----------

  // header({onBack, backIcon: 'back'|'close', backLabel, title, sub, right})
  function header(o) {
    o = o || {};
    var close = o.backIcon === 'close';
    var back = iconBtn(close ? 'close' : 'back', o.onBack, o.backLabel || (close ? 'Close' : 'Back'));
    var textKids = [];
    if (o.sub) textKids.push(h('span', { class: 'hdr-sub' }, o.sub));
    textKids.push(h('h1', { class: 'hdr-title' }, o.title));
    return h('header', { class: 'hdr' }, back, h('div', { class: 'hdr-text' }, textKids), o.right || null);
  }

  // dock(tabs, activeId, onSelect): tabs = [{id, label, icon}]. Returns the fixed wrapper.
  function dock(tabs, activeId, onSelect) {
    return h('div', { class: 'dock-wrap' },
      h('nav', { class: 'dock', role: 'tablist', 'aria-label': 'Navigation' },
        (tabs || []).map(function (t) {
          var on = t.id === activeId;
          return h('button', {
            type: 'button',
            role: 'tab',
            class: 'dock-tab' + (on ? ' is-active' : ''),
            'aria-selected': on,
            'aria-label': t.label,
            onClick: function () { if (onSelect) onSelect(t.id); }
          }, icon(t.icon, 20), h('span', { class: 'dock-label' }, t.label));
        })));
  }

  // ---------- Two-step destructive confirm ----------

  // Only one control can be armed at a time, across the whole page.
  var armed = null;

  // twoStep(label, reallyLabel, onConfirm, {small, block, armed, persist})
  //   First press arms it: the label becomes reallyLabel and a Cancel appears.
  //   Second press runs onConfirm. Cancel, or 5 s with no second press, disarms it.
  //   persist: never time out (gallery use only).
  function twoStep(label, reallyLabel, onConfirm, opts) {
    opts = opts || {};
    var wrap = h('div', { class: 'two-step' });
    var timer = null;
    var state = { wrap: wrap, disarm: disarm };
    var size = { small: !!opts.small, block: !!opts.block };

    function draw(isArmed, fresh) {
      wrap.textContent = '';
      wrap.classList.toggle('is-fresh', !!fresh);   // animate only a change, not the first draw
      if (!isArmed) {
        wrap.appendChild(btn(label, { variant: 'outline', small: size.small, block: size.block, onClick: arm }));
      } else {
        wrap.appendChild(btn(reallyLabel, { variant: 'primary', small: size.small, block: size.block, onClick: confirm }));
        wrap.appendChild(btn('Cancel', { variant: 'outline', small: size.small, onClick: disarm }));
      }
    }

    function arm() {
      if (armed && armed !== state) armed.disarm();
      armed = state;
      draw(true, true);
      clearTimeout(timer);
      timer = opts.persist ? null : setTimeout(disarm, 5000);
    }

    function disarm() {
      clearTimeout(timer);
      timer = null;
      if (armed === state) armed = null;
      draw(false, true);
    }

    function confirm() {
      disarm();
      if (onConfirm) onConfirm();
    }

    if (opts.armed) arm();
    else draw(false);
    return wrap;
  }

  // ---------- Swipe ----------

  // Swipe before a click: the click that follows a swipe inside root is swallowed,
  // so a swipe never also opens the session card under the finger.
  function eatNextClick(root) {
    var timer = null;
    function done() {
      clearTimeout(timer);
      document.removeEventListener('click', eat, true);
    }
    function eat(e) {
      if (!root.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      done();
    }
    document.addEventListener('click', eat, true);
    timer = setTimeout(done, 400);
  }

  // onSwipe(el, {onLeft, onRight}). Fires when horizontal travel > 50px and greater than
  // vertical travel. Swipe left calls onLeft. Returns an unbind function.
  // Give the element CSS class "swipe-area" (touch-action: pan-y) so the browser
  // does not pan horizontally and steal the gesture.
  function onSwipe(el, o) {
    o = o || {};
    var start = null;

    function down(e) {
      if (e.isPrimary === false) { start = null; return; }
      start = { x: e.clientX, y: e.clientY };
    }
    function up(e) {
      if (!start) return;
      var s = start;
      start = null;
      var dx = e.clientX - s.x;
      var dy = e.clientY - s.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        eatNextClick(el);
        if (dx < 0) { if (o.onLeft) o.onLeft(); }
        else if (o.onRight) o.onRight();
      }
    }
    function cancel() { start = null; }

    el.addEventListener('pointerdown', down, { passive: true });
    el.addEventListener('pointerup', up, { passive: true });
    el.addEventListener('pointercancel', cancel, { passive: true });

    return function unbind() {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }

  global.UI = {
    h: h,
    icon: icon,
    card: card,
    row: row,
    inset: inset,
    btn: btn,
    iconBtn: iconBtn,
    status: status,
    pill: pill,
    chip: chip,
    rungBadge: rungBadge,
    toggle: toggle,
    seg: seg,
    field: field,
    input: input,
    textarea: textarea,
    empty: empty,
    header: header,
    dock: dock,
    twoStep: twoStep,
    onSwipe: onSwipe
  };
})(window);
