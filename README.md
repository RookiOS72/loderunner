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
| `M` | Mute / unmute |
| `Space` | Start the picked level / Restart / Next level |

## What's in v0.3

- **The real campaign is live**, and you can now actually pick a level: the menu screen doubles as a level-select for all 150 original levels (Left/Right to pick, Space to start) — vendored as data in `levels.js` / `levels/vglc-source/`. Winning advances to the next level on Space; losing retries the same one; clearing level 150 returns you to the picker.
- **Fixed digging.** Z/X used to dig the brick beside the player's own row — a bug that only ever worked on the old placeholder level's specially-built layout (see v0.2 below; that level is gone as of v0.3.6). The real levels put the floor *below* the walking row, so digging now correctly targets diagonally below-left/right, matching the original.
- **Rope tiles** (`~`): hand-over-hand bars. Standing on one suspends gravity — walk left/right freely — until you press Down to let go and drop through. Enemies hang on ropes too instead of falling through them.
- **Real win condition:** collect all gold, then reach the top row. (The source data doesn't preserve the original's "hidden ladder that appears once gold is collected," so reaching the top stands in for it.) Previously nothing checked this at all.
- **The trap-and-recapture mechanic.** Dug holes close back up after ~4s; an enemy caught standing in one when it closes dies and respawns, but is safe to walk over while trapped, and gets ~2.5s to climb back out on its own first.
- **Gold-carrying guards.** Guards steal gold they walk over (the level can't be won until it's recovered); trapping one in a hole makes it drop what it's carrying, which reappears one tile above the pit.
- **v0.3.6: removed the v0.2 placeholder level.** It was a hand-built single level used to get the engine off the ground before the real 150 were vendored — it's no longer reachable from anywhere in the UI (the menu is a level-select over the real 150), so it was dead weight. See "What was in v0.2" below for what it used to be.
- **v0.3.7: sound**, synthesized via WebAudio (no audio files, same approach as the sibling [asteroids](https://github.com/RookiOS72/asteroids) project) — a thunk for digging, a chime for gold, a "gotcha" blip for trapping a guard, a poof when one dies in a refilling hole, and stingers for winning/losing a level. `M` mutes.
- Debug hooks: `window.__loderunner.loadLevel(id)` jumps to any of the 150 levels by 1-based id; `setEnemyAt(index, col, row)` and `setPlayerPixelAt(x, y)` exist for deterministic tests.

## What was in v0.2 (removed in v0.3.6)

The very first playable milestone was a single hand-built level, before the real 150 were vendored. It's gone from the code now, kept here for history:

- Tile-based 16×16 retro graphics, orange brick-pattern rendering, yellow ladder rungs, a green exit tile.
- Two full-height ladder columns (cols 2 and 30) so the player could reach any brick row.
- Six gold pieces, one Red Runner (chases on-row) and one Purple Grunter (patrols/falls).
- Win condition: collect all gold, then step onto a fixed exit tile at (col 16, row 15) — this tile existed from v0.2 but didn't actually trigger a win until v0.3.2.

## What's NOT in v0.1

Deferred to v0.2+:

- Level editor (the original Atari 800XL version had one — this is the *missing feature*)
- Shareable-Level URLs (editor output → URL → load level)
- Daily level (same seed for everyone)
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
- `audio.js` — synthesized sound effects (WebAudio, no audio files)
- `levels.js` — all 150 original levels, generated (see below); the only
  level data the game plays now
- `levels/vglc-source/` — the 150 original levels, vendored verbatim as
  plain-text tile grids from [TheVGLC](https://github.com/TheVGLC/TheVGLC)
  (MIT), itself a transcription of the 1983 Broderbund release designed by
  Douglas E. Smith
- `scripts/build_levels.py` — converts `levels/vglc-source/` into
  `levels.js`; re-run it after touching the source data
- `scripts/smoke_test.py` — Playwright end-to-end test

## Test coverage

The smoke test verifies: page loads with no console errors, the menu's level-select (Left/Right pick, wraparound, Space starts the pick), gold count matches the picked level's own data, Z digs diagonally below-left (not the player's own row), gold pickup, enemy contact triggers 'lost', forceWin() reaches 'won', winning advances to the next level on Space, and losing retries the same level. It doesn't cover the hole-refill/trap-and-escape timing or gold-carrying guards (see game.js and recent commit messages for how those were checked separately).

To run it:

```bash
uv venv .venv && uv pip install --python .venv/bin/python playwright
.venv/bin/playwright install chromium
.venv/bin/python scripts/smoke_test.py
```

## License

MIT. By [Rook](https://github.com/RookiOS72).
