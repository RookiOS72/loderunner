#!/usr/bin/env python3
"""Differential test: run identical key sequences (no guards) in our game and in
the reference port of the 1983 game, and report where the runner's path diverges.

The reference is SimonHung/LodeRunner_TotalRecall, which we don't vendor (no
licence). Clone it anywhere and pass --ref:

  git clone --depth 1 https://github.com/SimonHung/LodeRunner_TotalRecall /tmp/tr
  .venv/bin/python scripts/conform.py --ref /tmp/tr                # random keys, a few levels
  .venv/bin/python scripts/conform.py --ref /tmp/tr --levels 1 37 --runs 20 --seed 3

One reference tick = 53.33ms of our time (the runner needs 5 ticks per tile).
"""
import argparse, http.server, random, socketserver, sys, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
TICK = 0.053333

def serve(directory):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(s, *a, **k): super().__init__(*a, directory=str(directory), **k)
        def log_message(s, *a): pass
    srv = socketserver.TCPServer(('127.0.0.1', 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

REF_KEYS = {'L': 'ACT_LEFT', 'R': 'ACT_RIGHT', 'U': 'ACT_UP', 'D': 'ACT_DOWN', 'S': 'ACT_STOP', 'Z': 'ACT_DIG_LEFT', 'X': 'ACT_DIG_RIGHT'}
OUR_KEYS = {'L': ['ArrowLeft'], 'R': ['ArrowRight'], 'U': ['ArrowUp'], 'D': ['ArrowDown'], 'S': [], 'Z': ['KeyZ'], 'X': ['KeyX']}

def script(rng, n_ticks):
    out = []
    while len(out) < n_ticks:
        k = rng.choice('LLLRRRUUDDSZX')
        out += [k] * rng.randint(3, 40)
    return out[:n_ticks]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ref', required=True)
    ap.add_argument('--levels', nargs='*', type=int, default=[1, 2, 3, 4, 5])
    ap.add_argument('--runs', type=int, default=10)
    ap.add_argument('--tol', type=int, default=3, help='ticks of phase slack (both engines are discrete)')
    ap.add_argument('--dump', action='store_true', help='print sub-tile positions for the first tick range of each run')
    ap.add_argument('--first-run', type=int, default=0)
    ap.add_argument('--ticks', type=int, default=600)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--context', type=int, default=6, help='ticks of context to print before a divergence')
    a = ap.parse_args()
    rs, os_ = serve(a.ref), serve(ROOT)
    total = bad = 0
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        ref = b.new_page(); ref.goto(f'http://127.0.0.1:{rs.server_address[1]}/lodeRunner.html'); time.sleep(5)
        ref.evaluate('stopPlayTicker()')
        our = b.new_page()
        our.add_init_script("window.__t=0; performance.now=()=>window.__t; window.requestAnimationFrame=()=>0")
        our.goto(f'http://127.0.0.1:{os_.server_address[1]}/index.html')
        for lvl in a.levels:
            for run in range(a.first_run, a.first_run + a.runs):
                keys = script(random.Random(f'{a.seed}-{lvl}-{run}'), a.ticks)
                ref.evaluate("""([lvl])=>{ stopPlayTicker(); levelData=playVersionInfo[0].verData; playMode=PLAY_TEST; recordMode=0;
                    curLevel=lvl; curAiVersion=4; godMode=0; const m=levelData[lvl-1].replace(/0/g,' '); testLevelInfo={levelMap:m};
                    curScore=0; runnerLife=1; showLevel(m); gameState=GAME_RUNNING; changingLevel=0; keyAction=ACT_STOP;
                    goldComplete=goldCount<=0?1:0; if(goldCount<=0) showHideLaddr(); }""", [lvl])
                our.evaluate("([l])=>{ window.__t=0; const L=window.__loderunner; L.loadLevel(l); L.clearEnemies(); L.setPitEscape(false); }", [lvl])
                rp = ref.evaluate("""([keys, map])=>{ const out=[]; for(const k of keys){ keyAction = window[map[k]]; playGame(0.05);
                    out.push([runner.pos.x, runner.pos.y, goldCount, runner.pos.xOffset, runner.pos.yOffset]); } return out; }""", [keys, REF_KEYS])
                op = our.evaluate("""([keys, map, tick])=>{ const L=window.__loderunner; const out=[];
                    for(const k of keys){ L.setKeys(map[k]); L.tick(tick); window.__t += tick*1000; const p=L.getPlayerPos(); out.push([p.col,p.row,L.getGold().total-L.getGold().collected, Math.round((p.x-p.col*16-8)*2.5*10)/10, Math.round((p.y-p.row*16-8)*2.75*10)/10]); } return out; }""", [keys, OUR_KEYS, TICK])
                # Compare WHERE the runner went, not exact timing: both engines are discrete and
                # differ by a tick here and there (stopping phase, landing), which accumulates over a
                # run without being a mechanic. A tile visited by one engine that the other never got
                # within one tile of means a real difference (a wall, a fall, a ladder, a dug hole).
                def tiles(pts): return {tuple(p[:2]) for p in pts}
                def near(t, S): return any(abs(t[0] - u[0]) <= 1 and abs(t[1] - u[1]) <= 1 for u in S)
                tr, to = tiles(rp), tiles(op)
                only_ref = sorted(t for t in tr if not near(t, to))
                only_our = sorted(t for t in to if not near(t, tr))
                total += 1
                if only_ref or only_our:
                    bad += 1
                    t_first = min([next(i for i, p in enumerate(rp) if tuple(p[:2]) == t) for t in only_ref] +
                                  [next(i for i, p in enumerate(op) if tuple(p[:2]) == t) for t in only_our])
                    print(f"L{lvl} run {run}: only ref reached {only_ref[:4]}, only ours reached {only_our[:4]} (first around tick {t_first})")
                    for i in range(max(0, t_first - a.context), min(len(keys), t_first + 4)):
                        print(f"   t{i:<4} key {keys[i]}  ref {rp[i][:2]} off({rp[i][3]},{rp[i][4]})  ours {op[i][:2]} off({op[i][3]},{op[i][4]})")
        b.close()
    print(f"\n{total - bad}/{total} runs matched the reference (same places visited) over {a.ticks} ticks")
    sys.exit(1 if bad else 0)

main()
