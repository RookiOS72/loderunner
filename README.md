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
| `←` `→` | At the menu: pick a level. While playing: run left / right. In the editor: move the cursor horizontally |
| `↑` `↓` | Climb up / down ladder. In the editor: move the cursor vertically |
| `Z` | Dig the brick diagonally below-left |
| `X` | Dig the brick diagonally below-right |
| `M` | Mute / unmute |
| `E` | At the menu: open the level editor |
| `Space` | Start the picked level / Restart / Next level |

## Level editor

Press `E` at the menu to open it. Move the cursor with the arrow keys, place a tile with a number key, then `T` to test-play or `S` to save. `Esc` returns to the menu.

| Key | Tile |
|---|---|
| `1` | Empty |
| `2` | Brick (diggable) |
| `3` | Solid (undiggable) |
| `4` | Ladder |
| `5` | Rope |
| `6` | Gold |
| `7` | Runner spawn |
| `8` | Grunter spawn |
| `9` | Player spawn (exactly one; placing a new one moves it) |
| `0` | Trapdoor (looks like brick, you fall through it) |
| `H` | Hidden ladder (appears once all gold is collected) |

`T` and `S` both require a player spawn first. Saved levels are appended after the 150 official ones in the level-select (level 151 is your first save, and so on) and persist in `localStorage` — they play through the exact same engine as the originals, trap mechanic and all.

Not yet built: shareable-level URLs (the saved level's data would need to round-trip through a URL, which is its own separate backlog item — see below), editing an already-saved level (you can only build a new one), deleting a saved level short of clearing `localStorage` by hand.

## What's in v0.3

- **The real campaign is live**, and you can now actually pick a level: the menu screen doubles as a level-select for all 150 levels of the Apple II original (Left/Right to pick, Space to start) — as data in `levels.js`. Winning advances to the next level on Space; losing retries the same one; clearing level 150 returns you to the picker.
- **Fixed digging.** Z/X used to dig the brick beside the player's own row — a bug that only ever worked on the old placeholder level's specially-built layout (see v0.2 below; that level is gone as of v0.3.6). The real levels put the floor *below* the walking row, so digging now correctly targets diagonally below-left/right, matching the original.
- **Rope tiles** (`~`): hand-over-hand bars. Standing on one suspends gravity — walk left/right freely — until you press Down to let go and drop through. Enemies hang on ropes too instead of falling through them.
- **Real win condition:** collect all gold, then climb out the top of the screen. (Superseded by v0.3.14, which restores the original's hidden ladder that appears once the gold is collected — before that the levels didn't carry it and level 1 could not be finished.)
- **The trap-and-recapture mechanic.** Dug holes close back up after ~4s; an enemy caught standing in one when it closes dies and respawns, but is safe to walk over while trapped, and gets ~2.5s to climb back out on its own first.
- **Gold-carrying guards.** Guards steal gold they walk over (the level can't be won until it's recovered); trapping one in a hole makes it drop what it's carrying, which reappears one tile above the pit.
- **v0.3.6: removed the v0.2 placeholder level.** It was a hand-built single level used to get the engine off the ground before the real 150 were vendored — it's no longer reachable from anywhere in the UI (the menu is a level-select over the real 150), so it was dead weight. See "What was in v0.2" below for what it used to be.
- **v0.3.7: sound**, synthesized via WebAudio (no audio files, same approach as the sibling [asteroids](https://github.com/RookiOS72/asteroids) project) — a thunk for digging, a chime for gold, a "gotcha" blip for trapping a guard, a poof when one dies in a refilling hole, and stingers for winning/losing a level. `M` mutes.
- **v0.3.8: progress persists.** The highest level you've cleared is saved to `localStorage` — the menu shows "Cleared: N/150" and defaults the picker to the next one, instead of always starting back at level 1 after closing the tab.
- **v0.3.9: level editor.** Build a level tile-by-tile, test-play it, save it — saved levels extend the same 1-150 numbering (151, 152, ...) and play through the identical engine, so anything built in the editor gets the full trap mechanic, gold-carrying guards, and everything else for free. See "Level editor" above.
- **v0.3.10: falling into your own hole.** Three fixes for a bug where you'd half-fall into a hole you'd dug and get stuck: (1) the player's column was computed with `ceil` going left and `floor` going right, so it lagged the sprite by up to half a tile and you dropped in off-center, overlapping the wall — now `floor` both ways; (2) you now fall straight down the middle of a gap (no mid-air steering, as in the original) instead of landing offset; (3) you can climb out of a pit by pushing toward a side, hopping onto the floor beside it. That last one is a deliberate softening — the original manual says the runner can't climb out of a pit at all, which in practice just turned a slip into a death (holes in the bottom row are the worst case: nothing below to dig). It's one self-contained block in `updatePlayer` if you'd rather have the original behavior. Also fixed: guards trapped in a pit never actually escaped — they climbed up one row and the empty hole tile under them dropped them straight back in — so they now climb out onto the floor *beside* the pit after ~2.5s, as the README always claimed. Walking into a wall also no longer jitters.
- **v0.3.11: ladder float and lost gold.** Holding Up at the top of a ladder no longer floats you above the walkway — vertical movement now works like horizontal (row is `floor` of the centre in both directions, and the centre clamps to the middle of the tile when the next row isn't enterable). Falling is also faster than climbing now (it was crawling at climb speed). And when two guards drop gold into the same spot, the second no longer overwrites the first (which made the level unwinnable): drops search for the nearest tile that is truly free — never on top of other gold, a ladder, or a rope — and a guard killed while still carrying can't take its gold with it.
- **v0.3.12: characters that look like the originals** *(superseded by v0.3.13 below)*. The runner and guards were placeholder blobs; they became animated pixel figures in the style of the 1983 Apple II art — a thin white runner and an orange guard with white legs, each with a blue pixel on top of the head — with the same set of animations as the original: run (3 frames), hand-over-hand along ropes (3), climbing (2), digging (1) and falling (1), all mirrored for left. That set was **our own drawings**, generated from pose data. Ropes moved to the top of their tile (as in the original) so a hanging character's hands meet them. Also fixed: the play area was a 1:1 box for a 32×22 board, leaving a dead black band under the level and pushing the overlay text off-center.
- **v0.3.13: the actual 1983 sprites.** v0.3.12's characters were our own drawings in the original's style; the point of this port is fidelity, so the runner and guards now use the real Apple II frames — every one of the 38 (run, hand-over-hand, climb, dig, fall, with the originals' separate left-facing frames rather than mirrors) in the Apple II hi-res white/orange/blue. `scripts/build_sprites.py` decodes them from the public [XekriRedmane/lode_runner_reveng](https://github.com/XekriRedmane/lode_runner_reveng) project, using its disassembly's animation tables to know which sprite is which. **Rights note:** that art is Brøderbund's, and that repository states no licence, so this project has no licence to it either — it's a fan port, and the levels come from the same original. If a rights holder objects, `python3 scripts/build_sprites.py --source own` regenerates `sprites.js` with our own look-alike drawings (the v0.3.12 set) in one command.
- **v0.3.14: the actual Apple II levels — and a way out.** Level 1 couldn't be finished: with all the gold collected there was no ladder to climb out. In the original, some ladders are **hidden** until every piece of gold is collected, then appear (111 of the 150 levels have one). The levels vendored earlier (from the VGLC corpus) had dropped them — and, it turned out, weren't the Apple II levels at all but a 32×22 variant with different layouts. Now `levels.js` is built by `scripts/build_levels.py` from levels extracted from the Apple II disk image (via [SimonHung/LodeRunner_TotalRecall](https://github.com/SimonHung/LodeRunner_TotalRecall)): the real 150, on the original **28×16** board, with hidden ladders, and **trapdoors** (85 levels) — tiles that look like brick but drop you through. The status line tells you when the ladder has appeared, and a rising chime plays. The editor gained `0` (trapdoor) and `H` (hidden ladder). **Rights note:** as with the sprites, the designs are Doug Smith's/Brøderbund's and that repository states no licence, so neither does this project. Custom levels saved from the 32×22 editor before this are cropped to the new board.
- Debug hooks: `window.__loderunner.loadLevel(id)` jumps to any level (official or custom) by 1-based id; `setEnemyAt(index, col, row)` and `setPlayerPixelAt(x, y)` exist for deterministic tests; `getHighestCleared()` / `resetProgress()` for saved progress; `enterEditor()`, `editorKey(code)`, `getEditorState()`, `saveEditorLevelAs(name)`, `getCustomLevels()`, `clearCustomLevels()` for the editor.

## What was in v0.2 (removed in v0.3.6)

The very first playable milestone was a single hand-built level, before the real 150 were vendored. It's gone from the code now, kept here for history:

- Tile-based 16×16 retro graphics, orange brick-pattern rendering, yellow ladder rungs, a green exit tile.
- Two full-height ladder columns (cols 2 and 30) so the player could reach any brick row.
- Six gold pieces, one Red Runner (chases on-row) and one Purple Grunter (patrols/falls).
- Win condition: collect all gold, then step onto a fixed exit tile at (col 16, row 15) — this tile existed from v0.2 but didn't actually trigger a win until v0.3.2.

## What's NOT in v0.1

Deferred to v0.2+:

- Shareable-Level URLs (editor output → URL → load level — the editor landed in v0.3.9, this still hasn't)
- Daily level (same seed for everyone)
- Multiple player characters / skins
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
- `sprites.js` — the runner and guard animation frames, generated by
  `scripts/build_sprites.py` (the original Apple II sprites by default;
  `--source own` for our own drawings)
- `levels.js` — the 150 Apple II levels (28×16), generated by
  `scripts/build_levels.py`; the only level data the game plays
- `scripts/smoke_test.py` — Playwright end-to-end test

## Test coverage

The smoke test verifies: page loads with no console errors, the menu's level-select (Left/Right pick, wraparound, Space starts the pick), gold count matches the picked level's own data, Z digs diagonally below-left (not the player's own row), gold pickup, enemy contact triggers 'lost', forceWin() reaches 'won', winning advances to the next level on Space, losing retries the same level, and the level editor (opens from the menu, refuses to test-play without a player spawn, tile placement, test-play returns to the editor on win instead of the campaign, saving plays back correctly as a level after the official 150). It doesn't cover the hole-refill/trap-and-escape timing or gold-carrying guards (see game.js and recent commit messages for how those were checked separately).

To run it:

```bash
uv venv .venv && uv pip install --python .venv/bin/python playwright
.venv/bin/playwright install chromium
.venv/bin/python scripts/smoke_test.py
```

## License

MIT. By [Rook](https://github.com/RookiOS72).
