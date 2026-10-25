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
    var head = ['Date', 'Opponent', 'Their end', 'Our end'];
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var z = r.stats.zones.total;
      tbody.appendChild(el('tr', null, [
        el('td', null, [el('a', { href: 'game.html?id=' + encodeURIComponent(r.game.id), text: short(r.game) })]),
        el('td', { text: (r.game.opponent || '') + H.sideTag(r.game) }),
        el('td', { text: z ? H.pct(z.theirEnd) : '-' }),
        el('td', { text: z ? H.pct(z.ourEnd) : '-' })
      ]));
    });
    var tableCard = el('section', { class: 'card', 'aria-labelledby': 'pg-h' }, [
      el('h2', { id: 'pg-h', text: 'Game by game' }),
      el('div', { class: 'table-scroll' }, [el('table', { class: 'stats' }, [
        el('thead', null, [el('tr', null, head.map(function (h, i) { return el('th', { scope: 'col', text: h }); }))]), tbody])]),
      el('p', { class: 'chart-note', text: 'Share of the game the play spent in each end.' })
    ]);
    root.appendChild(tableCard);

    var zonesBox = el('div', { id: 'zones-chart' });
    root.appendChild(el('div', { class: 'section' }, [
      el('section', { class: 'card', 'aria-labelledby': 'zt-h' }, [
        el('h2', { id: 'zt-h', text: 'Zone time per game' }),
        el('div', { class: 'legend' }, [el('span', null, [el('i', { class: 'key us' }), 'Their end']),
          el('span', null, [el('i', { class: 'key neutral' }), 'Neutral']), el('span', null, [el('i', { class: 'key them' }), 'Our end'])]),
        zonesBox])
    ]));
    zonesChart(zonesBox, rows);
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
