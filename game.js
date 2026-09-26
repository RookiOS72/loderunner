/* Lode Runner — in-browser port by Rook.

See README.md for version history. Levels are the 150 originals,
vendored in levels.js — there's no hand-crafted level in this file
anymore (removed in v0.3.6; see the README for what it used to be).
*/

(() => {
  'use strict';

  // ---------------- Constants ----------------
  const TILE = 16;
  const COLS = 28;   // the Apple II original's 28x16 board
  const ROWS = 16;
  const CANVAS_W = COLS * TILE;
  const CANVAS_H = ROWS * TILE;

  const T_EMPTY       = 0;
  const T_BRICK       = 1;
  const T_SOLID       = 2;
  const T_LADDER      = 3;
  const T_FREE_LADDER = 4;
  const T_GOLD        = 5;
  const T_RUNNER_SPAWN  = 7;
  const T_GRUNTER_SPAWN = 8;
  const T_ROPE          = 9;
  const T_TRAP          = 10; // looks like brick, but you fall through it

  const PLAYER_SPEED       = 60; // px/s — 2x enemies (RUNNER=35, GRUNTER=25)
  // Vertical speeds are the original's: climbing and falling both move a tile
  // in ~4.9 ticks (yMove 9 of a 44px tile) against 5 ticks for a horizontal
  // tile, i.e. ~61px/s when running is 60px/s. (Falling used to be 200px/s.)
  const PLAYER_CLIMB_SPEED = 61;
  const PLAYER_FALL_SPEED  = 61;
  // Digging freezes the runner for 11 ticks (0.59s at our scale); the hole
  // opens when that finishes.
  const DIG_TIME_MS        = 587;


  // A dug hole closes back up into a brick after this long. Anyone still
  // standing in it when it closes dies. Timings are the original's,
  // measured against the runner: in the reference port of the Apple II game
  // (SimonHung/LodeRunner_TotalRecall) a hole stays open 166 ticks and takes
  // 20 more to fill, while the runner needs 5 ticks per tile. That is about
  // 37 tiles of running; at our runner speed (3.75 tiles/s) it is ~9.9s.
  // (This was 4s until the play test showed levels like 16, which need you
  // to drop into a room, grab six gold and climb back out, were unwinnable.)
  // Guards climb out on their own after 51 ticks + shaking + climbing out
  // (~3.8s at our scale), matching "guards can climb out of pits that do not
  // close up around them"; the player can hop out at will by pushing toward
  // a side (see the pit-escape block in updatePlayer).
  const HOLE_REFILL_MS   = 9900;

  // Deliberate softening of the original (see updatePlayer): the runner may hop out of a pit.
  let pitEscape = true;

  // ---------------- Level ----------------
  // '.' empty  '#' brick  '|' solid  'L' ladder
  // 'S' hidden ladder (invisible until all gold is collected)  'X' trapdoor
  // 'g' gold  'r' guard  'R' grunter
  // '~' rope (hand-over-hand bar — hold position, no gravity, unless
  //     the player presses Down to let go; see isRopeAt() usage below)
  //
  // Level data lives entirely in levels.js (the 150 vendored levels);
  // see loadLevelById() below. PLAYER_SPAWN is reassigned per-level from
  // that data — this default only matters before any level has loaded.
  let PLAYER_SPAWN = { col: 0, row: 0 };

  // ---------------- State ----------------
  let level = [];
  let enemySpawns = [];
  // 1-based id into window.LEVELS for whichever of the 150 levels is
  // currently loaded. Set the moment any level loads (see boot, below).
  let currentLevelId = null;
  // Which level Space will start from the menu screen — changed with
  // Left/Right while at the menu (see the level-select overlay below).
  let selectedLevel = 1;
  // Currently-open dug holes: { col, row, refillAt }. The tile grid
  // itself just shows T_EMPTY at that spot in the meantime.
  let digHoles = [];
  // True while playing a level straight out of the editor (not yet
  // saved) — winning/losing returns to the editor instead of trying to
  // advance/retry a level id that may not exist.
  let isTestPlay = false;

  // ---------------- Level editor state ----------------
  // '.' empty  '#' brick  '|' solid  'L' ladder  '~' rope  'g' gold
  // 'r' guard spawn  'R' grunter spawn — same char scheme as the vendored
  // levels, one key (1-8) per tile; 0 places a trapdoor ('X') and H a
  // hidden ladder ('S'). '9' places the player
  // spawn, which (like the vendored data) is tracked separately rather
  // than as a grid character.
  const EDITOR_PALETTE = ['.', '#', '|', 'L', '~', 'g', 'r', 'R'];
  let editorTiles = [];       // array of ROWS arrays of COLS chars
  let editorPlayerSpawn = null;
  let editorCursor = { col: 0, row: 0 };

  // ---------------- Progress (localStorage) ----------------
  // The only thing worth remembering across visits: how far you've
  // gotten. Wrapped in try/catch since storage can throw (private
  // browsing, disabled cookies/storage) — losing progress tracking
  // isn't worth crashing the game over.
  const PROGRESS_KEY = 'loderunner_progress';
  let highestCleared = 0;

  function loadProgress() {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Number.isInteger(data.highestCleared)) highestCleared = data.highestCleared;
    } catch (err) {
      // Storage unavailable or corrupt — just start fresh.
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify({ highestCleared }));
    } catch (err) {
      // Storage unavailable — nothing to do, progress just won't persist.
    }
  }

  // ---------------- Custom levels (the level editor's output) ----------------
  // Saved levels extend the same 1-based id space as the 150 official
  // ones (151, 152, ...), so the existing level-select, progression,
  // and win/lose flow all work on them unchanged — see getLevelById().
  const CUSTOM_KEY = 'loderunner_custom_levels';
  let customLevels = [];

  function loadCustomLevels() {
    try {
      const raw = localStorage.getItem(CUSTOM_KEY);
      customLevels = raw ? JSON.parse(raw) : [];
    } catch (err) {
      customLevels = [];
    }
  }

  function saveCustomLevels() {
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(customLevels));
    } catch (err) {
      // Storage unavailable — the level still works for this session,
      // it just won't be there next visit.
    }
  }

  function officialLevelCount() {
    return (typeof window.LEVELS !== 'undefined') ? window.LEVELS.length : 0;
  }

  function totalLevelCount() {
    return officialLevelCount() + customLevels.length;
  }

  // 1-based id -> level object, transparently spanning official + custom.
  function getLevelById(id) {
    const officialTotal = officialLevelCount();
    if (id >= 1 && id <= officialTotal) return window.LEVELS[id - 1];
    const customIndex = id - officialTotal - 1;
    if (customIndex >= 0 && customIndex < customLevels.length) return customLevels[customIndex];
    return null;
  }

  const player = {
    col: 0, row: 0, x: 0, y: 0,
    vx: 0, vy: 0,
    facing: 1,
    onLadder: false,
    isClimbing: false,
    isFalling: false,
    digCooldown: 0,
    alive: true,
    goldCollected: 0,
    goldTotal: 0,
  };

  let enemies = [];

  let gameState = 'menu';
  let lastTime = 0;

  // ---------------- Level utilities ----------------
  function parseLevel(ascii) {
    const lvl = [];
    enemySpawns = [];
    let goldCount = 0;
    for (let row = 0; row < ROWS; row++) {
      const line = ascii[row] || '';
      const rowArr = [];
      for (let col = 0; col < COLS; col++) {
        const ch = line[col] || ' ';
        let t;
        switch (ch) {
          case '.': t = T_EMPTY; break;
          case '#': t = T_BRICK; break;
          case '|': t = T_SOLID; break;
          case 'L': t = T_LADDER; break;
          case 'F': case 'S': t = T_FREE_LADDER; break;   // hidden ladder
          case 'X': t = T_TRAP; break;
          case '~': t = T_ROPE; break;
          case 'g': t = T_GOLD; goldCount++; break;
          case 'r': t = T_RUNNER_SPAWN; enemySpawns.push({ col, row, type: T_RUNNER_SPAWN }); break;
          case 'R': t = T_GRUNTER_SPAWN; enemySpawns.push({ col, row, type: T_GRUNTER_SPAWN }); break;
          default:  t = T_EMPTY;
        }
        rowArr.push(t);
      }
      lvl.push(rowArr);
    }
    player.goldTotal = goldCount;
    return lvl;
  }
  function tileAt(col, row) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return T_SOLID;
    return level[row][col];
  }
  function setTile(col, row, t) {
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return;
    level[row][col] = t;
  }
  function isSolidAt(col, row) {
    const t = tileAt(col, row);
    return t === T_BRICK || t === T_SOLID;
  }
  // The hidden ladders (the original's "ladder that appears after getting
  // all gold") only exist once every piece of gold is collected. Guards
  // carrying gold count as not yet collected, so trapping them matters.
  function laddersRevealed() {
    return player.goldTotal > 0 && player.goldCollected >= player.goldTotal;
  }
  function isLadderAt(col, row) {
    const t = tileAt(col, row);
    return t === T_LADDER || (t === T_FREE_LADDER && laddersRevealed());
  }
  function isRopeAt(col, row) {
    return tileAt(col, row) === T_ROPE;
  }
  function isPassableAt(col, row) {
    const t = tileAt(col, row);
    return !(t === T_BRICK || t === T_SOLID);
  }
  function holeAt(col, row) {
    return digHoles.find(h => h.col === col && h.row === row);
  }

  // ---------------- Enemy init ----------------
  // The original never has more than 5 guards on a level; when the data has
  // more, the first ones in reading order are left out.
  const MAX_GUARDS = 5;
  function spawnEnemiesForLevel() {
    enemies = [];
    guardAcc = 0; moveOffset = 0; moveId = 0;
    const spawns = enemySpawns.length > MAX_GUARDS ? enemySpawns.slice(enemySpawns.length - MAX_GUARDS) : enemySpawns;
    for (const spawn of spawns) enemies.push(makeGuard(spawn.col, spawn.row, spawn.type === T_GRUNTER_SPAWN ? 'grunter' : 'runner'));
  }
  function makeGuard(col, row, kind) {
    return {
      kind, col, row, ox: 0, oy: 0,
      x: col * TILE + TILE / 2, y: row * TILE + TILE / 2,
      act: 'stop',              // stop | left | right | up | down | fall | fallbar | inhole | climbout | reborn
      facing: 1,
      hasGold: 0,               // >0: carrying, counting down steps; <0: waiting before it may pick up again
      alive: true,              // (kept for the test hooks; a guard is always "alive", it respawns when it dies)
      inHole: false, isFalling: false, vertical: false,
      shakeT: 0, rebornT: 0, holeCol: 0, holeRow: 0,
      animDist: 0,
    };
  }

  // ---------------- Player movement ----------------
  function resetPlayer() {
    player.col = PLAYER_SPAWN.col;
    player.row = PLAYER_SPAWN.row;
    player.x = player.col * TILE + TILE / 2;
    player.y = player.row * TILE + TILE / 2;
    player.xFx = player.x; player.yFx = player.y;   // stale sub-tile position from the last level would teleport us
    player.vx = 0; player.vy = 0;
    player.facing = 1;
    player.onLadder = false;
    player.isClimbing = false;
    player.isFalling = false;
    player.digCooldown = 0;
    player.digging = null;
    player.laddersShown = false;
    player.alive = true;
    player.goldCollected = 0;
  }

  function updatePlayer(dt) {
    if (!player.alive) return;
    if (player.digging) {
      // A guard stepping onto the tile beside you early in the dig spoils it (the brick stays).
      if (player.digging.left > (DIG_TIME_MS / 1000) * 0.4 && guardOccupies(player.digging.col, player.digging.row - 1)) {
        player.digging = null; player.digUntil = 0;
        return;
      }
      player.digging.left -= dt;
      if (player.digging.left <= 0) {
        const { col, row } = player.digging;
        player.digging = null;
        tryDig(col, row);
      }
      return;                                    // frozen while digging
    }
    const wantsLeft = keys['ArrowLeft'];
    const wantsRight = keys['ArrowRight'];
    const wantsUp = keys['ArrowUp'];
    const wantsDown = keys['ArrowDown'];

    const onLadderTile = isLadderAt(player.col, player.row);
    const onLadderBelow = isLadderAt(player.col, player.row + 1);
    player.onLadder = onLadderTile || onLadderBelow;

    let dx = 0, dy = 0;
    let wantsClimb = false;

    // Lateral: try to walk horizontally
    if (wantsLeft && !wantsRight) { dx = -1; player.facing = -1; }
    else if (wantsRight && !wantsLeft) { dx = 1; player.facing = 1; }

    // Vertical: climbing only if on a ladder column
    if (player.onLadder && (wantsUp || wantsDown)) {
      if (wantsUp) dy = -1;
      if (wantsDown) dy = 1;
      wantsClimb = true;
      player.isClimbing = true;
    } else {
      player.isClimbing = false;
    }

    // Rope: hanging on a rope tile suspends gravity (hand-over-hand
    // lateral movement, same as the original), but pressing Down lets
    // go on purpose and drops the player through it.
    const onRope = isRopeAt(player.col, player.row);
    const holdingRope = onRope && !player.onLadder && !wantsDown;

    // Falling: if not on ladder, not holding a rope, and no solid below, fall down
    if (!wantsClimb && !player.onLadder && !holdingRope && !isSolidAt(player.col, player.row + 1) && !guardOccupies(player.col, player.row + 1)) {
      player.isFalling = true;
      dy = 1;
      // Fall straight down the middle of the column, like the original —
      // no mid-air steering, and no landing half-overlapping a wall.
      dx = 0;
    } else {
      player.isFalling = false;   // supported by floor, ladder or rope
    }
    // Landing: a fall carries on until the runner is centred on the tile it landed in (it can
    // cross the tile boundary a few pixels above the middle), so gold there is picked up.
    if (dy === 0 && !wantsClimb && !player.onLadder && !holdingRope && (isSolidAt(player.col, player.row + 1) || guardOccupies(player.col, player.row + 1))
        && player.y < player.row * TILE + TILE / 2 - 0.01) {
      dy = 1;
    }

    // Climbing out of a pit: standing in a hole (a dug one, so its
    // neighbours at this row are wall) and pushing toward a side hops up
    // onto the floor beside it. The original manual says the runner can't
    // climb out of a pit at all; in practice that just turned a slip into
    // a death, so this is a deliberate, easy-to-revert softening.
    if (pitEscape && dx !== 0 && !player.isFalling && holeAt(player.col, player.row)) {
      const tc = player.col + dx, tr = player.row - 1;
      if (isSolidAt(tc, player.row) && isPassableAt(tc, tr) && !isSolidAt(tc, tr)) {
        player.col = tc; player.row = tr;
        player.x = player.xFx = tc * TILE + TILE / 2;
        player.y = player.yFx = tr * TILE + TILE / 2;
        dx = 0;
      }
    }

    // Horizontal movement at a fixed px/sec rate. The column is
    // floor(centre / TILE) in BOTH directions (it used to be ceil going
    // left, which made the column lag the sprite by up to half a tile and
    // let you fall "half" into holes). Walls stop the centre at the middle
    // of the current tile rather than snapping back each frame.
    // (After a fall or a ladder the runner is off the row's centre line: the original settles onto it
    // first and only then starts running, so horizontal input waits for that.)
    if (dx !== 0 && !player.isFalling && Math.abs(player.y - (player.row * TILE + TILE / 2)) > 0.01) dx = 0;
    if (dx !== 0) {
      if (player.xFx === undefined) player.xFx = player.x;
      let nx = player.xFx + dx * PLAYER_SPEED * dt;
      const cur = Math.floor(player.x / TILE);
      const next = cur + dx;
      // A trapdoor looks like brick, so it is a wall from the side (you only fall through it from above).
      if (!(next >= 0 && next < COLS && isPassableAt(next, player.row) && tileAt(next, player.row) !== T_TRAP)) {
        const mid = cur * TILE + TILE / 2;
        if ((dx > 0 && nx > mid) || (dx < 0 && nx < mid)) nx = mid;
      }
      player.xFx = nx;
      const newTile = Math.floor(nx / TILE);
      if (newTile !== cur && newTile >= 0 && newTile < COLS) player.col = newTile;
      player.x = player.xFx;
    } else {
      player.xFx = player.x;
      // Climbing or falling pulls the runner back to the middle of the column
      // (the original recentres at the same rate it runs).
      if (dy !== 0) {
        const cx = player.col * TILE + TILE / 2, step = PLAYER_SPEED * dt;
        player.xFx = player.x = Math.abs(cx - player.x) <= step ? cx : player.x + Math.sign(cx - player.x) * step;
      }
    }
    // Vertical movement (climbing and falling). Same rules as horizontal:
    // the row is floor(centre / TILE) both ways, and when the next row
    // isn't enterable the centre is clamped to the middle of the current
    // one. (It used to accumulate past the top of a ladder while Up was
    // held, so you floated above the walkway until you let go.)
    if (dy !== 0) {
      if (player.yFx === undefined) player.yFx = player.y;
      const speed = player.isFalling ? PLAYER_FALL_SPEED : PLAYER_CLIMB_SPEED;
      let ny = player.yFx + dy * speed * dt;
      const cur = Math.floor(player.y / TILE);
      const next = cur + dy;
      let allowed = next >= 0 && next < ROWS && isPassableAt(player.col, next) && !(dy < 0 && tileAt(player.col, next) === T_TRAP);
      // Climbing needs a ladder here or in the row we're moving into.
      // Going UP needs a ladder in the tile you are standing in (you can't grab one from the empty
      // tile below it); going down also works onto a ladder top below you.
      if (wantsClimb) allowed = allowed && (dy < 0 ? isLadderAt(player.col, cur) : (isLadderAt(player.col, cur) || isLadderAt(player.col, next)));
      if (!allowed) {
        const mid = cur * TILE + TILE / 2;
        if ((dy > 0 && ny > mid) || (dy < 0 && ny < mid)) ny = mid;
      }
      player.yFx = ny;
      const newRow = Math.floor(ny / TILE);
      if (newRow !== cur && newRow >= 0 && newRow < ROWS) player.row = newRow;
      player.y = ny;
    } else {
      player.yFx = player.y;
      // Running along a row pulls the runner back onto its centre line.
      if (dy === 0 && (wantsLeft || wantsRight) && !(wantsLeft && wantsRight)) {
        const cy = player.row * TILE + TILE / 2, step = PLAYER_CLIMB_SPEED * dt;
        player.yFx = player.y = Math.abs(cy - player.y) <= step ? cy : player.y + Math.sign(cy - player.y) * step;
      }
    }

    // Gold pickup: like the original, only when the runner is close to the
    // middle of the tile (within a quarter of a tile), not on first touch.
    if (tileAt(player.col, player.row) === T_GOLD
        && Math.abs(player.x - (player.col * TILE + TILE / 2)) < TILE / 4
        && Math.abs(player.y - (player.row * TILE + TILE / 2)) < TILE / 4) {
      setTile(player.col, player.row, T_EMPTY);
      player.goldCollected++;
      Audio.gold();
    }

    // Win check: all gold collected, then reach the top row — the
    // source data doesn't preserve the original's "hidden ladder that
    // appears after all gold," so this stands in for "climb to the top
    // of the screen," per the manual.
    if (player.goldCollected >= player.goldTotal && player.row === 0) {
      triggerWin();
    }
    // Dig bricks. Targets one row BELOW the player, diagonally. The original's
    // rule (ok2Dig in the reference port): the brick diagonally below must be
    // plain brick, and the tile beside you must be empty — not gold, ladder,
    // rope or trapdoor (a not-yet-revealed hidden ladder counts as empty).
    // Only from solid footing, and the runner is frozen while digging.
    if (!player.isFalling) {
      let d = 0;
      if (keys['KeyZ']) d = -1; else if (keys['KeyX']) d = 1;
      if (d && canDig(player.col, player.row, d)) {
        player.digging = { col: player.col + d, row: player.row + 1, left: DIG_TIME_MS / 1000 };
        player.facing = d;
        player.digDir = d;
        player.digUntil = performance.now() + DIG_TIME_MS;
        player.x = player.xFx = player.col * TILE + TILE / 2;
        player.y = player.yFx = player.row * TILE + TILE / 2;
      }
    }
  }

  function canDig(col, row, d) {
    const sc = col + d, br = row + 1;
    if (sc < 0 || sc >= COLS || br >= ROWS) return false;
    if (level[br][sc] !== T_BRICK) return false;
    const side = tileAt(sc, row);
    const sideEmpty = side === T_EMPTY || side === T_RUNNER_SPAWN || side === T_GRUNTER_SPAWN
      || (side === T_FREE_LADDER && !laddersRevealed());
    return sideEmpty;
  }

  function tryDig(col, row) {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
    if (level[row][col] !== T_BRICK) return false;
    setTile(col, row, T_EMPTY);
    digHoles.push({ col, row, refillAt: performance.now() + HOLE_REFILL_MS });
    Audio.dig();
    return true;
  }

  // Holes close back up after HOLE_REFILL_MS. Anyone still in one when
  // it closes is caught by the refilling brick.
  function updateHoles() {
    if (digHoles.length === 0) return;
    const now = performance.now();
    for (let i = digHoles.length - 1; i >= 0; i--) {
      const h = digHoles[i];
      if (now < h.refillAt) continue;
      for (const e of enemies) {
        if (e.alive && e.col === h.col && e.row === h.row) killEnemyInHole(e);
      }
      if (player.alive && player.col === h.col && player.row === h.row) killPlayer();
      setTile(h.col, h.row, T_BRICK);
      digHoles.splice(i, 1);
    }
  }

  // ---------------- Guards ----------------
  // Written from the original's observable behaviour (checked against the
  // reference port with scripts/conform.py --guards), not copied from it.
  //
  // Guards run on the original's clock: one guard "tick" is 1/18.75 s (five
  // ticks to cross a tile at the runner's speed). How many guard-steps happen
  // per tick depends on how many guards there are, which is what makes a
  // lone guard half as fast as the runner and a crowd slower still.
  const G_TICK   = 0.053333;
  const G_XSTEP  = TILE * 8 / 40;       // 3.2px a tick sideways
  const G_YSTEP  = TILE * 9 / 44;       // ~3.27px a tick up, down or falling
  const G_HALF   = TILE / 2;
  const G_QUARTER = TILE / 4;
  const G_MOVES  = [null, [0, 1, 0, 1, 0, 1], [1, 1, 1, 1, 1, 1], [1, 2, 1, 1, 2, 1], [1, 2, 2, 1, 2, 2], [2, 2, 2, 2, 2, 2]];
  const SHAKE_TICKS  = 66;              // held 51 ticks, then shakes, then it climbs out
  const REBORN_TICKS = 8;
  const RUNNER_TOUCH = TILE * 0.75;     // guard and runner this close (both axes) = caught

  let guardAcc = 0, moveOffset = 0, moveId = 0;

  // What a tile is made of (base) vs what is standing on it (act), as guards
  // see them. A dug hole is still brick underneath, and a hidden ladder is
  // empty until it appears.
  const B_EMPTY = 0, B_BLOCK = 1, B_SOLID = 2, B_LADDR = 3, B_BAR = 4, B_TRAP = 5, B_HLADR = 6, B_GOLD = 7;
  const A_EMPTY = 0, A_BLOCK = 1, A_SOLID = 2, A_LADDR = 3, A_BAR = 4, A_TRAP = 5, A_GUARD = 8, A_RUNNER = 9;
  function gBase(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return B_SOLID;
    if (holeAt(c, r)) return B_BLOCK;
    switch (level[r][c]) {
      case T_BRICK: return B_BLOCK;
      case T_SOLID: return B_SOLID;
      case T_LADDER: return B_LADDR;
      case T_FREE_LADDER: return laddersRevealed() ? B_LADDR : B_HLADR;
      case T_GOLD: return B_GOLD;
      case T_ROPE: return B_BAR;
      case T_TRAP: return B_TRAP;
      default: return B_EMPTY;
    }
  }
  function guardTileAt(c, r) {
    for (const g of enemies) if (g.col === c && g.row === r) return g;
    return null;
  }
  function gAct(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return A_SOLID;
    if (guardTileAt(c, r)) return A_GUARD;
    if (player.col === c && player.row === r) return A_RUNNER;
    if (holeAt(c, r)) return A_EMPTY;
    switch (level[r][c]) {
      case T_BRICK: return A_BLOCK;
      case T_SOLID: return A_SOLID;
      case T_LADDER: return A_LADDR;
      case T_FREE_LADDER: return laddersRevealed() ? A_LADDR : A_EMPTY;
      case T_ROPE: return A_BAR;
      case T_TRAP: return A_TRAP;
      default: return A_EMPTY;     // includes gold and spawn markers
    }
  }
  // Can something stand on (c, r)? Solid ground, or a guard.
  function guardOccupies(c, r) { return !!guardTileAt(c, r); }

  function updateEnemies(dt) {
    guardAcc += dt;
    while (guardAcc >= G_TICK) {
      guardAcc -= G_TICK;
      guardTick();
    }
    for (const g of enemies) { g.x = g.col * TILE + G_HALF + g.ox; g.y = g.row * TILE + G_HALF + g.oy; }
    checkCaught();
  }

  function guardTick() {
    if (!enemies.length) return;
    for (const g of enemies) {
      if (g.act === 'inhole') {
        if (++g.shakeT >= SHAKE_TICKS) { g.act = 'climbout'; g.inHole = false; g.holeCol = g.col; g.holeRow = g.row; }
      } else if (g.act === 'reborn') {
        if (++g.rebornT >= REBORN_TICKS) {
          g.act = 'fall';
          if (player.col === g.col && player.row === g.row && player.alive) killPlayer();
        }
      }
    }
    moveOffset = (moveOffset + 1) % 6;
    let moves = G_MOVES[Math.min(enemies.length, 5)][moveOffset];
    while (moves-- > 0) {
      moveId = (moveId + 1) % enemies.length;
      const g = enemies[moveId];
      if (g.act === 'inhole' || g.act === 'reborn') continue;
      guardStep(g, guardDecide(g));
    }
    checkCaught();
  }

  function checkCaught() {
    if (!player.alive || gameState !== 'playing') return;
    for (const g of enemies) {
      if (g.act === 'reborn') continue;
      const gx = g.col * TILE + G_HALF + g.ox, gy = g.row * TILE + G_HALF + g.oy;
      if (Math.abs(player.x - gx) <= RUNNER_TOUCH && Math.abs(player.y - gy) <= RUNNER_TOUCH) { killPlayer(); return; }
    }
  }

  // ---- deciding where to go ----
  function guardDecide(g) {
    let sameLevelOnly = false;
    if (g.act === 'climbout') {
      if (g.row === g.holeRow) return 'up';
      sameLevelOnly = true;
      if (g.col !== g.holeCol) g.act = 'left';     // clear of the pit: back to normal
    }
    if (!sameLevelOnly) {
      // Gravity first.
      const here = gBase(g.col, g.row);
      if (here === B_LADDR || (here === B_BAR && g.oy === 0)) {
        // held by a ladder or rope
      } else if (g.oy < 0) {
        return 'fall';
      } else if (g.row < ROWS - 1) {
        const below = gAct(g.col, g.row + 1);
        if (below === A_EMPTY || below === A_RUNNER) return 'fall';
        if (!(below === A_BLOCK || below === A_SOLID || below === A_GUARD || below === A_LADDR)) return 'fall';   // rope or trapdoor below: no footing
      }
    }
    // Runner on the same floor and reachable in a straight line? Go for him.
    const rc = player.col, rr = player.row;
    if (g.row === rr && !player.isFalling) {
      let x = g.col;
      while (x !== rc) {
        const y = g.row;
        const cb = gBase(x, y);
        const below = y < ROWS - 1 ? gBase(x, y + 1) : B_SOLID;
        if (cb === B_LADDR || cb === B_BAR || below === B_SOLID || below === B_LADDR || below === B_BLOCK
            || gAct(x, y + 1) === A_GUARD || below === B_BAR || below === B_GOLD) x += Math.sign(rc - x);
        else break;
      }
      if (x === rc) {
        if (g.col < rc) return 'right';
        if (g.col > rc) return 'left';
        const rox = player.x - (rc * TILE + G_HALF);
        return g.ox < rox ? 'right' : 'left';
      }
    }
    return guardScanFloor(g);
  }

  // Otherwise look along the floor for the best place to go up or down.
  // A column is rated by where a ladder up / a drop down there would leave
  // the guard relative to the runner: on his row (rated by distance) beats
  // above him beats below him.
  function guardScanFloor(g) {
    const sx = g.col, sy = g.row, rr = player.row;
    let best = 255, bestDir = 'stop';
    const floorUnder = (c, r) => { const b = gBase(c, r); return b === B_BLOCK || b === B_SOLID; };
    const footing = (c, r) => { const b = gBase(c, r + 1); return b === B_BLOCK || b === B_SOLID || b === B_LADDR; };

    // How far can it walk each way along this floor?
    const reach = (dir) => {
      let x = sx;
      for (;;) {
        const nx = x + dir;
        if (nx < 0 || nx >= COLS) break;
        const a = gAct(nx, sy);
        if (a === A_BLOCK || a === A_SOLID) break;
        const ok = a === A_LADDR || a === A_BAR || sy >= ROWS - 1 || footing(nx, sy);
        x = nx;
        if (!ok) break;              // steps off the edge; can go no further
      }
      return x;
    };
    const left = reach(-1), right = reach(1);

    const rate = (endRow, x) => endRow === rr ? Math.abs(sx - x) : endRow > rr ? endRow - rr + 200 : rr - endRow + 100;
    const sideOpen = (c, r) => c >= 0 && c < COLS && (footing(c, r) || gBase(c, r + 1) === B_LADDR || gBase(c, r) === B_BAR);

    const tryDown = (x, dir) => {
      let y = sy;
      while (y < ROWS - 1 && !floorUnder(x, y + 1)) {
        if (gBase(x, y) !== B_EMPTY && gBase(x, y) !== B_HLADR) {
          // not simply falling: could it step off sideways here instead?
          if (x > 0 && sideOpen(x - 1, y) && y >= rr) break;
          if (x < COLS - 1 && sideOpen(x + 1, y) && y >= rr) break;
        }
        y++;
      }
      const rt = rate(y, x);
      if (rt < best) { best = rt; bestDir = dir; }
    };
    const tryUp = (x, dir) => {
      let y = sy;
      while (y > 0 && gBase(x, y) === B_LADDR) {
        y--;
        if (x > 0 && sideOpen(x - 1, y) && y <= rr) break;
        if (x < COLS - 1 && sideOpen(x + 1, y) && y <= rr) break;
      }
      const rt = rate(y, x);
      if (rt < best) { best = rt; bestDir = dir; }
    };
    const canDrop = (x) => sy < ROWS - 1 && !floorUnder(x, sy + 1);

    // straight down / up from where it stands first, then the left half, then the right half
    if (canDrop(sx)) tryDown(sx, 'down');
    if (gBase(sx, sy) === B_LADDR) tryUp(sx, 'up');
    for (let x = left; x < sx; x++) {
      if (canDrop(x)) tryDown(x, 'left');
      if (gBase(x, sy) === B_LADDR) tryUp(x, 'left');
    }
    if (right !== sx) {
      for (let x = right; x > sx; x--) {
        if (canDrop(x)) tryDown(x, 'right');
        if (gBase(x, sy) === B_LADDR) tryUp(x, 'right');
      }
    }
    return bestDir;
  }

  // ---- carrying gold ----
  // A guard that picks gold up carries it for 12-37 steps, then drops it on
  // the next spot with something under it, and waits a step before it will
  // take any again.
  function guardMaybeDropGold(g) {
    if (g.hasGold > 1) { g.hasGold--; return; }
    if (g.hasGold === 1) {
      const under = g.row >= ROWS - 1 ? B_SOLID : gBase(g.col, g.row + 1);
      if (gBase(g.col, g.row) === B_EMPTY && (under === B_BLOCK || under === B_SOLID || under === B_LADDR)) {
        setTile(g.col, g.row, T_GOLD);
        g.hasGold = -1;
      }
      return;
    }
    if (g.hasGold < 0) g.hasGold++;
  }

  // ---- taking one step ----
  function guardStep(g, action) {
    let ox = g.ox, oy = g.oy, col = g.col, row = g.row;
    let blocked = false, centreX = 0, centreY = 0;
    if (g.act === 'climbout' && action === 'stop') g.act = 'stop';

    if (action === 'up' || action === 'down' || action === 'fall') {
      if (action === 'up') {
        const a = row <= 0 ? A_SOLID : gAct(col, row - 1);
        blocked = a === A_BLOCK || a === A_SOLID || a === A_TRAP || a === A_GUARD;
        if (oy <= 0 && blocked) action = 'stop';
      } else {
        const a = row >= ROWS - 1 ? A_SOLID : gAct(col, row + 1);
        blocked = a === A_BLOCK || a === A_SOLID || a === A_GUARD;
        if (action === 'fall' && oy < 0 && gBase(col, row) === B_BLOCK) { action = 'inhole'; blocked = true; }
        else if (oy >= 0 && blocked) action = 'stop';
      }
      if (action !== 'stop') centreX = ox > 0 ? -1 : ox < 0 ? 1 : 0;
    } else if (action === 'left' || action === 'right') {
      const d = action === 'left' ? -1 : 1;
      const nc = col + d;
      const a = nc < 0 || nc >= COLS ? A_SOLID : gAct(nc, row);
      blocked = a === A_BLOCK || a === A_SOLID || a === A_GUARD || gBase(nc, row) === B_TRAP;
      if ((d < 0 ? ox <= 0 : ox >= 0) && blocked) action = 'stop';
      if (action !== 'stop') centreY = oy > 0 ? -1 : oy < 0 ? 1 : 0;
    }

    g.vertical = action === 'up' || action === 'down';
    if (action === 'up') {
      oy -= G_YSTEP;
      if (blocked && oy < 0) oy = 0;
      else if (oy < -G_HALF) { row--; oy += TILE; }
      if (oy <= 0 && oy > -G_YSTEP) guardMaybeDropGold(g);
    }
    if (centreY < 0) { oy -= G_YSTEP; if (oy < 0) oy = 0; }

    if (action === 'down' || action === 'fall' || action === 'inhole') {
      let holdBar = false;
      if (gBase(col, row) === B_BAR) {
        if (oy < 0) holdBar = true;
        else if (action === 'down' && row < ROWS - 1 && gAct(col, row + 1) !== A_LADDR) action = 'fall';
      }
      oy += G_YSTEP;
      if (holdBar && oy >= 0) { oy = 0; action = 'fallbar'; }
      if (blocked && oy > 0) oy = 0;
      else if (oy > G_HALF) { row++; oy -= TILE; }
      if ((action === 'fall' || action === 'down') && oy >= 0 && oy < G_YSTEP) guardMaybeDropGold(g);

      if (action === 'inhole') {
        if (oy < 0) {
          action = 'fall';                       // still on the way in
          if (g.hasGold > 0) guardSpillGold(g, col, row);
        } else {                                  // landed in the pit
          if (g.hasGold > 0) guardSpillGold(g, col, row);
          g.hasGold = 0;
          g.act = 'inhole'; g.inHole = true; g.shakeT = 0;
          Audio.trap();
          action = 'inhole';
        }
      }
    }
    if (centreY > 0) { oy += G_YSTEP; if (oy > 0) oy = 0; }

    if (action === 'left') {
      ox -= G_XSTEP;
      if (blocked && ox < 0) ox = 0;
      else if (ox < -G_HALF) { col--; ox += TILE; }
      if (ox <= 0 && ox > -G_XSTEP) guardMaybeDropGold(g);
      g.facing = -1;
    }
    if (centreX < 0) { ox -= G_XSTEP; if (ox < 0) ox = 0; }
    if (action === 'right') {
      ox += G_XSTEP;
      if (blocked && ox > 0) ox = 0;
      else if (ox > G_HALF) { col++; ox -= TILE; }
      if (ox >= 0 && ox < G_XSTEP) guardMaybeDropGold(g);
      g.facing = 1;
    }
    if (centreX > 0) { ox += G_XSTEP; if (ox > 0) ox = 0; }

    ox = Math.round(ox * 1e4) / 1e4; oy = Math.round(oy * 1e4) / 1e4;   // keep offsets exact so "centred" means === 0
    const moved = Math.abs(ox - g.ox) + Math.abs(oy - g.oy) + (col !== g.col || row !== g.row ? TILE : 0);
    g.animDist += Math.min(moved, TILE);
    g.col = col; g.row = row; g.ox = ox; g.oy = oy;
    g.isFalling = action === 'fall' || action === 'fallbar';
    if (action !== 'stop' && action !== 'inhole' && g.act !== 'climbout') g.act = action;
    if (g.act === 'climbout' && action === 'up') { /* keep climbing out */ }

    // picking gold up
    if (gBase(col, row) === B_GOLD && g.hasGold === 0
        && ((ox === 0 && oy >= 0 && oy < G_QUARTER) || (oy === 0 && ox >= 0 && ox < G_QUARTER)
            || (row < ROWS - 1 && gBase(col, row + 1) === B_LADDR && oy < G_QUARTER))) {
      g.hasGold = 12 + Math.floor(Math.random() * 26);
      setTile(col, row, T_EMPTY);
    }
  }

  // Gold a guard is carrying when it drops into a pit reappears on the tile
  // above if that is empty; otherwise it is lost — and counts as collected.
  function guardSpillGold(g, col, row) {
    if (gBase(col, row - 1) === B_EMPTY && row > 0) setTile(col, row - 1, T_GOLD);
    else player.goldCollected++;
    g.hasGold = 0;
  }

  // A pit refilling over a guard kills it; it comes back somewhere near the top.
  function killEnemyInHole(g) {
    if (g.hasGold > 0) player.goldCollected++;
    g.hasGold = 0;
    g.inHole = false; g.isFalling = false;
    const order = [];
    for (let c = 0; c < COLS; c++) order.push(c);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    let bc = 0, br = 1, found = false;
    for (br = 1; br < ROWS && !found; br++) {
      for (const c of order) {
        const t = level[br][c];
        if ((t === T_EMPTY || t === T_RUNNER_SPAWN || t === T_GRUNTER_SPAWN) && !holeAt(c, br) && !guardTileAt(c, br)) { bc = c; found = true; break; }
      }
      if (found) break;
    }
    g.col = bc; g.row = found ? br : 1; g.ox = 0; g.oy = 0;
    g.act = 'reborn'; g.rebornT = 0;
    Audio.enemyDeath();
  }

  // ---------------- Render ----------------
  const canvas = document.getElementById('game');
  const ctx2d = canvas.getContext('2d');

  const COLORS = {
    [T_BRICK]: '#c87850',
    [T_SOLID]: '#666',
    [T_LADDER]: '#fdba35',
    [T_FREE_LADDER]: '#fdba35',
    [T_ROPE]: '#e0c090',
    [T_GOLD]: '#ffcc33',
  };

  function renderTile(col, row, t, x, y) {
    if (t === T_BRICK || t === T_TRAP) {   // a trapdoor looks exactly like brick
      // Brick body
      ctx2d.fillStyle = COLORS[T_BRICK];
      ctx2d.fillRect(x, y, TILE, TILE);
      // Real brick pattern: 2 horizontal mortar lines + 1 vertical offset line
      // = classic staggered brick layout
      ctx2d.strokeStyle = '#3a1a0c';
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      // Top mortar
      ctx2d.moveTo(x, y + 4);
      ctx2d.lineTo(x + TILE, y + 4);
      // Middle mortar
      ctx2d.moveTo(x, y + TILE - 4);
      ctx2d.lineTo(x + TILE, y + TILE - 4);
      // Staggered vertical line: offset between rows of bricks
      // Even columns: vertical at x + TILE/2 (8)
      // Odd columns: NO vertical line (so the bricks interlock)
      const offset = (col % 2 === 0) ? TILE / 2 : -1;
      if (offset > 0) {
        ctx2d.moveTo(x + offset, y + 4);
        ctx2d.lineTo(x + offset, y + TILE - 4);
      }
      ctx2d.stroke();
      // Small highlight to give brick some color depth
      ctx2d.fillStyle = 'rgba(255,255,255,0.06)';
      ctx2d.fillRect(x, y, TILE, 4);
    } else if (t === T_LADDER || t === T_FREE_LADDER) {
      // Hidden ladders are invisible until all the gold is collected (the
      // editor shows them faintly so you can place them).
      const hidden = t === T_FREE_LADDER && !laddersRevealed();
      if (hidden && gameState !== 'editor') return;
      // Ladder: 2 vertical rails + 5 horizontal rungs
      ctx2d.save();
      if (hidden) ctx2d.globalAlpha = 0.35;
      ctx2d.fillStyle = COLORS[T_LADDER];
      ctx2d.fillRect(x + 2, y, 2, TILE);
      ctx2d.fillRect(x + TILE - 4, y, 2, TILE);
      for (let r = 0; r < 5; r++) {
        ctx2d.fillRect(x + 2, y + r * (TILE / 4) + 2, TILE - 4, 2);
      }
      ctx2d.restore();
    } else if (t === T_ROPE) {
      // Rope: a single taut horizontal line near the top of the tile (where
      // a hanging character's hands meet it), with a subtle shadow beneath.
      ctx2d.strokeStyle = COLORS[T_ROPE];
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(x, y + 3);
      ctx2d.lineTo(x + TILE, y + 3);
      ctx2d.stroke();
      ctx2d.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.moveTo(x, y + 5);
      ctx2d.lineTo(x + TILE, y + TILE / 2 + 2);
      ctx2d.stroke();
    } else if (t === T_GOLD) {
      // Gold: chunky irregular pile with a highlight
      ctx2d.fillStyle = COLORS[T_GOLD];
      ctx2d.beginPath();
      ctx2d.arc(x + TILE/2, y + TILE/2 + 2, 6, 0, Math.PI*2);
      ctx2d.arc(x + TILE/2 + 3, y + TILE/2 - 2, 4, 0, Math.PI*2);
      ctx2d.arc(x + TILE/2 - 3, y + TILE/2 - 1, 4, 0, Math.PI*2);
      ctx2d.fill();
      // Highlight
      ctx2d.fillStyle = '#ffe680';
      ctx2d.beginPath();
      ctx2d.arc(x + TILE/2 - 1, y + TILE/2, 2, 0, Math.PI*2);
      ctx2d.fill();
    } else if (t === T_SOLID) {
      // Solid (background, indestructible): dark grey
      ctx2d.fillStyle = COLORS[T_SOLID];
      ctx2d.fillRect(x, y, TILE, TILE);
    }
  }

  // ---- Character sprites (sprites.js, generated by scripts/build_sprites.py) ----
  // 14x11 pixel frames scaled to a 20x16 canvas each (a 16px tile tall),
  // pre-rendered once per facing and, for the grunter, in a violet
  // palette. drawSprite() then just blits.
  const SPR_W = 20, SPR_H = 16;
  // Apple II hi-res colours (the sprites only use white, orange and blue).
  const PALETTES = {
    player:  { w: '#ffffff', o: '#ff6a3c', b: '#14cffd' },
    guard:   { w: '#ffffff', o: '#ff6a3c', b: '#14cffd' },
    grunter: { w: '#ffffff', o: '#d15dff', b: '#14cffd' },
  };
  const spriteCache = {};
  function buildSpriteCache() {
    const S = window.SPRITES;
    if (!S) return;
    const make = (frame, pal) => {
      const cv = document.createElement('canvas');
      cv.width = SPR_W; cv.height = SPR_H;
      const c = cv.getContext('2d');
      frame.forEach((row, j) => {
        const y0 = Math.round(j * SPR_H / frame.length), y1 = Math.round((j + 1) * SPR_H / frame.length);
        [...row].forEach((ch, i) => {
          if (ch === '.' || !pal[ch]) return;
          const x0 = Math.round(i * SPR_W / row.length), x1 = Math.round((i + 1) * SPR_W / row.length);
          c.fillStyle = pal[ch];
          c.fillRect(x0, y0, x1 - x0, y1 - y0);
        });
      });
      return cv;
    };
    // sprites.js has separate right- and left-facing frames (the 1983
    // sprites are not mirrors of each other).
    const sets = { player: S.player, guard: S.guard, grunter: S.guard };
    for (const [set, anims] of Object.entries(sets)) {
      for (const [anim, sides] of Object.entries(anims)) {
        spriteCache[set + ':' + anim] = {
          right: sides.right.map(f => make(f, PALETTES[set])),
          left: sides.left.map(f => make(f, PALETTES[set])),
        };
      }
    }
  }
  function drawSprite(set, anim, idx, facingLeft, cx, cy) {
    const entry = spriteCache[set + ':' + anim];
    if (!entry) { // sprites.js missing — a plain block beats invisibility
      ctx2d.fillStyle = set === 'player' ? '#fff' : '#ff6a3c';
      ctx2d.fillRect(Math.round(cx - 5), Math.round(cy - 6), 10, 14);
      return;
    }
    const frames = facingLeft ? entry.left : entry.right;
    // Bottom-aligned to the tile so feet stay on the floor.
    ctx2d.drawImage(frames[idx % frames.length], Math.round(cx - SPR_W / 2), Math.round(cy + TILE / 2 - SPR_H));
  }

  // Which frame of which animation the player is in right now.
  function playerFrame() {
    if (performance.now() < (player.digUntil || 0)) return { anim: 'dig', idx: 0, left: player.digDir < 0 };
    const left = player.facing < 0, d = player.animDist || 0, moving = player.moved;
    if (player.isFalling) return { anim: 'fall', idx: 0, left };
    if (player.isClimbing) return { anim: 'climb', idx: moving ? Math.floor(d / 5) % 2 : 0, left };
    if (isRopeAt(player.col, player.row) && !player.onLadder) {
      return { anim: 'monkey', idx: moving ? Math.floor(d / 4) % 3 : 1, left };
    }
    return { anim: 'run', idx: moving ? Math.floor(d / 4) % 3 : 1, left };
  }

  function renderPlayer(px, py, frame) {
    const f = frame || { anim: 'run', idx: 1, left: false };
    drawSprite('player', f.anim, f.idx, f.left, px, py);
  }

  function renderEnemy(e) {
    const set = e.kind === 'grunter' ? 'grunter' : 'guard';
    const left = e.facing < 0, d = e.animDist || 0;
    let anim = 'run', idx = Math.floor(d / 4) % 3;
    const onRope = gBase(e.col, e.row) === B_BAR;
    if (e.act === 'reborn') { ctx2d.globalAlpha = 0.45; drawSprite(set, 'run', 1, left, e.x, e.y); ctx2d.globalAlpha = 1; return; }
    if (e.inHole) idx = 1;
    else if (e.isFalling && !onRope) { anim = 'fall'; idx = 0; }
    else if (e.vertical || e.act === 'climbout') { anim = 'climb'; idx = Math.floor(d / 5) % 2; }
    else if (onRope) anim = 'monkey';
    drawSprite(set, anim, idx, left, e.x, e.y);
    if (e.hasGold > 0) {
      // A guard that has stolen a piece: the level can't be won until it is
      // dropped (or the guard is trapped and it spills).
      ctx2d.fillStyle = '#ffcc33';
      ctx2d.beginPath();
      ctx2d.arc(Math.round(e.x), Math.round(e.y) - TILE / 2 - 3, 2.5, 0, Math.PI * 2);
      ctx2d.fill();
    }
  }

  function render() {
    ctx2d.fillStyle = '#000';
    ctx2d.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // Draw tiles
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t = level[row][col];
        if (t === T_EMPTY) continue;
        renderTile(col, row, t, col * TILE, row * TILE);
      }
    }
    if (gameState === 'editor') {
      renderEditorOverlay();
      return;
    }
    // Enemies (drawn before player so player appears on top)
    for (const e of enemies) renderEnemy(e);
    // Player
    renderPlayer(player.x, player.y, playerFrame());
  }

  function renderEditorOverlay() {
    // Player-spawn marker
    if (editorPlayerSpawn) {
      renderPlayer(
        editorPlayerSpawn.col * TILE + TILE / 2,
        editorPlayerSpawn.row * TILE + TILE / 2
      );
    }
    // Cursor: a pulsing-free simple highlight box
    const x = editorCursor.col * TILE;
    const y = editorCursor.row * TILE;
    ctx2d.strokeStyle = '#ffffff';
    ctx2d.lineWidth = 2;
    ctx2d.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
  }

  // ---------------- HUD ----------------
  const elGold = document.getElementById('gold-count');
  const elStatus = document.getElementById('status');
  const overlay = document.getElementById('overlay');
  const overlayContent = document.getElementById('overlay-content');

  function updateHud() {
    elGold.textContent = `GOLD: ${player.goldCollected}/${player.goldTotal}`;
    elStatus.textContent = (gameState === 'playing' && laddersRevealed())
      ? 'ALL GOLD — CLIMB OUT THE TOP'
      : gameState.toUpperCase();
  }

  function showOverlay(html) {
    overlayContent.innerHTML = html;
    overlay.classList.remove('hidden');
  }
  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  // The menu screen doubles as a level picker for the 150 vendored
  // levels — Left/Right change the pick, Space starts it.
  function renderMenuOverlay() {
    const officialTotal = officialLevelCount();
    const total = totalLevelCount();
    const customNote = customLevels.length > 0
      ? ` (${customLevels.length} custom)` : '';
    const picker = total > 0
      ? `<p class="hints"><kbd>&larr;</kbd> <kbd>&rarr;</kbd> Level: ${String(selectedLevel).padStart(3, '0')} / ${total}${customNote}</p>`
      : '';
    const progress = highestCleared > 0
      ? `<p class="hints">Cleared: ${highestCleared}/${officialTotal}</p>`
      : '';
    showOverlay(`
      <h1>Lode Runner</h1>
      <p>Collect all the gold. Reach the top. Don't get caught.</p>
      ${picker}
      ${progress}
      <p class="hints">
        <span><kbd>&uarr;</kbd> <kbd>&darr;</kbd> Climb</span>
        <span><kbd>Z</kbd> <kbd>X</kbd> Dig</span>
        <span><kbd>M</kbd> Mute</span>
        <span><kbd>E</kbd> Level editor</span>
      </p>
      <p class="hints" style="margin-top:1em"><kbd>SPACE</kbd> Start</p>
    `);
  }

  // ---------------- State transitions ----------------
  // Loads a level object directly (used by loadLevelById below, and by
  // the editor's test-play, which has no id to look up yet).
  function loadLevelObject(lv) {
    if (lv.playerSpawn) PLAYER_SPAWN = { col: lv.playerSpawn.col, row: lv.playerSpawn.row };
    level = parseLevel(lv.tiles);
    digHoles = [];
    resetPlayer();
    spawnEnemiesForLevel();
    gameState = 'playing';
    hideOverlay();
    updateHud();
  }

  // Loads a level (official or custom, see getLevelById) by 1-based id.
  // Returns false (and leaves state untouched) if the id doesn't exist.
  function loadLevelById(id) {
    const lv = getLevelById(id);
    if (!lv) return false;
    isTestPlay = false;
    currentLevelId = id;
    loadLevelObject(lv);
    return true;
  }

  // ---------------- Level editor ----------------
  function enterEditor(keepExisting) {
    gameState = 'editor';
    isTestPlay = false;
    if (!keepExisting) {
      editorTiles = Array.from({ length: ROWS }, () => Array(COLS).fill('.'));
      editorPlayerSpawn = null;
      editorCursor = { col: 0, row: 0 };
    }
    level = parseLevel(editorTiles.map(r => r.join('')));
    digHoles = [];
    hideOverlay();
    elStatus.textContent = 'EDITOR';
  }

  // A brief status-line message that reverts back to "EDITOR" — the
  // editor has no overlay of its own to show a bigger notice in.
  function editorFlash(text, ms) {
    elStatus.textContent = text;
    setTimeout(() => { if (gameState === 'editor') elStatus.textContent = 'EDITOR'; }, ms);
  }

  function handleEditorKey(code) {
    if (code === 'ArrowLeft') editorCursor.col = Math.max(0, editorCursor.col - 1);
    else if (code === 'ArrowRight') editorCursor.col = Math.min(COLS - 1, editorCursor.col + 1);
    else if (code === 'ArrowUp') editorCursor.row = Math.max(0, editorCursor.row - 1);
    else if (code === 'ArrowDown') editorCursor.row = Math.min(ROWS - 1, editorCursor.row + 1);
    else if (code === 'Digit0' || code === 'KeyH') {
      editorTiles[editorCursor.row][editorCursor.col] = (code === 'Digit0') ? 'X' : 'S';
      level = parseLevel(editorTiles.map(r => r.join('')));
    }
    else if (code === 'Digit9') {
      editorPlayerSpawn = { col: editorCursor.col, row: editorCursor.row };
    } else if (code.startsWith('Digit')) {
      const n = parseInt(code.slice(5), 10);
      if (n >= 1 && n <= EDITOR_PALETTE.length) {
        editorTiles[editorCursor.row][editorCursor.col] = EDITOR_PALETTE[n - 1];
        level = parseLevel(editorTiles.map(r => r.join('')));
      }
    } else if (code === 'KeyT') {
      testPlayEditorLevel();
    } else if (code === 'KeyS') {
      saveEditorLevel();
    } else if (code === 'Escape') {
      gameState = 'menu';
      renderMenuOverlay();
    }
  }

  function testPlayEditorLevel() {
    if (!editorPlayerSpawn) { editorFlash('PLACE PLAYER (9) FIRST', 1500); return; }
    isTestPlay = true;
    currentLevelId = null;
    loadLevelObject({ tiles: editorTiles.map(r => r.join('')), playerSpawn: editorPlayerSpawn });
  }

  function saveEditorLevel() {
    if (!editorPlayerSpawn) { editorFlash('PLACE PLAYER (9) FIRST', 1500); return; }
    const name = window.prompt('Name this level:', `Custom ${customLevels.length + 1}`);
    if (!name) return;
    commitCustomLevel(name);
  }

  // Split out from saveEditorLevel so tests can save without going
  // through window.prompt (which blocks waiting for a real dialog).
  function commitCustomLevel(name) {
    const tiles = editorTiles.map(r => r.join(''));
    const flat = tiles.join('');
    customLevels.push({
      name,
      tiles,
      playerSpawn: editorPlayerSpawn,
      goldTotal: (flat.match(/g/g) || []).length,
      enemyCount: (flat.match(/[rR]/g) || []).length,
    });
    saveCustomLevels();
    editorFlash('SAVED', 1200);
  }

  let invulnerable = false;   // test hook only (playtest / conformance runs)
  function killPlayer() {
    if (invulnerable) return;
    player.alive = false;
    gameState = 'lost';
    const levelTag = currentLevelId !== null ? ` (level ${currentLevelId})` : '';
    const hint = isTestPlay ? 'Back to editor' : 'Try again';
    showOverlay(`<h2>CAUGHT</h2><p>You collected ${player.goldCollected}/${player.goldTotal} gold${levelTag}.</p><p class="hints"><kbd>SPACE</kbd> ${hint}</p>`);
    updateHud();
    Audio.playerDeath();
  }

  function triggerWin() {
    gameState = 'won';
    if (!isTestPlay && currentLevelId !== null
        && currentLevelId <= officialLevelCount() && currentLevelId > highestCleared) {
      highestCleared = currentLevelId;
      saveProgress();
    }
    const hasNext = !isTestPlay && currentLevelId !== null && getLevelById(currentLevelId + 1) !== null;
    const hint = isTestPlay ? 'Back to editor'
      : hasNext ? `Next level (${currentLevelId + 1}/${totalLevelCount()})`
      : 'Back to level select';
    const title = (!isTestPlay && currentLevelId !== null && !hasNext) ? 'ALL LEVELS CLEAR' : 'LEVEL CLEAR';
    showOverlay(`<h2>${title}</h2><p>You collected all ${player.goldTotal} gold.</p><p class="hints"><kbd>SPACE</kbd> ${hint}</p>`);
    updateHud();
    Audio.win();
  }

  // ---------------- Input ----------------
  const keys = {};
  let muted = false;
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    Audio.unlock();
    if (e.code === 'KeyM') {
      muted = !muted;
      Audio.setMuted(muted);
      return;
    }
    if (e.code === 'Space') {
      if (gameState === 'menu') {
        // Play whichever level is currently picked in the level-select
        // (official campaign or a saved custom one).
        loadLevelById(selectedLevel);
      } else if (gameState === 'won' || gameState === 'lost') {
        if (isTestPlay) {
          enterEditor(true); // back to the level you were just testing
        } else if (gameState === 'won') {
          if (!loadLevelById(currentLevelId + 1)) {
            // Cleared the last level — back to the picker rather than
            // falling off the end of the campaign.
            gameState = 'menu';
            renderMenuOverlay();
          }
        } else {
          loadLevelById(currentLevelId);
        }
      }
      e.preventDefault();
    }
    if (gameState === 'menu' && e.code === 'KeyE') {
      enterEditor(false);
      return;
    }
    // Level-select: only at the menu. Left/Right otherwise mean "run"
    // during play.
    if (gameState === 'menu' && totalLevelCount() > 0
        && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      const total = totalLevelCount();
      selectedLevel += (e.code === 'ArrowRight') ? 1 : -1;
      if (selectedLevel < 1) selectedLevel = total;
      if (selectedLevel > total) selectedLevel = 1;
      renderMenuOverlay();
    }
    if (gameState === 'editor') {
      handleEditorKey(e.code);
    }
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  // ---------------- Main loop ----------------
  // One simulation step (no drawing). Split out of loop() so the headless
  // play test (scripts/playtest.py) can run the real game logic at full
  // speed on a virtual clock.
  function tick(dt) {
    if (gameState === 'playing') {
      const ox = player.x, oy = player.y;
      updatePlayer(dt);
      const moved = Math.abs(player.x - ox) + Math.abs(player.y - oy);
      player.animDist = (player.animDist || 0) + moved;
      player.moved = moved > 0.01;
      if (!player.laddersShown && laddersRevealed()) {
        player.laddersShown = true;
        if (level.some(r => r.includes(T_FREE_LADDER))) Audio.reveal();
      }
      updateEnemies(dt);
      updateHoles();
      updateHud();
    }
  }

  function loop(t) {
    if (!lastTime) lastTime = t;
    let dt = (t - lastTime) / 1000;
    if (dt > 0.05) dt = 0.05;
    lastTime = t;
    try {
      tick(dt);
      render();
    } catch (err) {
      console.error('frame error (game continues):', err);
    }
    requestAnimationFrame(loop);
  }

  // ---------------- Test hooks ----------------
  window.__loderunner = {
    getState: () => gameState,
    getGold: () => ({ collected: player.goldCollected, total: player.goldTotal }),
    getPlayerPos: () => ({
      col: player.col, row: player.row,
      x: player.x, y: player.y,
      xFrac: player.xFx, yFrac: player.yFx,
      alive: player.alive,
    }),
    getEnemyCount: () => enemies.length,
    getEnemyPositions: () => enemies.map(e => ({ kind: e.kind, col: e.col, row: e.row, x: e.x, y: e.y, act: e.act, hasGold: e.hasGold, ox: e.ox, oy: e.oy })),
    getTile: (col, row) => tileAt(col, row),
    digAt: (col, row) => tryDig(col, row),
    setPlayerAt: (col, row) => {
      player.col = col; player.row = row;
      player.x = col * TILE + TILE / 2; player.y = row * TILE + TILE / 2;
      // Reset fractional position too so the player doesn't continue climbing
      // from a stale yFrac value that crosses back into a previous tile.
      player.xFx = player.x;
      player.yFx = player.y;
    },
    // Same idea as setPlayerAt, but pixel-exact — useful for tests that
    // need to land the player precisely on a live enemy's current
    // position, which is rarely tile-centered while it's patrolling.
    setPlayerPixelAt: (x, y) => {
      player.col = Math.round((x - TILE / 2) / TILE);
      player.row = Math.round((y - TILE / 2) / TILE);
      player.x = x; player.y = y;
      player.xFx = x; player.yFx = y;
    },
    // Places a live enemy (by index into the alive-only list, matching
    // getEnemyPositions()'s ordering) at an exact tile — for tests that
    // need a deterministic trap/chase scenario rather than waiting on
    // real patrol/fall timing.
    setEnemyAt: (index, col, row) => {
      const e = enemies[index];
      if (!e) return false;
      e.col = col; e.row = row; e.ox = 0; e.oy = 0;
      e.x = col * TILE + TILE / 2; e.y = row * TILE + TILE / 2;
      e.act = 'stop'; e.inHole = false; e.isFalling = false;
      if (holeAt(col, row)) { e.act = 'inhole'; e.inHole = true; e.shakeT = 0; if (e.hasGold > 0) guardSpillGold(e, col, row); }
      return true;
    },
    pickupGold: (col, row) => {
      // Accept explicit col/row to avoid race with player motion between
      // setPlayerAt and pickupGold calls.
      if (col === undefined) col = player.col;
      if (row === undefined) row = player.row;
      if (tileAt(col, row) === T_GOLD) {
        setTile(col, row, T_EMPTY);
        player.goldCollected++;
        return true;
      }
      return false;
    },
    forceWin: () => { player.goldCollected = player.goldTotal; triggerWin(); },
    forceGameOver: () => { if (gameState === 'playing') killPlayer(); },
    // Load one of the 150 vendored levels (levels.js) by 1-based id —
    // the same thing the in-game level-select does. Levels without a
    // source player-spawn marker (currently just #150) keep whatever
    // spawn was already set rather than guessing one.
    loadLevel: (id) => loadLevelById(id),
    getCurrentLevelId: () => currentLevelId,
    // Headless play-test hooks (scripts/playtest.py): step the real
    // simulation without drawing, drive the keys, read the grid.
    clearEnemies: () => { enemies = []; },
    setInvulnerable: (on) => { invulnerable = !!on; },
    guardDecision: (i) => guardDecide(enemies[i]),
    getPlayerDebug: () => ({ digging: player.digging, isFalling: player.isFalling, onLadder: player.onLadder, isClimbing: player.isClimbing, facing: player.facing }),
    setPitEscape: (on) => { pitEscape = !!on; },
    tick: (dt) => tick(dt),
    setKeys: (down) => { for (const k of Object.keys(keys)) keys[k] = false; for (const k of down) keys[k] = true; },
    getGrid: () => level.map(r => r.slice()),
    getHoles: () => digHoles.map(h => ({ ...h })),
    getHighestCleared: () => highestCleared,
    getLaddersRevealed: () => laddersRevealed(),
    resetProgress: () => {
      highestCleared = 0;
      try { localStorage.removeItem(PROGRESS_KEY); } catch (err) { /* ignore */ }
    },
    // Level editor test hooks: drive it without real keyboard events.
    enterEditor: (keepExisting) => enterEditor(!!keepExisting),
    editorKey: (code) => handleEditorKey(code),
    getEditorState: () => ({
      tiles: editorTiles.map(r => r.join('')),
      playerSpawn: editorPlayerSpawn,
      cursor: { ...editorCursor },
    }),
    getCustomLevels: () => customLevels,
    // Saves the in-progress editor level without going through
    // window.prompt (which blocks waiting for a real dialog).
    saveEditorLevelAs: (name) => {
      if (!editorPlayerSpawn) return false;
      commitCustomLevel(name);
      return true;
    },
    clearCustomLevels: () => {
      customLevels = [];
      try { localStorage.removeItem(CUSTOM_KEY); } catch (err) { /* ignore */ }
    },
  };

  // ---------------- Boot ----------------
  // Blank grid behind the menu until a level is picked — parseLevel()
  // already treats missing rows/columns as empty, so an empty array is
  // a valid "nothing yet" level.
  level = parseLevel([]);
  digHoles = [];
  buildSpriteCache();
  ctx2d.imageSmoothingEnabled = false;
  loadProgress();
  loadCustomLevels();
  // Default the picker to the next level past your best, not always 1
  // (clamped in case all 150 are already cleared).
  if (highestCleared > 0) {
    selectedLevel = Math.min(highestCleared + 1, officialLevelCount() || highestCleared);
  }
  updateHud();
  renderMenuOverlay();
  requestAnimationFrame(loop);
})();
