/* Lode Runner — in-browser port by Rook.

See README.md for version history. Levels are the 150 originals,
vendored in levels.js — there's no hand-crafted level in this file
anymore (removed in v0.3.6; see the README for what it used to be).
*/

(() => {
  'use strict';

  // ---------------- Constants ----------------
  const TILE = 16;
  const COLS = 32;
  const ROWS = 22;
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

  const PLAYER_SPEED       = 60; // px/s — 2x enemies (RUNNER=35, GRUNTER=25)
  const PLAYER_CLIMB_SPEED = 50;
  const PLAYER_FALL_SPEED  = 200;
  const DIG_RECHARGE_MS    = 350;

  const RUNNER_SPEED     = 35;
  const GRUNTER_SPEED    = 25;
  const ENEMY_FALL_SPEED = 120;
  const ENEMY_RESPAWN_MS = 5000;

  // A dug hole closes back up into a brick after this long. Anyone still
  // standing in it when it closes dies — the player has no way to climb
  // out, and an enemy that hasn't escaped by then gets caught. Enemies
  // get a shorter window to climb back out on their own first, matching
  // "guards can climb out of pits that do not close up around them."
  const HOLE_REFILL_MS   = 4000;
  const ENEMY_ESCAPE_MS  = 2500;

  // ---------------- Level ----------------
  // '.' empty  '#' brick  '|' solid  'L' ladder
  // 'F' free ladder  'g' gold  'r' runner  'R' grunter
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
          case 'F': t = T_FREE_LADDER; break;
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
  function isLadderAt(col, row) {
    const t = tileAt(col, row);
    return t === T_LADDER || t === T_FREE_LADDER;
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
  function spawnEnemiesForLevel() {
    enemies = [];
    for (const spawn of enemySpawns) {
      if (spawn.type === T_RUNNER_SPAWN) {
        enemies.push(makeRunner(spawn.col, spawn.row));
      } else if (spawn.type === T_GRUNTER_SPAWN) {
        enemies.push(makeGrunter(spawn.col, spawn.row));
      }
    }
  }
  function makeRunner(col, row) {
    return {
      kind: 'runner', col, row,
      x: col * TILE + TILE / 2, y: row * TILE + TILE / 2,
      vx: RUNNER_SPEED, vy: 0,
      facing: 1,
      state: 'patrol',
      respawnAt: 0,
      alive: true,
      inHole: false,
      trappedUntil: 0,
      carryingGold: false,
    };
  }
  function makeGrunter(col, row) {
    return {
      kind: 'grunter', col, row,
      x: col * TILE + TILE / 2, y: row * TILE + TILE / 2,
      vx: 0, vy: 0,
      facing: 1,
      state: 'patrol',
      respawnAt: 0,
      alive: true,
      inHole: false,
      trappedUntil: 0,
      carryingGold: false,
    };
  }

  // ---------------- Player movement ----------------
  function resetPlayer() {
    player.col = PLAYER_SPAWN.col;
    player.row = PLAYER_SPAWN.row;
    player.x = player.col * TILE + TILE / 2;
    player.y = player.row * TILE + TILE / 2;
    player.vx = 0; player.vy = 0;
    player.facing = 1;
    player.onLadder = false;
    player.isClimbing = false;
    player.isFalling = false;
    player.digCooldown = 0;
    player.alive = true;
    player.goldCollected = 0;
  }

  function updatePlayer(dt) {
    if (!player.alive) return;
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
    if (!wantsClimb && !player.onLadder && !holdingRope && !isSolidAt(player.col, player.row + 1)) {
      player.isFalling = true;
      dy = 1;
    } else if (isSolidAt(player.col, player.row + 1) || holdingRope) {
      player.isFalling = false;
    }
    // Hmm — that lets dy default to 0 if on ladder and on ground. Good.

    // Apply horizontal movement at proper px/sec rate.
    // The KEY insight: track fractional pixel position (xFrac), and update
    // player.x AND player.col BOTH from that fractional value. No more per-
    // frame tile-snap — player.x equals player.xFx directly every frame.
    if (dx !== 0) {
      if (player.xFx === undefined) player.xFx = player.x;
      player.xFx += dx * PLAYER_SPEED * dt;
      // Check if we crossed a tile boundary in the direction of motion.
      // Compute previous tile index (from player.x) and current tile index
      // (from xFrac). If they differ, we crossed a boundary.
      const oldTile = (dx > 0) ? Math.floor(player.x / TILE) : Math.ceil(player.x / TILE);
      const newTile = (dx > 0) ? Math.floor(player.xFx / TILE) : Math.ceil(player.xFx / TILE);
      if (newTile !== oldTile) {
        // Crossed a boundary. Check destination tile passability.
        const newCol = (dx > 0) ? newTile : newTile;
        if (newCol >= 0 && newCol < COLS && isPassableAt(newCol, player.row)) {
          player.col = newCol;
        } else {
          // Wall — stop at the boundary
          player.xFx = (dx > 0) ? (oldTile * TILE + TILE / 2) : (oldTile * TILE - TILE / 2);
        }
      }
      // Player.x is wherever xFrac ended up. Smooth, continuous.
      player.x = player.xFx;
    } else {
      player.xFx = player.x;
    }
    // Apply vertical movement at proper px/sec rate, continuous motion.
    // Same pattern as horizontal: track fractional pixel position (yFx),
    // snap col on tile boundary.
    if (dy !== 0) {
      if (player.yFx === undefined) player.yFx = player.y;
      player.yFx += dy * PLAYER_CLIMB_SPEED * dt;
      // Compute previous tile index from player.y, current tile from yFx.
      const oldTile = (dy > 0) ? Math.floor(player.y / TILE) : Math.ceil(player.y / TILE);
      const newTile = (dy > 0) ? Math.floor(player.yFx / TILE) : Math.ceil(player.yFx / TILE);
      if (newTile !== oldTile) {
        // Crossed a tile boundary. Check passability.
        const newRow = (dy > 0) ? newTile : newTile;
        let canMove = false;
        if (wantsClimb) {
          canMove = isLadderAt(player.col, player.row) || isLadderAt(player.col, newRow);
        } else {
          // Falling — check destination cell passable
          canMove = isPassableAt(player.col, newRow) || isLadderAt(player.col, newRow);
        }
        if (newRow >= 0 && newRow < ROWS && canMove) {
          player.row = newRow;
        } else {
          // Blocked — snap back to current tile center, reset accumulator
          player.yFx = (dy > 0) ? (oldTile * TILE + TILE / 2) : (oldTile * TILE - TILE / 2);
        }
      }
      player.y = player.yFx;
    } else {
      player.yFx = player.y;
    }

    // Gold pickup
    if (tileAt(player.col, player.row) === T_GOLD) {
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
    // Snap to tile center only at ladder touches or when movement stopped.
    // Otherwise player.x already tracks player.xFrac continuously.
    if (!dx && !dy) {
      player.x = player.col * TILE + TILE / 2;
      player.y = player.row * TILE + TILE / 2;
    }

    // Dig bricks. Targets one row BELOW the player, diagonally — the
    // floor you're standing over, not a wall beside you. (This was
    // previously same-row, which only ever worked on the placeholder
    // level's ladder-embedded floor rows; real levels put the floor
    // under the walking row, so same-row digging couldn't reach it.)
    player.digCooldown = Math.max(0, player.digCooldown - dt);
    if (player.digCooldown <= 0) {
      if (keys['KeyZ']) {
        if (tryDig(player.col - 1, player.row + 1)) {
          player.digCooldown = DIG_RECHARGE_MS / 1000;
        }
      } else if (keys['KeyX']) {
        if (tryDig(player.col + 1, player.row + 1)) {
          player.digCooldown = DIG_RECHARGE_MS / 1000;
        }
      }
    }
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

  function killEnemyInHole(e) {
    e.alive = false;
    e.inHole = false;
    e.respawnAt = performance.now() + ENEMY_RESPAWN_MS;
    Audio.enemyDeath();
  }

  // ---------------- Enemy update ----------------
  // Cleaner, actually-working logic. Both enemy types share a top-level
  // decision tree: falling first (no solid below), then patrol, then
  // chase if player is close on same row.
  function updateEnemies(dt) {
    const now = performance.now();
    for (const e of enemies) {
      if (!e.alive) {
        if (e.respawnAt > 0 && now >= e.respawnAt) {
          const spawn = enemySpawns.find(s => s.type === (e.kind === 'runner' ? T_RUNNER_SPAWN : T_GRUNTER_SPAWN));
          if (spawn) {
            const fresh = e.kind === 'runner' ? makeRunner(spawn.col, spawn.row) : makeGrunter(spawn.col, spawn.row);
            Object.assign(e, fresh);
          }
        }
        continue;
      }

      // Determine current tile from pixel position. A tile-center pixel
      // position is always exactly col*TILE + TILE/2 — a .5 fraction of
      // TILE — so this MUST be floor(), not round(): round() ties break
      // upward in JS and would put every entity sitting at its own
      // tile's center into the tile one column/row over.
      let col = Math.floor(e.x / TILE);
      let row = Math.floor(e.y / TILE);
      if (row < 0) row = 0;
      if (row >= ROWS) row = ROWS - 1;
      // Keep the public col/row fields live every frame — previously
      // these only updated once an enemy landed, so anything reading
      // them (getEnemyPositions(), the trap check below) saw a stale
      // spawn-time tile for an enemy that was still mid-fall.
      e.col = col;
      e.row = row;

      // Guards steal gold they walk over — the level can't be won
      // until it's recovered (win check only counts what the PLAYER
      // has collected), which is the point: some levels require
      // trapping a gold-carrying guard specifically.
      if (tileAt(col, row) === T_GOLD && !e.carryingGold) {
        setTile(col, row, T_EMPTY);
        e.carryingGold = true;
      }

      // 0. Trapped in a dug hole? Enemies caught standing in an open
      // hole are briefly harmless (skipped in the collision pass below)
      // and try to climb back out after ENEMY_ESCAPE_MS. If the hole
      // refills before they escape, updateHoles() kills them.
      const inActiveHole = !!holeAt(col, row);
      if (inActiveHole && !e.inHole) {
        e.inHole = true;
        e.trappedUntil = now + ENEMY_ESCAPE_MS;
        Audio.trap();
        // Trapping releases any gold it was carrying — reappears one
        // tile above the pit, where the player who dug it is standing.
        // (Never drop it in the pit tile itself: the enemy is still
        // standing there, so it would just get immediately re-picked-up
        // next frame.)
        if (e.carryingGold) {
          e.carryingGold = false;
          if (row - 1 >= 0) setTile(col, row - 1, T_GOLD);
        }
      } else if (!inActiveHole && e.inHole) {
        e.inHole = false; // hole was dug elsewhere and this tile refilled/never held one
      }
      if (e.inHole) {
        if (now >= e.trappedUntil && isPassableAt(col, row - 1)) {
          e.y -= TILE; // climb out onto the tile above
          e.inHole = false;
          e.row = row - 1;
        }
        e.row = row;
        continue; // frozen in the pit otherwise — no patrol/chase/fall
      }

      // 1. Falling? If no solid below and not hanging on a rope, fall at
      // fall-speed px/s. Enemies hang on ropes the same as the player —
      // several original levels rely on guards patrolling rope rows
      // instead of dropping straight through them.
      if (!isSolidAt(col, row + 1) && !isRopeAt(col, row)) {
        e.y += ENEMY_FALL_SPEED * dt;
        continue;
      }
      // 2. On solid ground. Snap y to tile-center line, clamp to valid range.
      const groundY = (row + 1) * TILE - TILE / 2;
      const maxY = (ROWS - 1) * TILE + TILE;
      e.y = Math.min(groundY, maxY);
      e.vy = 0;

      // 3. Decide direction: chase player if on same row and close, else patrol.
      let dir = e.facing;
      if (player.row === row && Math.abs(player.col - col) < 8) {
        dir = player.col > col ? 1 : -1;
      }

      // 4. Move horizontally at proper pixel/sec rate (no more per-frame tile jumps).
      const speed = e.kind === 'runner' ? RUNNER_SPEED : GRUNTER_SPEED;
      const nextX = e.x + dir * speed * dt;
      let nextCol = Math.floor(nextX / TILE);
      // Bounce off walls and bricks
      if (nextCol < 0 || nextCol >= COLS) {
        e.facing = -dir;
      } else if (isSolidAt(nextCol, row)) {
        e.facing = -dir;
      } else {
        e.x = nextX;
        e.col = nextCol;
        e.facing = dir;
      }
      e.row = row;
    }

    // Enemy-player collision — trapped enemies are safe to walk over,
    // per the original ("safe for a moment to run over him").
    for (const e of enemies) {
      if (!e.alive || e.inHole) continue;
      if (Math.abs(player.y - e.y) < TILE * 0.7 && Math.abs(player.x - e.x) < TILE * 0.7) {
        killPlayer();
        return;
      }
    }
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
    if (t === T_BRICK) {
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
      // Ladder: 2 vertical rails + 5 horizontal rungs
      ctx2d.fillStyle = COLORS[t];
      ctx2d.fillRect(x + 2, y, 2, TILE);
      ctx2d.fillRect(x + TILE - 4, y, 2, TILE);
      for (let r = 0; r < 5; r++) {
        ctx2d.fillRect(x + 2, y + r * (TILE / 4) + 2, TILE - 4, 2);
      }
    } else if (t === T_ROPE) {
      // Rope: a single taut horizontal line through the tile's vertical
      // center, with a subtle shadow line beneath for depth.
      ctx2d.strokeStyle = COLORS[T_ROPE];
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(x, y + TILE / 2);
      ctx2d.lineTo(x + TILE, y + TILE / 2);
      ctx2d.stroke();
      ctx2d.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.moveTo(x, y + TILE / 2 + 2);
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

  function renderPlayer(px, py) {
    // Small humanoid: head + body + 2 legs, drawn in the player's color
    ctx2d.save();
    ctx2d.translate(px, py);
    // Body (small torso)
    ctx2d.fillStyle = '#fff0a8';
    ctx2d.fillRect(-3, -2, 6, 6);
    // Head
    ctx2d.fillStyle = '#ffd970';
    ctx2d.beginPath();
    ctx2d.arc(0, -4, 3, 0, Math.PI * 2);
    ctx2d.fill();
    // Eyes (facing direction)
    ctx2d.fillStyle = '#000';
    const eyeX = player.facing > 0 ? 1 : -2;
    ctx2d.fillRect(eyeX, -5, 1, 1);
    // Legs (thin vertical lines)
    ctx2d.fillStyle = '#c87850';
    ctx2d.fillRect(-2, 4, 1, 4);
    ctx2d.fillRect(1, 4, 1, 4);
    ctx2d.restore();
  }

  function renderEnemy(e) {
    const x = e.x - TILE / 2;
    const y = e.y - TILE / 2;
    if (e.kind === 'runner') {
      // Runner: tall angular figure in red
      ctx2d.fillStyle = '#ff5544';
      ctx2d.beginPath();
      ctx2d.moveTo(x + 2, y + 2);
      ctx2d.lineTo(x + TILE - 2, y + 2);
      ctx2d.lineTo(x + TILE - 3, y + TILE - 4);
      ctx2d.lineTo(x + 8, y + TILE - 2);
      ctx2d.lineTo(x + 2, y + TILE - 2);
      ctx2d.closePath();
      ctx2d.fill();
      // Eyes (facing direction)
      ctx2d.fillStyle = '#fff';
      ctx2d.fillRect(x + 9, y + 4, 2, 2);
      ctx2d.fillRect(x + 11, y + 4, 1, 2);
    } else {
      // Grunter: rounder purple blob
      ctx2d.fillStyle = '#b07aff';
      ctx2d.beginPath();
      ctx2d.arc(x + TILE / 2, y + TILE / 2, TILE / 2 - 2, 0, Math.PI * 2);
      ctx2d.fill();
      // Eyes
      ctx2d.fillStyle = '#fff';
      ctx2d.fillRect(x + 4, y + 5, 2, 2);
      ctx2d.fillRect(x + 9, y + 5, 2, 2);
      ctx2d.fillStyle = '#000';
      ctx2d.fillRect(x + 5, y + 6, 1, 1);
      ctx2d.fillRect(x + 10, y + 6, 1, 1);
    }
    if (e.carryingGold) {
      // Small gold glint above a guard that's stolen a piece — the
      // level can't be won until this comes back.
      ctx2d.fillStyle = '#ffcc33';
      ctx2d.beginPath();
      ctx2d.arc(x + TILE / 2, y - 2, 3, 0, Math.PI * 2);
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
    // Enemies (drawn before player so player appears on top)
    for (const e of enemies) {
      if (e.alive) renderEnemy(e);
    }
    // Player
    renderPlayer(player.x, player.y);
  }

  // ---------------- HUD ----------------
  const elGold = document.getElementById('gold-count');
  const elStatus = document.getElementById('status');
  const overlay = document.getElementById('overlay');
  const overlayContent = document.getElementById('overlay-content');

  function updateHud() {
    elGold.textContent = `GOLD: ${player.goldCollected}/${player.goldTotal}`;
    elStatus.textContent = gameState.toUpperCase();
  }

  function showOverlay(html) {
    overlayContent.innerHTML = html;
    overlay.classList.remove('hidden');
  }
  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  // The menu screen doubles as a level picker for the 150 vendored
  // levels — Left/Right change the pick, Space starts it. Falls back to
  // the v0.2 placeholder if levels.js somehow isn't loaded.
  function renderMenuOverlay() {
    const total = (typeof window.LEVELS !== 'undefined') ? window.LEVELS.length : 0;
    const picker = total > 0
      ? `<p class="hints"><kbd>&larr;</kbd> <kbd>&rarr;</kbd> Level: ${String(selectedLevel).padStart(3, '0')} / ${total}</p>`
      : '';
    showOverlay(`
      <h1>Lode Runner</h1>
      <p>Collect all the gold. Reach the top. Don't get caught.</p>
      ${picker}
      <p class="hints">
        <span><kbd>&uarr;</kbd> <kbd>&darr;</kbd> Climb</span>
        <span><kbd>Z</kbd> <kbd>X</kbd> Dig</span>
        <span><kbd>M</kbd> Mute</span>
      </p>
      <p class="hints" style="margin-top:1em"><kbd>SPACE</kbd> Start</p>
    `);
  }

  // ---------------- State transitions ----------------
  // Loads one of the 150 vendored levels (levels.js) by 1-based id.
  // Returns false (and leaves state untouched) if levels.js isn't
  // loaded or id is out of range.
  function loadLevelById(id) {
    if (typeof window.LEVELS === 'undefined') return false;
    const lv = window.LEVELS[id - 1];
    if (!lv) return false;
    currentLevelId = id;
    if (lv.playerSpawn) PLAYER_SPAWN = { col: lv.playerSpawn.col, row: lv.playerSpawn.row };
    level = parseLevel(lv.tiles);
    digHoles = [];
    resetPlayer();
    spawnEnemiesForLevel();
    gameState = 'playing';
    hideOverlay();
    updateHud();
    return true;
  }

  function killPlayer() {
    player.alive = false;
    gameState = 'lost';
    const levelTag = currentLevelId !== null ? ` (level ${currentLevelId})` : '';
    showOverlay(`<h2>CAUGHT</h2><p>You collected ${player.goldCollected}/${player.goldTotal} gold${levelTag}.</p><p class="hints"><kbd>SPACE</kbd> Try again</p>`);
    updateHud();
    Audio.playerDeath();
  }

  function triggerWin() {
    gameState = 'won';
    const hasNext = currentLevelId !== null && typeof window.LEVELS !== 'undefined' && window.LEVELS[currentLevelId] !== undefined;
    const hint = hasNext ? `<kbd>SPACE</kbd> Next level (${currentLevelId + 1}/${window.LEVELS.length})` : `<kbd>SPACE</kbd> Back to level select`;
    const title = currentLevelId !== null && !hasNext ? 'ALL LEVELS CLEAR' : 'LEVEL CLEAR';
    showOverlay(`<h2>${title}</h2><p>You collected all ${player.goldTotal} gold.</p><p class="hints">${hint}</p>`);
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
        // Play whichever of the 150 levels is currently picked in the
        // menu's level-select.
        loadLevelById(selectedLevel);
      } else if (gameState === 'won') {
        if (!loadLevelById(currentLevelId + 1)) {
          // Cleared level 150 — back to the picker rather than falling
          // off the end of the campaign.
          gameState = 'menu';
          renderMenuOverlay();
        }
      } else if (gameState === 'lost') {
        loadLevelById(currentLevelId);
      }
      e.preventDefault();
    }
    // Level-select: only at the menu, and only when levels.js actually
    // loaded. Left/Right otherwise mean "run" during play.
    if (gameState === 'menu' && typeof window.LEVELS !== 'undefined'
        && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      const total = window.LEVELS.length;
      selectedLevel += (e.code === 'ArrowRight') ? 1 : -1;
      if (selectedLevel < 1) selectedLevel = total;
      if (selectedLevel > total) selectedLevel = 1;
      renderMenuOverlay();
    }
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  // ---------------- Main loop ----------------
  function loop(t) {
    if (!lastTime) lastTime = t;
    let dt = (t - lastTime) / 1000;
    if (dt > 0.05) dt = 0.05;
    lastTime = t;
    try {
      if (gameState === 'playing') {
        updatePlayer(dt);
        updateEnemies(dt);
        updateHoles();
        updateHud();
      }
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
    getEnemyCount: () => enemies.filter(e => e.alive).length,
    getEnemyPositions: () => enemies.filter(e => e.alive).map(e => ({ kind: e.kind, col: e.col, row: e.row, x: e.x, y: e.y })),
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
      const alive = enemies.filter(e => e.alive);
      const e = alive[index];
      if (!e) return false;
      e.col = col; e.row = row;
      e.x = col * TILE + TILE / 2; e.y = row * TILE + TILE / 2;
      e.inHole = false;
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
  };

  // ---------------- Boot ----------------
  // Blank grid behind the menu until a level is picked — parseLevel()
  // already treats missing rows/columns as empty, so an empty array is
  // a valid "nothing yet" level.
  level = parseLevel([]);
  digHoles = [];
  updateHud();
  renderMenuOverlay();
  requestAnimationFrame(loop);
})();
