(function () {
  'use strict';
  var H = window.Hockey, el = H.el;
  var totalsBox = document.getElementById('totals'), gamesBox = document.getElementById('games');

  function tile(label, value, sub) {
    return el('div', { class: 'tile' }, [
      el('div', { class: 'label', text: label }),
      el('div', { class: 'value' }, value),
      sub ? el('div', { class: 'sub', text: sub }) : null
    ]);
  }
  function pair(a, b) { return [String(a), el('span', { class: 'sep', text: '–' }), String(b)]; }

  H.loadIndex().then(function (index) {
    H.setHeader(index);
    var games = (index.games || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return Promise.all(games.map(function (g) {
      return H.loadGame(g.id).then(function (d) { return { game: g, stats: H.computeStats(g, d) }; },
        function () { return { game: g, stats: null }; });
    })).then(function (rows) { render(rows, index); });
  }).catch(function (e) { H.fail(gamesBox, e.message); });

  function render(rows, index) {
    var gf = 0, ga = 0, sf = 0, sa = 0, att = 0, attN = 0;
    rows.forEach(function (r) {
      if (!r.stats) return;
      var t = r.stats.total;
      gf += t.goals.us; ga += t.goals.them; sf += t.shots.us; sa += t.shots.them;
      if (r.stats.zones.total) { att += r.stats.zones.total.theirEnd; attN++; }
    });
    totalsBox.textContent = '';
    totalsBox.appendChild(tile('Games', [String(rows.length)], rows.length === 1 ? 'game recorded' : 'games recorded'));
    totalsBox.appendChild(tile('Goals for – against', pair(gf, ga), 'detected from video'));
    totalsBox.appendChild(tile('Shots for – against', pair(sf, sa), 'shots on goal, incl. goals'));
    totalsBox.appendChild(tile('Time in attacking end', [attN ? H.pct(att / attN) : '-'], 'average per game'));

    gamesBox.textContent = '';
    if (!rows.length) { gamesBox.appendChild(el('p', { class: 'empty', text: 'No games yet.' })); return; }
    var us = (index.team && index.team.name) || 'Us';
    rows.forEach(function (r) {
      var g = r.game, s = r.stats, gl = s && s.total.goals;
      var row = function (team, name, n, win) {
        return el('div', { class: 'gc-row ' + team + (win ? ' win' : '') }, [el('i', { class: 'bar', 'aria-hidden': 'true' }),
          el('span', { class: 'name', text: name, title: name }), el('b', { class: 'num tnum' + (s ? '' : ' dim'), text: s ? String(n) : '–' })]);
      };
      var card = el('a', { class: 'card game-card', href: 'game.html?id=' + encodeURIComponent(g.id),
        'aria-label': 'Watch ' + us + ' vs ' + (g.opponent || 'Opponent') + H.sideTag(g) + ', ' + H.fmtDate(g.date) + (s ? ', score ' + gl.us + ' to ' + gl.them : ', video only') }, [
        el('div', { class: 'gc-top' }, [
          el('span', { text: H.fmtDate(g.date) + (g.side ? ' · ' + g.side : '') }),
          el('span', { class: 'status' + (s ? '' : ' video'), text: s ? 'Final' : 'Video only' })
        ]),
        el('div', { class: 'gc-board' }, [
          row('us', us, s && gl.us, s && gl.us > gl.them),
          row('them', g.opponent || 'Opponent', s && gl.them, s && gl.them > gl.us)
        ]),
        el('div', { class: 'gc-meta' }, [
          s ? el('span', { class: 'pill', text: 'Shots ' + s.total.shots.us + '–' + s.total.shots.them }) : null,
          s && s.zones.total ? el('span', { class: 'pill', text: H.pct(s.zones.total.theirEnd) + ' in their end' }) : null,
          el('span', { class: 'pill', text: (g.periods || []).length + ' periods · ' + H.fmtTime(g.duration) })
        ]),
        g.summary ? el('p', { class: 'gc-sum', text: g.summary }) : null,
        el('div', { class: 'gc-go' }, [el('span', { text: '▶ Watch game' })])
      ]);
      gamesBox.appendChild(card);
    });
  }
})();
