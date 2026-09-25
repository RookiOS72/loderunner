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
- **The trap-and-recapture mechanic.** Dug holes close back up after ~4s (now ~9.9s, see v0.4); an enemy caught standing in one when it closes dies and respawns, but is safe to walk over while trapped, and gets ~2.5s to climb back out on its own first.
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

## What's in v0.4 (play-testing the 150 levels)

Before restarting the campaign faithfully ("New Game" from level 1 with lives), every level had to be play-tested. That turned out to need two new tools, and they found a lot of places where the engine disagreed with the 1983 game.

**The tools** (see "Play testing" below): a bot that plays levels in the real engine, and a differential test that drives the same keys through this engine and through the reference port ([SimonHung/LodeRunner_TotalRecall](https://github.com/SimonHung/LodeRunner_TotalRecall), not vendored) and compares where the runner goes.

**Engine fixes the play test forced** (each one made real levels unwinnable or wrong):

- **Holes now stay open ~9.9s, not 4s.** In the original a dug hole stays open 166 ticks and takes 20 more to fill, while the runner needs 5 ticks to cross a tile, so a hole lasts about 37 tiles of running. At our runner speed that is ~9.9s. With 4s, levels like 16 (drop into a sealed room, take six gold, climb back out) could not be won. Guards get ~3.8s (was 2.5s) to climb out of a pit.
- **Digging follows the original's rule and takes time.** The brick diagonally below must be plain brick and the tile *beside* you must be empty (not gold, ladder, rope or trapdoor; a hidden ladder that hasn't appeared counts as empty). The runner is frozen for ~0.6s while digging and the hole opens when that finishes. Before, any brick could be dug instantly with a 0.35s cooldown.
- **Falling and climbing run at the original's speed** (~61px/s, same as the original's climb; falling was 200px/s).
- **Trapdoors are walls from the side.** You fall through one from above, but you cannot walk into it sideways or climb up into it (you could).
- **Going up needs a ladder in your own tile.** You cannot grab a ladder from the empty tile below it.
- **Gold is picked up near the middle of its tile**, as in the original, not on first touch. (Walking sideways into a gold tile that has no floor drops you through it off-centre with no pickup; you have to fall or climb straight through it.)
- **Landing and turning follow the original**: a fall carries on until you are centred on the tile; running waits until you are on the row's centre line; climbing or falling recentres you in the column.
- **Guards no longer hold stolen gold forever.** They drop it after 12-37 steps, as in the original (a guard that kept it forever could soft-lock a level).
- **Two real bugs:** a level could start with the runner's sub-tile position left over from the last level (hold a direction when a level starts and you were teleported), and after falling into a pit the runner could be stuck "falling" while standing on a ladder, so the pit-escape hop never fired.
- Still deliberately different from the original: the runner can hop out of a pit (see v0.3.10).

**Results.** `scripts/conform.py` matches the reference on ~99% of random key runs across all 150 levels (same tiles visited), so runner movement is now close to the original. `scripts/playtest.py` (no guards) wins 68 of 150 levels; 13 more (25, 30, 48, 49, 59, 64, 92, 98, 115, 136, 137, 139, 148) are flagged: some gold is unreachable by any route the bot's model allows, most likely because a guard has to carry it out (see below); the other 69 are beyond the bot's planner, not known-broken. Per-level list: `PLAYTEST.md`.

**Guards are the next problem, and they matter for winnability.** The engine's guards patrol horizontally and only fall; they never climb or chase. In the original their chase AI, and their habit of carrying gold to somewhere reachable, is part of solving some levels (level 137 is the clear case: its top corridor is only reachable through a hidden-ladder gap a guard can fall through, so a guard has to carry that gold out; the other flagged levels look similar but are not confirmed one by one). Until guards behave like the originals those levels cannot be completed here. The original's other guard traits (speed tied to the number of guards, dying and respawning at the top, being stepped on) are also missing.

**There is no lives limit** (losing just retries the level), which is what play-testing wants; the faithful five-lives mode will be added later as something you can turn off.

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
- `scripts/playtest.py` + `scripts/playbot.js` — the level play-test bot (see below)
- `scripts/conform.py` — differential test against the reference port (see below)

## Test coverage

The smoke test verifies: page loads with no console errors, the menu's level-select (Left/Right pick, wraparound, Space starts the pick), gold count matches the picked level's own data, Z digs diagonally below-left (not the player's own row), gold pickup, enemy contact triggers 'lost', forceWin() reaches 'won', winning advances to the next level on Space, losing retries the same level, and the level editor (opens from the menu, refuses to test-play without a player spawn, tile placement, test-play returns to the editor on win instead of the campaign, saving plays back correctly as a level after the official 150). It doesn't cover the hole-refill/trap-and-escape timing or gold-carrying guards (see game.js and recent commit messages for how those were checked separately).

To run it:

```bash
uv venv .venv && uv pip install --python .venv/bin/python playwright
.venv/bin/playwright install chromium
.venv/bin/python scripts/smoke_test.py
```

## Play testing

```bash
.venv/bin/python scripts/playtest.py --static     # 2s: is every gold reachable at all? (holes permanent, no timing)
.venv/bin/python scripts/playtest.py 1 16 37      # a bot plays those levels in the real engine (no guards)
.venv/bin/python scripts/playtest.py --trace 16   # ...and prints the route it planned and any step that failed
.venv/bin/python scripts/playtest.py              # all 150 (slow; run shards in parallel, see the script header)
```

The bot (`scripts/playbot.js`, runs inside the page against the real `game.js` on a virtual clock) plans a route with the engine's own rules — walking, ladders, ropes, falling, trapdoors, digging with the original's rule, holes that expire — picks an order for the gold with backtracking out of dead ends, and then presses real keys. If the engine disagrees with the plan it re-plans from where the runner actually is. `--static` is a cheaper necessary condition: it pretends every hole you can dig stays open forever, and reports any gold that is *still* unreachable, which cannot be planner weakness.

```bash
git clone --depth 1 https://github.com/SimonHung/LodeRunner_TotalRecall ~/rookios72/reference/LodeRunner_TotalRecall
.venv/bin/python scripts/conform.py --ref ~/rookios72/reference/LodeRunner_TotalRecall --levels 1 2 3 --runs 10
```

`conform.py` feeds identical random key sequences (no guards) to this game and to the reference port headless, and reports any tile one visited that the other never got near. The reference is the closest thing to the 1983 game's behaviour we can run, so this is how movement bugs were found. It is not vendored (it has no licence); clone it wherever you like.

## License

MIT. By [Rook](https://github.com/RookiOS72).
