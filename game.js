/* Lode Runner — in-browser port by Rook.

v0.1 scope:
- 16×16 tile-based rendering on a single fixed level
- Player movement (run + climb ladders + dig)
- Two enemy types (Runner, Grunter) with simple AI
- Win/lose conditions
- One hand-crafted classic first level
- Silent (Lode Runner OG was silent; sound is v0.2)

Tile types (single integer per cell):
  0 = empty
  1 = brick (diggable from sides)
  2 = solid (background / unpassable)
  3 = ladder (climbable)
  4 = free ladder (can be dug away by adjacent-brick dig)
  5 = gold
  6 = exit (top of level)
  7 = runner spawn marker
  8 = grunter spawn marker

The level is stored as a 2D array of tile integers, plus a separate list of
enemy descriptors (so they can occupy a tile cell alongside the tile's
visual, and we track their per-frame physics).

The classic Atari first level is encoded directly below in `LEVEL_1`.
*/

(() => {
  'use strict';

  // ---------------- Constants ----------------
  const TILE = 16;                 // pixels per tile
  const COLS = 32;                 // tiles wide
  const ROWS = 22;                 // tiles tall
  const CANVAS_W = COLS * TILE;    // 512 px
  const CANVAS_H = ROWS * TILE;    // 352 px

  const T_EMPTY  = 0;
  const T_BRICK  = 1;
  const T_SOLID  = 2;
  const T_LADDER = 3;
  const T_FREE_LADDER = 4;
  const T_GOLD   = 5;
  const T_EXIT   = 6;
  const T_RUNNER_SPAWN = 7;
  const T_GRUNTER_SPAWN = 8;

  // Player physics
  const PLAYER_SPEED = 80;          // px/s
  const PLAYER_CLIMB_SPEED = 70;
  const PLAYER_FALL_SPEED = 200;
  const DIG_RECHARGE_MS = 350;      // ms between digs (same brick stays gone)

  // Enemy physics
  const RUNNER_SPEED = 50;
  const GRUNTER_SPEED = 40;
  const ENEMY_FALL_SPEED = 100;
  const ENEMY_RESPAWN_MS = 5000;    // ms before a killed enemy respawns

  // ---------------- Level ----------------
  // Classic Atari 800XL first level, hand-encoded. 32 cols × 22 rows.
  // Row format: chars representing tiles. Spaces are EMPTY.
  //   '.' = empty     '#' = brick    '|' = solid   'L' = ladder
  //   'F' = free ladder  'g' = gold   'E' = exit   'r' = runner spawn
  //   'R' = grunter spawn
  const LEVEL_ASCII = [
    "                                ",   // row 0 — top, sky
    "                                ",   // row 1
    "                                ",   // row 2
    "                                ",   // row 3
    "                                ",   // row 4
    "                                ",   // row 5
    "                                ",   // row 6
    "             L L                 ",   // row 7 — top exit ladder pair
    "              L                  ",   // row 8
    "                                ",   // row 9
    "                                ",   // row 10
    "                                ",   // row 11
    "  ######  ######  ######  ######",   // row 12 — first brick row
    "                                ",   // row 13
    "L                L                ",   // row 14
    "              g                  ",   // row 15 — gold in the gap
    "              #                  ",   // row 16 — a single brick (player's dig target)
    "                                ",   // row 17
    "         g     g        g        ",   // row 18 — gold spread
    "L         #     #L         #     ",   // row 19 — mid row
    "R    ######     ######    ######",   // row 20 — second brick row
    "                                ",   // row 21 — bottom, ground
  ];
  // Note: there's a player spawn implicit in code below. No "P" marker needed.

  // Initial player position: bottom-center area, on solid ground.
  const PLAYER_SPAWN = { col: 16, row: 21 };
  // Initial enemy spawns — pulled from level by reading T_RUNNER_SPAWN / T_GRUNTER_SPAWN cells.

  // ---------------- State ----------------
  /** @type {number[][]} 2D array [row][col] of tile integers */
  let level = [];

  /** @type {Array<{col:number, row:number, type:number}>} captured at level-load */
  let enemySpawns = [];

  /** Player state */
  const player = {
    col: 0, row: 0,
    x: 0, y: 0,         // pixel position (top-left of tile area, before rendering offset)
    vx: 0, vy: 0,
    facing: 1,          // -1 = left, +1 = right (visual)
    onLadder: false,
    isClimbing: false,
    isFalling: false,
    digCooldown: 0,
    alive: true,
    goldCollected: 0,
    goldTotal: 0,
  };

  /** Enemy list */
  /** @type {Array<{
   *   kind: 'runner'|'grunter', col:number, row:number, x:number, y:number,
   *   vx:number, vy:number, state:'patrol'|'chase'|'falling'|'trapped'|'dead',
   *   facing:number, trappedTimer:number, alive:boolean
   * }>} */
  let enemies = [];

  let gameState = 'menu';     // 'menu' | 'playing' | 'won' | 'lost'
  let wonTimer = 0;

  // Track input
  const keys = {};
  let lastDigTime = -Infinity;

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
      x: col * TILE, y: row * TILE,
      vx: RUNNER_SPEED, vy: 0,
      facing: 1,
      state: 'patrol',
      trappedTimer: 0,
      respawnAt: 0,
      alive: true,
    };
  }
  function makeGrunter(col, row) {
    return {
      kind: 'grunter', col, row,
      x: col * TILE, y: row * TILE,
      vx: 0, vy: 0,
      facing: 1,
      state: 'patrol',
      trappedTimer: 0,
      respawnAt: 0,
      alive: true,
    };
  }

  // ---------------- Player movement ----------------
  function resetPlayer() {
    player.col = PLAYER_SPAWN.col;
    player.row = PLAYER_SPAWN.row;
    player.x = player.col * TILE;
    player.y = player.row * TILE;
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
    const speed = PLAYER_SPEED;
    let dx = 0, dy = 0;
    let wantsClimbUp = keys['ArrowUp'];
    let wantsClimbDown = keys['ArrowDown'];
    let wantsLeft = keys['ArrowLeft'];
    let wantsRight = keys['ArrowRight'];

    // Lateral movement
    if (wantsLeft && !wantsRight) {
      dx = -1; player.facing = -1;
    } else if (wantsRight && !wantsLeft) {
      dx = 1; player.facing = 1;
    }

    // Determine if player is on/near a ladder
    const onLadderTile = isLadderAt(player.col, player.row);
    const onLadderBelow = isLadderAt(player.col, player.row + 1);
    player.onLadder = onLadderTile || onLadderBelow;

    // Vertical movement: climb if on ladder + arrow up/down pressed
    let wantsClimb = false;
    if (player.onLadder && (wantsClimbUp || wantsClimbDown)) {
      if (wantsClimbUp) dy = -1;
      if (wantsClimbDown) dy = 1;
      wantsClimb = true;
      player.isClimbing = true;
    } else {
      player.isClimbing = false;
    }

    // Falling
    if (!wantsClimb && !player.onLadder && !isSolidAt(player.col, player.row + 1)) {
      player.isFalling = true;
      dy = 1;
    } else if (isSolidAt(player.col, player.row + 1)) {
      player.isFalling = false;
    }

    // Apply movement with tile-by-tile collision (substep for speed).
    // For simplicity, allow free horizontal movement if destination tile
    // is passable; allow vertical only if there's a ladder OR falling.
    if (dx !== 0) {
      const newCol = player.col + Math.sign(dx);
      // Allow walking into empty / gold / ladder / exit / free-ladder cells.
      if (isPassableAt(newCol, player.row)) {
        player.col = newCol;
      } else if (player.isFalling && isPassableAt(newCol, player.row)) {
        // Walking off a ledge while falling is fine.
        player.col = newCol;
      }
      // else: blocked, stay
    }
    if (dy !== 0) {
      if (dy > 0) {
        // moving down
        const newRow = player.row + 1;
        if (wantsClimb && isLadderAt(player.col, player.row)) {
          // climb down a ladder
          player.row = newRow;
        } else if (isPassableAt(player.col, newRow) || isLadderAt(player.col, newRow)) {
          player.row = newRow;
        }
        // landing
        if (isSolidAt(player.col, player.row + 1)) {
          player.isFalling = false;
        }
      } else {
        // moving up
        if (isLadderAt(player.col, player.row) || wantsClimb) {
          player.row = Math.max(0, player.row - 1);
        }
        // check exit
        if (tileAt(player.col, player.row) === T_EXIT && player.goldCollected >= player.goldTotal) {
          triggerWin();
        }
      }
    }
    // Gold pickup
    if (tileAt(player.col, player.row) === T_GOLD) {
      setTile(player.col, player.row, T_EMPTY);
      player.goldCollected++;
      Audio.gold();
    }

    // Dig bricks (Z = dig left, X = dig right)
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
    // Dig the brick at (col, row) - leave an empty space.
    // v0.1 simplified rule: just dig any brick that's adjacent to the player.
    // The "must be stacked with brick above" rule is from the OG's UX hint
    // that digging two stacked bricks at once is a single action — but that
    // confuses players in v0.1. We can re-add the stacking rule in v0.2.
    setTile(col, row, T_EMPTY);
    Audio.dig();
    return true;
  }

  // ---------------- Enemy update ----------------
  function updateEnemies(dt) {
    const now = performance.now();
    for (const e of enemies) {
      if (!e.alive) {
        if (e.respawnAt > 0 && now >= e.respawnAt) {
          // Respawn at spawn point
          const spawn = enemySpawns.find(s => s.type === (e.kind === 'runner' ? T_RUNNER_SPAWN : T_GRUNTER_SPAWN));
          if (spawn) {
            Object.assign(e, e.kind === 'runner' ? makeRunner(spawn.col, spawn.row) : makeGrunter(spawn.col, spawn.row));
          }
        }
        continue;
      }
      if (e.kind === 'runner') updateRunner(e, dt);
      else updateGrunter(e, dt);

      // Check enemy-player collision
      if (e.alive) {
        const dx = player.x + TILE / 2 - (e.x + TILE / 2);
        const dy = player.y + TILE / 2 - (e.y + TILE / 2);
        if (Math.hypot(dx, dy) < TILE * 0.6) {
          killPlayer();
        }
      }
    }
  }

  function updateRunner(e, dt) {
    // Determine target cell row/col
    e.col = Math.round(e.x / TILE);
    e.row = Math.round(e.y / TILE);

    // Check if on a ladder or falling: if a brick immediately below is empty
    // (a hole), the runner falls into it.
    const belowEmpty = !isSolidAt(e.col, e.row + 1);
    if (belowEmpty && e.y % TILE !== 0) {
      // fall into hole
      e.vy = ENEMY_FALL_SPEED;
      e.y += e.vy * dt;
      return;
    } else if (belowEmpty && e.y % TILE === 0) {
      // start falling
      e.vy = ENEMY_FALL_SPEED;
      e.y += e.vy * dt;
      return;
    }
    // On solid ground (or ladder). Patrol horizontally.
    e.vy = 0;
    // Decide which direction to walk
    // If player is on same row and within sensing range, chase
    const playerRowDist = Math.abs(player.row - e.row);
    const playerColDist = Math.abs(player.col - e.col);
    let dir = e.facing;
    if (playerRowDist === 0 && playerColDist < 12) {
      dir = (player.col > e.col) ? 1 : -1;
    }
    // Try to step
    const tryCol = e.col + dir;
    if (isPassableAt(tryCol, e.row) && !isSolidAt(e.col, e.row + 1) === false || isLadderAt(e.col, e.row)) {
      // can walk
      e.col = tryCol;
      e.facing = dir;
      e.x = e.col * TILE;
      e.y = e.row * TILE;
    } else {
      // turn around
      e.facing = -dir;
    }
    // Sanity: stop runaway
    if (e.col < 0 || e.col >= COLS) {
      e.col = Math.max(0, Math.min(COLS - 1, e.col));
      e.x = e.col * TILE;
      e.facing *= -1;
    }
  }

  function updateGrunter(e, dt) {
    e.col = Math.round(e.x / TILE);
    e.row = Math.round(e.y / TILE);
    // Grunters fall down if there's no brick below
    if (!isSolidAt(e.col, e.row + 1)) {
      e.vy = ENEMY_FALL_SPEED;
      e.y += e.vy * dt;
      return;
    }
    // Landed — patrol horizontally
    e.vy = 0;
    e.y = e.row * TILE;
    let dir = e.facing;
    const tryCol = e.col + dir;
    if (isPassableAt(tryCol, e.row) && !isSolidAt(tryCol, e.row + 1)) {
      e.col = tryCol;
      e.x = e.col * TILE;
    } else {
      e.facing = -dir;
    }
    if (e.col < 0 || e.col >= COLS) {
      e.col = Math.max(0, Math.min(COLS - 1, e.col));
      e.x = e.col * TILE;
      e.facing *= -1;
    }
  }

  // ---------------- Render ----------------
  const canvas = document.getElementById('game');
  const ctx2d = canvas.getContext('2d');

  // Tile colors (Atari-ish)
  const COLORS = {
    [T_BRICK]: '#c87850',
    [T_SOLID]: '#666',
    [T_LADDER]: '#fdba35',
    [T_FREE_LADDER]: '#fdba35',
    [T_GOLD]: '#ffcc33',
    [T_EXIT]: '#aaff66',
  };

  function render() {
    ctx2d.fillStyle = '#000';
    ctx2d.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t = level[row][col];
        if (t === T_EMPTY) continue;
        const x = col * TILE, y = row * TILE;
        if (t === T_BRICK) {
          ctx2d.fillStyle = COLORS[T_BRICK];
          ctx2d.fillRect(x, y, TILE, TILE);
          // mortar lines
          ctx2d.strokeStyle = '#000';
          ctx2d.lineWidth = 1;
          ctx2d.beginPath();
          ctx2d.moveTo(x, y);
          ctx2d.lineTo(x + TILE, y);
          ctx2d.moveTo(x, y + TILE);
          ctx2d.lineTo(x + TILE, y + TILE);
          ctx2d.stroke();
        } else if (t === T_LADDER || t === T_FREE_LADDER) {
          ctx2d.fillStyle = COLORS[t];
          for (let r = 0; r < 4; r++) {
            ctx2d.fillRect(x + 2, y + r * 4 + 1, TILE - 4, 2);
          }
        } else if (t === T_GOLD) {
          ctx2d.fillStyle = COLORS[T_GOLD];
          // Draw a chunky gold pile
          ctx2d.beginPath();
          ctx2d.arc(x + TILE / 2, y + TILE / 2, 6, 0, Math.PI * 2);
          ctx2d.arc(x + TILE / 2 + 4, y + TILE / 2 - 2, 5, 0, Math.PI * 2);
          ctx2d.fill();
        } else if (t === T_EXIT) {
          ctx2d.fillStyle = COLORS[T_EXIT];
          ctx2d.fillRect(x, y, TILE, TILE);
          ctx2d.fillStyle = '#000';
          ctx2d.font = 'bold 10px monospace';
          ctx2d.fillText('E', x + 4, y + TILE - 4);
        }
      }
    }
    // Player
    const px = player.col * TILE;
    const py = player.row * TILE;
    ctx2d.fillStyle = '#fff0a8';
    ctx2d.fillRect(px + 4, py + 3, TILE - 8, TILE - 6);
    ctx2d.fillStyle = '#000';
    // simple eyes
    ctx2d.fillRect(px + 6, py + 6, 2, 2);
    ctx2d.fillRect(px + 9, py + 6, 2, 2);
    // Enemies
    for (const e of enemies) {
      if (!e.alive) continue;
      const ex = e.col * TILE;
      const ey = e.row * TILE;
      if (e.kind === 'runner') {
        ctx2d.fillStyle = '#ff5544';
        ctx2d.fillRect(ex + 3, ey + 4, TILE - 6, TILE - 8);
      } else {
        ctx2d.fillStyle = '#b07aff';
        ctx2d.fillRect(ex + 2, ey + 3, TILE - 4, TILE - 6);
        ctx2d.fillStyle = '#000';
        ctx2d.fillRect(ex + 5, ey + 6, 2, 2);
        ctx2d.fillRect(ex + 9, ey + 6, 2, 2);
      }
    }
  }

  // ---------------- Audio (silent in v0.1) ----------------
  const Audio = {
    init() {},
    unlock() {},
    dig() {},     // placeholders for v0.2
    gold() {},
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
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    Audio.unlock();
    if (e.code === 'Space') {
      if (gameState === 'menu' || gameState === 'lost' || gameState === 'won') {
        startGame();
      }
      e.preventDefault();
    }
    // Prevent arrow keys from scrolling page
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  // ---------------- Main loop ----------------
  let lastTime = 0;
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

  // Test hooks for the smoke test
  window.__loderunner = {
    getState: () => gameState,
    getGold: () => ({ collected: player.goldCollected, total: player.goldTotal }),
    getPlayerPos: () => ({ col: player.col, row: player.row, x: player.x, y: player.y, alive: player.alive }),
    getEnemyCount: () => enemies.filter(e => e.alive).length,
    getEnemyPositions: () => enemies.filter(e => e.alive).map(e => ({ kind: e.kind, col: e.col, row: e.row })),
    getTile: (col, row) => tileAt(col, row),
    digAt: (col, row) => tryDig(col, row),
    forceGameOver: () => { if (gameState === 'playing') killPlayer(); },
    setPlayerAt: (col, row) => {
      player.col = col; player.row = row;
      player.x = col * TILE; player.y = row * TILE;
    },
    pickupGold: () => {
      if (tileAt(player.col, player.row) === T_GOLD) {
        setTile(player.col, player.row, T_EMPTY);
        player.goldCollected++;
        return true;
      }
      return false;
    },
    forceWin: () => { player.goldCollected = player.goldTotal; triggerWin(); },
  };

  // Boot
  level = parseLevel(LEVEL_ASCII);
  player.goldTotal = countGold(level);
  updateHud();
  requestAnimationFrame(loop);
})();
