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
| `←` `→` | At the menu: pick a level (1–150). While playing: run left / right |
| `↑` `↓` | Climb up / down ladder |
| `Z` | Dig the brick diagonally below-left |
| `X` | Dig the brick diagonally below-right |
| `Space` | Start the picked level / Restart / Next level |

## What's in v0.3

- **The real campaign is live**, and you can now actually pick a level: the menu screen doubles as a level-select for all 150 original levels (Left/Right to pick, Space to start) — vendored as data in `levels.js` / `levels/vglc-source/`. Winning advances to the next level on Space; losing retries the same one. The v0.2 hand-crafted level still exists in the code but isn't the default anymore.
- **Fixed digging.** Z/X used to dig the brick beside the player's own row — a bug that only ever worked on the placeholder's specially-built layout. Real levels put the floor *below* the walking row, so digging now correctly targets diagonally below-left/right, matching the original.
- **Rope tiles** (`~`): hand-over-hand bars. Standing on one suspends gravity — walk left/right freely — until you press Down to let go and drop through. Enemies hang on ropes too instead of falling through them.
- **Real win condition.** Reaching the exit tile (placeholder level) or the top row (the 150 vendored levels, which have no exit tile in the source data) with all gold collected now actually wins — previously nothing did.
- **The trap-and-recapture mechanic.** Dug holes close back up after ~4s; an enemy caught standing in one when it closes dies and respawns, but is safe to walk over while trapped, and gets ~2.5s to climb back out on its own first.
- **Gold-carrying guards.** Guards steal gold they walk over (the level can't be won until it's recovered); trapping one in a hole makes it drop what it's carrying, which reappears one tile above the pit.
- Debug hooks: `window.__loderunner.loadLevel(id)` jumps to any of the 150 levels by 1-based id; `setEnemyAt(index, col, row)` and `setPlayerPixelAt(x, y)` exist for deterministic tests.

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
- **Win condition:** collect all gold, reach top exit (col 16 row 15) — note: this tile existed but did nothing until v0.3, see below
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
- `levels.js` — all 150 original levels, generated (see below); this is
  what the game actually plays by default now
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
