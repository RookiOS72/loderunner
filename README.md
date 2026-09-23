# Lode Runner — in-browser port by Rook

> **Faithful tile-based port of the 1983 Lode Runner in your browser.** Single-screen, single-player, keyboard-only. Player vs. the gold, the runners, the grunters, and the bricks.

## Play

Open `index.html` in any modern browser. No build step, no server, no install.

```bash
# from this directory:
open index.html
```

## Controls

| Key | Action |
|---|---|
| `←` `→` | Run left / right |
| `↑` `↓` | Climb up / down ladder |
| `Z` | Dig to the left |
| `X` | Dig to the right |
| `Space` | Start / Restart |

## What's in v0.3

- **All 150 original levels vendored** as data (`levels.js` / `levels/vglc-source/`) — not wired into the engine yet, so real play is still the single v0.2 level. See Files below.
- **Rope tiles** (`~`): hand-over-hand bars from the original game. Standing on one suspends gravity — walk left/right freely — until you press Down to let go and drop through. Enemies hang on ropes the same way instead of falling through them, since several original levels route guard patrols along a rope.
- Debug hook `window.__loderunner.loadLevel(id)` loads any of the 150 vendored levels by 1-based id, ahead of the real level-select UI.

## What's in v0.2

- Tile-based 16×16 retro graphics with classic Atari color palette (orange bricks with real brick-pattern mortar, yellow gold piles, green exit, yellow ladder rungs)
- **Real brick-pattern rendering:** staggered bricks with mortar lines (not solid rectangles)
- **Player movement:** arrow keys to run (55 px/s), climb ladders, fall through dug bricks
- **Two ladder columns** at cols 2 and 30, running rows 7–21, so the player can climb between any brick row
- **Brick digging** (Z/X keys) with 350ms cooldown between digs
- **Player sprite:** small humanoid figure (head, body, legs, facing-direction eyes)
- **Two enemy types:**
  - **Red Runner:** tall angular figure, patrols horizontally, chases player on same row
  - **Purple Grunter:** round figure, patrols when grounded, falls down holes
- **Both enemies** use proper px/sec movement (no per-frame tile jumps) and bounce off walls/bricks
- **Six gold pieces** scattered through the level
- **Win condition:** collect all gold, reach top exit (col 14 row 7)
- **Lose condition:** touch any enemy (collision uses TILE * 0.7 distance)

## What's NOT in v0.1

Deferred to v0.2+:

- Level editor (the original Atari 800XL version had one — this is the *missing feature*)
- Shareable-Level URLs (editor output → URL → load level)
- Daily level (same seed for everyone)
- Sound design (the original Atari version was silent — sound is optional)
- Multiple player characters / skins
- Save/load beyond URL sharing
- Touch / mobile controls
- Background animations

## Tech

- Vanilla JavaScript, no framework, no build step
- HTML5 Canvas for rendering
- Local-only (no analytics, no network requests, no accounts)

## Files

- `index.html` — page shell + HUD + canvas
- `game.js` — engine + player + enemy AI + level + test hooks
- `levels.js` — all 150 original levels, generated (see below); not yet
  wired into the engine, which still runs on the single hand-crafted level
- `levels/vglc-source/` — the 150 original levels, vendored verbatim as
  plain-text tile grids from [TheVGLC](https://github.com/TheVGLC/TheVGLC)
  (MIT), itself a transcription of the 1983 Broderbund release designed by
  Douglas E. Smith
- `scripts/build_levels.py` — converts `levels/vglc-source/` into
  `levels.js`; re-run it after touching the source data
- `scripts/smoke_test.py` — Playwright end-to-end test

## Test coverage

The smoke test verifies: page loads with no console errors, state transitions (menu → playing → won/lost), gold count matches the level, player can dig bricks, can collect gold, enemy contact triggers lost state, and 3 consecutive restart cycles all reach 'playing' state.

To run it:

```bash
uv venv .venv && uv pip install --python .venv/bin/python playwright
.venv/bin/playwright install chromium
.venv/bin/python scripts/smoke_test.py
```

## License

MIT. By [Rook](https://github.com/RookiOS72).
