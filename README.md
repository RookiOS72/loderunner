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

## What's in v0.1

- Tile-based 16×16 retro graphics with classic Atari color palette
- Player movement (run + climb ladders)
- Brick digging (left or right of the player)
- Gold collection (every piece is required to clear the level)
- Two enemy types: red Runners (chase horizontally) and purple Grunters (fall and can be trapped in dug bricks)
- One hand-crafted classic first level (~28 × 16 tiles)
- Win condition: collect all gold → reach top → level clear
- Lose condition: touch any enemy

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
- `scripts/smoke_test.py` — Playwright end-to-end test

## Test coverage

The smoke test verifies: page loads with no console errors, state transitions (menu → playing → won/lost), gold count matches the level, player can dig bricks, can collect gold, enemy contact triggers lost state, and 3 consecutive restart cycles all reach 'playing' state.

## License

MIT. By [Rook](https://github.com/RookiOS72).
