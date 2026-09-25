#!/usr/bin/env python3
"""Play-test every level with a bot driving the real game.js.

Headless, virtual clock, no drawing. See scripts/playbot.js for how the bot plays.

  .venv/bin/python scripts/playtest.py                 # all 150, no guards (slow, see below)
  .venv/bin/python scripts/playtest.py 1 27 105        # just these levels
  .venv/bin/python scripts/playtest.py --guards        # guards live (bot doesn't dodge; informational)
  .venv/bin/python scripts/playtest.py --dig-rule any  # plan with a looser dig rule than the original's (for comparison)

  .venv/bin/python scripts/playtest.py --static        # necessary condition only, ~2s for all 150
  .venv/bin/python scripts/playtest.py --budget 600 --seconds 400 12 34   # give hard levels more search

The bot is slow on levels that need a lot of digging (its search is exponential in the worst case), so
for the whole set run shards in parallel, e.g. one process per (level % 12), and merge the --json files.

Exit status is non-zero if any level fails.
"""
import argparse, http.server, json, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

INIT = """
(() => {
  let vt = 0;
  performance.now = () => window.__playbotClock ? window.__playbotClock() : vt;
  window.requestAnimationFrame = () => 0;   // the bot steps the sim itself
})();
"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('levels', nargs='*', type=int)
    ap.add_argument('--guards', action='store_true')
    ap.add_argument('--dig-rule', default='strict', choices=['strict', 'passable', 'any'], help="strict = original (side tile must be empty); passable; any = the engine's current rule (no side check)")
    ap.add_argument('--seconds', type=int, default=240)
    ap.add_argument('--budget', type=int, default=150, help='max gold-order searches per level before giving up')
    ap.add_argument('--map', action='store_true', help='print reachable-tile map for failures (* = reachable)')
    ap.add_argument('--static', action='store_true', help='fast necessary-condition check only (holes permanent, no timing)')
    ap.add_argument('--trace', action='store_true')
    ap.add_argument('--json', help='write results here')
    a = ap.parse_args()

    class handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *x, **k): super().__init__(*x, directory=str(ROOT), **k)
        def log_message(self, *x): pass
    srv = socketserver.TCPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{srv.server_address[1]}/index.html'

    results = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        page = b.new_page()
        page.add_init_script(INIT)
        page.on('pageerror', lambda e: print('PAGE ERROR', e))
        page.goto(url)
        page.add_script_tag(path=str(ROOT / 'scripts' / 'playbot.js'))
        n = page.evaluate('window.LEVELS.length')
        ids = a.levels or list(range(1, n + 1))
        for i in ids:
            if a.static:
                r = page.evaluate('([id, o]) => window.__playbot.staticCheck(id, o)', [i, {'digRule': a.dig_rule}])
                r.setdefault('seconds', 0); r['gold'] = {'collected': 0, 'total': r.get('gold', 0)}
                results.append(r)
                print(f"{'ok  ' if r['ok'] else 'FAIL'} L{i:<3} gold {r['gold']['total']:>2}  {r['reason']}", flush=True)
                if a.map and r.get('map'): print(r['map'])
                continue
            r = page.evaluate('([id, o]) => window.__playbot.solve(id, o)',
                              [i, {'guards': a.guards, 'maxSeconds': a.seconds, 'digRule': a.dig_rule, 'trace': a.trace, 'budget': a.budget}])
            results.append(r)
            if a.map and r.get('map'): print(r['map'])
            if a.trace: print('\n'.join(r.get('trace', [])))
            print(f"{'ok  ' if r['ok'] else 'FAIL'} L{i:<3} {r['seconds']:>6}s  gold {r['gold']['collected']}/{r['gold']['total']}  {r['reason']}", flush=True)
        b.close()
    srv.shutdown()

    bad = [r for r in results if not r['ok']]
    print(f"\n{len(results) - len(bad)}/{len(results)} levels cleared")
    if bad:
        print('failed:', ' '.join(str(r['id']) for r in bad))
    if a.json:
        Path(a.json).write_text(json.dumps(results, indent=1))
    sys.exit(1 if bad else 0)

main()
