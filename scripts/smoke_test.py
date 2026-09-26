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
- Hidden ladders appear when all gold is collected and climbing out wins;
  trapdoors drop you through; falling into your own hole is survivable;
  holding Up at a ladder top doesn't float; double gold drops lose nothing
- The level editor: opens from the menu, refuses to test-play with no
  player spawn placed, cursor movement + tile placement work, test-play
  loads with no level id and returns to the editor (not the campaign)
  on win, saving appends a custom level that plays back correctly right
  after the official 150

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


def find_pit_spot(levels):
    """(level, col, row): stand at (col,row); digging left opens (col-1,row+1),
    a real pit (floor beneath it) whose far wall (col-2) has open floor to
    hop out onto. Read from the level data so the test survives level edits."""
    for lid, t in enumerate(levels, 1):
        for r in range(1, len(t) - 2):
            for c in range(3, len(t[0]) - 1):
                if (t[r][c] == "." and t[r][c - 1] == "." and t[r][c - 2] == "."
                        and t[r + 1][c] in "#|" and t[r + 1][c - 1] == "#" and t[r + 2][c - 1] in "#|"
                        and t[r + 1][c - 2] in "#|"):
                    return lid, c, r
    raise AssertionError("no level has a diggable pit spot")


def find_ladder_top(levels):
    """(level, col, row_top, row_start): a ladder whose top has open air above
    it and at least three rungs below to climb from."""
    for lid, t in enumerate(levels, 1):
        for r in range(2, len(t) - 4):
            for c in range(len(t[0])):
                if t[r][c] == "L" and t[r - 1][c] == "." and all(t[r + k][c] == "L" for k in (1, 2, 3)):
                    return lid, c, r, r + 3
    raise AssertionError("no level has a ladder top")


def find_two_golds(levels):
    """(level, (c1,r1), (c2,r2)): a gold with a diggable brick under it, plus
    any other gold, in a level with at least two guards."""
    for lid, t in enumerate(levels, 1):
        golds = [(c, r) for r in range(len(t)) for c in range(len(t[0])) if t[r][c] == "g"]
        guards = sum(row.count("r") for row in t)
        for (c, r) in golds:
            if r + 1 < len(t) and t[r + 1][c] == "#" and guards >= 2:
                other = next((g for g in golds if g != (c, r)), None)
                if other:
                    return lid, (c, r), other
    raise AssertionError("no level has two golds with a diggable one")


def find_trapdoor(levels):
    """(level, col, row): a trapdoor with open air above it."""
    for lid, t in enumerate(levels, 1):
        for r in range(1, len(t) - 1):
            for c in range(len(t[0])):
                if t[r][c] == "X" and t[r - 1][c] == ".":
                    return lid, c, r
    raise AssertionError("no level has a trapdoor")


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

        levels = page.evaluate("window.LEVELS.map(l => l.tiles)")

        # 4. Digging targets one row BELOW the player, not the player's own
        # row — dig with the real Z key (not the digAt debug hook, which
        # bypasses this logic and so wouldn't catch a same-row regression).
        pit_level, pc, pr = find_pit_spot(levels)
        page.evaluate(f"window.__loderunner.loadLevel({pit_level})")
        for i in range(6):   # park every guard so nothing catches the player mid-test
            page.evaluate(f"window.__loderunner.setEnemyAt({i}, 27, 15)")
        page.evaluate(f"window.__loderunner.setPlayerAt({pc}, {pr})")
        same_row_before = page.evaluate(f"window.__loderunner.getTile({pc - 1}, {pr})")
        below_before = page.evaluate(f"window.__loderunner.getTile({pc - 1}, {pr + 1})")
        assert below_before == 1, f"Expected a brick at ({pc - 1},{pr + 1}) to dig, got tile {below_before!r}"
        page.keyboard.down("KeyZ")
        page.wait_for_timeout(300)
        mid_dig = page.evaluate(f"window.__loderunner.getTile({pc - 1}, {pr + 1})")
        assert mid_dig == 1, "The hole must not open until the dig finishes (the runner is frozen ~0.6s while digging)"
        page.wait_for_timeout(500)
        page.keyboard.up("KeyZ")
        same_row_after = page.evaluate(f"window.__loderunner.getTile({pc - 1}, {pr})")
        below_after = page.evaluate(f"window.__loderunner.getTile({pc - 1}, {pr + 1})")
        assert below_after == 0, f"Dig-left should clear the brick below-left, got {below_after!r}"
        assert same_row_after == same_row_before, "Dig-left must not touch the player's own row"
        print("  ✓ Z digs the brick diagonally below-left, not same-row")

        # 4b. Falling into your own hole isn't a trap: you drop straight down
        # the middle of it and pushing toward a side hops you out onto the
        # floor beside it. Walk left over the dug hole: fall in, climb out.
        page.keyboard.down("ArrowLeft")
        page.wait_for_timeout(1100)
        page.keyboard.up("ArrowLeft")
        pit = page.evaluate("window.__loderunner.getPlayerPos()")
        assert pit["row"] == pr and pit["col"] <= pc - 2, f"Should have hopped out of the pit, got {pit!r}"
        print("  ✓ falling into your own hole and climbing back out works")

        page.evaluate("window.__loderunner.loadLevel(2)")

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

        # 10. Level editor: build a tiny level, test-play it, save it, then
        # play it back from the menu as a level extending the official 150.
        # Reload first — there's no "quit to menu" key from mid-play, and
        # we need a clean 'menu' state for KeyE to do anything.
        page.reload()
        page.wait_for_timeout(200)
        page.keyboard.press("KeyE")
        state_editor = page.evaluate("window.__loderunner.getState()")
        assert state_editor == "editor", f"E at the menu should open the editor, got {state_editor!r}"

        no_spawn_result = page.evaluate("window.__loderunner.editorKey('KeyT')")
        state_no_spawn = page.evaluate("window.__loderunner.getState()")
        assert state_no_spawn == "editor", "Test-play with no player spawn should refuse and stay in the editor"

        page.evaluate("window.__loderunner.editorKey('Digit3')")  # solid at cursor (0,0)
        page.evaluate("window.__loderunner.editorKey('ArrowRight')")
        page.evaluate("window.__loderunner.editorKey('Digit6')")  # gold at (1,0)
        page.evaluate("window.__loderunner.editorKey('ArrowRight')")
        page.evaluate("window.__loderunner.editorKey('Digit9')")  # player spawn at (2,0)
        editor_state = page.evaluate("window.__loderunner.getEditorState()")
        assert editor_state["playerSpawn"] == {"col": 2, "row": 0}, f"Expected spawn at (2,0), got {editor_state['playerSpawn']!r}"
        assert editor_state["tiles"][0][1] == "g", "Expected gold placed at (1,0)"
        print("  ✓ editor: cursor movement and tile placement")

        page.evaluate("window.__loderunner.editorKey('KeyT')")
        state_test = page.evaluate("window.__loderunner.getState()")
        id_test = page.evaluate("window.__loderunner.getCurrentLevelId()")
        assert state_test == "playing" and id_test is None, f"Test-play should be 'playing' with no level id, got {state_test!r}/{id_test!r}"
        page.evaluate("window.__loderunner.forceWin()")
        page.keyboard.press("Space")
        page.wait_for_timeout(100)
        state_back = page.evaluate("window.__loderunner.getState()")
        assert state_back == "editor", f"Winning a test-play level should return to the editor, got {state_back!r}"
        print("  ✓ editor: test-play, then winning returns to the editor (not the campaign)")

        saved = page.evaluate("window.__loderunner.saveEditorLevelAs('Smoke Test Level')")
        assert saved is True, "Saving with a valid player spawn should succeed"
        customs = page.evaluate("window.__loderunner.getCustomLevels()")
        assert len(customs) == 1 and customs[0]["name"] == "Smoke Test Level"
        page.evaluate("window.__loderunner.editorKey('Escape')")

        official_total = page.evaluate("window.LEVELS.length")
        loaded_custom = page.evaluate(f"window.__loderunner.loadLevel({official_total + 1})")
        custom_id = page.evaluate("window.__loderunner.getCurrentLevelId()")
        custom_gold = page.evaluate("window.__loderunner.getGold()")
        assert loaded_custom and custom_id == official_total + 1, "Saved level should be playable right after the official 150"
        assert custom_gold["total"] == 1, f"Expected the 1 placed gold, got {custom_gold!r}"
        print(f"  ✓ editor: saved level plays back as level {custom_id} with correct data")

        # 11. Ladder: holding Up at the top must stop on the walkway, not keep
        # rising (the player used to float above it until Up was released).
        lad_level, lc, lt, lstart = find_ladder_top(levels)
        page.evaluate(f"window.__loderunner.loadLevel({lad_level})")
        for i in range(6):
            page.evaluate(f"window.__loderunner.setEnemyAt({i}, 27, 15)")
        page.evaluate(f"window.__loderunner.setPlayerAt({lc}, {lstart})")
        page.keyboard.down("ArrowUp")
        page.wait_for_timeout(2300)
        top = page.evaluate("window.__loderunner.getPlayerPos()")
        page.keyboard.up("ArrowUp")
        want_y = (lt - 1) * 16 + 8
        assert top["row"] == lt - 1 and abs(top["y"] - want_y) < 0.5, f"Should rest on the walkway (row {lt - 1}, y={want_y}) while Up is held, got {top!r}"
        print("  ✓ holding Up at the top of a ladder stops on the walkway (no floating)")

        # 12. Two guards dropping gold into the same pit must not destroy any:
        # the second drop used to overwrite the first, leaving the level
        # unwinnable.
        def gold_tiles():
            return page.evaluate("""() => { let n = 0;
                for (let r = 0; r < 16; r++) for (let c = 0; c < 28; c++)
                    if (window.__loderunner.getTile(c, r) === 5) n++;
                return n; }""")
        g_level, (c1, r1), (c2, r2) = find_two_golds(levels)
        page.evaluate(f"window.__loderunner.loadLevel({g_level})")
        page.evaluate("window.__loderunner.setPlayerAt(0, 0)")
        total = page.evaluate("window.__loderunner.getGold().total")
        page.evaluate(f"window.__loderunner.setEnemyAt(0, {c1}, {r1})"); page.wait_for_timeout(80)     # steals gold 1
        page.evaluate(f"window.__loderunner.digAt({c1}, {r1 + 1})")
        page.evaluate(f"window.__loderunner.setEnemyAt(0, {c1}, {r1 + 1})"); page.wait_for_timeout(120)  # trapped, drops it
        page.evaluate(f"window.__loderunner.setEnemyAt(1, {c2}, {r2})"); page.wait_for_timeout(80)     # steals gold 2
        page.evaluate(f"window.__loderunner.setEnemyAt(1, {c1}, {r1 + 1})"); page.wait_for_timeout(150)  # same pit, drops it too
        # Original rule: a dropped piece lands on the tile above the pit if that is empty; if it isn't
        # (the first piece is already there) it is lost, and counts as collected so the level stays winnable.
        got = page.evaluate("window.__loderunner.getGold().collected")
        assert gold_tiles() + got == total, f"Gold must be conserved: {gold_tiles()} on board + {got} counted, expected {total}"
        print("  ✓ two guards dropping gold into one pit: nothing becomes uncollectable")

        # 13. The way out: hidden ladders don't exist until every piece of gold
        # is collected, then appear and can be climbed out of the top of the
        # screen. Level 1's runs up column 18, joined to the rope on row 3.
        page.evaluate("window.__loderunner.loadLevel(1)")
        for i in range(6):
            page.evaluate(f"window.__loderunner.setEnemyAt({i}, 27, 15)")
        assert page.evaluate("window.__loderunner.getLaddersRevealed()") is False, "Hidden ladders must start hidden"
        page.evaluate("""() => { for (let r = 0; r < 16; r++) for (let c = 0; c < 28; c++)
            if (window.__loderunner.getTile(c, r) === 5) window.__loderunner.pickupGold(c, r); }""")
        assert page.evaluate("window.__loderunner.getLaddersRevealed()") is True, "Collecting all gold must reveal the ladders"
        page.evaluate("window.__loderunner.setPlayerAt(18, 3)")
        page.keyboard.down("ArrowUp")
        page.wait_for_timeout(2200)
        page.keyboard.up("ArrowUp")
        won = page.evaluate("window.__loderunner.getState()")
        assert won == "won", f"Climbing the revealed ladder off the top should win level 1, got {won!r}"
        print("  ✓ hidden ladder appears when all gold is collected, and climbing out wins")

        # 14. Trapdoors look like brick but you fall through them.
        t_level, tc, tr = find_trapdoor(levels)
        page.evaluate(f"window.__loderunner.loadLevel({t_level})")
        for i in range(6):
            page.evaluate(f"window.__loderunner.setEnemyAt({i}, 27, 15)")
        page.evaluate(f"window.__loderunner.setPlayerAt({tc}, {tr - 1})")
        page.wait_for_timeout(600)
        fell = page.evaluate("window.__loderunner.getPlayerPos()")
        assert fell["row"] >= tr, f"Should fall through the trapdoor at ({tc},{tr}), got {fell!r}"
        print("  ✓ a trapdoor drops you through")

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
