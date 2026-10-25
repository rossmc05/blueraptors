(function () {
  'use strict';
  var H = window.Hockey, el = H.el, svg = H.svg;
  var HL_TYPES = ['goal', 'shot', 'save', 'chance'];
  var HL_BEFORE = 6, HL_AFTER = 4, SEEK_LEAD = 5;

  var $ = function (id) { return document.getElementById(id); };
  var state = {
    index: null, game: null, stats: null, video: null, videoOk: false, cursor: 0, duration: 1,
    types: new Set(H.TYPES), teams: new Set(['us', 'them']), activeEvent: null,
    hl: null // { clips, i }
  };

  var params = new URLSearchParams(location.search);
  H.loadIndex().then(function (index) {
    state.index = index; H.setHeader(index);
    var games = index.games || [];
    var id = params.get('id');
    var game = games.filter(function (g) { return g.id === id; })[0] || (!id && games[0]);
    if (!game) throw new Error('No game with id "' + id + '"');
    state.game = game;
    return H.loadGame(game.id).then(function (data) { init(game, data); });
  }).catch(function (e) { H.fail($('game-root'), e.message); });

  function teamName(team) { return team === 'them' ? (state.game.opponent || 'Opponent') : 'Us'; }

  function init(game, data) {
    state.stats = H.computeStats(game, data);
    // Stats count every event; the list, timeline and highlights show only key plays.
    state.stats.events = state.stats.events.filter(function (e) { return e.key; });
    state.duration = game.duration || (state.stats.events.length ? state.stats.events[state.stats.events.length - 1].t + 10 : 60);
    document.title = 'vs ' + (game.opponent || 'Opponent') + ' · ' + H.fmtDate(game.date, { month: 'short', day: 'numeric' });
    $('game-title').textContent = 'vs ' + (game.opponent || 'Opponent');
    var t = state.stats.total;
    $('game-sub').textContent = H.fmtDate(game.date) + ' · Goals ' + t.goals.us + '–' + t.goals.them +
      ' · Shots ' + t.shots.us + '–' + t.shots.them + (game.summary ? ' · ' + game.summary : '');

    setupPlayer(game);
    renderFilters();
    renderTimeline();
    renderEvents();
    renderStats();
    renderZones();
    renderPressureTable();
    var pr = $('pressure'), lastW = 0;
    var draw = function () { var w = pr.clientWidth; if (w && w !== lastW) { lastW = w; renderPressure(); } };
    draw();
    if (window.ResizeObserver) new ResizeObserver(draw).observe(pr); else window.addEventListener('resize', draw);
    setupKeys();
    tick();
  }

  /* ---------------- player ---------------- */
  function setupPlayer(game) {
    var box = $('player-box');
    var src = H.videoUrl(state.index, game);
    if (!src) { showMissing(null); return; }
    // No crossOrigin attribute: plain cross-origin playback needs no CORS.
    // Our own control bar sits below the picture, so hovering never dims the video
    // the way the browser's built-in controls do.
    var v = el('video', { preload: 'metadata', playsinline: '', id: 'video' });
    v.src = src;
    var scrub = el('input', { type: 'range', class: 'scrub', id: 'scrub', min: '0', max: String(state.duration), step: '0.1', value: '0', 'aria-label': 'Video position' });
    var fs = el('button', { class: 'vbtn', type: 'button', id: 'btn-fs', 'aria-label': 'Full screen', text: '\u26F6' });
    var bar = el('div', { class: 'vbar' }, [scrub, fs]);
    var wrap = el('div', { class: 'player' }, [v, bar]);
    box.appendChild(wrap);
    v.addEventListener('click', togglePlay);
    scrub.addEventListener('input', function () { seek(+scrub.value, false); });
    scrub.addEventListener('pointerdown', function () { state.scrubbing = true; });
    window.addEventListener('pointerup', function () { state.scrubbing = false; });
    fs.onclick = function () {
      if (document.fullscreenElement) return document.exitFullscreen();
      if (wrap.requestFullscreen) wrap.requestFullscreen();
      else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); // iPhone: native player
    };
    state.video = v; state.videoOk = true;
    v.addEventListener('error', function () { showMissing(src); });
    v.addEventListener('timeupdate', tick);
    v.addEventListener('seeked', function () { state.hlSeeking = false; tick(); });
    // Scrubbing the video's own seek bar during highlights means "I want the full game".
    v.addEventListener('seeking', function () { if (state.hl && !state.hlSeeking) exitHighlights(); });
    v.addEventListener('play', syncPlayBtn);
    v.addEventListener('pause', syncPlayBtn);
    $('btn-play').onclick = togglePlay;
    $('btn-back').onclick = function () { nudge(-10); };
    $('btn-fwd').onclick = function () { nudge(10); };
    $('btn-hl').onclick = function () { if (state.hl) exitHighlights(); else startHighlights(); };
    $('hl-prev').onclick = function () { gotoClip(state.hl ? state.hl.i - 1 : 0); };
    $('hl-next').onclick = function () { gotoClip(state.hl ? state.hl.i + 1 : 0); };
    $('hl-stop').onclick = exitHighlights;
  }

  function showMissing(src) {
    stopHighlights();
    state.videoOk = false;
    if (state.video) { state.video.removeAttribute('src'); state.video.load(); }
    state.video = null;
    var box = $('player-box');
    box.textContent = '';
    box.appendChild(el('div', { class: 'video-missing', id: 'video-missing', role: 'status' }, [
      el('strong', { text: 'Video not available yet' }),
      el('p', { text: 'The game video hasn’t been uploaded, or the video server is offline. All the stats below still work – check back later for the footage.' }),
      src ? el('code', { text: src.replace(/^.*\//, '') }) : null
    ]));
    ['btn-play', 'btn-back', 'btn-fwd', 'btn-hl'].forEach(function (id) { $(id).disabled = true; });
    $('btn-hl').title = 'Highlights need the video';
    document.body.dataset.video = 'missing';
  }

  function syncPlayBtn() { if (state.video) $('btn-play').textContent = state.video.paused ? 'Play' : 'Pause'; }
  function togglePlay() {
    var v = state.video; if (!v) return;
    if (v.paused) v.play().catch(function () {}); else v.pause();
  }
  function nudge(d) { seek(curTime() + d, false, true); }
  function curTime() { return state.video ? state.video.currentTime : state.cursor; }

  function seek(t, play, keepHighlights) {
    t = Math.max(0, Math.min(state.duration, t));
    if (!keepHighlights) stopHighlights();
    state.cursor = t;
    var v = state.video;
    if (v) {
      try { v.currentTime = t; } catch (e) { /* not seekable yet */ }
      if (play) v.play().catch(function () {});
    }
    tick();
  }

  function tick() {
    var t = curTime();
    var x = Math.max(0, Math.min(1, t / state.duration)) * 100;
    var ph = $('tl-playhead'), pg = $('tl-progress');
    if (ph) ph.style.left = x + '%';
    if (pg) pg.style.width = x + '%';
    var sc = $('scrub');
    if (sc && !state.scrubbing) { sc.value = t; sc.style.setProperty('--p', x + '%'); }
    var pl = document.querySelector('#pressure .playhead');
    if (pl && state.prX) { var px = state.prX(t); pl.setAttribute('x1', px); pl.setAttribute('x2', px); }
    $('now').textContent = H.fmtTime(t) + ' / ' + H.fmtTime(state.duration) + ' · P' + H.periodOf(state.game, t);
    // active event: last visible event within the 12 s before the playhead
    if (state.video && !state.video.paused) {
      var cand = null;
      visibleEvents().forEach(function (e) { if (e.t <= t + 0.5 && t - e.t < 12) cand = e; });
      if (cand && cand !== state.activeEvent) setActive(cand, false);
    }
    if (state.hl) hlTick(t);
  }

  /* ---------------- filters ---------------- */
  function visibleEvents() {
    return state.stats.events.filter(function (e) { return state.types.has(e.type) && state.teams.has(e.team); });
  }
  function renderFilters() {
    var box = $('filters'); box.textContent = '';
    var counts = {}; state.stats.events.forEach(function (e) { counts[e.type] = (counts[e.type] || 0) + 1; });
    var typeRow = el('div', { class: 'row', role: 'group', 'aria-label': 'Event types' }, [el('span', { class: 'lbl', text: 'Type' })]);
    var chips = el('div', { class: 'chips' });
    H.TYPES.forEach(function (ty) {
      if (!counts[ty]) return;
      var b = el('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', 'data-type': ty }, [
        H.icon(ty, 'us', 14), H.TYPE_LABEL[ty] + ' ' + counts[ty]]);
      b.onclick = function () { toggle(state.types, ty, b); };
      chips.appendChild(b);
    });
    typeRow.appendChild(chips);
    var teamRow = el('div', { class: 'row', role: 'group', 'aria-label': 'Teams' }, [el('span', { class: 'lbl', text: 'Team' })]);
    var tchips = el('div', { class: 'chips' });
    ['us', 'them'].forEach(function (tm) {
      var b = el('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', 'data-team': tm }, [
        el('i', { class: 'key ' + tm, style: 'margin:0' }), teamName(tm)]);
      b.onclick = function () { toggle(state.teams, tm, b); };
      tchips.appendChild(b);
    });
    teamRow.appendChild(tchips);
    box.appendChild(typeRow); box.appendChild(teamRow);
  }
  function toggle(set, key, btn) {
    if (set.has(key)) set.delete(key); else set.add(key);
    btn.setAttribute('aria-pressed', set.has(key) ? 'true' : 'false');
    renderTimeline(); renderEvents();
    if (state.lastPressureW) renderPressure();
  }

  /* ---------------- timeline ---------------- */
  function renderTimeline() {
    var box = $('timeline'); box.textContent = '';
    var D = state.duration;
    box.appendChild(el('div', { class: 'lane lane-us' }));
    box.appendChild(el('div', { class: 'lane lane-them' }));
    box.appendChild(el('span', { class: 'lane-label', style: 'top:15px' }, [el('i', { class: 'key us' }), 'Us']));
    box.appendChild(el('span', { class: 'lane-label', style: 'top:43px', title: teamName('them') }, [el('i', { class: 'key them' }), 'Opp']));
    var tl = el('div', { class: 'track' });
    box.appendChild(tl);
    tl.appendChild(el('div', { class: 'progress', id: 'tl-progress' }));
    (state.game.periods || []).forEach(function (p) {
      var x = p.start / D * 100;
      if (p.start > 0) tl.appendChild(el('div', { class: 'period-line', style: 'left:' + x + '%' }));
      tl.appendChild(el('span', { class: 'period-label', style: 'left:' + x + '%', text: 'P' + p.n }));
    });
    visibleEvents().forEach(function (e) {
      var b = el('button', {
        type: 'button', class: 'marker ' + e.type, 'data-i': e.i, 'data-t': e.t,
        style: 'left:' + (e.t / D * 100) + '%;top:' + (e.team === 'us' ? 22 : 50) + 'px',
        'aria-label': H.TYPE_LABEL[e.type] + ', ' + teamName(e.team) + ', ' + H.fmtTime(e.t) + (e.note ? ': ' + e.note : '')
      }, [H.icon(e.type, e.team, e.type === 'goal' ? 18 : 14)]);
      b.addEventListener('click', function (ev) { ev.stopPropagation(); jumpTo(e); });
      var show = function (ev) {
        var r = b.getBoundingClientRect();
        H.showTip(ev && ev.clientX != null ? ev.clientX : r.left + 12, r.top, [
          { value: H.fmtTime(e.t), label: H.TYPE_LABEL[e.type] + ' · ' + teamName(e.team) },
          e.note ? { label: e.note } : null
        ].filter(Boolean));
      };
      b.addEventListener('pointerenter', show); b.addEventListener('focus', function () { show(null); });
      b.addEventListener('pointerleave', H.hideTip); b.addEventListener('blur', H.hideTip);
      tl.appendChild(b);
    });
    tl.appendChild(el('div', { class: 'playhead', id: 'tl-playhead' }));
    box.onclick = function (ev) {
      var r = tl.getBoundingClientRect();
      seek(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * D, !!state.video && !state.video.paused);
    };
    var ax = $('timeline-axis'); ax.textContent = '';
    var step = D > 2400 ? 600 : D > 600 ? 300 : 30;
    var ticks = [0]; for (var s = step; s < D - step * 0.4; s += step) ticks.push(s); ticks.push(D);
    ticks.forEach(function (s) { ax.appendChild(el('span', { style: 'left:' + (s / D * 100) + '%', text: H.fmtTime(s) })); });
    tick();
    if (state.activeEvent) markActive(state.activeEvent);
  }

  function jumpTo(e) {
    setActive(e, true);
    seek(e.t - SEEK_LEAD, true);
  }
  function setActive(e, scroll) { state.activeEvent = e; markActive(e, scroll); }
  function markActive(e, scroll) {
    document.querySelectorAll('.marker.active, .ev.active').forEach(function (n) { n.classList.remove('active'); });
    var m = document.querySelector('.marker[data-i="' + e.i + '"]'); if (m) m.classList.add('active');
    var r = document.querySelector('.ev[data-i="' + e.i + '"]');
    if (r) {
      r.classList.add('active');
      var sc = $('events');
      if (scroll !== false && sc.scrollHeight > sc.clientHeight) {
        var top = r.offsetTop - sc.offsetTop;
        if (top < sc.scrollTop || top > sc.scrollTop + sc.clientHeight - r.offsetHeight) sc.scrollTop = top - 40;
      }
    }
  }

  /* ---------------- event list ---------------- */
  function renderEvents() {
    var box = $('events'); box.textContent = '';
    var evs = visibleEvents();
    $('ev-count').textContent = String(evs.length);
    if (!evs.length) { box.appendChild(el('p', { class: 'empty', text: 'No events match the filters.' })); return; }
    (state.game.periods || [{ n: 1, start: 0, end: state.duration }]).forEach(function (p) {
      var pe = evs.filter(function (e) { return e.period === p.n; });
      var g = el('div', { class: 'period-group' }, [
        el('div', { class: 'period-head' }, [el('span', { text: 'Period ' + p.n }),
          el('span', { class: 'tnum', text: H.fmtTime(p.start) + '–' + H.fmtTime(p.end) })])
      ]);
      if (!pe.length) g.appendChild(el('p', { class: 'empty', text: 'No events.' }));
      var ul = el('ul', { class: 'event-list' });
      pe.forEach(function (e) {
        var lvl = { high: 3, medium: 2, low: 1 }[e.confidence] || 2;
        var conf = el('span', { class: 'conf', title: 'Detection confidence: ' + e.confidence }, [
          el('i', { class: 'on' }), el('i', { class: lvl > 1 ? 'on' : '' }), el('i', { class: lvl > 2 ? 'on' : '' }),
          el('span', { text: e.confidence })]);
        var b = el('button', { type: 'button', class: 'ev', 'data-i': e.i, 'data-t': e.t,
          'aria-label': H.fmtTime(e.t) + ', ' + H.TYPE_LABEL[e.type] + ', ' + teamName(e.team) + (e.note ? ', ' + e.note : '') + ', confidence ' + e.confidence }, [
          el('span', { class: 'time tnum', text: H.fmtTime(e.t) }),
          H.icon(e.type, e.team, e.type === 'goal' ? 20 : 16),
          el('span', { class: 'what' }, [
            el('b', { text: H.TYPE_LABEL[e.type] + ' · ' + teamName(e.team) + (e.player ? ' ' + e.player : '') }),
            e.note ? el('span', { text: e.note }) : null
          ]),
          conf
        ]);
        b.onclick = function () { jumpTo(e); };
        ul.appendChild(el('li', null, [b]));
      });
      g.appendChild(ul);
      box.appendChild(g);
    });
    if (state.activeEvent) markActive(state.activeEvent, false);
  }

  /* ---------------- highlights ---------------- */
  function buildClips() {
    var evs = visibleEvents().filter(function (e) { return HL_TYPES.indexOf(e.type) >= 0; });
    if (!evs.length) evs = state.stats.events.filter(function (e) { return HL_TYPES.indexOf(e.type) >= 0; });
    var clips = [];
    evs.forEach(function (e) {
      var s = Math.max(0, e.t - HL_BEFORE), en = Math.min(state.duration, e.t + HL_AFTER), last = clips[clips.length - 1];
      if (last && s <= last.end) { last.end = Math.max(last.end, en); last.events.push(e); }
      else clips.push({ start: s, end: en, events: [e] });
    });
    return clips;
  }
  function startHighlights() {
    if (!state.video) return;
    var clips = buildClips();
    if (!clips.length) return;
    state.hl = { clips: clips, i: -1 };
    $('hl-bar').classList.add('on');
    $('player-box').parentNode.classList.add('hl-mode');
    $('btn-hl').innerHTML = '&#10005; Exit highlights';
    gotoClip(0);
  }
  function gotoClip(i) {
    var hl = state.hl; if (!hl) return;
    if (i < 0) i = 0;
    if (i >= hl.clips.length) { stopHighlights(); return; } // reel finished: pause
    hl.i = i;
    var c = hl.clips[i], main = c.events.filter(function (e) { return e.type === 'goal'; })[0] || c.events[0];
    document.body.dataset.hlIndex = String(i);
    var txt = $('hl-text'); txt.textContent = '';
    txt.appendChild(el('b', { text: 'Highlight ' + (i + 1) + ' of ' + hl.clips.length + ': ' +
      c.events.map(function (e) { return H.TYPE_LABEL[e.type] + ' (' + teamName(e.team) + ')'; }).join(', ') }));
    txt.appendChild(el('span', { text: H.fmtTime(main.t) + (main.note ? ' · ' + main.note : '') }));
    $('hl-prev').disabled = i === 0;
    setActive(main, true);
    state.hlSeeking = true;
    seek(c.start, true, true);
  }
  function hlTick(t) {
    var hl = state.hl, c = hl && hl.clips[hl.i]; if (!c) return;
    $('hl-prog').style.width = Math.max(0, Math.min(100, (t - c.start) / (c.end - c.start) * 100)) + '%';
    if (t >= c.end) gotoClip(hl.i + 1);
    else if (t < c.start - 1.5 && state.video && !state.video.seeking) stopHighlights(); // user scrubbed away
  }
  function stopHighlights(keepPlaying) {
    if (!state.hl) return;
    state.hl = null; state.hlSeeking = false;
    delete document.body.dataset.hlIndex;
    $('hl-bar').classList.remove('on');
    $('player-box').parentNode.classList.remove('hl-mode');
    $('btn-hl').innerHTML = '&#9654; Play highlights';
    if (state.video && !keepPlaying) state.video.pause();
  }
  // Leave highlights and carry on watching the full game from the current moment.
  function exitHighlights() { stopHighlights(true); }

  /* ---------------- keyboard ---------------- */
  function setupKeys() {
    document.addEventListener('keydown', function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var tg = ev.target && ev.target.tagName;
      if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT' || (ev.target && ev.target.isContentEditable)) return;
      var k = ev.key.toLowerCase();
      if (k === 'escape' && state.hl) { exitHighlights(); ev.preventDefault(); }
      else if (k === 'j') { nudge(-10); ev.preventDefault(); }
      else if (k === 'l') { nudge(10); ev.preventDefault(); }
      else if (k === 'k') { togglePlay(); ev.preventDefault(); }
    });
  }

  /* ---------------- stats ---------------- */
  function renderStats() {
    var s = state.stats, ps = state.game.periods || [];
    var head = el('tr', null, [el('th', { scope: 'col', text: '' })].concat(
      ps.map(function (p) { return el('th', { scope: 'col', text: 'P' + p.n }); }), [el('th', { scope: 'col', text: 'Game' })]));
    var body = el('tbody');
    [['goals', 'Goals'], ['shots', 'Shots on goal'], ['saves', 'Saves']].forEach(function (row) {
      body.appendChild(el('tr', { class: 'group' }, [el('th', { scope: 'rowgroup', colspan: ps.length + 2, text: row[1] })]));
      ['us', 'them'].forEach(function (tm) {
        var cells = [el('th', { scope: 'row' }, [el('i', { class: 'key ' + tm }), teamName(tm)])];
        ps.forEach(function (p) { cells.push(el('td', { class: tm, text: String((s.byPeriod[p.n] || {})[row[0]] ? s.byPeriod[p.n][row[0]][tm] : 0) })); });
        cells.push(el('td', { class: tm, text: String(s.total[row[0]][tm]) }));
        body.appendChild(el('tr', null, cells));
      });
    });
    var box = $('stats'); box.textContent = '';
    box.appendChild(el('table', { class: 'stats' }, [el('thead', null, [head]), body]));
  }

  function zoneBar(z) {
    var segs = [['z-their', z.theirEnd, 'Their end'], ['z-neu', z.neutral, 'Neutral'], ['z-our', z.ourEnd, 'Our end']];
    var bar = el('div', { class: 'zone-bar', role: 'img',
      'aria-label': segs.map(function (s) { return s[2] + ' ' + H.pct(s[1]); }).join(', ') });
    segs.forEach(function (s) {
      var d = el('div', { class: s[0], style: 'flex:' + Math.max(s[1], 0.001) + ' 1 0' });
      if (s[1] >= 0.12) d.textContent = H.pct(s[1]);
      d.addEventListener('pointermove', function (ev) { H.showTip(ev.clientX, ev.clientY, [{ value: H.pct(s[1]), label: s[2] }]); });
      d.addEventListener('pointerleave', H.hideTip);
      bar.appendChild(d);
    });
    return bar;
  }
  function renderZones() {
    var box = $('zones'); box.textContent = '';
    var z = state.stats.zones;
    if (!z.total) { box.appendChild(el('p', { class: 'empty', text: 'No zone data for this game.' })); return; }
    box.appendChild(el('div', { class: 'zone-row' }, [el('span', { text: 'Game' }), zoneBar(z.total)]));
    (state.game.periods || []).forEach(function (p) {
      if (z.byPeriod[p.n]) box.appendChild(el('div', { class: 'zone-row' }, [el('span', { text: 'Period ' + p.n }), zoneBar(z.byPeriod[p.n])]));
    });
    box.appendChild(el('p', { class: 'chart-note', text: 'Share of on-ice action in each zone, from the camera. We attacked ' +
      H.pct(z.total.theirEnd) + ' of the time and defended ' + H.pct(z.total.ourEnd) + '.' }));
  }

  /* ---------------- pressure chart ---------------- */
  function pressureSeries() {
    var a = state.stats.activity;
    return a.map(function (b, i) {
      var sum = 0, n = 0;
      for (var k = i - 1; k <= i + 1; k++) if (a[k]) { sum += a[k].theirEnd - a[k].ourEnd; n++; }
      return { t: b.t + 5, v: sum / n, bin: b };
    });
  }
  function renderPressure() {
    var box = $('pressure'); box.textContent = '';
    var series = pressureSeries();
    if (!series.length) { box.appendChild(el('p', { class: 'empty', text: 'No activity data for this game.' })); return; }
    var W = box.clientWidth || 600, Hh = W < 500 ? 150 : 180;
    state.lastPressureW = W;
    var m = { l: 62, r: 6, t: 12, b: 22 }, iw = W - m.l - m.r, ih = Hh - m.t - m.b;
    var D = state.duration;
    var X = function (t) { return m.l + Math.max(0, Math.min(1, t / D)) * iw; };
    var Y = function (v) { return m.t + (1 - (v + 1) / 2) * ih; };
    state.prX = X;
    var y0 = Y(0);
    var uid = 'pr' + Math.random().toString(36).slice(2, 7);
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + Hh, width: W, height: Hh, role: 'img',
      'aria-label': 'Pressure over time. Above the centre line we were in their end; below, they were in ours.' });
    var defs = svg('defs', null, [
      svg('clipPath', { id: uid + 'u' }, [svg('rect', { x: 0, y: 0, width: W, height: y0 })]),
      svg('clipPath', { id: uid + 'd' }, [svg('rect', { x: 0, y: y0, width: W, height: Hh - y0 })])
    ]);
    root.appendChild(defs);
    [-0.5, 0.5].forEach(function (v) { root.appendChild(svg('line', { class: 'grid-line', x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) })); });
    root.appendChild(svg('text', { class: 'axis-text', x: m.l - 6, y: Y(0.82), 'text-anchor': 'end', text: 'Their end' }));
    root.appendChild(svg('text', { class: 'axis-text', x: m.l - 6, y: Y(0) + 4, 'text-anchor': 'end', text: 'Even' }));
    root.appendChild(svg('text', { class: 'axis-text', x: m.l - 6, y: Y(-0.82) + 8, 'text-anchor': 'end', text: 'Our end' }));

    var line = series.map(function (p, i) { return (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1); }).join('');
    var area = line + 'L' + X(series[series.length - 1].t).toFixed(1) + ' ' + y0 + 'L' + X(series[0].t).toFixed(1) + ' ' + y0 + 'Z';
    root.appendChild(svg('path', { d: area, fill: 'var(--us-wash)', 'clip-path': 'url(#' + uid + 'u)' }));
    root.appendChild(svg('path', { d: area, fill: 'var(--them-wash)', 'clip-path': 'url(#' + uid + 'd)' }));
    root.appendChild(svg('path', { d: line, fill: 'none', stroke: 'var(--us)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'clip-path': 'url(#' + uid + 'u)' }));
    root.appendChild(svg('path', { d: line, fill: 'none', stroke: 'var(--them)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'clip-path': 'url(#' + uid + 'd)' }));
    root.appendChild(svg('line', { class: 'zero-line', x1: m.l, x2: W - m.r, y1: y0, y2: y0 }));

    (state.game.periods || []).forEach(function (p) {
      if (p.start > 0) root.appendChild(svg('line', { x1: X(p.start), x2: X(p.start), y1: m.t - 6, y2: Hh - m.b, stroke: 'var(--axis)', 'stroke-width': 1 }));
      root.appendChild(svg('text', { class: 'axis-text', x: X(p.start) + 4, y: m.t - 2, text: 'P' + p.n }));
    });
    // goal glyphs along the edges (context, respects team filter)
    state.stats.events.forEach(function (e) {
      if (e.type !== 'goal' || !state.teams.has(e.team) || !state.types.has('goal')) return;
      var g = H.icon('goal', e.team, 12);
      g.setAttribute('x', X(e.t) - 6); g.setAttribute('y', e.team === 'us' ? m.t - 2 : Hh - m.b - 10);
      root.appendChild(g);
    });
    // x axis
    var step = D > 2400 ? 600 : D > 600 ? 300 : 30;
    for (var s = 0; s <= D; s += step) {
      if (W < 500 && (s / step) % 2) continue;
      root.appendChild(svg('text', { class: 'axis-text tnum', x: X(s), y: Hh - 6, 'text-anchor': s === 0 ? 'start' : 'middle', text: H.fmtTime(s) }));
    }
    var cross = svg('line', { x1: -10, x2: -10, y1: m.t, y2: Hh - m.b, stroke: 'var(--muted)', 'stroke-width': 1, visibility: 'hidden' });
    root.appendChild(cross);
    var px = X(curTime());
    root.appendChild(svg('line', { class: 'playhead', x1: px, x2: px, y1: m.t - 6, y2: Hh - m.b, stroke: 'var(--ink)', 'stroke-width': 2 }));
    var hit = svg('rect', { x: m.l, y: 0, width: iw, height: Hh, fill: 'transparent', style: 'cursor:pointer' });
    root.appendChild(hit);
    box.appendChild(root);

    function tAt(ev) {
      var r = root.getBoundingClientRect();
      var xx = (ev.clientX - r.left) * (W / r.width);
      return Math.max(0, Math.min(D, (xx - m.l) / iw * D));
    }
    hit.addEventListener('pointermove', function (ev) {
      var t = tAt(ev), idx = Math.min(series.length - 1, Math.max(0, Math.round((t - 5) / 10)));
      var best = series[idx];
      series.forEach(function (p) { if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p; });
      cross.setAttribute('x1', X(best.t)); cross.setAttribute('x2', X(best.t)); cross.setAttribute('visibility', 'visible');
      H.showTip(ev.clientX, ev.clientY, [
        { value: H.fmtTime(best.bin.t), label: 'P' + H.periodOf(state.game, best.bin.t) },
        { key: 'us', value: H.pct(best.bin.theirEnd), label: 'their end' },
        { key: 'neutral', value: H.pct(best.bin.neutral), label: 'neutral' },
        { key: 'them', value: H.pct(best.bin.ourEnd), label: 'our end' }
      ]);
    });
    hit.addEventListener('pointerleave', function () { cross.setAttribute('visibility', 'hidden'); H.hideTip(); });
    hit.addEventListener('click', function (ev) { seek(tAt(ev), !!state.video); });
  }

  function renderPressureTable() {
    var a = state.stats.activity, box = $('pressure-table'); box.textContent = '';
    if (!a.length) return;
    var rows = [], block = 300;
    for (var s = 0; s < state.duration; s += block) {
      var bins = a.filter(function (b) { return b.t >= s && b.t < s + block; });
      if (!bins.length) continue;
      var avg = function (k) { return bins.reduce(function (x, b) { return x + b[k]; }, 0) / bins.length; };
      rows.push(el('tr', null, [el('td', { text: H.fmtTime(s) + '–' + H.fmtTime(Math.min(s + block, state.duration)) }),
        el('td', { text: H.pct(avg('theirEnd')) }), el('td', { text: H.pct(avg('neutral')) }), el('td', { text: H.pct(avg('ourEnd')) })]));
    }
    box.appendChild(el('table', { class: 'stats' }, [
      el('thead', null, [el('tr', null, ['Video time', 'Their end', 'Neutral', 'Our end'].map(function (h) { return el('th', { scope: 'col', text: h }); }))]),
      el('tbody', null, rows)]));
  }
})();
