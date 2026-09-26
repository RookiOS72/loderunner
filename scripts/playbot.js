/* Play-test bot — runs INSIDE the page against the real game.js.
 *
 * scripts/playtest.py stubs requestAnimationFrame and performance.now, then
 * calls window.__playbot.solve(id, opts) for each level.
 *
 * How it plays:
 *   1. PLAN. Search over (tile, open dug holes) with the same movement rules
 *      the engine uses: walk, ladders, ropes, falling, pit escape, and the
 *      original's dig rule (needs brick diagonally below and an EMPTY,
 *      gold-free tile beside you). Holes carry a timer, so multi-hole
 *      "staircase" digs are found only if they fit inside the refill window.
 *      The nearest gold is the goal; once all gold is in, the goal is the
 *      top row (the hidden ladders are visible by then).
 *   2. EXECUTE. Follow the plan one step at a time by pressing real keys and
 *      stepping the real simulation (__loderunner.tick). If the engine
 *      disagrees with the plan (didn't arrive, hole closed early), re-plan
 *      from wherever the runner actually is.
 *
 * A level that fails is either an engine rule that disagrees with the
 * original, or a level needing a trick the planner can't express — the
 * report says which step failed so it can be checked by hand.
 */
(() => {
  'use strict';
  const L = window.__loderunner;
  const COLS = 28, ROWS = 16;
  const T = { EMPTY: 0, BRICK: 1, SOLID: 2, LADDER: 3, HIDDEN: 4, GOLD: 5, ROPE: 9, TRAP: 10 };
  const DT = 1 / 60;

  // Rough real-time costs (seconds) for the planner's hole timers.
  const COST = { walk: 0.27, climb: 0.27, fall: 0.27, dig: 0.64, escape: 0.3 };
  const HOLE_SAFE_S = 8.9;          // engine refills at 9.6s; keep a margin
  const MAX_NODES = 400000;
const HOLE_GONE_S = 11.7;            // after this a hole is certainly closed
const HOLE_KEEP_DIST = 99;
const MAX_SEG_DIGS = 6;
const DIG_PENALTY = 3;           // search-cost of a dig (in walking-seconds); real time is COST.dig
const H_WEIGHT = 2.5;              // weighted A*: we want a plan, not the cheapest one

  let clock = 0;
  window.__playbotClock = () => clock;

  // ---------------------------------------------------------------- planner
  function makeWorld(grid, rev, digRule) {
    const base = (c, r) => (r < 0 || r >= ROWS || c < 0 || c >= COLS) ? T.SOLID : grid[r][c];
    return { base, rev, digRule };
  }

  // Would the runner stand still at (c, r)? (same test as in successors)
  function standsAt(w, c, r, holes) {
    const isHole = (x, y) => holes.some(h => h[0] === x && h[1] === y);
    const tile = (x, y) => isHole(x, y) ? T.EMPTY : w.base(x, y);
    const solid = (x, y) => { const t = tile(x, y); return t === T.BRICK || t === T.SOLID; };
    const ladder = (x, y) => { const t = tile(x, y); return t === T.LADDER || (t === T.HIDDEN && w.rev); };
    const onLadder = ladder(c, r) || ladder(c, r + 1);
    const holding = tile(c, r) === T.ROPE && !onLadder;
    return onLadder || holding || solid(c, r + 1);
  }

  // holes: array of [x, y, digTime]
  function successors(w, c, r, holes, digsUsed) {
    const isHole = (x, y) => holes.some(h => h[0] === x && h[1] === y);
    const tile = (x, y) => isHole(x, y) ? T.EMPTY : w.base(x, y);
    const solid = (x, y) => { const t = tile(x, y); return t === T.BRICK || t === T.SOLID; };
    const passable = (x, y) => !solid(x, y);
    const ladder = (x, y) => { const t = tile(x, y); return t === T.LADDER || (t === T.HIDDEN && w.rev); };
    const rope = (x, y) => tile(x, y) === T.ROPE;

    const out = [];
    const onLadder = ladder(c, r) || ladder(c, r + 1);
    const holding = rope(c, r) && !onLadder;
    // Relaxed mode: a dug hole is both open AND still a floor, so digging can never take
    // a route away (keeps the closure an over-approximation).
    const bsolid = (x, y) => { const t = w.base(x, y); return t === T.BRICK || t === T.SOLID; };
    const supported = onLadder || holding || (w.relaxed ? bsolid(c, r + 1) : solid(c, r + 1));
    if (w.relaxed && supported && isHole(c, r + 1) && !bsolid(c, r + 1) === false)
      out.push({ kind: 'fall', c, r: r + 1, cost: COST.fall, keys: [] });
    if (!supported) {
      out.push({ kind: 'fall', c, r: r + 1, cost: COST.fall, keys: [] });
      return out;
    }
    for (const d of [-1, 1]) {
      // (a trapdoor is a wall from the side: you only fall through it from above)
      if (c + d >= 0 && c + d < COLS && passable(c + d, r) && tile(c + d, r) !== T.TRAP)
        out.push({ kind: 'walk', c: c + d, r, cost: COST.walk, keys: [d < 0 ? 'ArrowLeft' : 'ArrowRight'] });
    }
    if (isHole(c, r)) {       // engine's pit escape: push to a side, hop onto the floor beside
      for (const d of [-1, 1]) {
        if (solid(c + d, r) && passable(c + d, r - 1) && !solid(c + d, r - 1))
          out.push({ kind: 'escape', c: c + d, r: r - 1, cost: COST.escape, keys: [d < 0 ? 'ArrowLeft' : 'ArrowRight'] });
      }
    }
    if (r > 0 && passable(c, r - 1) && tile(c, r - 1) !== T.TRAP && ladder(c, r))         // going up needs a ladder in your own tile
      out.push({ kind: 'climb', c, r: r - 1, cost: COST.climb, keys: ['ArrowUp'] });
    if (r + 1 < ROWS && onLadder && passable(c, r + 1) && (ladder(c, r) || ladder(c, r + 1)))
      out.push({ kind: 'climb', c, r: r + 1, cost: COST.climb, keys: ['ArrowDown'] });
    if (holding && r + 1 < ROWS && passable(c, r + 1))
      out.push({ kind: 'drop', c, r: r + 1, cost: COST.walk, keys: ['ArrowDown'] });
    // dig (only worth exploring while few holes are open)
    if (w.noCap || (holes.length < 5 && (digsUsed || 0) < (w.maxDigs === undefined ? 99 : w.maxDigs))) {
      for (const d of [-1, 1]) {
        const dc = c + d;
        if (dc < 0 || dc >= COLS || r + 1 >= ROWS) continue;
        if (tile(dc, r + 1) !== T.BRICK) continue;
        // Staircase digs are local: a second dig in the same stretch must be next to a hole that is already open.
        if (!w.noCap && holes.length && !holes.some(hh => Math.abs(hh[0] - dc) + Math.abs(hh[1] - (r + 1)) <= 3)) continue;
        const side = tile(dc, r);
        // Original (ok2Dig in the reference port): the side tile's ACT must be empty and it must not
        // hold gold. Guard spawn markers are empty once the guard leaves; a hidden ladder is empty
        // until it appears.
        // (Relaxed mode assumes gold beside the dig spot has been collected already.)
        const emptyAct = side === T.EMPTY || side === 7 || side === 8 || (side === T.HIDDEN && !w.rev) || (w.relaxed && side === T.GOLD);
        if (w.digRule === 'strict' ? !emptyAct : w.digRule === 'passable' ? !passable(dc, r) : false) continue;
        out.push({ kind: 'dig', c, r, dig: [dc, r + 1], dir: d, cost: COST.dig, keys: [d < 0 ? 'KeyZ' : 'KeyX'] });
      }
    }
    return out;
  }

  // Uniform-cost search from `start`. mode 'gold': records the cheapest segment to every
  // reachable gold tile (gold tiles are terminal — a route through one is two segments).
  // mode 'exit': stops at the first top-row tile. Holes start as `holes0` (real ones on the first call).
  function search(grid, rev, start, mode, strict, holes0, cap, maxDigs) {
    const w = makeWorld(grid, rev, strict);
    w.maxDigs = maxDigs;
    const keyOf = (c, r, holes) => c + ',' + r + '|' + holes.map(h => h[0] + ',' + h[1]).sort().join(';');
    const heap = [];
    const push = (n) => { heap.push(n); let i = heap.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (heap[q].f <= heap[i].f) break; [heap[q], heap[i]] = [heap[i], heap[q]]; i = q; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let m = i; const a = 2 * i + 1, b = a + 1; if (a < heap.length && heap[a].f < heap[m].f) m = a; if (b < heap.length && heap[b].f < heap[m].f) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const stepsOf = (n) => { const st = []; for (let m = n; m.prev; m = m.prev) st.push(m.step); return st.reverse(); };
    // g = search cost (a dig costs extra so plans with fewer digs come first);
    // t = real elapsed seconds (drives the hole timers).
    const h = mode === 'exit' ? ((c, r) => r * COST.walk) : (() => 0);
    const hw = mode === 'exit' ? 1.5 : 0;

    const seen = new Map(), found = new Map(), reach = new Set([start.row * COLS + start.col]);
    push({ c: start.col, r: start.row, holes: holes0, t: 0, g: 0, f: 0, digs: 0, prev: null, step: null });
    seen.set(keyOf(start.col, start.row, holes0), 0);
    let nodes = 0;
    while (heap.length && nodes++ < cap) {
      const n = pop();
      // Gold is only picked up near the middle of its tile, so it counts when you arrive on it
      // falling or climbing straight (you pass through the middle), or when you can stand there.
      // Walking into a gold tile that has no floor drops you through it off-centre: no pickup.
      const isG = n.prev !== null && (mode === 'exit' ? n.r === 0
        : w.base(n.c, n.r) === T.GOLD && (n.step.kind === 'fall' || n.step.kind === 'drop' || n.step.kind === 'climb' || standsAt(w, n.c, n.r, n.holes)));
      if (isG) {
        if (mode === 'exit') return { found: new Map([['exit', { t: n.t, steps: stepsOf(n), c: n.c, r: n.r }]]), reach, capped: false };
        // Keep the cheapest way to each gold PER end-state of open holes: which holes are still
        // open when you get the gold decides whether you can get back out (e.g. a room you
        // dropped into through the ceiling).
        const k = n.r * COLS + n.c + '|' + n.holes.map(hh => hh[0] + ',' + hh[1]).sort().join(';');
        if (!found.has(k)) found.set(k, { t: n.g, real: n.t, holes: n.holes, steps: stepsOf(n), c: n.c, r: n.r });
        continue;                                    // terminal
      }
      // A hole is usable for HOLE_SAFE_S; between then and HOLE_GONE_S it may or may not have closed
      // (planned time is only approximate), so keep off it and off the tile above it.
      const live = n.holes.filter(hh => n.t - hh[2] < HOLE_SAFE_S);
      const ghosts = n.holes.filter(hh => n.t - hh[2] >= HOLE_SAFE_S && n.t - hh[2] < HOLE_GONE_S);
      if (ghosts.some(hh => hh[0] === n.c && (hh[1] === n.r || hh[1] === n.r + 1))) continue;
      for (const s of successors(w, n.c, n.r, live, n.digs)) {
        if (ghosts.some(hh => hh[0] === s.c && (hh[1] === s.r || hh[1] === s.r + 1))) continue;
        const t = n.t + s.cost;
        const g = n.g + s.cost + (s.kind === 'dig' ? DIG_PENALTY : 0);
        let holes = (s.kind === 'dig' ? [...live, [s.dig[0], s.dig[1], n.t]] : live).concat(ghosts.filter(hh => hh[2] + HOLE_GONE_S > t));
        // Staircase digs are local: once the runner is well away from a hole, forget it
        // (keeps the state space from exploding into "dig here, walk off, dig there").
        if (s.kind !== 'dig' && s.kind !== 'fall' && holes.length)
          holes = holes.filter(hh => Math.abs(hh[0] - s.c) + Math.abs(hh[1] - s.r) <= HOLE_KEEP_DIST);
        const k = keyOf(s.c, s.r, holes);
        if (seen.has(k) && seen.get(k) <= g) continue;
        seen.set(k, g);
        reach.add(s.r * COLS + s.c);
        push({ c: s.c, r: s.r, holes, t, g, f: g + hw * h(s.c, s.r), digs: n.digs + (s.kind === 'dig' ? 1 : 0), prev: n, step: s });
      }
    }
    return { found, reach, capped: nodes >= cap };
  }

  // Whole-level plan: choose an order for the gold, with backtracking out of dead ends,
  // ending at the top row. Returns a list of segments {steps, c, r} or an error.
  let opts_trace = false;
  function planLevel(grid, gold, p, strict, budget) {
    const total = gold.total;
    let searches = 0, deepest = 0, deepestReach = null, cappedAny = false, deepestPath = [];
    const remainingGold = () => { const g = []; grid.forEach((row, r) => row.forEach((t, c) => { if (t === T.GOLD) g.push(r * COLS + c); })); return g; };

    const g0 = { grid: grid.map(row => row.slice()), left: remainingGold() };
    const memo = new Set();
    const rec = (g, pos, collected, holes0, path = []) => {
      if (searches >= budget) return null;
      const allGold = collected >= total;
      const mkey = pos.col + ',' + pos.row + '|' + g.left.join(',') + '|' + holes0.map(h => h[0] + ',' + h[1]).sort().join(';');
      if (memo.has(mkey)) return null;
      memo.add(mkey);
      // Fewest new digs first: most segments need none or one; staircases need more.
      for (let k = 0; k <= MAX_SEG_DIGS; k++) {
        if (searches >= budget) return null;
        searches++;
        const res = search(g.grid, allGold, pos, allGold ? 'exit' : 'gold', strict, holes0, allGold ? 200000 : 60000, k);
        if (res.capped) cappedAny = true;
        if (collected >= deepest) { deepest = collected; deepestReach = res.reach; deepestPath = path; }
        if (allGold) { const e = res.found.get('exit'); if (e) return [e]; continue; }
        const cands = [...res.found.values()].sort((a, b) => a.t - b.t);
        let tried = 0;
        for (const cnd of cands) {
          const g2 = { grid: g.grid.map(row => row.slice()), left: g.left.filter(x => x !== cnd.r * COLS + cnd.c) };
          g2.grid[cnd.r][cnd.c] = T.EMPTY;
          // Dead-end check (necessary condition): from where this leaves us, with holes permanent and
          // no timing, can every remaining gold and the exit still be reached?
          const pos2 = { col: cnd.c, row: cnd.r };
          // Holes still open at the end of this segment carry into the next one (with their ages).
          const carry = (cnd.holes || []).filter(hh => cnd.real - hh[2] < HOLE_SAFE_S).map(hh => [hh[0], hh[1], hh[2] - cnd.real]);
          const ra = relaxed(g2.grid, false, pos2, strict, carry);
          if (g2.left.some(kk => !ra.pick.has(kk))) continue;
          const rb = relaxed(g2.grid, true, pos2, strict, carry);
          let exitOk = false;
          for (let c = 0; c < COLS; c++) if (rb.reach.has(c)) exitOk = true;
          if (!exitOk) continue;
          if (++tried > 4) break;
          const tail = rec(g2, pos2, collected + 1, carry, [...path, cnd]);
          if (tail) return [cnd, ...tail];
          if (searches >= budget) return null;
        }
        if (cands.length && k >= 1 && collected + 1 >= total) continue;
      }
      return null;
    };
    const first = L.getHoles().map(h => [h.col, h.row, (h.refillAt - clock) / 1000 - 9.6]);
    const segs = rec(g0, p, gold.collected, first);
    if (segs) return { segs };
    return {
      error: (gold.collected >= total ? 'exit unreachable' : 'no route collects all gold and reaches the exit')
        + ' from ' + p.col + ',' + p.row + ' (best: ' + deepest + '/' + total + ' gold' + (searches >= budget ? ', search budget hit' : '') + (cappedAny ? ', node cap hit' : '') + ')'
        + (opts_trace ? ' PATH: ' + deepestPath.map(c => '[' + c.c + ',' + c.r + ' t=' + c.real.toFixed(1) + ' holes=' + c.holes.map(h => h[0] + ',' + h[1] + '@' + h[2].toFixed(1)).join(';') + ' ' + c.steps.map(x => x.kind[0] + x.c + ',' + x.r + (x.dig ? '(' + x.dig + ')' : '')).join(' ') + ']').join(' ') : ''),
      reach: deepestReach,
    };
  }

  // Relaxed reachability: pretend every hole you can dig stays open forever and nothing
  // ever times out. This OVER-approximates what a player can do, so any gold (or the exit)
  // that is unreachable even here is unreachable in the game — no false alarms from the
  // planner's limits. Reachable here does not prove winnable; the bot does that.
  function relaxed(grid, rev, start, strict, dug0) {
    const w = makeWorld(grid, rev, strict);
    w.noCap = true; w.relaxed = true;
    const dug = (dug0 || []).map(h => [h[0], h[1], 0]);
    const key = (x, y) => y * COLS + x;
    let reach, pick;
    for (;;) {
      reach = new Map([[key(start.col, start.row), true]]);
      pick = new Set();                                 // gold tiles that can actually be picked up
      const q = [[start.col, start.row]];
      while (q.length) {
        const [c, r] = q.pop();
        for (const s of successors(w, c, r, dug)) {
          if (s.kind === 'dig') continue;
          const k = key(s.c, s.r);
          if (w.base(s.c, s.r) === T.GOLD && (s.kind === 'fall' || s.kind === 'drop' || s.kind === 'climb' || standsAt(w, s.c, s.r, []) || standsAt(w, s.c, s.r, dug)))
            pick.add(k);
          if (!reach.has(k)) { reach.set(k, true); q.push([s.c, s.r]); }
        }
      }
      let added = false;
      for (const k of reach.keys()) {
        const c = k % COLS, r = (k / COLS) | 0;
        for (const s of successors(w, c, r, dug)) {
          if (s.kind !== 'dig') continue;
          if (!dug.some(h => h[0] === s.dig[0] && h[1] === s.dig[1])) { dug.push([s.dig[0], s.dig[1], 0]); added = true; }
        }
      }
      if (!added) break;
    }
    return { reach, dug, pick };
  }

  function staticCheck(id, opts = {}) {
    L.loadLevel(id);
    const strict = opts.digRule || 'strict';
    const grid = L.getGrid(), p = L.getPlayerPos(), gold = L.getGold();
    const res = { id, ok: true, reason: '' };
    // Gold: closure without hidden ladders (they only appear once all gold is in).
    const a = relaxed(grid, false, p, strict);
    const missing = [];
    grid.forEach((row, r) => row.forEach((t, c) => {
      if (t === T.GOLD && !a.pick.has(r * COLS + c) && !(c === p.col && r === p.row)) missing.push(c + ',' + r);
    }));
    if (missing.length) { res.ok = false; res.reason = 'gold unreachable even with permanent holes: ' + missing.join(' '); res.map = ascii(grid, new Set(a.reach.keys())); }
    // Exit: closure with hidden ladders revealed.
    const b = relaxed(grid, true, p, strict);
    let exit = false;
    for (let c = 0; c < COLS; c++) if (b.reach.has(c)) exit = true;
    if (!exit) { res.ok = false; res.reason += (res.reason ? ' | ' : '') + 'top row unreachable even with ladders revealed'; res.map = res.map || ascii(grid, new Set(b.reach.keys())); }
    res.gold = gold.total; res.digs = a.dug.length;
    return res;
  }

  function ascii(grid, reach) {
    return grid.map((row, r) => row.map((t, c) => {
      const b = { 0: '.', 1: '#', 2: '|', 3: 'L', 4: 'S', 5: 'g', 7: 'r', 8: 'R', 9: '~', 10: 'X' }[t] || '?';
      return reach && reach.has(r * COLS + c) ? (b === '.' ? '*' : b === '#' ? '%' : b) : b;
    }).join('')).join('\n');
  }

  // --------------------------------------------------------------- executor
  function runTicks(keys, ms) {
    L.setKeys(keys);
    const n = Math.max(1, Math.round(ms / 1000 / DT));
    for (let i = 0; i < n; i++) {
      L.tick(DT); clock += DT * 1000;
      if (L.getState() !== 'playing') return;
    }
  }

  function execute(steps, log) {
    for (const s of steps) {
      let waited = 0;
      const limit = s.kind === 'dig' ? 1.0 : 4.0;
      for (;;) {
        if (L.getState() !== 'playing') return 'over';
        const p = L.getPlayerPos();
        if (s.kind === 'dig') {
          if (L.getHoles().some(h => h.col === s.dig[0] && h.row === s.dig[1])) break;
          if (p.col !== s.c || p.row !== s.r) return 'off-plan at dig, at ' + p.col + ',' + p.row + ' wanted ' + s.c + ',' + s.r;
        } else if (p.col === s.c && p.row === s.r) {
          break;
        }
        runTicks(s.keys, 1000 * DT);
        waited += DT;
        if (waited > limit) return 'step timed out: ' + s.kind + ' -> ' + s.c + ',' + s.r + ' (at ' + p.col + ',' + p.row + ')';
      }
      log.steps++;
    }
    return null;
  }

  function solve(id, opts = {}) {
    const strict = opts.digRule || 'strict';
    opts_trace = !!opts.trace;
    L.loadLevel(id);
    if (!opts.guards) L.clearEnemies();
    const t0 = clock, maxS = opts.maxSeconds || 240;
    const log = { id, ok: false, reason: '', seconds: 0, gold: null, steps: 0, replans: 0 };
    let lastFail = null, sameFail = 0;

    while ((clock - t0) / 1000 < maxS) {
      const st = L.getState();
      if (st === 'won') { log.ok = true; break; }
      if (st === 'lost') { log.reason = 'died'; break; }
      // Let leftover holes close so the plan's "all holes closed between segments" holds
      // (unless we're standing in one — then plan from inside it).
      const grid = L.getGrid();
      const p = L.getPlayerPos();
      const inHole = L.getHoles().some(h => h.col === p.col && h.row === p.row);
      const pl = planLevel(grid, L.getGold(), p, strict, opts.budget || 150);
      if (pl.error) { log.reason = pl.error; log.map = ascii(grid, pl.reach); break; }
      if (opts.trace) (log.trace = log.trace || []).push('t=' + Math.round((clock - t0) / 100) / 10 + ' at ' + p.col + ',' + p.row + ' order: ' + pl.segs.map(x => (x.r === 0 && x === pl.segs[pl.segs.length - 1] ? 'EXIT@' : '') + x.c + ',' + x.r + '[' + x.steps.map(y => y.kind[0] + y.c + ',' + y.r + (y.dig ? '(dig ' + y.dig + ')' : '')).join(' ') + ']').join('  '));
      let fail = null;
      for (const seg of pl.segs) {
        const before = L.getGold().collected;
        fail = execute(seg.steps, log);
        if (fail) break;
        if (L.getState() !== 'playing') break;
        // The engine (like the original) only picks gold up near the middle of the tile:
        // keep nudging in the last direction until it is actually in the bag.
        if (seg !== pl.segs[pl.segs.length - 1]) {
          const last = seg.steps[seg.steps.length - 1];
          for (let i = 0; i < 30 && L.getGold().collected === before && L.getState() === 'playing'; i++) runTicks(last.kind === 'dig' ? [] : last.keys, 1000 * DT);
          if (L.getGold().collected === before && L.getState() === 'playing') { fail = 'gold not picked up at ' + seg.c + ',' + seg.r; break; }
        }
      }
      log.replans++;
      if (opts.trace && fail) (log.trace = log.trace || []).push('   FAIL: ' + fail + ' at t=' + Math.round((clock - t0) / 100) / 10 + ' pos=' + JSON.stringify(L.getPlayerPos()) + ' holes=' + JSON.stringify(L.getHoles()) + ' dbg=' + JSON.stringify(L.getPlayerDebug()));
      if (fail === 'over') continue;
      if (fail) {
        if (fail === lastFail) sameFail++; else { lastFail = fail; sameFail = 0; }
        if (sameFail >= 3) { log.reason = 'executor: ' + fail; break; }
        runTicks([], 100);
      }
    }
    L.setKeys([]);
    log.gold = L.getGold();
    log.seconds = Math.round((clock - t0) / 100) / 10;
    if (!log.ok) {
      const g = L.getGrid(), left = [];
      g.forEach((row, r) => row.forEach((t, c) => { if (t === T.GOLD) left.push(c + ',' + r); }));
      const pp = L.getPlayerPos();
      log.at = pp.col + ',' + pp.row;
      if (!log.reason) log.reason = 'timeout';
      log.reason += ' | gold left: ' + (left.join(' ') || 'none (a guard holds it)') + ' | player ' + log.at;
    }
    return log;
  }

  // Debug helper: run one gold search from a position on a level and describe what it finds.
  function debugSearch(id, col, row, opts = {}) {
    L.loadLevel(id);
    const grid = L.getGrid(), p = col === undefined ? L.getPlayerPos() : { col, row };
    for (const [cc, rr] of (opts.clear || [])) grid[rr][cc] = T.EMPTY;
    const rev = !!opts.rev;
    const res = search(grid, rev, p, opts.exit ? 'exit' : 'gold', opts.digRule || 'strict', opts.holes || [], opts.cap || 60000, opts.maxDigs);
    return { capped: res.capped, found: [...res.found.values()].map(f => ({ at: f.c + ',' + f.r, cost: Math.round(f.t * 10) / 10, real: Math.round(f.real * 10) / 10, digs: f.steps.filter(x => x.kind === 'dig').length, holes: f.holes.length, steps: f.steps.map(x => x.kind[0] + x.c + ',' + x.r + (x.dig ? '(' + x.dig + ')' : '')).join(' ') })) };
  }
  window.__playbot = { solve, staticCheck, debugSearch };
})();
