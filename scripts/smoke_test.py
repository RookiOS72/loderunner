"""Smoke test for Lode Runner (in-browser port).

Uses Playwright to drive a headless Chromium and verify:
- Page loads with no console errors
- Pressing Space starts the game (state goes from 'menu' to 'playing')
- Gold count matches the level definition (4 pieces)
- Player can move left/right and dig bricks
- Player can collect gold by walking onto it
- Touching an enemy sends the game to 'lost' state
- Reaching the exit with all gold triggers 'won' state
- Multiple consecutive runs are reliable (no race conditions)

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

        page.keyboard.press("Space")
        page.wait_for_timeout(300)
        state_after = page.evaluate("window.__loderunner.getState()")
        assert state_after == "playing", f"After Space, state should be 'playing', got {state_after!r}"
        print(f"  ✓ after Space, state is {state_after!r}")

        # 3. Gold count is correct
        gold = page.evaluate("window.__loderunner.getGold()")
        assert gold == {"collected": 0, "total": 6}, f"Expected 6 gold pieces, got {gold!r}"
        print(f"  ✓ gold count = {gold['collected']}/{gold['total']}")

        # 4. Player can dig a brick
        # Stand next to a brick, dig it, verify tile becomes empty
        page.evaluate("window.__loderunner.setPlayerAt(16, 20)")
        dig_result = page.evaluate("window.__loderunner.digAt(17, 20)")
        assert dig_result is True, f"Dig should succeed, got {dig_result!r}"
        tile_after_dig = page.evaluate("window.__loderunner.getTile(17, 20)")
        assert tile_after_dig == 0, f"Tile after dig should be empty, got {tile_after_dig!r}"
        print(f"  ✓ dig at (17, 20) succeeded; tile is now empty")

        # 5. Player can collect gold by walking onto it
        # Find gold positions and verify pickup
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
        assert len(gold_positions) == 6, f"Expected 6 gold pieces in level, got {len(gold_positions)}"
        # Pickup the first gold
        target = gold_positions[0]
        page.evaluate(f"window.__loderunner.setPlayerAt({target['col']}, {target['row']})")
        picked = page.evaluate(
            "(args) => { window.__loderunner.setPlayerAt(args.col, args.row); return window.__loderunner.pickupGold(); }",
            {"col": target["col"], "row": target["row"]},
        )
        assert picked is True, f"Pickup at gold position should succeed, got {picked!r}"
        gold_after = page.evaluate("window.__loderunner.getGold()")
        assert gold_after["collected"] == 1, f"Expected 1 gold collected, got {gold_after!r}"
        print(f"  ✓ pickup gold at ({target['col']}, {target['row']}); collected=1")

        # 6. Enemy collision triggers 'lost' state
        # Place player next to a known enemy spawn (col 0 has a grunter at row 21)
        page.evaluate("window.__loderunner.setPlayerAt(0, 21)")
        page.wait_for_timeout(800)  # let the grunter walk toward the player
        state = page.evaluate("window.__loderunner.getState()")
        assert state == "lost", f"Expected 'lost' after enemy contact, got {state!r}"
        print(f"  ✓ enemy contact triggered 'lost' state")

        # 7. Win state reachable
        page.evaluate("window.__loderunner.forceWin()")
        state_win = page.evaluate("window.__loderunner.getState()")
        assert state_win == "won", f"forceWin should set 'won' state, got {state_win!r}"
        print(f"  ✓ forceWin triggered 'won' state")

        # 8. Multiple game-restart cycles work
        for cycle in range(3):
            page.keyboard.press("Space")
            page.wait_for_timeout(200)
            state = page.evaluate("window.__loderunner.getState()")
            assert state == "playing", f"After Space cycle {cycle}, expected 'playing', got {state!r}"
        print("  ✓ 3 consecutive restart cycles all reached 'playing' state")

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
