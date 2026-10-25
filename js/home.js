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
    })).then(function (rows) { render(rows); });
  }).catch(function (e) { H.fail(gamesBox, e.message); });

  function render(rows) {
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
    rows.forEach(function (r) {
      var g = r.game, s = r.stats;
      var card = el('a', { class: 'card game-card', href: 'game.html?id=' + encodeURIComponent(g.id) }, [
        el('div', { class: 'top' }, [
          el('span', { class: 'date', text: H.fmtDate(g.date) }),
          el('span', { class: 'pill', text: (g.periods || []).length + ' periods · ' + H.fmtTime(g.duration) })
        ]),
        el('div', { class: 'opp', text: 'vs ' + (g.opponent || 'Opponent') }),
        s ? el('div', { class: 'scoreline' }, [
          el('span', { class: 'score', 'aria-label': 'Goals: us ' + s.total.goals.us + ', them ' + s.total.goals.them }, [
            el('i', { class: 'key us', 'aria-hidden': 'true' }), String(s.total.goals.us),
            el('span', { class: 'dash', text: '–' }),
            String(s.total.goals.them), el('i', { class: 'key them', 'aria-hidden': 'true', style: 'margin:0 0 0 6px' })
          ]),
          el('span', { class: 'meta', text: 'Shots ' + s.total.shots.us + '–' + s.total.shots.them +
            (s.zones.total ? ' · ' + H.pct(s.zones.total.theirEnd) + ' in their end' : '') })
        ]) : el('div', { class: 'meta', text: 'Stats not available yet' }),
        g.summary ? el('div', { class: 'meta', text: g.summary }) : null,
        el('div', { class: 'go', text: 'Watch game →' })
      ]);
      gamesBox.appendChild(card);
    });
  }
})();
