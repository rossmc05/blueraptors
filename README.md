# U9 hockey game site

A static site (plain HTML, CSS and JavaScript, with no build step and no backend) for watching game video with a clickable timeline and team stats.

```
index.html        home: season totals and game cards
game.html?id=…    video, timeline, event list, highlights, stats, pressure chart
season.html       game-by-game table and trends
css/style.css
js/common.js      data loading, stats and helpers (shared)
js/home.js, js/game.js, js/season.js
data/games.json   the list of games
data/games/<id>.json   events and activity for one game
videos/           video files (optional: see videoBase)
.nojekyll         stops GitHub Pages from running Jekyll
```

All paths are relative, so the site works from a sub-path (for example `https://user.github.io/repo/`).

## Serving

The pages load JSON with `fetch`, so open them through a web server, not as a `file://` path.

- Quick local check: `python3 -m http.server 8000` in this folder, then open http://localhost:8000/.
  Python's server does **not** support HTTP Range requests. The video plays, but seeking in a long video can be slow or fail.
- For real use, serve with something that supports Range requests. Caddy, nginx, Apache and GitHub Pages all do (`caddy file-server --root . --listen :8000`).
- Video served from another origin (for example a home Mac over an HTTPS tunnel) needs no CORS headers. The page only plays the file and never reads its pixels. The video server must support Range requests and serve `.mp4` as `video/mp4`. If the pages are served over HTTPS, the video URL must be HTTPS too.

If the video file can't be loaded, the game page shows a "Video not available yet" message. The timeline, event list and stats still work.

## Adding a game

1. Put the video at `videos/<id>.mp4` (H.264/AAC MP4), or upload it to the video server. For fast start, use `ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`.
2. Add `data/games/<id>.json` (schema below).
3. Add an entry to the `games` array in `data/games.json`.

Refresh the page to see the new game. Nothing needs to be rebuilt.

## Schema

### data/games.json

```json
{
  "team": { "name": "Blue Raptors", "color": "blue" },
  "videoBase": "",
  "games": [
    {
      "id": "2026-10-24-vs-tw-red",
      "date": "2026-10-24",
      "opponent": "TW Red",
      "video": "videos/2026-10-24-vs-tw-red.mp4",
      "duration": 3097,
      "periods": [ { "n": 1, "start": 0, "end": 1590 }, { "n": 2, "start": 1590, "end": 3097 } ],
      "summary": "short text"
    }
  ]
}
```

- `videoBase` (string, optional): the base URL for every relative `video` path. When it is `""`, the path is relative to the site.
  For example, `"videoBase": "https://mac.example.ts.net/"` with `"video": "videos/x.mp4"` gives `https://mac.example.ts.net/videos/x.mp4`. The usual URL rules apply, so end the base with `/`.
  A `video` that is already an absolute URL (`https://…`) is used as-is.
- `duration`, and the `start`/`end` of each period, are in seconds of the **video**. The timeline uses them, not the clock.
- `id` is also the file name of the game's data file.

### data/games/&lt;id&gt;.json

```json
{
  "id": "2026-10-24-vs-tw-red",
  "events": [
    { "t": 620.5, "type": "goal", "team": "us", "period": 1, "player": null,
      "note": "Rebound at the side of the net", "confidence": "high" }
  ],
  "activity": [
    { "t": 0, "ourEnd": 0.30, "neutral": 0.40, "theirEnd": 0.30, "intensity": 0.5 }
  ]
}
```

**events**
- `t`: seconds into the video when the event happened.
- `type`: `goal` | `shot` | `save` | `chance` | `breakaway` | `penalty` | `stoppage`.
- `team`: `us` | `them`. For `save`, this is the team whose goalie made the save.
- `period`: the period number. If it is missing, it is worked out from `periods`.
- `player`: for example `"#9"`, or `null`.
- `note`: short text.
- `confidence`: `high` | `medium` | `low`.
- `key` (optional, default `true`): set `false` to count an event in the stats but leave it out of the event list, timeline and highlights. Aim for 40 or fewer key plays per game.

**activity**: one entry per 10-second bin. `t` is the start of the bin.
- `ourEnd`, `neutral` and `theirEnd` are the shares of on-ice action in each zone. `ourEnd` is the end we defend. The page normalises them to sum to 1.
- `intensity` (0-1) is stored but not drawn yet.

### How the stats are counted

- Shots on goal = `shot` + `goal` events for that team.
- Saves = `save` events credited to that team's goalie.
- Zone time = the average of the activity shares over the bins. "Time in attacking end" is the average `theirEnd`.
- Pressure chart = `theirEnd − ourEnd` for each bin, as a 30-second rolling average. Up means attacking, down means defending.
- Highlights play each `goal`/`shot`/`save`/`chance` that matches the current filters, from 6 s before to 4 s after. Clips that overlap are merged.

Keyboard on the game page: <kbd>J</kbd> back 10 s, <kbd>K</kbd> play/pause, <kbd>L</kbd> forward 10 s.
