(function () {
  'use strict';
  var H = window.Hockey, el = H.el, svg = H.svg;
  var HL_TYPES = ['goal', 'shot', 'save', 'chance'];
  var HL_BEFORE = 6, HL_AFTER = 4, SEEK_LEAD = 5;
  var SPEEDS = [1, 1.5, 2];

  var $ = function (id) { return document.getElementById(id); };
  var state = {
    index: null, game: null, stats: null, video: null, videoOk: false, cursor: 0, duration: 1,
    types: new Set(H.TYPES), teams: new Set(['us', 'them']), activeEvent: null,
    hl: null, // { clips, i }
    speed: 0, userScrollUntil: 0, lastSaved: -1
  };

  var params = new URLSearchParams(location.search);
  H.loadIndex().then(function (index) {
    state.index = index; H.setHeader(index);
    var games = index.games || [];
    var id = params.get('id');
    var game = games.filter(function (g) { return g.id === id; })[0] || (!id && games[0]);
    if (!game) throw new Error('No game with id "' + id + '"');
    state.game = game;
    // A game with no data file yet is shown video-only, unless parents have tagged goals in it.
    var data = H.loadGame(game.id).then(null, function () { return null; });
    var tags = fetch(tagsUrl(game) + '.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : []; }).then(null, function () { return []; });
    return Promise.all([data, tags]).then(function (r) {
      var d = r[0] || { events: [], activity: [] }, crowd = crowdEvents(r[1], d.events || []);
      d.events = (d.events || []).concat(crowd);
      if (!r[0] && !crowd.length) document.body.classList.add('no-stats');
      init(game, d);
    });
  }).catch(function (e) { H.fail($('game-root'), e.message); });

  /* ---------------- parents' tags (stored on the video server) ---------------- */
  var CLUSTER = 20; // taps of the same kind within 20 s are one goal / play
  function tagsUrl(game) { return ((state.index && state.index.videoBase) || '') + 'tags/' + encodeURIComponent(game.id); }

  // Merge every parent's taps into events: one per cluster, skipping goals the game data already has.
  function crowdEvents(tags, existing) {
    var out = [], groups = {};
    (Array.isArray(tags) ? tags : []).forEach(function (x) {
      if (!x || typeof x.t !== 'number' || (x.type !== 'goal' && x.type !== 'play')) return;
      var k = x.type + ':' + (x.team || '');
      (groups[k] = groups[k] || []).push(x);
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k].sort(function (a, b) { return a.t - b.t; }), run = [];
      var flush = function () {
        if (!run.length) return;
        var ts = run.map(function (x) { return x.t; }), t = ts[Math.floor(ts.length / 2)], x0 = run[0];
        var dup = x0.type === 'goal' && existing.some(function (e) { return e.type === 'goal' && e.team === x0.team && Math.abs(e.t - t) < CLUSTER; });
        if (!dup) out.push({ t: Math.max(0, t - 3), type: x0.type === 'goal' ? 'goal' : 'chance', team: x0.team || 'us', key: true,
          confidence: 'high', crowd: true,
          note: (x0.type === 'goal' ? 'Goal' : 'Great play') + ' tagged by parents (' + run.length + (run.length === 1 ? ' tap)' : ' taps)') });
        run = [];
      };
      g.forEach(function (x) { if (run.length && x.t - run[run.length - 1].t > CLUSTER) flush(); run.push(x); });
      flush();
    });
    return out;
  }

  function renderTagBar(game) {
    var box = $('tagbar'); if (!box) return; box.textContent = '';
    var mine = []; try { mine = JSON.parse(load('tags:' + game.id) || '[]'); } catch (e) { mine = []; }
    var post = function (body) {
      var code = load('teamcode') || window.prompt('Team code (ask the team manager):');
      if (!code) return Promise.reject(new Error('cancelled'));
      body.code = code;
      return fetch(tagsUrl(game), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) {
          return r.json().then(function (j) {
            if (r.status === 403) { store('teamcode', null); throw new Error('Wrong team code'); }
            if (!r.ok) throw new Error(j.error || 'Could not save');
            store('teamcode', code); return j;
          });
        });
    };
    var tag = function (type, team, label) {
      var t = Math.round(curTime() * 10) / 10;
      post({ action: 'add', t: t, type: type, team: team }).then(function (j) {
        mine.push({ id: j.id, key: j.key, t: t, label: label }); store('tags:' + game.id, JSON.stringify(mine.slice(-50)));
        osd(label + ' tagged at ' + H.fmtTime(t) + ' · thanks!'); undo.disabled = false;
      }, function (e) { if (e.message !== 'cancelled') osd(e.message); });
    };
    var btn = function (cls, text, fn) { var b = el('button', { type: 'button', class: 'btn tag ' + cls, text: text }); b.onclick = fn; return b; };
    var undo = btn('undo', 'Undo my last tag', function () {
      var last = mine[mine.length - 1]; if (!last) return;
      post({ action: 'remove', id: last.id, key: last.key }).then(function () {
        mine.pop(); store('tags:' + game.id, JSON.stringify(mine)); undo.disabled = !mine.length;
        osd('Removed ' + last.label + ' at ' + H.fmtTime(last.t));
      }, function (e) { if (e.message !== 'cancelled') osd(e.message); });
    });
    undo.disabled = !mine.length;
    box.appendChild(el('span', { class: 'lbl', text: 'Tag this moment' }));
    box.appendChild(btn('us', 'Goal · ' + ourName(), function () { tag('goal', 'us', 'Goal ' + ourName()); }));
    box.appendChild(btn('them', 'Goal · ' + (game.opponent || 'Opponent'), function () { tag('goal', 'them', 'Goal ' + (game.opponent || 'Opponent')); }));
    box.appendChild(btn('play', 'Great play', function () { tag('play', 'us', 'Great play'); }));
    box.appendChild(undo);
    box.appendChild(el('span', { class: 'hint', text: 'Pause where the puck goes in, then tap. Everyone’s taps are combined and show up for all viewers on the next page load.' }));
  }

  function teamName(team) { return team === 'them' ? (state.game.opponent || 'Opponent') : 'Us'; }
  function ourName() { return (state.index && state.index.team && state.index.team.name) || 'Us'; }
  function noStats() { return document.body.classList.contains('no-stats'); }

  /* Small local storage helpers: private windows and blocked storage just skip the feature. */
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function init(game, data) {
    if (!(data.activity || []).length) document.body.classList.add('no-activity');
    state.stats = H.computeStats(game, data);
    // Stats count every event; the list, timeline and highlights show only key plays.
    state.stats.events = state.stats.events.filter(function (e) { return e.key; });
    if (!state.stats.events.length) $('btn-hl').style.display = 'none';
    state.duration = game.duration || (state.stats.events.length ? state.stats.events[state.stats.events.length - 1].t + 10 : 60);
    document.title = 'vs ' + (game.opponent || 'Opponent') + H.sideTag(game) + ' · ' + H.fmtDate(game.date, { month: 'short', day: 'numeric' }) + ' · ' + ourName();
    $('game-title').textContent = ourName() + ' vs ' + (game.opponent || 'Opponent') + H.sideTag(game);
    $('game-sub').textContent = noStats() ?
      H.fmtDate(game.date) + ' · Video only: key plays and stats are not available yet.' + (game.summary ? ' ' + game.summary : '') :
      H.fmtDate(game.date) + '. ' + (game.summary || '');

    renderScorebug(game);
    renderPicker(game);
    renderSummaryTiles();
    setupPlayer(game);
    renderFilters();
    renderTimeline();
    renderEvents();
    renderJumps();
    renderTagBar(game);
    renderZones();
    renderPressureTable();
    var pr = $('pressure'), lastW = 0;
    var draw = function () { var w = pr.clientWidth; if (w && w !== lastW) { lastW = w; renderPressure(); } };
    draw();
    if (window.ResizeObserver) new ResizeObserver(draw).observe(pr); else window.addEventListener('resize', draw);
    setupKeys();
    setupPanel();
    if (load('br:theatre') === '1') setTheatre(true);
    // Deep link: game.html?id=...&t=930 opens the video at 15:30. Otherwise pick up where this viewer left off.
    var t0 = parseFloat(params.get('t')), resumed = false;
    if (!isFinite(t0)) {
      var saved = parseFloat(load('br:pos:' + game.id));
      if (isFinite(saved) && saved > 20 && saved < state.duration - 20) { t0 = saved; resumed = true; }
    }
    if (isFinite(t0) && state.video) {
      var go = function () {
        seek(t0, false);
        // Bring the list to this moment: the play under the playhead, or the next one.
        var near = state.activeEvent || visibleEvents().filter(function (e) { return e.t >= t0; })[0];
        var row = near && document.querySelector('.ev[data-i="' + near.i + '"]');
        // Wait for the web fonts so the row positions are final.
        if (row) (document.fonts ? document.fonts.ready : Promise.resolve()).then(function () { revealInList(row, true); });
        if (resumed) toast('Picked up where you left off at ' + H.fmtTime(t0) + '.', 'Start over', function () { seek(0, false); });
      };
      if (state.video.readyState >= 1) go(); else state.video.addEventListener('loadedmetadata', go, { once: true });
    }
    tick();
  }

  /* ---------------- header: score bug, game picker, summary ---------------- */
  function renderScorebug(game) {
    var box = $('scorebug'); box.textContent = '';
    // Teams only, no score: goals are just marked in the video.
    box.setAttribute('aria-label', ourName() + ' vs ' + (game.opponent || 'Opponent') + H.sideTag(game));
    box.appendChild(el('div', { class: 'sb-team us' }, [el('i', { class: 'sw' }), el('span', { class: 'sb-name' }, [el('span', { class: 'full', text: ourName() }), el('span', { class: 'short', text: ourName().split(' ').pop() })])]));
    box.appendChild(el('div', { class: 'sb-mid' }, [el('b', { text: 'vs' }),
      el('span', { text: H.fmtDate(game.date, { month: 'short', day: 'numeric' }) + (game.side ? ' · ' + game.side : '') })]));
    box.appendChild(el('div', { class: 'sb-team them' }, [
      el('span', { class: 'sb-name', text: game.opponent || 'Opponent', title: game.opponent || '' }), el('i', { class: 'sw' })]));
  }

  function renderPicker(game) {
    var sel = $('game-pick'); sel.textContent = '';
    (state.index.games || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }).forEach(function (g) {
      var o = el('option', { value: g.id, text: H.fmtDate(g.date, { month: 'short', day: 'numeric' }) + ' · vs ' + (g.opponent || 'Opponent') + H.sideTag(g) });
      if (g.id === game.id) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () { location.href = 'game.html?id=' + encodeURIComponent(sel.value); };
  }

  function renderSummaryTiles() {
    var box = $('sum-tiles'); box.textContent = '';
    var z = state.stats.zones.total;
    var tile = function (label, value, sub) {
      return el('div', { class: 'tile' }, [el('div', { class: 'label', text: label }), el('div', { class: 'value tnum', text: value }),
        sub ? el('div', { class: 'sub', text: sub }) : null]);
    };
    box.appendChild(tile('In their end', z ? H.pct(z.theirEnd) : '-', 'share of the game'));
  }

  /* ---------------- player ---------------- */
  function icon(d, opts) {
    opts = opts || {};
    var s = svg('svg', { width: opts.size || 20, height: opts.size || 20, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' });
    d.split('|').forEach(function (p) {
      s.appendChild(opts.stroke ? svg('path', { d: p, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
        : svg('path', { d: p, fill: 'currentColor' }));
    });
    return s;
  }
  var IC = {
    play: 'M4.5 2.5v11l9-5.5z', pause: 'M4 2.5h2.8v11H4z|M9.2 2.5H12v11H9.2z',
    back: 'M3.2 6.2A5.2 5.2 0 1 1 3.4 10|M2.6 2.8v3.6h3.6', fwd: 'M12.8 6.2A5.2 5.2 0 1 0 12.6 10|M13.4 2.8v3.6H9.8',
    prev: 'M3 3h2v10H3z|M13.5 3v10L6 8z', next: 'M11 3h2v10h-2z|M2.5 3v10L10 8z',
    fs: 'M2 6V2h4|M10 2h4v4|M14 10v4h-4|M6 14H2v-4', fsx: 'M6 2v4H2|M14 6h-4V2|M10 14v-4h4|M2 10h4v4',
    theatre: 'M1.5 3.5h13v9h-13z'
  };
  function vbtn(id, label, kids, cls) {
    return el('button', { class: 'vbtn' + (cls ? ' ' + cls : ''), type: 'button', id: id, 'aria-label': label, title: label }, kids);
  }

  function setupPlayer(game) {
    var box = $('player-box');
    var src = H.videoUrl(state.index, game);
    if (!src) { showMissing(null); return; }
    // No crossOrigin attribute: plain cross-origin playback needs no CORS.
    // Our own control bar sits below the picture, so nothing ever dims or covers the video on hover.
    var v = el('video', { preload: 'metadata', playsinline: '', id: 'video' });
    v.src = src;
    var osdEl = el('div', { class: 'osd', id: 'osd', 'aria-hidden': 'true' });
    var big = el('button', { class: 'bigplay', type: 'button', id: 'bigplay', 'aria-label': 'Play video' }, [icon(IC.play, { size: 34 })]);
    var vwrap = el('div', { class: 'vwrap' }, [v, osdEl, big, el('div', { class: 'spinner', 'aria-hidden': 'true' })]);

    var scrub = el('input', { type: 'range', class: 'scrub', id: 'scrub', min: '0', max: String(state.duration), step: '0.1', value: '0', 'aria-label': 'Video position' });
    var scrubWrap = el('div', { class: 'scrubwrap', id: 'scrubwrap' }, [
      el('div', { class: 'scrub-rail', id: 'scrub-rail' }, [el('div', { class: 'scrub-fill', id: 'scrub-fill' })]),
      el('div', { class: 'scrub-ticks', id: 'scrub-ticks', 'aria-hidden': 'true' }),
      scrub
    ]);
    var now = el('span', { class: 'now', id: 'now', 'aria-live': 'off' });
    var ctl = el('div', { class: 'ctl', id: 'controls' }, [
      vbtn('btn-play', 'Play (Space)', [icon(IC.play, { size: 22 })], 'play'),
      vbtn('btn-back', 'Back 10 seconds (J)', [el('span', { class: 'lbl' }, [icon(IC.back, { stroke: true, size: 18 }), el('small', { text: '10' })])], 'skip'),
      vbtn('btn-fwd', 'Forward 10 seconds (L)', [el('span', { class: 'lbl' }, [el('small', { text: '10' }), icon(IC.fwd, { stroke: true, size: 18 })])], 'skip'),
      now,
      el('span', { class: 'spacer' }),
      vbtn('kp-prev', 'Previous key play (P)', [icon(IC.prev, { size: 18 })], 'kp'),
      vbtn('kp-next', 'Next key play (N)', [icon(IC.next, { size: 18 })], 'kp'),
      el('span', { class: 'sep-v kp' }),
      vbtn('btn-speed', 'Playback speed', [document.createTextNode('1×')], 'speed'),
      vbtn('btn-theatre', 'Theatre mode (T)', [icon(IC.theatre, { stroke: true, size: 20 })], 'theatre'),
      vbtn('btn-fs', 'Full screen (F)', [icon(IC.fs, { stroke: true, size: 20 })], 'fs')
    ]);
    var bar = el('div', { class: 'vbar' }, [scrubWrap, ctl]);
    var wrap = el('div', { class: 'player', id: 'player' }, [vwrap, bar, $('hl-bar')]);
    box.appendChild(wrap);
    state.video = v; state.videoOk = true;

    v.addEventListener('click', togglePlay);
    v.addEventListener('dblclick', toggleFs);
    big.onclick = togglePlay;
    scrub.addEventListener('input', function () { setFill(+scrub.value); seek(+scrub.value, false); });
    scrub.addEventListener('pointerdown', function () { state.scrubbing = true; });
    window.addEventListener('pointerup', function () { state.scrubbing = false; });
    scrub.addEventListener('pointermove', function (ev) { if (ev.pointerType === 'mouse') scrubTip(ev); });
    scrub.addEventListener('pointerleave', H.hideTip);
    renderScrubMarks();

    v.addEventListener('error', function () { showMissing(src); });
    v.addEventListener('timeupdate', function () { tick(); savePos(false); });
    v.addEventListener('seeked', function () { state.hlSeeking = false; wrap.classList.remove('waiting'); tick(); });
    // Any manual seek during highlights (scrub, skip, timeline, list) means "I want the full game".
    v.addEventListener('seeking', function () { if (state.hl && !state.hlSeeking) exitHighlights(); });
    v.addEventListener('waiting', function () { wrap.classList.add('waiting'); });
    ['playing', 'canplay', 'pause'].forEach(function (n) { v.addEventListener(n, function () { wrap.classList.remove('waiting'); }); });
    v.addEventListener('play', function () { big.hidden = true; syncPlayBtn(); });
    v.addEventListener('pause', function () { syncPlayBtn(); savePos(true); });
    v.addEventListener('ratechange', syncSpeed);
    window.addEventListener('pagehide', function () { savePos(true); });
    document.addEventListener('fullscreenchange', function () {
      var on = document.fullscreenElement === wrap, b = $('btn-fs');
      b.replaceChild(icon(on ? IC.fsx : IC.fs, { stroke: true, size: 20 }), b.firstChild);
      b.setAttribute('aria-label', on ? 'Exit full screen (F)' : 'Full screen (F)'); b.title = b.getAttribute('aria-label');
    });

    $('btn-play').onclick = togglePlay;
    $('btn-back').onclick = function () { nudge(-10); };
    $('btn-fwd').onclick = function () { nudge(10); };
    $('kp-prev').onclick = function () { stepPlay(-1); };
    $('kp-next').onclick = function () { stepPlay(1); };
    $('btn-speed').onclick = function () { setSpeed((state.speed + 1) % SPEEDS.length); };
    $('btn-theatre').onclick = function () { setTheatre(!$('stage').classList.contains('theatre')); };
    $('btn-fs').onclick = toggleFs;
    $('btn-hl').onclick = function () { if (state.hl) exitHighlights(); else startHighlights(); };
    $('btn-share').onclick = share;
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
    $('stage-main').appendChild($('hl-bar')); // keep the strip in the page; the player is going away
    box.textContent = '';
    box.appendChild(el('div', { class: 'video-missing', id: 'video-missing', role: 'status' }, [
      el('strong', { text: 'Video not available yet' }),
      el('p', { text: 'The game video hasn’t been uploaded, or the video server is offline. The key plays and stats still work – check back later for the footage.' }),
      src ? el('code', { text: src.replace(/^.*\//, '') }) : null
    ]));
    ['btn-hl', 'btn-share'].forEach(function (id) { $(id).disabled = true; });
    $('btn-hl').title = 'Highlights need the video';
    document.body.dataset.video = 'missing';
  }

  function syncPlayBtn() {
    var v = state.video, b = $('btn-play'); if (!v || !b) return;
    b.replaceChild(icon(v.paused ? IC.play : IC.pause, { size: 22 }), b.firstChild);
    b.setAttribute('aria-label', v.paused ? 'Play (Space)' : 'Pause (Space)'); b.title = b.getAttribute('aria-label');
  }
  function togglePlay() {
    var v = state.video; if (!v) return;
    if (v.paused) v.play().catch(function () {}); else v.pause();
  }
  function nudge(d) {
    if (!state.video) return;
    seek(curTime() + d, false, true);
    osd((d > 0 ? '+' : '−') + Math.abs(d) + 's  ·  ' + H.fmtTime(curTime()));
  }
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

  function setSpeed(i) { state.speed = i; if (state.video) state.video.playbackRate = SPEEDS[i]; syncSpeed(); osd('Speed ' + SPEEDS[i] + '×'); }
  function syncSpeed() {
    var b = $('btn-speed'), r = state.video ? state.video.playbackRate : 1;
    if (b) { b.textContent = r + '×'; b.setAttribute('aria-label', 'Playback speed ' + r + '×. Click to change.'); }
  }
  function setTheatre(on) {
    $('stage').classList.toggle('theatre', on);
    var b = $('btn-theatre'); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
    store('br:theatre', on ? '1' : null);
  }
  function toggleFs() {
    var wrap = $('player'), v = state.video; if (!wrap) return;
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (wrap.requestFullscreen) wrap.requestFullscreen().catch(function () {});
    else if (v && v.webkitEnterFullscreen) v.webkitEnterFullscreen(); // iPhone: native player
  }
  var osdTimer = 0;
  function osd(text) {
    var o = $('osd'); if (!o) return;
    o.textContent = text; o.classList.add('show');
    clearTimeout(osdTimer); osdTimer = setTimeout(function () { o.classList.remove('show'); }, 900);
  }

  // Remember where this viewer got to, per game (this browser only).
  function savePos(force) {
    var t = curTime();
    if (!state.video || state.hl || (!force && Math.abs(t - state.lastSaved) < 5)) return;
    state.lastSaved = t;
    store('br:pos:' + state.game.id, t > 20 && t < state.duration - 20 ? String(Math.floor(t)) : null);
  }

  function shareUrl() {
    var u = new URL('game.html', location.href);
    u.searchParams.set('id', state.game.id);
    u.searchParams.set('t', String(Math.floor(curTime())));
    return u.href;
  }
  function share() {
    var url = shareUrl(), at = H.fmtTime(curTime());
    var fallback = function () {
      var inp = el('input', { type: 'text', value: url, readonly: '', 'aria-label': 'Link to this moment' });
      toast(null, null, null, [el('span', { text: 'Copy this link (' + at + '):' }), inp]);
      inp.focus(); inp.select();
    };
    if (navigator.share && window.matchMedia && matchMedia('(pointer: coarse)').matches) {
      navigator.share({ title: document.title, url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast('Link copied. It opens the video at ' + at + '.'); }, fallback);
    } else fallback();
  }

  var toastTimer = 0;
  function toast(text, action, fn, kids) {
    var t = $('toast'); t.textContent = '';
    if (text) t.appendChild(el('span', { text: text }));
    (kids || []).forEach(function (k) { t.appendChild(k); });
    if (action) {
      var b = el('button', { class: 'btn', type: 'button', text: action });
      b.onclick = function () { fn(); t.classList.remove('show'); };
      t.appendChild(b);
    }
    t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, kids ? 9000 : 5000);
  }

  function periodLabel(t) {
    var ps = state.game.periods || [];
    if (!ps.length) return '';
    for (var i = 0; i < ps.length; i++) {
      if (t >= ps[i].start && t < ps[i].end) return 'P' + ps[i].n;
      if (t < ps[i].start) return i ? 'Break' : 'Pre-game';
    }
    return 'End';
  }

  function setFill(t) {
    var f = $('scrub-fill'); if (f) f.style.width = Math.max(0, Math.min(1, t / state.duration)) * 100 + '%';
  }

  function tick() {
    var t = curTime();
    var x = Math.max(0, Math.min(1, t / state.duration)) * 100;
    var ph = $('tl-playhead'), pg = $('tl-progress');
    if (ph) ph.style.left = x + '%';
    if (pg) pg.style.width = x + '%';
    var sc = $('scrub');
    if (sc && !state.scrubbing) { sc.value = t; setFill(t); }
    var pl = document.querySelector('#pressure .playhead');
    if (pl && state.prX) { var px = state.prX(t); pl.setAttribute('x1', px); pl.setAttribute('x2', px); }
    var now = $('now');
    if (now) {
      now.textContent = '';
      now.appendChild(document.createTextNode(H.fmtTime(t)));
      now.appendChild(el('span', { class: 'dur', text: ' / ' + H.fmtTime(state.duration) }));
      var pl2 = periodLabel(t); if (pl2) now.appendChild(el('span', { class: 'per', text: pl2 }));
    }
    // The current key play: the latest one whose clip (from SEEK_LEAD before to 12 s after) holds the playhead.
    if (state.stats) {
      var cand = null;
      visibleEvents().forEach(function (e) { if (e.t - SEEK_LEAD - 0.5 <= t && t <= e.t + 12) cand = e; });
      if (cand && cand !== state.activeEvent) setActive(cand, !!state.video && !state.video.paused);
    }
    if (state.hl) hlTick(t);
  }

  /* Key-play ticks and period breaks drawn on the seek bar. */
  function renderScrubMarks() {
    var ticks = $('scrub-ticks'), rail = $('scrub-rail'); if (!ticks) return;
    var D = state.duration;
    ticks.textContent = '';
    visibleEvents().forEach(function (e) {
      ticks.appendChild(el('i', { class: e.team + ' ' + e.type, style: 'left:' + (e.t / D * 100) + '%' }));
    });
    rail.querySelectorAll('.scrub-gap').forEach(function (n) { n.remove(); });
    var ps = (state.game.periods || []).slice().sort(function (a, b) { return a.start - b.start; }), from = 0;
    ps.concat([{ start: D, end: D }]).forEach(function (p) {
      if (p.start - from > 1) rail.insertBefore(el('div', { class: 'scrub-gap', style: 'left:' + (from / D * 100) + '%;width:' + ((p.start - from) / D * 100) + '%' }), rail.firstChild);
      from = Math.max(from, p.end);
    });
  }
  function scrubTip(ev) {
    var r = $('scrubwrap').getBoundingClientRect(), D = state.duration;
    var t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * D, near = null;
    visibleEvents().forEach(function (e) { if (Math.abs(e.t - t) < D * 0.008 && (!near || Math.abs(e.t - t) < Math.abs(near.t - t))) near = e; });
    var rows = [{ value: H.fmtTime(near ? near.t : t), label: periodLabel(near ? near.t : t) }];
    if (near) rows.push({ key: near.team, value: H.TYPE_LABEL[near.type], label: teamName(near.team) }, near.note ? { label: near.note } : null);
    H.showTip(ev.clientX, r.top - 4, rows.filter(Boolean));
  }

  /* Previous / next key play from where the video is now (or the previous / next clip in highlights). */
  function stepPlay(dir) {
    if (state.hl) { gotoClip(state.hl.i + dir); return; }
    var evs = visibleEvents(), t = curTime(), target = null;
    evs.forEach(function (e) {
      var s = e.t - SEEK_LEAD;
      if (dir > 0 && !target && s > t + 1) target = e;
      if (dir < 0 && s < t - 3) target = e;
    });
    if (target) { jumpTo(target); osd(H.TYPE_LABEL[target.type] + ' · ' + teamName(target.team) + ' · ' + H.fmtTime(target.t)); }
    else osd(dir > 0 ? 'No more key plays' : 'This is the first key play');
  }

  function renderJumps() {
    var box = $('jumps'); box.textContent = '';
    var ps = state.game.periods || [];
    if (!ps.length) return;
    box.appendChild(el('span', { class: 'lbl', text: 'Jump to' }));
    ps.forEach(function (p) {
      var b = el('button', { type: 'button', class: 'chip', text: 'Period ' + p.n, title: 'Start of period ' + p.n + ' (' + H.fmtTime(p.start) + ')' });
      b.onclick = function () { seek(p.start, !!state.video && !state.video.paused); };
      box.appendChild(b);
    });
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
    $('filter-pop').classList.toggle('filtered', document.querySelector('#filters .chip[aria-pressed="false"]') != null);
    renderTimeline(); renderEvents(); renderScrubMarks();
    if (state.lastPressureW) renderPressure();
  }

  /* Panel behaviour: close the filter popover on outside click, pause list auto-scroll while the
     viewer scrolls it, and tell sticky period headings how tall the sticky player is on phones. */
  function setupPanel() {
    var pop = $('filter-pop');
    document.addEventListener('click', function (ev) { if (pop.open && !pop.contains(ev.target)) pop.open = false; });
    var sc = $('events'), hold = function () { state.userScrollUntil = Date.now() + 5000; };
    ['wheel', 'touchmove'].forEach(function (n) { sc.addEventListener(n, hold, { passive: true }); });
    var sm = $('stage-main');
    var setH = function () {
      document.documentElement.style.setProperty('--player-h', (window.innerWidth < 1000 ? sm.offsetHeight : 0) + 'px');
    };
    setH();
    if (window.ResizeObserver) new ResizeObserver(setH).observe(sm); else window.addEventListener('resize', setH);
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
    if (state.activeEvent) markActive(state.activeEvent, false);
  }

  function jumpTo(e) {
    setActive(e, true, true);
    seek(e.t - SEEK_LEAD, true);
  }
  function setActive(e, scroll, force) { state.activeEvent = e; markActive(e, scroll, force); }
  function markActive(e, scroll, force) {
    document.querySelectorAll('.marker.active, .ev.active').forEach(function (n) { n.classList.remove('active'); n.removeAttribute('aria-current'); });
    var m = document.querySelector('.marker[data-i="' + e.i + '"]'); if (m) m.classList.add('active');
    var r = document.querySelector('.ev[data-i="' + e.i + '"]');
    if (!r) return;
    r.classList.add('active'); r.setAttribute('aria-current', 'true');
    if (scroll) revealInList(r, force);
  }
  // Scroll only the list itself (never the page), and not while the viewer is scrolling it.
  function revealInList(r, force) {
    var sc = $('events');
    if (sc.scrollHeight <= sc.clientHeight + 4 || (!force && Date.now() < state.userScrollUntil)) return;
    var top = r.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop, head = 34;
    if (top - head < sc.scrollTop || top + r.offsetHeight > sc.scrollTop + sc.clientHeight) {
      sc.scrollTo({ top: Math.max(0, top - head - 8), behavior: 'smooth' });
    }
  }

  /* ---------------- key plays list ---------------- */
  function renderEvents() {
    var box = $('events'); box.textContent = '';
    var evs = visibleEvents();
    $('ev-count').textContent = String(evs.length);
    if (!evs.length) { box.appendChild(el('p', { class: 'empty', text: 'No key plays match the filters.' })); return; }
    (state.game.periods || [{ n: 1, start: 0, end: state.duration }]).forEach(function (p) {
      var pe = evs.filter(function (e) { return e.period === p.n; });
      var pj = el('button', { type: 'button', class: 'pj', text: 'Start ▸', 'aria-label': 'Jump to the start of period ' + p.n });
      pj.onclick = function () { seek(p.start, true); };
      var g = el('div', { class: 'period-group' }, [
        el('div', { class: 'period-head' }, [el('span', { text: 'Period ' + p.n + ' · ' + H.fmtTime(p.start) }), pj])
      ]);
      if (!pe.length) g.appendChild(el('p', { class: 'empty', text: 'No key plays.' }));
      var ul = el('ul', { class: 'event-list' });
      pe.forEach(function (e) {
        var lvl = { high: 3, medium: 2, low: 1 }[e.confidence] || 2;
        var conf = el('span', { class: 'conf', title: 'Detection confidence: ' + e.confidence }, [
          el('i', { class: 'on' }), el('i', { class: lvl > 1 ? 'on' : '' }), el('i', { class: lvl > 2 ? 'on' : '' })]);
        var b = el('button', { type: 'button', class: 'ev ' + e.type, 'data-i': e.i, 'data-t': e.t,
          'aria-label': H.fmtTime(e.t) + ', ' + H.TYPE_LABEL[e.type] + ', ' + teamName(e.team) + (e.note ? ', ' + e.note : '') + ', confidence ' + e.confidence }, [
          el('span', { class: 'time tnum', text: H.fmtTime(e.t) }),
          H.icon(e.type, e.team, e.type === 'goal' ? 20 : 16),
          el('span', { class: 'what' }, [
            el('b', { text: H.TYPE_LABEL[e.type] + ' · ' + teamName(e.team) + (e.player ? ' ' + e.player : '') }),
            e.type === 'goal' ? el('i', { class: 'tag', text: e.team === 'us' ? 'Goal' : 'Against' }) : null,
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
  function setHlButton(on) {
    var b = $('btn-hl'); b.textContent = '';
    b.appendChild(on ? svg('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, [svg('path', { d: 'M3 3l10 10M13 3L3 13', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round' })])
      : svg('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, [svg('path', { d: 'M3 1.5v13L14 8z', fill: 'currentColor' })]));
    b.appendChild(el('span', null, [el('span', { class: 't-long', text: on ? 'Exit ' : 'Play ' }), 'highlights']));
    b.setAttribute('aria-label', on ? 'Exit highlights' : 'Play highlights');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function startHighlights() {
    if (!state.video) return;
    var clips = buildClips();
    if (!clips.length) return;
    state.hl = { clips: clips, i: -1 };
    $('hl-bar').classList.add('on');
    $('stage').classList.add('hl-mode');
    setHlButton(true);
    gotoClip(0);
  }
  function gotoClip(i) {
    var hl = state.hl; if (!hl) return;
    if (i < 0) i = 0;
    if (i >= hl.clips.length) { stopHighlights(); toast('That’s the end of the highlights.'); return; } // reel finished: pause
    hl.i = i;
    var c = hl.clips[i], main = c.events.filter(function (e) { return e.type === 'goal'; })[0] || c.events[0];
    document.body.dataset.hlIndex = String(i);
    var txt = $('hl-text'); txt.textContent = '';
    txt.appendChild(el('b', null, [el('span', { class: 'n', text: (i + 1) + ' / ' + hl.clips.length + '  ' }),
      c.events.map(function (e) { return H.TYPE_LABEL[e.type] + ' (' + teamName(e.team) + ')'; }).join(', ')]));
    txt.appendChild(el('span', { text: H.fmtTime(main.t) + (main.note ? ' · ' + main.note : '') }));
    $('hl-prev').disabled = i === 0;
    setActive(main, true, true);
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
    $('stage').classList.remove('hl-mode');
    setHlButton(false);
    if (state.video && !keepPlaying) state.video.pause();
  }
  // Leave highlights and carry on watching the full game from the current moment.
  function exitHighlights() { if (state.hl) { stopHighlights(true); osd('Full game · ' + H.fmtTime(curTime())); } }

  /* ---------------- keyboard ---------------- */
  function setupKeys() {
    document.addEventListener('keydown', function (ev) {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var tg = ev.target, tag = tg && tg.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || (tg && tg.isContentEditable)) return;
      if (tag === 'INPUT' && tg.type !== 'range') return;
      var k = ev.key.toLowerCase(), done = true;
      if (k === 'escape') {
        if (state.hl) exitHighlights();
        else if ($('filter-pop').open) $('filter-pop').open = false;
        else done = false;
      }
      else if (!state.video) done = false;
      else if (k === ' ' || k === 'k') togglePlay();
      else if (k === 'arrowleft') nudge(-5);
      else if (k === 'arrowright') nudge(5);
      else if (k === 'j') nudge(-10);
      else if (k === 'l') nudge(10);
      else if (k === 'n' && !noStats()) stepPlay(1);
      else if (k === 'p' && !noStats()) stepPlay(-1);
      else if (k === 'f') toggleFs();
      else if (k === 't') setTheatre(!$('stage').classList.contains('theatre'));
      else if (k === 'h' && !noStats()) { if (state.hl) exitHighlights(); else startHighlights(); }
      else if (k === 'm') { state.video.muted = !state.video.muted; osd(state.video.muted ? 'Muted' : 'Sound on'); }
      else done = false;
      if (done) ev.preventDefault();
    });
  }

  /* ---------------- stats ---------------- */
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
