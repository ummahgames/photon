// ============================================================
// Photon Breaker – full game in a single plain-JS file
// ============================================================

"use strict";

// ---- Virtual resolution & config ----
const W = 360, H = 640;
const GRID_COLS   = 8;
const TOP_MARGIN  = 60;
const CELL_W      = W / GRID_COLS;
const CELL_H      = 28;
const BLOCK_PAD   = 2;
const BAND_H      = 60;                       // bottom launch band height
const LAUNCH_Y    = H - BAND_H / 2;
const PHOTON_R    = 5;
const PHOTON_SPEED = 420;                      // virtual px / sec
const FIRE_INTERVAL = 0.065;                   // seconds between sequential launches
const PHYSICS_DT  = 1 / 120;
const MAX_PHOTONS = 60;
const BLOCK_SPAWN_CHANCE = 0.65;
const POWERUP_CHANCE     = 0.18;               // slightly higher chance
const SPEED_SCALE_INTERVAL = 10;               // every N levels, slight speed bump
const SPEED_SCALE_AMOUNT   = 0.04;

// ---- Phases ----
const AIMING       = 0;
const FIRING       = 1;
const SIMULATING   = 2;
const ROUND_END    = 3;
const ADVANCE      = 4;
const GAME_OVER    = 5;

// ---- Power-up kinds ----
const PW = { MULTI: "M", POWER: "P", PIERCE: "X", BIG: "B", SPEED: "S", FLAME: "F", LASER: "L", HINT: "H" };
const PW_COLORS = { M: "#7ec8e3", P: "#f7b731", X: "#a55eea", B: "#26de81", S: "#fd9644", F: "#fc5c65", L: "#45aaf2", H: "#dfe6e9" };
const PW_LABELS = { M: "+1 Ball!", P: "+1 Power!", X: "Pierce!", B: "Big Ball!", S: "+Speed!", F: "Fire Ball!", L: "Laser!", H: "+1 Hint!" };
const PW_ICONS  = { M: "+1", P: "POW", X: ">>", B: "BIG", S: "FAST", F: "FIRE", L: "ZAP", H: "EYE" };

// Weighted power-up selection: MULTI (+1 ball) is much more common
const PW_WEIGHTS = [
  { kind: PW.MULTI,  weight: 40 },
  { kind: PW.POWER,  weight: 12 },
  { kind: PW.PIERCE, weight: 7  },
  { kind: PW.BIG,    weight: 8  },
  { kind: PW.SPEED,  weight: 8  },
  { kind: PW.FLAME,  weight: 7  },
  { kind: PW.LASER,  weight: 6  },
  { kind: PW.HINT,   weight: 7  },
];
const PW_TOTAL_WEIGHT = PW_WEIGHTS.reduce((s, w) => s + w.weight, 0);

function randomPowerUp() {
  let r = Math.random() * PW_TOTAL_WEIGHT;
  for (const pw of PW_WEIGHTS) {
    r -= pw.weight;
    if (r <= 0) return pw.kind;
  }
  return PW.MULTI;
}

// ---- Block color bands – vibrant neon palette ----
const BLOCK_COLORS = [
  "#00c6ff", "#00e676", "#ffea00", "#ff9100",
  "#ff1744", "#d500f9", "#00e5ff", "#ff6d00"
];
// Darker shade of each color for block gradients
const BLOCK_COLORS_DARK = [
  "#0088b3", "#009e4f", "#b3a400", "#b36500",
  "#b3102f", "#9500ae", "#00a1b3", "#b34c00"
];
// Glow color (slightly transparent) for block borders
const BLOCK_GLOW = [
  "rgba(0,198,255,0.5)", "rgba(0,230,118,0.5)", "rgba(255,234,0,0.5)", "rgba(255,145,0,0.5)",
  "rgba(255,23,68,0.5)", "rgba(213,0,249,0.5)", "rgba(0,229,255,0.5)", "rgba(255,109,0,0.5)"
];

// ---- Background stars ----
const STARS = [];
for (var _si = 0; _si < 60; _si++) {
  STARS.push({ x: Math.random() * W, y: Math.random() * H, r: 0.4 + Math.random() * 1.2, a: 0.2 + Math.random() * 0.5, speed: 0.1 + Math.random() * 0.3 });
}

// ---- Canvas setup ----
const canvas = document.getElementById("game");
const ctx    = canvas.getContext("2d");
let scale = 1, offsetX = 0, offsetY = 0;

function resize() {
  const ar = W / H;
  let cw = window.innerWidth, ch = window.innerHeight;
  if (cw / ch > ar) { scale = ch / H; } else { scale = cw / W; }
  canvas.width  = Math.floor(W * scale);
  canvas.height = Math.floor(H * scale);
  offsetX = (window.innerWidth  - canvas.width)  / 2;
  offsetY = (window.innerHeight - canvas.height) / 2;
  canvas.style.left = "50%";
  canvas.style.top  = "50%";
}
window.addEventListener("resize", resize);
resize();

function toVirtual(px, py) {
  const rect = canvas.getBoundingClientRect();
  return { x: (px - rect.left) / scale, y: (py - rect.top) / scale };
}

// ---- Audio ----
let audioCtx = null, muted = false;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { /* Audio not supported */ }
  }
  // Resume suspended context (required by iOS Safari)
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}
let lastSoundTime = 0;
function playTone(freq, dur, vol) {
  if (muted || !audioCtx) return;
  const now = audioCtx.currentTime;
  if (now - lastSoundTime < 0.025) return;      // throttle
  lastSoundTime = now;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + dur);
  } catch (e) { /* ignore audio errors */ }
}
function sfxHit()   { playTone(600 + Math.random() * 200, 0.08, 0.10); }
function sfxBreak() { playTone(900 + Math.random() * 300, 0.14, 0.13); }
function sfxPower() { playTone(1200, 0.18, 0.10); }
function sfxLaser() { playTone(200, 0.35, 0.15); }

document.getElementById("muteBtn").addEventListener("click", function() {
  muted = !muted;
  document.getElementById("muteBtn").textContent = muted ? "Unmute" : "Mute";
});

// ---- Object pools ----
function makePool(factory) {
  var pool = [];
  return {
    get: function()  { return pool.length ? pool.pop() : factory(); },
    release: function(o) { pool.push(o); }
  };
}
const photonPool = makePool(function() { return { x:0,y:0,vx:0,vy:0,r:PHOTON_R,active:false,returned:false,returnX:0,damage:1,pierce:0,type:"normal" }; });

// ---- Floating text popups ----
let floatingTexts = [];

function spawnFloatingText(x, y, text, color) {
  floatingTexts.push({ x: x, y: y, text: text, color: color, life: 1.0 });
}

// ---- Game state ----
let phase, level, score, ballCount, launchX;
let photons, blocks;
let fireQueue, fireTimer;
let firstReturnX, photonsReturned;
let aimDir, aiming;
let nextBuffs;          // one-shot buffs (flame, laser, pierce, big) – reset after firing
let permUpgrades;       // persistent upgrades (power, speed, hint) – kept forever
let fadingBlocks;

function initGame() {
  phase = AIMING;
  level = 0;
  score = 0;
  ballCount = 1;
  launchX = W / 2;
  photons = [];
  blocks = [];
  fadingBlocks = [];
  floatingTexts = [];
  laserBeam = null;
  fireQueue = 0;
  fireTimer = 0;
  firstReturnX = null;
  photonsReturned = 0;
  aimDir = null;
  aiming = false;
  nextBuffs = freshBuffs();
  permUpgrades = { addDamage: 0, speedMul: 1.0, hintBounces: 2 };
  advanceLevel();
}

function freshBuffs() {
  return { big: false, flame: false, laser: false, pierce: 0 };
}

document.getElementById("restartBtn").addEventListener("click", function() { ensureAudio(); initGame(); });

// ---- Block helpers ----
function blockX(col) { return col * CELL_W + BLOCK_PAD; }
function blockY(row) { return TOP_MARGIN + row * CELL_H + BLOCK_PAD; }
function blockW()    { return CELL_W - BLOCK_PAD * 2; }
function blockH()    { return CELL_H - BLOCK_PAD * 2; }

function makeBlock(row, col, hp, power) {
  return { row: row, col: col, x: blockX(col), y: blockY(row), w: blockW(), h: blockH(), hp: hp, maxHp: hp, power: power, alive: true };
}

function blockColor(hp) { return BLOCK_COLORS[(hp - 1) % BLOCK_COLORS.length]; }

// ---- Level generation ----
function advanceLevel() {
  level++;
  // Shift existing blocks down
  for (var i = blocks.length - 1; i >= 0; i--) {
    var b = blocks[i];
    b.row++;
    b.y = blockY(b.row);
    if (b.y + b.h > H - BAND_H) { phase = GAME_OVER; return; }
  }
  // Spawn new row (row 0)
  var spawned = 0;
  var hasPowerUp = false;
  for (var c = 0; c < GRID_COLS; c++) {
    if (Math.random() < BLOCK_SPAWN_CHANCE) {
      var hp;
      if (level <= 5) hp = level;
      else hp = randInt(Math.max(1, level - 2), level);
      var power = null;
      if (Math.random() < POWERUP_CHANCE) {
        power = randomPowerUp();
        hasPowerUp = true;
      }
      blocks.push(makeBlock(0, c, hp, power));
      spawned++;
    }
  }
  // Ensure at least 1 block
  if (spawned === 0) {
    var rc = randInt(0, GRID_COLS - 1);
    var rhp = level <= 5 ? level : randInt(Math.max(1, level - 2), level);
    blocks.push(makeBlock(0, rc, rhp, null));
  }
  // Guarantee a power-up every 2 levels, biased toward +1 ball
  if (!hasPowerUp && level % 2 === 0) {
    var row0 = [];
    for (var j = 0; j < blocks.length; j++) {
      if (blocks[j].row === 0 && !blocks[j].power) row0.push(blocks[j]);
    }
    if (row0.length) {
      row0[randInt(0, row0.length - 1)].power = Math.random() < 0.5 ? PW.MULTI : randomPowerUp();
    }
  }
  phase = AIMING;
}

function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

// ---- Input ----
// Mouse: trajectory follows cursor at all times, click to fire.
// Touch: hold to aim (trajectory follows finger), release to fire.
var mouseVirtX = W / 2, mouseVirtY = 0;
var touchDragging = false;  // true while a touch is held down

function updateAimFromPointer(px, py) {
  var p = toVirtual(px, py);
  mouseVirtX = p.x;
  mouseVirtY = p.y;
  var dx = mouseVirtX - launchX, dy = mouseVirtY - LAUNCH_Y;
  if (dy < -10) {
    var len = Math.hypot(dx, dy);
    aimDir = { x: dx / len, y: dy / len };
    aiming = true;
  } else {
    aiming = false;
    aimDir = null;
  }
}

// --- Mouse input (trajectory always follows, click fires) ---
canvas.addEventListener("mousemove", function(e) {
  if (phase === AIMING) {
    updateAimFromPointer(e.clientX, e.clientY);
  }
});
canvas.addEventListener("mousedown", function(e) {
  ensureAudio();
  if (phase === GAME_OVER) { initGame(); return; }
  if (phase !== AIMING) return;
  updateAimFromPointer(e.clientX, e.clientY);
  if (aiming && aimDir) {
    startFiring();
  }
});

// --- Touch input (hold to aim, drag to adjust, release to fire) ---
canvas.addEventListener("touchstart", function(e) {
  e.preventDefault();
  ensureAudio();
  if (phase === GAME_OVER) { initGame(); return; }
  if (phase !== AIMING) return;
  touchDragging = true;
  if (e.touches.length > 0) {
    updateAimFromPointer(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });

canvas.addEventListener("touchmove", function(e) {
  e.preventDefault();
  if (touchDragging && phase === AIMING && e.touches.length > 0) {
    updateAimFromPointer(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });

canvas.addEventListener("touchend", function(e) {
  e.preventDefault();
  if (touchDragging && phase === AIMING && aiming && aimDir) {
    startFiring();
  }
  touchDragging = false;
}, { passive: false });

canvas.addEventListener("touchcancel", function(e) {
  touchDragging = false;
}, { passive: false });

// ---- Firing ----
function startFiring() {
  // If laser buff is active, fire instant beam first
  if (nextBuffs.laser) {
    fireLaserBeam();
    nextBuffs.laser = false;
  }
  phase = FIRING;
  fireQueue = ballCount;
  fireTimer = 0;
  firstReturnX = null;
  photonsReturned = 0;
}

function spawnPhoton() {
  if (photons.length >= MAX_PHOTONS) return;
  var p = photonPool.get();
  var speedMul = (1 + Math.floor((level - 1) / SPEED_SCALE_INTERVAL) * SPEED_SCALE_AMOUNT) * permUpgrades.speedMul;
  var spd = PHOTON_SPEED * speedMul;
  p.x = launchX; p.y = LAUNCH_Y;
  p.vx = aimDir.x * spd; p.vy = aimDir.y * spd;
  p.r = nextBuffs.big ? PHOTON_R * 1.8 : PHOTON_R;
  p.active = true;
  p.returned = false;
  p.returnX = 0;
  p.damage = 1 + permUpgrades.addDamage;
  p.pierce = nextBuffs.pierce || 0;
  p.type = nextBuffs.flame ? "flame" : "normal";
  photons.push(p);
}

// ---- Physics ----
function updatePhysics(dt) {
  // Photons
  for (var i = photons.length - 1; i >= 0; i--) {
    var p = photons[i];
    if (!p.active) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Wall bounces
    if (p.x - p.r < 0)    { p.x = p.r;       p.vx = Math.abs(p.vx); }
    if (p.x + p.r > W)    { p.x = W - p.r;   p.vx = -Math.abs(p.vx); }
    if (p.y - p.r < 0)    { p.y = p.r;       p.vy = Math.abs(p.vy); }

    // Bottom return
    if (p.y + p.r > LAUNCH_Y + 10) {
      p.active = false;
      p.returned = true;
      p.returnX = clamp(p.x, PHOTON_R, W - PHOTON_R);
      if (firstReturnX === null) firstReturnX = p.returnX;
      photonsReturned++;
      continue;
    }

    // Block collisions
    resolveBlockCollisions(p);
  }

  // Laser beam fade
  if (laserBeam) {
    laserBeam.life -= dt * 2.0;
    if (laserBeam.life <= 0) laserBeam = null;
  }

  // Floating texts
  for (var i = floatingTexts.length - 1; i >= 0; i--) {
    var ft = floatingTexts[i];
    ft.y -= dt * 40;
    ft.life -= dt * 1.2;
    if (ft.life <= 0) floatingTexts.splice(i, 1);
  }

  // Fading blocks
  for (var i = fadingBlocks.length - 1; i >= 0; i--) {
    fadingBlocks[i].fade -= dt * 3;
    if (fadingBlocks[i].fade <= 0) fadingBlocks.splice(i, 1);
  }
}

function resolveBlockCollisions(p) {
  for (var i = blocks.length - 1; i >= 0; i--) {
    var b = blocks[i];
    if (!b.alive) continue;

    // Circle vs AABB
    var cx = clamp(p.x, b.x, b.x + b.w);
    var cy = clamp(p.y, b.y, b.y + b.h);
    var dx = p.x - cx, dy = p.y - cy;
    var dist2 = dx * dx + dy * dy;
    if (dist2 >= p.r * p.r) continue;

    // Hit!
    var dmg = p.type === "flame" ? p.damage + 1 : p.damage;
    b.hp -= dmg;
    score += 1;
    sfxHit();

    if (b.hp <= 0) {
      b.alive = false;
      score += 5;
      sfxBreak();
      fadingBlocks.push({ x: b.x, y: b.y, w: b.w, h: b.h, color: blockColor(b.maxHp), fade: 1 });
      // Auto-collect power-up immediately on block break
      if (b.power) {
        collectPowerUp(b.power, b.x + b.w / 2, b.y + b.h / 2);
      }
      blocks.splice(i, 1);
    }

    // Pierce
    if (p.pierce > 0) { p.pierce--; continue; }

    // Reflect
    var dist = Math.sqrt(dist2) || 0.001;
    var nx = dx / dist, ny = dy / dist;
    p.x = cx + nx * (p.r + 0.5);
    p.y = cy + ny * (p.r + 0.5);
    var dot = p.vx * nx + p.vy * ny;
    p.vx -= 2 * dot * nx;
    p.vy -= 2 * dot * ny;
    return;
  }
}

function collectPowerUp(kind, x, y) {
  score += 10;
  sfxPower();
  // Floating text popup
  var label = PW_LABELS[kind] || "Power!";
  var color = PW_COLORS[kind] || "#fff";
  spawnFloatingText(x, y, label, color);
  switch (kind) {
    case PW.MULTI:  ballCount++; break;
    case PW.POWER:  permUpgrades.addDamage++; break;           // permanent
    case PW.SPEED:  permUpgrades.speedMul += 0.1; break;       // permanent +10%
    case PW.HINT:   permUpgrades.hintBounces++; break;          // permanent +1 trajectory segment
    case PW.PIERCE: nextBuffs.pierce += 2; break;
    case PW.BIG:    nextBuffs.big = true; break;
    case PW.FLAME:  nextBuffs.flame = true; break;
    case PW.LASER:  nextBuffs.laser = true; break;
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ---- Laser beam (instant red beam that destroys blocks in path) ----
var laserBeam = null; // { pts: [{x,y},...], life: 1.0 } when active

function fireLaserBeam() {
  if (!aimDir) return;
  sfxLaser();
  var pts = [{ x: launchX, y: LAUNCH_Y }];
  var rx = launchX, ry = LAUNCH_Y;
  var ddx = aimDir.x, ddy = aimDir.y;
  var maxBounces = 20; // generous max bounces

  for (var bounce = 0; bounce < maxBounces; bounce++) {
    var minT = Infinity, hitNx = 0, hitNy = 0, hitBlock = null;

    // Walls
    if (ddx < 0) { var t = (0 - rx) / ddx;     if (t > 0.01 && t < minT) { minT = t; hitNx = 1; hitNy = 0; hitBlock = null; } }
    if (ddx > 0) { var t = (W - rx) / ddx;      if (t > 0.01 && t < minT) { minT = t; hitNx = -1; hitNy = 0; hitBlock = null; } }
    if (ddy < 0) { var t = (0 - ry) / ddy;      if (t > 0.01 && t < minT) { minT = t; hitNx = 0; hitNy = 1; hitBlock = null; } }
    if (ddy > 0) { var t = (LAUNCH_Y + 20 - ry) / ddy; if (t > 0.01 && t < minT) { minT = t; hitNx = 0; hitNy = -1; hitBlock = null; } }

    // Blocks — find closest block intersection (ray vs AABB, no inflation for beam)
    for (var j = 0; j < blocks.length; j++) {
      var b = blocks[j];
      if (!b.alive) continue;
      var t = rayAABB(rx, ry, ddx, ddy, b.x, b.y, b.x + b.w, b.y + b.h);
      if (t !== null && t > 0.01 && t < minT) {
        minT = t;
        // Determine which face we hit for wall-bounce normal
        var hx = rx + ddx * t, hy = ry + ddy * t;
        var bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
        var ex = b.w / 2, ey = b.h / 2;
        var ppx = (hx - bcx) / ex, ppy = (hy - bcy) / ey;
        if (Math.abs(ppx) > Math.abs(ppy)) { hitNx = ppx > 0 ? 1 : -1; hitNy = 0; }
        else { hitNx = 0; hitNy = ppy > 0 ? 1 : -1; }
        hitBlock = b;
      }
    }

    if (minT === Infinity || minT > 2000) { minT = 2000; }
    var nx = rx + ddx * minT, ny = ry + ddy * minT;
    pts.push({ x: nx, y: ny });
    rx = nx; ry = ny;

    // If we hit a block, destroy it and continue through (no bounce off blocks)
    if (hitBlock) {
      hitBlock.alive = false;
      hitBlock.hp = 0;
      score += 6;
      sfxBreak();
      fadingBlocks.push({ x: hitBlock.x, y: hitBlock.y, w: hitBlock.w, h: hitBlock.h, color: blockColor(hitBlock.maxHp), fade: 1 });
      if (hitBlock.power) {
        collectPowerUp(hitBlock.power, hitBlock.x + hitBlock.w / 2, hitBlock.y + hitBlock.h / 2);
      }
      // Remove from blocks array
      for (var k = blocks.length - 1; k >= 0; k--) {
        if (blocks[k] === hitBlock) { blocks.splice(k, 1); break; }
      }
      // Continue in same direction (beam passes through blocks)
      continue;
    }

    // Hit a wall — reflect off it
    var dot = ddx * hitNx + ddy * hitNy;
    ddx -= 2 * dot * hitNx;
    ddy -= 2 * dot * hitNy;

    // If we hit the bottom wall, stop the beam
    if (ny >= LAUNCH_Y + 15) break;
  }

  laserBeam = { pts: pts, life: 1.0 };
}

// ---- Trajectory preview (raycast) ----
function trajectoryPreview() {
  if (!aimDir) return [];
  var pts = [{ x: launchX, y: LAUNCH_Y }];
  var rx = launchX, ry = LAUNCH_Y;
  var ddx = aimDir.x, ddy = aimDir.y;
  var r = PHOTON_R;

  var maxSegs = permUpgrades ? permUpgrades.hintBounces : 2;
  for (var seg = 0; seg < maxSegs; seg++) {
    var minT = Infinity, hitNx = 0, hitNy = 0;

    // Walls
    if (ddx < 0) { var t = (r - rx) / ddx;           if (t > 0 && t < minT) { minT = t; hitNx = 1; hitNy = 0; } }
    if (ddx > 0) { var t = (W - r - rx) / ddx;       if (t > 0 && t < minT) { minT = t; hitNx = -1; hitNy = 0; } }
    if (ddy < 0) { var t = (r - ry) / ddy;           if (t > 0 && t < minT) { minT = t; hitNx = 0; hitNy = 1; } }

    // Blocks (ray vs inflated AABB)
    for (var j = 0; j < blocks.length; j++) {
      var b = blocks[j];
      if (!b.alive) continue;
      var t = rayAABB(rx, ry, ddx, ddy, b.x - r, b.y - r, b.x + b.w + r, b.y + b.h + r);
      if (t !== null && t > 0.1 && t < minT) {
        minT = t;
        var hx = rx + ddx * t, hy = ry + ddy * t;
        var bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
        var ex = b.w / 2 + r, ey = b.h / 2 + r;
        var px = (hx - bcx) / ex, py = (hy - bcy) / ey;
        if (Math.abs(px) > Math.abs(py)) { hitNx = px > 0 ? 1 : -1; hitNy = 0; }
        else { hitNx = 0; hitNy = py > 0 ? 1 : -1; }
      }
    }

    if (minT === Infinity) { minT = 400; }
    pts.push({ x: rx + ddx * minT, y: ry + ddy * minT });
    rx += ddx * minT; ry += ddy * minT;
    var dot = ddx * hitNx + ddy * hitNy;
    ddx -= 2 * dot * hitNx;
    ddy -= 2 * dot * hitNy;
  }
  return pts;
}

function rayAABB(ox, oy, dx, dy, x0, y0, x1, y1) {
  var tmin = -Infinity, tmax = Infinity;
  if (dx !== 0) {
    var t1 = (x0 - ox) / dx, t2 = (x1 - ox) / dx;
    if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  } else if (ox < x0 || ox > x1) return null;
  if (dy !== 0) {
    var t1 = (y0 - oy) / dy, t2 = (y1 - oy) / dy;
    if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  } else if (oy < y0 || oy > y1) return null;
  if (tmin > tmax || tmax < 0) return null;
  return tmin >= 0 ? tmin : tmax;
}

// ---- Rendering ----
function render() {
  ctx.save();
  ctx.scale(scale, scale);

  // Background gradient
  var bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, "#0a0e27");
  bgGrad.addColorStop(0.5, "#141852");
  bgGrad.addColorStop(1, "#0a0e27");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Twinkling stars
  for (var si = 0; si < STARS.length; si++) {
    var star = STARS[si];
    star.a += star.speed * 0.02 * (Math.sin(Date.now() * 0.001 + si) > 0 ? 1 : -1);
    if (star.a < 0.1) star.a = 0.1;
    if (star.a > 0.7) star.a = 0.7;
    ctx.globalAlpha = star.a;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Fading blocks (break flash)
  for (var i = 0; i < fadingBlocks.length; i++) {
    var fb = fadingBlocks[i];
    ctx.globalAlpha = fb.fade * 0.6;
    ctx.shadowColor = fb.color;
    ctx.shadowBlur = 15 * fb.fade;
    drawRoundRect(fb.x, fb.y, fb.w, fb.h, 4, fb.color);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // Blocks
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    if (!b.alive) continue;
    var colorIdx = (b.hp - 1) % BLOCK_COLORS.length;
    var bColor = BLOCK_COLORS[colorIdx];
    var bColorDark = BLOCK_COLORS_DARK[colorIdx];
    if (b.power) {
      // Power-up blocks: neon pulsing glow + icon
      var pwColor = PW_COLORS[b.power];
      // Outer neon glow
      ctx.shadowColor = pwColor;
      ctx.shadowBlur = 10 + 4 * Math.sin(Date.now() * 0.005);
      ctx.globalAlpha = 0.5 + 0.25 * Math.sin(Date.now() * 0.004);
      drawRoundRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2, 5, pwColor);
      ctx.shadowBlur = 0;
      // Inner block with gradient
      ctx.globalAlpha = 1;
      drawBlockGradient(b.x, b.y, b.w, b.h, 4, bColor, bColorDark);
      // Power-up icon on left
      ctx.fillStyle = pwColor;
      ctx.font = "bold 7px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(PW_ICONS[b.power], b.x + 3, b.y + b.h / 2);
      // HP on right – high contrast outline
      ctx.font = "bold 12px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 3;
      ctx.strokeText(b.hp, b.x + b.w - 4, b.y + b.h / 2);
      ctx.fillStyle = "#fff";
      ctx.fillText(b.hp, b.x + b.w - 4, b.y + b.h / 2);
    } else {
      // Normal block — subtle glow border
      ctx.shadowColor = bColor;
      ctx.shadowBlur = 5;
      ctx.globalAlpha = 1;
      drawBlockGradient(b.x, b.y, b.w, b.h, 4, bColor, bColorDark);
      ctx.shadowBlur = 0;
      // Bright top-edge highlight
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#fff";
      roundRectPath(b.x + 1, b.y + 1, b.w - 2, 2, 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      // HP text centered – high contrast outline
      ctx.font = "bold 12px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 3;
      ctx.strokeText(b.hp, b.x + b.w / 2, b.y + b.h / 2);
      ctx.fillStyle = "#fff";
      ctx.fillText(b.hp, b.x + b.w / 2, b.y + b.h / 2);
    }
  }

  // Photons
  for (var i = 0; i < photons.length; i++) {
    var p = photons[i];
    if (!p.active) continue;
    var isFlame = p.type === "flame";
    // Outer glow (canvas shadow)
    ctx.shadowColor = isFlame ? "#ff1744" : "#00c6ff";
    ctx.shadowBlur = 12;
    // Halo
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = isFlame ? "#ff1744" : "#00c6ff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 2.8, 0, Math.PI * 2);
    ctx.fill();
    // Mid glow
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = isFlame ? "#ff5252" : "#4dd0e1";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 1.6, 0, Math.PI * 2);
    ctx.fill();
    // Core
    ctx.globalAlpha = 1;
    ctx.fillStyle = isFlame ? "#ffcdd2" : "#e0f7fa";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Laser beam (solid red line that fades out)
  if (laserBeam && laserBeam.life > 0) {
    var lbAlpha = laserBeam.life;
    // Outer glow
    ctx.globalAlpha = lbAlpha * 0.3;
    ctx.strokeStyle = "#ff0000";
    ctx.lineWidth = 8;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash([]);
    ctx.beginPath();
    for (var i = 0; i < laserBeam.pts.length; i++) {
      if (i === 0) ctx.moveTo(laserBeam.pts[i].x, laserBeam.pts[i].y);
      else ctx.lineTo(laserBeam.pts[i].x, laserBeam.pts[i].y);
    }
    ctx.stroke();
    // Core beam
    ctx.globalAlpha = lbAlpha * 0.9;
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (var i = 0; i < laserBeam.pts.length; i++) {
      if (i === 0) ctx.moveTo(laserBeam.pts[i].x, laserBeam.pts[i].y);
      else ctx.lineTo(laserBeam.pts[i].x, laserBeam.pts[i].y);
    }
    ctx.stroke();
    // Bright center
    ctx.globalAlpha = lbAlpha;
    ctx.strokeStyle = "#ffaaaa";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < laserBeam.pts.length; i++) {
      if (i === 0) ctx.moveTo(laserBeam.pts[i].x, laserBeam.pts[i].y);
      else ctx.lineTo(laserBeam.pts[i].x, laserBeam.pts[i].y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Floating text popups
  for (var i = 0; i < floatingTexts.length; i++) {
    var ft = floatingTexts[i];
    ctx.globalAlpha = Math.max(0, ft.life);
    ctx.shadowColor = ft.color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = ft.color;
    ctx.font = "bold 14px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 2;
    ctx.strokeText(ft.text, ft.x, ft.y);
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  // Trajectory preview – always visible when mouse/touch is above launch point
  if (phase === AIMING && aiming && aimDir) {
    var pts = trajectoryPreview();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = "rgba(0,198,255,0.5)";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "#00c6ff";
    ctx.shadowBlur = 4;
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
      else ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
  }

  // Launch point indicator
  if (phase === AIMING || phase === FIRING || phase === SIMULATING) {
    ctx.shadowColor = "#00c6ff";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "rgba(0,198,255,0.8)";
    ctx.beginPath();
    ctx.arc(launchX, LAUNCH_Y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // HUD
  ctx.shadowColor = "#00c6ff";
  ctx.shadowBlur = 3;
  ctx.fillStyle = "rgba(200,230,255,0.85)";
  ctx.font = "bold 14px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Score: " + score, 10, 10);
  ctx.textAlign = "right";
  ctx.fillText("Level " + level, W - 10, 10);
  ctx.textAlign = "left";
  ctx.fillText("Balls: " + ballCount, 10, 30);
  ctx.shadowBlur = 0;

  // Persistent upgrades line
  var permTexts = [];
  if (permUpgrades.addDamage > 0) permTexts.push("Dmg+" + permUpgrades.addDamage);
  if (permUpgrades.speedMul > 1.0) permTexts.push("Spd+" + Math.round((permUpgrades.speedMul - 1) * 100) + "%");
  if (permUpgrades.hintBounces > 2) permTexts.push("Hint+" + (permUpgrades.hintBounces - 2));
  if (permTexts.length) {
    ctx.textAlign = "center";
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "rgba(180,220,255,0.6)";
    ctx.fillText(permTexts.join("  "), W / 2, H - 28);
  }
  // One-shot buffs indicator
  var buffTexts = [];
  if (nextBuffs.big) buffTexts.push("Big Ball");
  if (nextBuffs.flame) buffTexts.push("Fire Ball");
  if (nextBuffs.laser) buffTexts.push("Laser");
  if (nextBuffs.pierce > 0) buffTexts.push("Pierce");
  if (buffTexts.length) {
    ctx.textAlign = "center";
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "rgba(255,220,100,0.8)";
    ctx.fillText("Next: " + buffTexts.join(", "), W / 2, H - 16);
  }

  // Game over overlay
  if (phase === GAME_OVER) {
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, W, H);
    ctx.shadowColor = "#ff1744";
    ctx.shadowBlur = 15;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Game Over", W / 2, H / 2 - 40);
    ctx.shadowBlur = 0;
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "rgba(200,230,255,0.9)";
    ctx.fillText("Score: " + score, W / 2, H / 2);
    ctx.fillText("Level: " + level, W / 2, H / 2 + 28);
    ctx.font = "13px sans-serif";
    ctx.fillStyle = "rgba(0,198,255,0.7)";
    ctx.fillText("Tap to play again", W / 2, H / 2 + 64);
  }

  ctx.restore();
}

function drawRoundRect(x, y, w, h, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBlockGradient(x, y, w, h, r, topColor, botColor) {
  var grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, topColor);
  grad.addColorStop(1, botColor);
  ctx.fillStyle = grad;
  roundRectPath(x, y, w, h, r);
  ctx.fill();
}

// ---- Main loop ----
var lastTime = 0, accumulator = 0;

function loop(timestamp) {
  requestAnimationFrame(loop);
  var dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;
  if (dt > 0.1) dt = 0.1;

  switch (phase) {
    case FIRING:
      fireTimer += dt;
      while (fireTimer >= FIRE_INTERVAL && fireQueue > 0) {
        spawnPhoton();
        fireQueue--;
        fireTimer -= FIRE_INTERVAL;
        if (fireQueue <= 0) { phase = SIMULATING; nextBuffs = freshBuffs(); break; }
      }
      accumulator += dt;
      while (accumulator >= PHYSICS_DT) { updatePhysics(PHYSICS_DT); accumulator -= PHYSICS_DT; }
      break;

    case SIMULATING:
      accumulator += dt;
      while (accumulator >= PHYSICS_DT) { updatePhysics(PHYSICS_DT); accumulator -= PHYSICS_DT; }
      if (photonsReturned >= photons.length && photons.length > 0) {
        phase = ROUND_END;
      }
      break;

    case ROUND_END:
      for (var i = 0; i < photons.length; i++) photonPool.release(photons[i]);
      photons.length = 0;
      if (firstReturnX !== null) launchX = firstReturnX;
      // Don't reset nextBuffs here — they apply to the NEXT round's photons
      phase = ADVANCE;
      advanceLevel();
      accumulator = 0;
      break;

    default:
      // Update floating texts and laser beam even during AIMING
      if (laserBeam) {
        laserBeam.life -= dt * 2.0;
        if (laserBeam.life <= 0) laserBeam = null;
      }
      for (var i = floatingTexts.length - 1; i >= 0; i--) {
        floatingTexts[i].y -= dt * 40;
        floatingTexts[i].life -= dt * 1.2;
        if (floatingTexts[i].life <= 0) floatingTexts.splice(i, 1);
      }
      break;
  }

  render();
}

// ---- Start ----
initGame();
requestAnimationFrame(loop);
