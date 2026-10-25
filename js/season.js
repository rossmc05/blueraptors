(function () {
  'use strict';
  var H = window.Hockey, el = H.el, svg = H.svg;
  var root = document.getElementById('season');

  H.loadIndex().then(function (index) {
    H.setHeader(index);
    var games = (index.games || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return Promise.all(games.map(function (g) {
      return H.loadGame(g.id).then(function (d) { return { game: g, stats: H.computeStats(g, d) }; },
        function () { return null; });
    })).then(function (rows) { render(rows.filter(Boolean)); });
  }).catch(function (e) { H.fail(root, e.message); });

  function short(g) { return H.fmtDate(g.date, { month: 'short', day: 'numeric' }); }

  function render(rows) {
    root.textContent = '';
    if (!rows.length) { root.appendChild(el('p', { class: 'empty', text: 'No games yet.' })); return; }

    // per-game table
    var head = ['Date', 'Opponent', 'Goals', 'Shots', 'Saves', 'Their end', 'Our end'];
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var t = r.stats.total, z = r.stats.zones.total;
      tbody.appendChild(el('tr', null, [
        el('td', null, [el('a', { href: 'game.html?id=' + encodeURIComponent(r.game.id), text: short(r.game) })]),
        el('td', { text: (r.game.opponent || '') + H.sideTag(r.game) }),
        el('td', { text: t.goals.us + '–' + t.goals.them }),
        el('td', { text: t.shots.us + '–' + t.shots.them }),
        el('td', { text: t.saves.us + '–' + t.saves.them }),
        el('td', { text: z ? H.pct(z.theirEnd) : '-' }),
        el('td', { text: z ? H.pct(z.ourEnd) : '-' })
      ]));
    });
    var tableCard = el('section', { class: 'card', 'aria-labelledby': 'pg-h' }, [
      el('h2', { id: 'pg-h', text: 'Game by game' }),
      el('div', { class: 'table-scroll' }, [el('table', { class: 'stats' }, [
        el('thead', null, [el('tr', null, head.map(function (h, i) { return el('th', { scope: 'col', text: h }); }))]), tbody])]),
      el('p', { class: 'chart-note', text: 'Numbers are us–them. Shots include goals.' })
    ]);
    root.appendChild(tableCard);

    var shotsBox = el('div', { class: 'chart', id: 'shots-chart' });
    var zonesBox = el('div', { id: 'zones-chart' });
    root.appendChild(el('div', { class: 'grid-2 section' }, [
      el('section', { class: 'card', 'aria-labelledby': 'sh-h' }, [
        el('h2', { id: 'sh-h', text: 'Shots on goal per game' }),
        el('div', { class: 'legend' }, [el('span', null, [el('i', { class: 'key us' }), 'Us']), el('span', null, [el('i', { class: 'key them' }), 'Opponent'])]),
        shotsBox]),
      el('section', { class: 'card', 'aria-labelledby': 'zt-h' }, [
        el('h2', { id: 'zt-h', text: 'Zone time per game' }),
        el('div', { class: 'legend' }, [el('span', null, [el('i', { class: 'key us' }), 'Their end']),
          el('span', null, [el('i', { class: 'key neutral' }), 'Neutral']), el('span', null, [el('i', { class: 'key them' }), 'Our end'])]),
        zonesBox])
    ]));
    var lastW = 0;
    var draw = function () { var w = shotsBox.clientWidth; if (w && w !== lastW) { lastW = w; shotsChart(shotsBox, rows); } };
    draw();
    if (window.ResizeObserver) new ResizeObserver(draw).observe(shotsBox);
    zonesChart(zonesBox, rows);
  }

  function niceMax(v) { var steps = [5, 10, 15, 20, 30, 40, 50, 60, 80, 100]; for (var i = 0; i < steps.length; i++) if (v <= steps[i]) return steps[i]; return Math.ceil(v / 50) * 50; }

  function colPath(x, y, w, h) {
    var r = Math.min(4, h, w / 2);
    if (h <= 0) return '';
    return 'M' + x + ' ' + (y + h) + 'V' + (y + r) + 'Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + r) + 'V' + (y + h) + 'Z';
  }

  function shotsChart(box, rows) {
    box.textContent = '';
    var W = box.clientWidth || 400, Hh = 200, m = { l: 28, r: 4, t: 18, b: 34 };
    var iw = W - m.l - m.r, ih = Hh - m.t - m.b;
    var max = niceMax(Math.max.apply(null, rows.map(function (r) { return Math.max(r.stats.total.shots.us, r.stats.total.shots.them); }).concat([1])));
    var Y = function (v) { return m.t + ih - v / max * ih; };
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + Hh, width: W, height: Hh, role: 'img', 'aria-label': 'Shots on goal per game, us versus opponent' });
    [0, max / 2, max].forEach(function (v) {
      s.appendChild(svg('line', { class: v ? 'grid-line' : 'zero-line', x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }));
      s.appendChild(svg('text', { class: 'axis-text tnum', x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end', text: String(v) }));
    });
    var band = iw / rows.length, bw = Math.min(24, (band - 16) / 2);
    rows.forEach(function (r, i) {
      var cx = m.l + band * (i + 0.5);
      [['us', -1], ['them', 1]].forEach(function (p) {
        var v = r.stats.total.shots[p[0]], x = p[1] < 0 ? cx - 1 - bw : cx + 1;
        var path = svg('path', { d: colPath(x, Y(v), bw, Y(0) - Y(v)), fill: 'var(--' + p[0] + ')' });
        s.appendChild(path);
        if (rows.length <= 8) s.appendChild(svg('text', { class: 'axis-text tnum', x: x + bw / 2, y: Y(v) - 4, 'text-anchor': 'middle', style: 'fill:var(--ink-2)', text: String(v) }));
        var hit = svg('rect', { x: x - 2, y: m.t, width: bw + 4, height: ih, fill: 'transparent', tabindex: 0,
          'aria-label': short(r.game) + ' ' + (p[0] === 'us' ? 'us' : r.game.opponent) + ' ' + v + ' shots' });
        var show = function (ev) {
          var b = hit.getBoundingClientRect();
          path.style.opacity = '.8';
          H.showTip(ev && ev.clientX != null ? ev.clientX : b.left, ev && ev.clientY != null ? ev.clientY : b.top + 40, [
            { value: String(v), label: 'shots · ' + (p[0] === 'us' ? 'Us' : r.game.opponent) },
            { label: short(r.game) + ' vs ' + r.game.opponent }]);
        };
        var hide = function () { path.style.opacity = ''; H.hideTip(); };
        hit.addEventListener('pointermove', show); hit.addEventListener('focus', function () { show(null); });
        hit.addEventListener('pointerleave', hide); hit.addEventListener('blur', hide);
        s.appendChild(hit);
      });
      s.appendChild(svg('text', { class: 'axis-text', x: cx, y: Hh - 18, 'text-anchor': 'middle', text: short(r.game) }));
      s.appendChild(svg('text', { class: 'axis-text', x: cx, y: Hh - 5, 'text-anchor': 'middle', text: band > 70 ? 'vs ' + r.game.opponent : '' }));
    });
    box.appendChild(s);
  }

  function zonesChart(box, rows) {
    box.textContent = '';
    rows.forEach(function (r) {
      var z = r.stats.zones.total;
      var label = el('span', { text: short(r.game) });
      if (!z) { box.appendChild(el('div', { class: 'zone-row' }, [label, el('span', { text: 'no data' })])); return; }
      var segs = [['z-their', z.theirEnd, 'Their end'], ['z-neu', z.neutral, 'Neutral'], ['z-our', z.ourEnd, 'Our end']];
      var bar = el('div', { class: 'zone-bar', role: 'img', 'aria-label': short(r.game) + ': ' + segs.map(function (s) { return s[2] + ' ' + H.pct(s[1]); }).join(', ') });
      segs.forEach(function (sg) {
        var d = el('div', { class: sg[0], style: 'flex:' + Math.max(sg[1], 0.001) + ' 1 0' });
        if (sg[1] >= 0.12) d.textContent = H.pct(sg[1]);
        d.addEventListener('pointermove', function (ev) { H.showTip(ev.clientX, ev.clientY, [{ value: H.pct(sg[1]), label: sg[2] + ' · vs ' + r.game.opponent }]); });
        d.addEventListener('pointerleave', H.hideTip);
        bar.appendChild(d);
      });
      box.appendChild(el('div', { class: 'zone-row' }, [label, bar]));
    });
    box.appendChild(el('p', { class: 'chart-note', text: 'Share of on-ice action by zone. More blue = more time attacking.' }));
  }
})();
