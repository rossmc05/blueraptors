/* Shared helpers: data loading, stats, formatting, icons, tooltip. No dependencies. */
(function () {
  'use strict';

  var TYPES = ['goal', 'shot', 'save', 'chance', 'breakaway', 'penalty', 'stoppage'];
  var TYPE_LABEL = {
    goal: 'Goal', shot: 'Shot', save: 'Save', chance: 'Scoring chance',
    breakaway: 'Breakaway', penalty: 'Penalty', stoppage: 'Stoppage'
  };
  var SVGNS = 'http://www.w3.org/2000/svg';

  function fetchJSON(path) {
    // cache: 'no-cache' so a replaced JSON file shows up without a hard refresh
    return fetch(path, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' (' + r.status + ')');
      return r.json();
    });
  }

  function loadIndex() { return fetchJSON('data/games.json'); }
  function loadGame(id) { return fetchJSON('data/games/' + encodeURIComponent(id) + '.json'); }

  /* Resolve a game's video URL. Absolute URLs are used as-is; otherwise the path is
     resolved against index.videoBase (if set), else against the current page. */
  function videoUrl(index, game) {
    var v = game && game.video;
    if (!v) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
    var base = (index && index.videoBase) || '';
    try {
      if (base) return new URL(v, new URL(base, location.href)).href;
      return new URL(v, location.href).href;
    } catch (e) { return v; }
  }

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var mm = h ? String(m).padStart(2, '0') : String(m);
    return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
  }
  function fmtDate(iso, opts) {
    var p = String(iso || '').split('-').map(Number);
    if (p.length < 3 || p.some(isNaN)) return String(iso || '');
    var d = new Date(p[0], p[1] - 1, p[2]);
    return d.toLocaleDateString(undefined, opts || { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function pct(x) { return isFinite(x) ? Math.round(x * 100) + '%' : '-'; }

  function periodOf(game, t) {
    var ps = (game && game.periods) || [];
    for (var i = 0; i < ps.length; i++) if (t >= ps[i].start && t < ps[i].end) return ps[i].n;
    if (ps.length && t >= ps[ps.length - 1].end) return ps[ps.length - 1].n;
    return 1;
  }

  function normEvents(game, data) {
    return ((data && data.events) || [])
      .filter(function (e) { return e && isFinite(e.t) && TYPES.indexOf(e.type) >= 0; })
      .map(function (e, i) {
        return {
          i: i, t: +e.t, type: e.type, team: e.team === 'them' ? 'them' : 'us',
          period: e.period || periodOf(game, +e.t), player: e.player || null,
          note: e.note || '', confidence: e.confidence || 'medium', key: e.key !== false
        };
      })
      .sort(function (a, b) { return a.t - b.t; });
  }

  function normActivity(data) {
    return ((data && data.activity) || []).filter(function (a) { return a && isFinite(a.t); }).map(function (a) {
      var o = Math.max(0, +a.ourEnd || 0), n = Math.max(0, +a.neutral || 0), th = Math.max(0, +a.theirEnd || 0);
      var s = o + n + th || 1;
      return { t: +a.t, ourEnd: o / s, neutral: n / s, theirEnd: th / s, intensity: isFinite(a.intensity) ? +a.intensity : 0.5 };
    }).sort(function (a, b) { return a.t - b.t; });
  }

  function emptyCounts() { return { goals: { us: 0, them: 0 }, shots: { us: 0, them: 0 }, saves: { us: 0, them: 0 } }; }

  function zoneOf(bins) {
    if (!bins.length) return null;
    var z = { ourEnd: 0, neutral: 0, theirEnd: 0 };
    bins.forEach(function (b) { z.ourEnd += b.ourEnd; z.neutral += b.neutral; z.theirEnd += b.theirEnd; });
    z.ourEnd /= bins.length; z.neutral /= bins.length; z.theirEnd /= bins.length;
    return z;
  }

  /* Team-level stats. A goal also counts as a shot on goal.
     "save" events are credited to the team whose goalie made the save. */
  function computeStats(game, data) {
    var events = normEvents(game, data), act = normActivity(data);
    var total = emptyCounts(), byPeriod = {};
    (game.periods || [{ n: 1 }]).forEach(function (p) { byPeriod[p.n] = emptyCounts(); });
    events.forEach(function (e) {
      var targets = [total];
      if (!byPeriod[e.period]) byPeriod[e.period] = emptyCounts();
      targets.push(byPeriod[e.period]);
      targets.forEach(function (c) {
        if (e.type === 'goal') { c.goals[e.team]++; c.shots[e.team]++; }
        else if (e.type === 'shot') c.shots[e.team]++;
        else if (e.type === 'save') c.saves[e.team]++;
      });
    });
    var zones = { total: zoneOf(act), byPeriod: {} };
    Object.keys(byPeriod).forEach(function (n) {
      zones.byPeriod[n] = zoneOf(act.filter(function (b) { return periodOf(game, b.t) === +n; }));
    });
    return { events: events, activity: act, total: total, byPeriod: byPeriod, zones: zones };
  }

  /* ---------- DOM helpers ---------- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function svg(tag, attrs, kids) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  /* Event-type glyphs: shape = type, fill colour = team. 16x16 viewBox. */
  function icon(type, team, size) {
    size = size || 16;
    var fill = team === 'them' ? 'var(--them)' : 'var(--us)';
    var ring = { stroke: 'var(--surface)', 'stroke-width': 1.5, 'paint-order': 'stroke', fill: fill };
    var s = svg('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' });
    var shape;
    switch (type) {
      case 'goal': shape = svg('path', Object.assign({ d: 'M8 .8l2.1 4.5 4.9.6-3.6 3.4.9 4.9L8 11.8l-4.3 2.4.9-4.9L1 5.9l4.9-.6z' }, ring)); break;
      case 'shot': shape = svg('circle', Object.assign({ cx: 8, cy: 8, r: 5 }, ring)); break;
      case 'save': shape = svg('path', Object.assign({ d: 'M8 1.5l5.5 2v4.2c0 3.2-2.4 5.6-5.5 6.8-3.1-1.2-5.5-3.6-5.5-6.8V3.5z' }, ring)); break;
      case 'chance': shape = svg('path', Object.assign({ d: 'M8 2.2l6 10.6H2z' }, ring)); break;
      case 'breakaway': shape = svg('path', Object.assign({ d: 'M2 4h6V1.5L14.5 8 8 14.5V12H2z' }, ring)); break;
      case 'penalty': shape = svg('rect', { x: 3, y: 3, width: 10, height: 10, rx: 2, fill: 'none', stroke: fill, 'stroke-width': 2.4 }); break;
      default: shape = svg('rect', { x: 6, y: 2, width: 4, height: 12, rx: 2, fill: 'var(--muted)' });
    }
    s.appendChild(shape);
    return s;
  }

  /* One shared tooltip. Content built with textContent only. */
  var tipEl = null;
  function tip() {
    if (!tipEl) { tipEl = el('div', { class: 'tip', role: 'tooltip' }); document.body.appendChild(tipEl); }
    return tipEl;
  }
  function showTip(x, y, rows) {
    var t = tip();
    t.textContent = '';
    rows.forEach(function (r) {
      var row = el('div', { class: 'row' });
      if (r.key) row.appendChild(el('span', { class: 'key line ' + r.key }));
      if (r.value != null) row.appendChild(el('span', { class: 'tv', text: r.value }));
      if (r.label) row.appendChild(el('span', { class: 'tl', text: r.label }));
      t.appendChild(row);
    });
    t.classList.add('show');
    var w = t.offsetWidth, h = t.offsetHeight, vw = document.documentElement.clientWidth;
    var left = Math.min(Math.max(8, x + 12), vw - w - 8);
    var top = y - h - 12; if (top < 8) top = y + 16;
    t.style.left = left + 'px'; t.style.top = top + 'px';
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('show'); }

  function setHeader(index) {
    var name = (index && index.team && index.team.name) || 'Our team';
    document.querySelectorAll('[data-team-name]').forEach(function (n) { n.textContent = name; });
  }

  function fail(container, msg) {
    container.textContent = '';
    container.appendChild(el('div', { class: 'notice' }, [
      el('strong', { text: 'Could not load the game data. ' }),
      el('span', { text: msg + ' - this site has to be opened through a web server (not as a file), e.g. python3 -m http.server.' })
    ]));
  }

  window.Hockey = {
    TYPES: TYPES, TYPE_LABEL: TYPE_LABEL, loadIndex: loadIndex, loadGame: loadGame, videoUrl: videoUrl,
    fmtTime: fmtTime, fmtDate: fmtDate, pct: pct, periodOf: periodOf, computeStats: computeStats,
    el: el, svg: svg, icon: icon, showTip: showTip, hideTip: hideTip, setHeader: setHeader, fail: fail
  };
})();
