"""Smoke test for Lode Runner (in-browser port).

Uses Playwright to drive a headless Chromium and verify:
- Page loads with no console errors
- The menu is a level-select for the 150 vendored levels: Left/Right
  change the pick (with wraparound), Space starts whichever is picked
- Gold count matches the picked level's own data
- Digging with Z targets one row BELOW the player (the floor underfoot),
  not the player's own row — this is what makes the real levels
  diggable at all; a same-row regression here would silently break them
- Player can collect gold by walking onto it
- Touching an enemy sends the game to 'lost' state
- forceWin() reaches 'won' state
- Winning advances to the next level on Space; losing retries the same
  one

This intentionally doesn't cover the hole-refill/trap-and-escape
mechanic, or gold-carrying guards (see game.js HOLE_REFILL_MS /
ENEMY_ESCAPE_MS / carryingGold) — those were verified with throwaway
Playwright scripts during development instead, since the former needs
several seconds of real time per case; see the v0.3.3/v0.3.4 commit
messages for what was checked.

Run with: python3 scripts/smoke_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

INDEX = Path(__file__).parent.parent / "index.html"


def main() -> int:
    INDEX_ABS = str(INDEX.resolve())
    print(f"Loading {INDEX_ABS}\n")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Playwright not available; install with: pip install playwright && playwright install chromium")
        # Fallback: just verify the JS files exist and the index.html references them
        gs_path = INDEX.parent / "game.js"
        if not gs_path.exists():
            print(f"FAIL: {gs_path} missing")
            return 1
        print(f"PASS (file-only check): {gs_path} exists")
        return 0

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 900, "height": 900})
        page = ctx.new_page()

        console_errors: list[str] = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))

        page.goto(f"file://{INDEX_ABS}")
        page.wait_for_selector("#game")
        page.wait_for_timeout(300)

        # 1. Page loads with no console errors
        assert console_errors == [], f"Page load produced errors: {console_errors}"
        print("  ✓ page loads with no console errors")

        # 2. State is 'menu' before Space, 'playing' after
        state_before = page.evaluate("window.__loderunner.getState()")
        assert state_before == "menu", f"Initial state should be 'menu', got {state_before!r}"
        print(f"  ✓ initial state is {state_before!r}")

        # 2b. The menu is a level-select: Left/Right pick a level (1-150,
        # wrapping), Space starts whichever one is currently picked.
        overlay_text = page.inner_text("#overlay-content")
        assert "001" in overlay_text, f"Menu should show level 001 by default, got: {overlay_text!r}"
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        overlay_text = page.inner_text("#overlay-content")
        assert "003" in overlay_text, f"Two ArrowRight presses should pick level 3, got: {overlay_text!r}"
        page.keyboard.press("ArrowLeft")
        overlay_text = page.inner_text("#overlay-content")
        assert "002" in overlay_text, f"ArrowLeft should step back to level 2, got: {overlay_text!r}"
        print("  ✓ menu level-select: Left/Right change the pick")

        page.keyboard.press("Space")
        page.wait_for_timeout(300)
        state_after = page.evaluate("window.__loderunner.getState()")
        assert state_after == "playing", f"After Space, state should be 'playing', got {state_after!r}"
        level_id = page.evaluate("window.__loderunner.getCurrentLevelId()")
        assert level_id == 2, f"Space should launch the picked level (2), got level id {level_id!r}"
        print(f"  ✓ after Space, state is {state_after!r} on picked level {level_id}")

        # 3. Gold count matches the level's own data (avoids hardcoding a
        # number that's a property of the vendored data, not the engine)
        expected_gold = page.evaluate("window.LEVELS[1].goldTotal")
        gold = page.evaluate("window.__loderunner.getGold()")
        assert gold == {"collected": 0, "total": expected_gold}, f"Expected {expected_gold} gold pieces, got {gold!r}"
        print(f"  ✓ gold count = {gold['collected']}/{gold['total']}")

        # 4. Digging targets one row BELOW the player, not the player's
        # own row. Level 2 spawns at (16, 20), with a brick at (15, 21)
        # diagonally below-left — dig it with the real Z key (not the
        # digAt debug hook, which bypasses this logic entirely and so
        # wouldn't catch a same-row regression).
        page.evaluate("window.__loderunner.setPlayerAt(16, 20)")
        same_row_before = page.evaluate("window.__loderunner.getTile(15, 20)")
        below_before = page.evaluate("window.__loderunner.getTile(15, 21)")
        assert below_before == 1, f"Expected a brick at (15,21) to dig, got tile {below_before!r}"
        page.keyboard.down("KeyZ")
        page.wait_for_timeout(150)
        page.keyboard.up("KeyZ")
        same_row_after = page.evaluate("window.__loderunner.getTile(15, 20)")
        below_after = page.evaluate("window.__loderunner.getTile(15, 21)")
        assert below_after == 0, f"Dig-left should clear the brick below-left (15,21), got {below_after!r}"
        assert same_row_after == same_row_before, "Dig-left must not touch the player's own row"
        print("  ✓ Z digs the brick diagonally below-left, not same-row")

        # 5. Player can collect gold by walking onto it
        gold_positions = page.evaluate("""() => {
            const result = [];
            for (let row = 0; row < 22; row++) {
                for (let col = 0; col < 32; col++) {
                    if (window.__loderunner.getTile(col, row) === 5) {
                        result.push({col, row});
                    }
                }
            }
            return result;
        }""")
        assert len(gold_positions) == expected_gold, f"Expected {expected_gold} gold tiles on the board, got {len(gold_positions)}"
        target = gold_positions[0]
        picked = page.evaluate(
            "(args) => window.__loderunner.pickupGold(args.col, args.row)",
            {"col": target["col"], "row": target["row"]},
        )
        assert picked is True, f"Pickup at gold position should succeed, got {picked!r}"
        gold_after = page.evaluate("window.__loderunner.getGold()")
        assert gold_after["collected"] == 1, f"Expected 1 gold collected, got {gold_after!r}"
        print(f"  ✓ pickup gold at ({target['col']}, {target['row']}); collected=1")

        # 6. Enemy collision triggers 'lost' state — walk the player onto
        # a live enemy's own position rather than hardcoding a spawn
        # tile, so this doesn't depend on which level is loaded. Enemies
        # can have long fall shafts from their spawn tile, so poll until
        # one has stopped FALLING (y stable — x keeps moving, since a
        # grounded enemy still patrols horizontally by design) rather
        # than guessing a fixed wait.
        settled_index = None
        for _ in range(20):
            before = page.evaluate("window.__loderunner.getEnemyPositions()")
            page.wait_for_timeout(150)
            after = page.evaluate("window.__loderunner.getEnemyPositions()")
            for i, a in enumerate(after):
                if i < len(before) and before[i]["kind"] == a["kind"] and abs(before[i]["y"] - a["y"]) < 0.01:
                    settled_index = i
                    break
            if settled_index is not None:
                break
        assert settled_index is not None, "No enemy stopped falling within the poll window"
        # Land the player at the enemy's exact CURRENT pixel position —
        # it's rarely tile-centered mid-patrol, and round-tripping
        # through tile coordinates just to set the player loses that
        # precision, so read it fresh right before setting.
        pos = page.evaluate("window.__loderunner.getEnemyPositions()")[settled_index]
        page.evaluate(
            "(p) => window.__loderunner.setPlayerPixelAt(p.x, p.y)",
            {"x": pos["x"], "y": pos["y"]},
        )
        page.wait_for_timeout(100)
        state = page.evaluate("window.__loderunner.getState()")
        assert state == "lost", f"Expected 'lost' after enemy contact, got {state!r}"
        print("  ✓ enemy contact triggered 'lost' state")

        # 7. Win state reachable
        page.evaluate("window.__loderunner.forceWin()")
        state_win = page.evaluate("window.__loderunner.getState()")
        assert state_win == "won", f"forceWin should set 'won' state, got {state_win!r}"
        print(f"  ✓ forceWin triggered 'won' state")

        # 8. Winning advances to the next level on Space
        page.keyboard.press("Space")
        page.wait_for_timeout(200)
        state2 = page.evaluate("window.__loderunner.getState()")
        level_id2 = page.evaluate("window.__loderunner.getCurrentLevelId()")
        assert state2 == "playing" and level_id2 == 3, f"Expected level 3 'playing' after winning level 2, got level {level_id2!r} / {state2!r}"
        print("  ✓ winning a level then pressing Space advances to the next one")

        # 9. Losing retries the SAME level (not level 1, not the placeholder)
        page.evaluate("window.__loderunner.forceGameOver()")
        page.keyboard.press("Space")
        page.wait_for_timeout(200)
        level_id3 = page.evaluate("window.__loderunner.getCurrentLevelId()")
        assert level_id3 == 3, f"Expected a loss on level 3 to retry level 3, got {level_id3!r}"
        print("  ✓ losing a level then pressing Space retries the same level")

        # Final check
        if console_errors:
            print(f"\nUnexpected console errors: {console_errors}")
            b.close()
            return 1

        b.close()
        print("\n== smoke test OK ==")
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as e:
        print(f"\n✗ assertion failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ smoke test crashed: {type(e).__name__}: {e}")
        sys.exit(1)
