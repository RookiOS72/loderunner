/* Lode Runner — in-browser port by Rook.

v0.2 changes from v0.1:
- Player movement speed reduced (80 → 55 px/s) for more deliberate control.
- Brick rendering: actual brick pattern (zigzag mortar lines) instead of
  solid orange rectangles.
- Player sprite: small humanoid stick figure (head, body, legs).
- Enemy sprites: distinctive shapes — Runner is angular/tall, Grunter
  is rounder/shorter.
- Enemy AI rewrite: actually moves. Runners patrol horizontally, chase
  the player on same row. Grunters patrol when grounded, fall when no
  brick is below.
- Level ladders: more ladders placed so the player can climb between
  any two brick rows. Specifically two vertical ladder columns connecting
  rows 7-21.
- Larger collision radius (TILE * 0.8) so contact is reliable.

The classic Atari first level is encoded directly below in LEVEL_ASCII.
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
  const T_EXIT        = 6;
  const T_RUNNER_SPAWN  = 7;
  const T_GRUNTER_SPAWN = 8;

  const PLAYER_SPEED       = 60; // px/s — 2x enemies (RUNNER=35, GRUNTER=25)
  const PLAYER_CLIMB_SPEED = 50;
  const PLAYER_FALL_SPEED  = 200;
  const DIG_RECHARGE_MS    = 350;

  const RUNNER_SPEED     = 35;
  const GRUNTER_SPEED    = 25;
  const ENEMY_FALL_SPEED = 120;
  const ENEMY_RESPAWN_MS = 5000;

  // ---------------- Level ----------------
  // '.' empty  '#' brick  '|' solid  'L' ladder
  // 'F' free ladder  'g' gold  'E' exit  'r' runner  'R' grunter
  // 
  // Layout notes:
  // - Two full vertical ladder columns at cols 1-2 and cols 17-18, running
  //   rows 7-21. So the player can climb between any two brick rows.
  // - Two solid brick rows at rows 12 and 20, plus a partial row at row 16
  //   with a single brick to dig down through.
  // - Gold in each section to require movement through ladders.
  // - Exit at the top center.
  // - One runner and one grunter to chase / patrol.
  const LEVEL_ASCII = [
    "                                ",   // row 0 — top
    "                                ",   // row 1
    "                                ",   // row 2
    "                                ",   // row 3
    "                                ",   // row 4
    "                                ",   // row 5
    "                                ",   // row 6
    "  L                            L ",   // row 7  exit ladders top
    "  L                            L ",   // row 8
    "  L                            L ",   // row 9
    "  L                            L ",   // row 10 (no gold - was floating)
    "  Lg     g      g    g     gL ",   // row 11 gold on top of row 12 bricks
    "  ##  ######  ######  ######  ## ",   // row 12 main brick row
    "  L                            L ",   // row 13
    "  L                            L ",   // row 14
    "  L          g  E          g L ",   // row 15 gold above dig target + exit
    "  L           #               L ",   // row 16 single dig target
    "  L                            L ",   // row 17
    "  L                            L ",   // row 18 (no gold - was floating)
    "  L     g  g          g    g L ",   // row 19 gold above row 20 bricks
    "R ##  ######  ######  ######  ## ",   // row 20 main brick row (bottom)
    "  L                            L ",   // row 21 player spawn (ladders go down to here)
  ];
  const PLAYER_SPAWN = { col: 2, row: 21 }; // on the left ladder

  // ---------------- State ----------------
  let level = [];
  let enemySpawns = [];

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
          case 'g': t = T_GOLD; goldCount++; break;
          case 'E': t = T_EXIT; break;
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
  function isPassableAt(col, row) {
    const t = tileAt(col, row);
    return !(t === T_BRICK || t === T_SOLID);
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

    // Falling: if not on ladder and no solid below, fall down
    if (!wantsClimb && !player.onLadder && !isSolidAt(player.col, player.row + 1)) {
      player.isFalling = true;
      dy = 1;
    } else if (isSolidAt(player.col, player.row + 1)) {
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
    }
    // Snap to tile center only at ladder touches or when movement stopped.
    // Otherwise player.x already tracks player.xFrac continuously.
    if (!dx && !dy) {
      player.x = player.col * TILE + TILE / 2;
      player.y = player.row * TILE + TILE / 2;
    }

    // Dig bricks
    player.digCooldown = Math.max(0, player.digCooldown - dt);
    if (player.digCooldown <= 0) {
      if (keys['KeyZ']) {
        if (tryDig(player.col - 1, player.row)) {
          player.digCooldown = DIG_RECHARGE_MS / 1000;
        }
      } else if (keys['KeyX']) {
        if (tryDig(player.col + 1, player.row)) {
          player.digCooldown = DIG_RECHARGE_MS / 1000;
        }
      }
    }
  }

  function tryDig(col, row) {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
    if (level[row][col] !== T_BRICK) return false;
    setTile(col, row, T_EMPTY);
    return true;
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

      // Determine current tile from pixel position. Snap rows to valid range.
      let col = Math.round(e.x / TILE);
      let row = Math.round(e.y / TILE);
      if (row < 0) row = 0;
      if (row >= ROWS) row = ROWS - 1;

      // 1. Falling? If no solid below, fall at fall-speed px/s.
      if (!isSolidAt(col, row + 1)) {
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
      let nextCol = Math.round(nextX / TILE);
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

    // Enemy-player collision
    for (const e of enemies) {
      if (!e.alive) continue;
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
    [T_GOLD]: '#ffcc33',
    [T_EXIT]: '#aaff66',
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
    } else if (t === T_EXIT) {
      // Exit: green door-like square with a small mark
      ctx2d.fillStyle = COLORS[T_EXIT];
      ctx2d.fillRect(x, y, TILE, TILE);
      ctx2d.strokeStyle = '#000';
      ctx2d.lineWidth = 1;
      ctx2d.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
      ctx2d.fillStyle = '#000';
      ctx2d.fillRect(x + TILE/2 - 1, y + TILE/2 - 3, 2, 6);  // door handle
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

  // ---------------- Audio (silent in v0.1) ----------------
  const Audio = {
    init() {},
    unlock() {},
  };

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

  // ---------------- State transitions ----------------
  function startGame() {
    level = parseLevel(LEVEL_ASCII);
    resetPlayer();
    player.goldCollected = 0;
    player.goldTotal = countGold(level);
    spawnEnemiesForLevel();
    gameState = 'playing';
    hideOverlay();
    updateHud();
  }

  function countGold(lvl) {
    let n = 0;
    for (const row of lvl) for (const t of row) if (t === T_GOLD) n++;
    return n;
  }

  function killPlayer() {
    player.alive = false;
    gameState = 'lost';
    showOverlay(`<h2>CAUGHT</h2><p>You collected ${player.goldCollected}/${player.goldTotal} gold.</p><p class="hints"><kbd>SPACE</kbd> Try again</p>`);
    updateHud();
  }

  function triggerWin() {
    gameState = 'won';
    showOverlay(`<h2>LEVEL CLEAR</h2><p>You collected all ${player.goldTotal} gold.</p><p class="hints"><kbd>SPACE</kbd> Restart</p>`);
    updateHud();
  }

  // ---------------- Input ----------------
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    Audio.unlock();
    if (e.code === 'Space') {
      if (gameState !== 'playing') startGame();
      e.preventDefault();
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
  };

  // ---------------- Boot ----------------
  level = parseLevel(LEVEL_ASCII);
  player.goldTotal = countGold(level);
  updateHud();
  requestAnimationFrame(loop);
})();
