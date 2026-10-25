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

  H.loadIndex().then(function (index) {
    H.setHeader(index);
    var games = (index.games || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return Promise.all(games.map(function (g) {
      return H.loadGame(g.id).then(function (d) { return { game: g, stats: H.computeStats(g, d) }; },
        function () { return { game: g, stats: null }; });
    })).then(function (rows) { render(rows, index); });
  }).catch(function (e) { H.fail(gamesBox, e.message); });

  function render(rows, index) {
    // No scores or shot counts on the site: goals are only marked in the video.
    totalsBox.textContent = '';
    totalsBox.appendChild(tile('Games', [String(rows.length)], rows.length === 1 ? 'game recorded' : 'games recorded'));

    gamesBox.textContent = '';
    if (!rows.length) { gamesBox.appendChild(el('p', { class: 'empty', text: 'No games yet.' })); return; }
    var us = (index.team && index.team.name) || 'Us';
    rows.forEach(function (r) {
      var g = r.game;
      var row = function (team, name) {
        return el('div', { class: 'gc-row ' + team }, [el('i', { class: 'bar', 'aria-hidden': 'true' }),
          el('span', { class: 'name', text: name, title: name })]);
      };
      var card = el('a', { class: 'card game-card', href: 'game.html?id=' + encodeURIComponent(g.id),
        'aria-label': 'Watch ' + us + ' vs ' + (g.opponent || 'Opponent') + H.sideTag(g) + ', ' + H.fmtDate(g.date) }, [
        el('div', { class: 'gc-top' }, [
          el('span', { text: H.fmtDate(g.date) + (g.side ? ' · ' + g.side : '') }),
          el('span', { class: 'status video', text: H.fmtTime(g.duration) })
        ]),
        el('div', { class: 'gc-board' }, [
          row('us', us),
          row('them', g.opponent || 'Opponent')
        ]),
        el('div', { class: 'gc-meta' }, [
          el('span', { class: 'pill', text: (g.periods || []).length + ' periods · ' + H.fmtTime(g.duration) })
        ]),
        g.summary ? el('p', { class: 'gc-sum', text: g.summary }) : null,
        el('div', { class: 'gc-go' }, [el('span', { text: '▶ Watch game' })])
      ]);
      gamesBox.appendChild(card);
    });
  }
})();
