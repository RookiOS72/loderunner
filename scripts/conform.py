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
SEED_JS = "window.__seed=(n)=>{let a=n>>>0;Math.random=()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};};"

def serve(directory):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(s, *a, **k): super().__init__(*a, directory=str(directory), **k)
        def log_message(s, *a): pass
    srv = socketserver.TCPServer(('127.0.0.1', 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

REF_KEYS = {'L': 'ACT_LEFT', 'R': 'ACT_RIGHT', 'U': 'ACT_UP', 'D': 'ACT_DOWN', 'S': 'ACT_STOP', 'Z': 'ACT_DIG_LEFT', 'X': 'ACT_DIG_RIGHT'}
OUR_KEYS = {'L': ['ArrowLeft'], 'R': ['ArrowRight'], 'U': ['ArrowUp'], 'D': ['ArrowDown'], 'S': [], 'Z': ['KeyZ'], 'X': ['KeyX']}

def script(rng, n_ticks, heavy=False):
    out = []
    pool = 'LLRRUDSZXZXZX' if heavy else 'LLLRRRUUDDSZX'
    while len(out) < n_ticks:
        k = rng.choice(pool)
        out += [k] * rng.randint(3, 40)
    return out[:n_ticks]

def guard_run(ref, our, a, lvl, run, keys):
    """Same runner keys in both; compare each guard's path. Stops at the first death of the runner."""
    ref.evaluate("""([lvl, seed])=>{ stopPlayTicker(); levelData=playVersionInfo[0].verData; playMode=PLAY_TEST; recordMode=0;
        curLevel=lvl; curAiVersion=4; godMode=0; const m=levelData[lvl-1]; testLevelInfo={levelMap:m};
        curScore=0; runnerLife=1; window.__seed(seed); showLevel(m); gameState=GAME_RUNNING; changingLevel=0; keyAction=ACT_STOP;
        goldComplete=goldCount<=0?1:0; if(goldCount<=0) showHideLaddr(); }""", [lvl, run + 1])
    our.evaluate("([l, seed])=>{ window.__t=0; window.__seed(seed); const L=window.__loderunner; L.loadLevel(l); L.setPitEscape(false); }", [lvl, run + 1])
    rp = ref.evaluate("""([keys, map])=>{ const out=[]; for(const k of keys){ keyAction = window[map[k]]; playGame(0.05);
        out.push({dead: gameState!==GAME_RUNNING, r:[runner.pos.x,runner.pos.y], g: guard.map(q=>[q.pos.x,q.pos.y,q.action===ACT_REBORN?1:0, q.action===ACT_IN_HOLE?1:q.action===ACT_CLIMB_OUT?2:0])}); if(gameState!==GAME_RUNNING) break; } return out; }""", [keys, REF_KEYS])
    op = our.evaluate("""([keys, map, tick])=>{ const L=window.__loderunner; const out=[];
        for(const k of keys){ L.setKeys(map[k]); L.tick(tick); window.__t += tick*1000; const p=L.getPlayerPos();
            out.push({dead: L.getState()!=='playing', r:[p.col,p.row], g: L.getEnemyPositions().map(q=>[q.col,q.row,q.act==='reborn'?1:0, q.act==='inhole'?1:q.act==='climbout'?2:0])}); if(L.getState()!=='playing') break; } return out; }""", [keys, OUR_KEYS, TICK])
    n = min(len(rp), len(op))
    ng_r = len(rp[0]['g']) if rp else 0
    ng_o = len(op[0]['g']) if op else 0
    if ng_r != ng_o:
        print(f"L{lvl} run {run}: guard count differs: ref {ng_r} ours {ng_o}")
        return 1
    problems = []
    for gi in range(ng_r):
        # A guard that dies comes back at a random spot in both engines; stop comparing it there.
        n0 = n
        n = next((i for i in range(n0) if rp[i]['g'][gi][2] or op[i]['g'][gi][2]), n0)
        tr = {tuple(f['g'][gi][:2]) for f in rp[:n]}
        to = {tuple(f['g'][gi][:2]) for f in op[:n]}
        def near(t, S): return any(abs(t[0]-u[0]) <= 1 and abs(t[1]-u[1]) <= 1 for u in S)
        onlyr = sorted(t for t in tr if not near(t, to)); onlyo = sorted(t for t in to if not near(t, tr))
        if onlyr or onlyo:
            first = min([next(i for i in range(n) if tuple(rp[i]['g'][gi][:2]) == t) for t in onlyr] + [next(i for i in range(n) if tuple(op[i]['g'][gi][:2]) == t) for t in onlyo])
            problems.append((gi, onlyr[:3], onlyo[:3], first))
        n = n0
    n = min(len(rp), len(op))
    # Timing: how often is a guard on a different tile than the reference's (within +-4 ticks of slack)?
    for gi in range(ng_r):
        off = sum(1 for i in range(n) if tuple(op[i]['g'][gi][:2]) not in {tuple(rp[j]['g'][gi][:2]) for j in range(max(0, i - 4), min(n, i + 5))})
        if off > 0.08 * n and not problems:
            problems.append((gi, [], [], next(i for i in range(n) if tuple(op[i]['g'][gi][:2]) not in {tuple(rp[j]['g'][gi][:2]) for j in range(max(0, i - 4), min(n, i + 5))})))
            print(f"L{lvl} run {run}: guard {gi} is off the reference's timing on {off}/{n} ticks")
    # Pit episodes: when a guard drops into a pit, how long until it is climbing out, and out?
    def episodes(fr, gi):
        eps, start = [], None
        for i, f in enumerate(fr):
            st = f['g'][gi][3]
            if st and start is None: start = i
            if not st and start is not None: eps.append((start, i - start)); start = None
        return eps
    for gi in range(ng_r):
        er, eo = episodes(rp[:n], gi), episodes(op[:n], gi)
        a.trap_total = getattr(a, 'trap_total', 0) + len(er)
        if len(er) != len(eo) or any(abs(x[1] - y[1]) > 8 for x, y in zip(er, eo)):
            if not problems:
                problems.append((gi, [], [], er[0][0] if er else 0))
                print(f"L{lvl} run {run}: guard {gi} pit episodes differ: ref {er} ours {eo}")
    if problems:
        gi, onlyr, onlyo, first = problems[0]
        print(f"L{lvl} run {run}: guard {gi} differs (of {ng_r}): only ref {onlyr}, only ours {onlyo}; first around tick {first} (compared {n} ticks)")
        for i in range(max(0, first - a.context), min(n, first + 4)):
            print(f"   t{i:<4} key {keys[i]}  runner ref {rp[i]['r']} ours {op[i]['r']}   guard{gi} ref {rp[i]['g'][gi]} ours {op[i]['g'][gi]}")
        return 1
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ref', required=True)
    ap.add_argument('--levels', nargs='*', type=int, default=[1, 2, 3, 4, 5])
    ap.add_argument('--runs', type=int, default=10)
    ap.add_argument('--tol', type=int, default=3, help='ticks of phase slack (both engines are discrete)')
    ap.add_argument('--guards', action='store_true', help='leave the guards in and compare THEIR paths (runner keys are random)')
    ap.add_argument('--dig-heavy', action='store_true', help='more Z/X in the random keys, to trap guards')
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
        ref.add_script_tag(content=SEED_JS)
        ref.evaluate('stopPlayTicker()')
        our = b.new_page()
        our.add_init_script(SEED_JS + "window.__t=0; performance.now=()=>window.__t; window.requestAnimationFrame=()=>0")
        our.goto(f'http://127.0.0.1:{os_.server_address[1]}/index.html')
        for lvl in a.levels:
            for run in range(a.first_run, a.first_run + a.runs):
                keys = script(random.Random(f'{a.seed}-{lvl}-{run}'), a.ticks, a.dig_heavy)
                if a.guards:
                    bad += guard_run(ref, our, a, lvl, run, keys)
                    total += 1
                    continue
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
    if a.guards: print(f"({getattr(a, 'trap_total', 0)} pit episodes compared)")
    print(f"\n{total - bad}/{total} runs matched the reference (same places visited) over {a.ticks} ticks")
    sys.exit(1 if bad else 0)

main()
