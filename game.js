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
const POWERUP_CHANCE     = 0.12;
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
const PW = { MULTI: "M", POWER: "P", PIERCE: "X", BIG: "B", SPEED: "S", FLAME: "F", LASER: "L" };
const PW_COLORS = { M: "#7ec8e3", P: "#f7b731", X: "#a55eea", B: "#26de81", S: "#fd9644", F: "#fc5c65", L: "#45aaf2" };
const PW_LABELS = { M: "+Ball", P: "+Dmg", X: "Pierce", B: "Big", S: "Speed", F: "Flame", L: "Laser" };

// ---- Block color bands (soft pastels) ----
const BLOCK_COLORS = [
  "#70a1d7", "#a1de93", "#f7f48b", "#f4a460",
  "#f08080", "#ce93d8", "#80cbc4", "#bcaaa4"
];

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
function ensureAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
let lastSoundTime = 0;
function playTone(freq, dur, vol) {
  if (muted || !audioCtx) return;
  const now = audioCtx.currentTime;
  if (now - lastSoundTime < 0.025) return;      // throttle
  lastSoundTime = now;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + dur);
}
function sfxHit()   { playTone(600 + Math.random() * 200, 0.08, 0.10); }
function sfxBreak() { playTone(900 + Math.random() * 300, 0.14, 0.13); }
function sfxPower() { playTone(1200, 0.18, 0.10); }

document.getElementById("muteBtn").addEventListener("click", () => {
  muted = !muted;
  document.getElementById("muteBtn").textContent = muted ? "Unmute" : "Mute";
});

// ---- Object pools ----
function makePool(factory) {
  const pool = [];
  return {
    get()     { return pool.length ? pool.pop() : factory(); },
    release(o){ pool.push(o); }
  };
}
const photonPool = makePool(() => ({ x:0,y:0,vx:0,vy:0,r:PHOTON_R,active:false,returned:false,returnX:0,damage:1,pierce:0,type:"normal" }));
const dropPool   = makePool(() => ({ x:0,y:0,vy:0,kind:"",active:false }));

// ---- Game state ----
let phase, level, score, ballCount, launchX;
let photons, drops, blocks;        // arrays
let fireQueue, fireTimer;
let firstReturnX, photonsReturned;
let aimDir, aiming;                // aiming
let nextBuffs;
let fadingBlocks;                  // for gentle fade-out

function initGame() {
  phase = AIMING;
  level = 0;
  score = 0;
  ballCount = 1;
  launchX = W / 2;
  photons = [];
  drops = [];
  blocks = [];
  fadingBlocks = [];
  fireQueue = 0;
  fireTimer = 0;
  firstReturnX = null;
  photonsReturned = 0;
  aimDir = null;
  aiming = false;
  nextBuffs = freshBuffs();
  advanceLevel();
}

function freshBuffs() {
  return { addDamage: 0, big: false, speedMul: 1.0, flame: false, laser: false, pierce: 0 };
}

document.getElementById("restartBtn").addEventListener("click", () => { ensureAudio(); initGame(); });

// ---- Block helpers ----
function blockX(col) { return col * CELL_W + BLOCK_PAD; }
function blockY(row) { return TOP_MARGIN + row * CELL_H + BLOCK_PAD; }
function blockW()    { return CELL_W - BLOCK_PAD * 2; }
function blockH()    { return CELL_H - BLOCK_PAD * 2; }

function makeBlock(row, col, hp, power) {
  return { row, col, x: blockX(col), y: blockY(row), w: blockW(), h: blockH(), hp, maxHp: hp, power, alive: true };
}

function blockColor(hp) { return BLOCK_COLORS[(hp - 1) % BLOCK_COLORS.length]; }

// ---- Level generation ----
function advanceLevel() {
  level++;
  // Shift existing blocks down
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    b.row++;
    b.y = blockY(b.row);
    // Game over check
    if (b.y + b.h > H - BAND_H) { phase = GAME_OVER; return; }
  }
  // Spawn new row (row 0)
  let spawned = 0;
  for (let c = 0; c < GRID_COLS; c++) {
    if (Math.random() < BLOCK_SPAWN_CHANCE) {
      let hp;
      if (level <= 5) hp = level;
      else hp = randInt(Math.max(1, level - 2), level);
      let power = null;
      if (Math.random() < POWERUP_CHANCE) {
        const kinds = Object.values(PW);
        power = kinds[randInt(0, kinds.length - 1)];
      }
      blocks.push(makeBlock(0, c, hp, power));
      spawned++;
    }
  }
  // Ensure at least 1 block
  if (spawned === 0) {
    const c = randInt(0, GRID_COLS - 1);
    let hp = level <= 5 ? level : randInt(Math.max(1, level - 2), level);
    blocks.push(makeBlock(0, c, hp, null));
  }
  // Guarantee a power-up every 3 levels early on
  if (level % 3 === 0) {
    const row0 = blocks.filter(b => b.row === 0 && !b.power);
    if (row0.length) {
      const kinds = Object.values(PW);
      row0[randInt(0, row0.length - 1)].power = kinds[randInt(0, kinds.length - 1)];
    }
  }
  phase = AIMING;
}

function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

// ---- Input ----
let pointerDown = false, pointerX = 0, pointerY = 0;

canvas.addEventListener("pointerdown", e => {
  ensureAudio();
  const p = toVirtual(e.clientX, e.clientY);
  if (phase === GAME_OVER) { initGame(); return; }
  if (phase !== AIMING) return;
  if (p.y < LAUNCH_Y - 80) return;             // must start in lower area
  pointerDown = true;
  pointerX = p.x; pointerY = p.y;
});

canvas.addEventListener("pointermove", e => {
  if (!pointerDown) return;
  const p = toVirtual(e.clientX, e.clientY);
  pointerX = p.x; pointerY = p.y;
  // Compute aim direction (must aim upward)
  const dx = pointerX - launchX, dy = pointerY - LAUNCH_Y;
  if (dy < -10) {
    const len = Math.hypot(dx, dy);
    aimDir = { x: dx / len, y: dy / len };
    aiming = true;
  } else {
    aiming = false;
    aimDir = null;
  }
});

canvas.addEventListener("pointerup", () => {
  if (!pointerDown) return;
  pointerDown = false;
  if (phase === AIMING && aiming && aimDir) {
    startFiring();
  }
  aiming = false;
});

// ---- Firing ----
function startFiring() {
  phase = FIRING;
  fireQueue = ballCount;
  fireTimer = 0;
  firstReturnX = null;
  photonsReturned = 0;
}

function spawnPhoton() {
  if (photons.length >= MAX_PHOTONS) return;
  const p = photonPool.get();
  const speedMul = (1 + Math.floor((level - 1) / SPEED_SCALE_INTERVAL) * SPEED_SCALE_AMOUNT) * nextBuffs.speedMul;
  const spd = PHOTON_SPEED * speedMul;
  p.x = launchX; p.y = LAUNCH_Y;
  p.vx = aimDir.x * spd; p.vy = aimDir.y * spd;
  p.r = nextBuffs.big ? PHOTON_R * 1.8 : PHOTON_R;
  p.active = true;
  p.returned = false;
  p.returnX = 0;
  p.damage = 1 + nextBuffs.addDamage;
  p.pierce = nextBuffs.pierce || 0;
  p.type = nextBuffs.laser ? "laser" : (nextBuffs.flame ? "flame" : "normal");
  photons.push(p);
}

// ---- Physics ----
function updatePhysics(dt) {
  // Photons
  for (let i = photons.length - 1; i >= 0; i--) {
    const p = photons[i];
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

  // Drops
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    if (!d.active) continue;
    d.y += d.vy * dt;
    if (d.y > H) { d.active = false; dropPool.release(d); drops.splice(i, 1); continue; }
    // Check photon collect
    for (const p of photons) {
      if (!p.active) continue;
      if (Math.hypot(p.x - d.x, p.y - d.y) < p.r + 10) {
        collectPowerUp(d.kind);
        d.active = false; dropPool.release(d); drops.splice(i, 1);
        break;
      }
    }
  }

  // Fading blocks
  for (let i = fadingBlocks.length - 1; i >= 0; i--) {
    fadingBlocks[i].fade -= dt * 3;
    if (fadingBlocks[i].fade <= 0) fadingBlocks.splice(i, 1);
  }
}

function resolveBlockCollisions(p) {
  const nearCols = [Math.floor((p.x - p.r) / CELL_W), Math.floor((p.x + p.r) / CELL_W)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (!b.alive) continue;

    // Circle vs AABB
    const cx = clamp(p.x, b.x, b.x + b.w);
    const cy = clamp(p.y, b.y, b.y + b.h);
    const dx = p.x - cx, dy = p.y - cy;
    const dist2 = dx * dx + dy * dy;
    if (dist2 >= p.r * p.r) continue;

    // Hit!
    const dmg = p.type === "flame" ? p.damage + 1 : p.damage;
    b.hp -= dmg;
    score += 1;
    sfxHit();

    if (b.hp <= 0) {
      b.alive = false;
      score += 5;
      sfxBreak();
      fadingBlocks.push({ x: b.x, y: b.y, w: b.w, h: b.h, color: blockColor(b.maxHp), fade: 1 });
      if (b.power) spawnDrop(b.x + b.w / 2, b.y + b.h / 2, b.power);
      blocks.splice(i, 1);
    }

    // Laser goes through blocks
    if (p.type === "laser") continue;

    // Pierce
    if (p.pierce > 0) { p.pierce--; continue; }

    // Reflect
    const dist = Math.sqrt(dist2) || 0.001;
    const nx = dx / dist, ny = dy / dist;
    // Push out
    p.x = cx + nx * (p.r + 0.5);
    p.y = cy + ny * (p.r + 0.5);
    // Reflect velocity
    const dot = p.vx * nx + p.vy * ny;
    p.vx -= 2 * dot * nx;
    p.vy -= 2 * dot * ny;
    return; // one collision per substep
  }
}

function spawnDrop(x, y, kind) {
  const d = dropPool.get();
  d.x = x; d.y = y; d.vy = 120; d.kind = kind; d.active = true;
  drops.push(d);
}

function collectPowerUp(kind) {
  score += 10;
  sfxPower();
  switch (kind) {
    case PW.MULTI:  ballCount++; break;
    case PW.POWER:  nextBuffs.addDamage++; break;
    case PW.PIERCE: nextBuffs.pierce += 2; break;
    case PW.BIG:    nextBuffs.big = true; break;
    case PW.SPEED:  nextBuffs.speedMul = 1.25; break;
    case PW.FLAME:  nextBuffs.flame = true; break;
    case PW.LASER:  nextBuffs.laser = true; break;
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ---- Trajectory preview (raycast) ----
function trajectoryPreview() {
  if (!aimDir) return [];
  const pts = [{ x: launchX, y: LAUNCH_Y }];
  let rx = launchX, ry = LAUNCH_Y;
  let dx = aimDir.x, dy = aimDir.y;
  const r = PHOTON_R;

  for (let seg = 0; seg < 2; seg++) {
    let minT = Infinity, hitNx = 0, hitNy = 0;

    // Walls
    if (dx < 0) { const t = (r - rx) / dx;           if (t > 0 && t < minT) { minT = t; hitNx = 1; hitNy = 0; } }
    if (dx > 0) { const t = (W - r - rx) / dx;       if (t > 0 && t < minT) { minT = t; hitNx = -1; hitNy = 0; } }
    if (dy < 0) { const t = (r - ry) / dy;           if (t > 0 && t < minT) { minT = t; hitNx = 0; hitNy = 1; } }

    // Blocks (ray vs inflated AABB)
    for (const b of blocks) {
      if (!b.alive) continue;
      const t = rayAABB(rx, ry, dx, dy, b.x - r, b.y - r, b.x + b.w + r, b.y + b.h + r);
      if (t !== null && t > 0.1 && t < minT) {
        minT = t;
        // Determine normal
        const hx = rx + dx * t, hy = ry + dy * t;
        const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
        const ex = b.w / 2 + r, ey = b.h / 2 + r;
        const px = (hx - bcx) / ex, py = (hy - bcy) / ey;
        if (Math.abs(px) > Math.abs(py)) { hitNx = px > 0 ? 1 : -1; hitNy = 0; }
        else { hitNx = 0; hitNy = py > 0 ? 1 : -1; }
      }
    }

    if (minT === Infinity) { minT = 400; }
    pts.push({ x: rx + dx * minT, y: ry + dy * minT });
    rx += dx * minT; ry += dy * minT;
    // Reflect
    const dot = dx * hitNx + dy * hitNy;
    dx -= 2 * dot * hitNx;
    dy -= 2 * dot * hitNy;
  }
  return pts;
}

function rayAABB(ox, oy, dx, dy, x0, y0, x1, y1) {
  let tmin = -Infinity, tmax = Infinity;
  if (dx !== 0) {
    let t1 = (x0 - ox) / dx, t2 = (x1 - ox) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  } else if (ox < x0 || ox > x1) return null;
  if (dy !== 0) {
    let t1 = (y0 - oy) / dy, t2 = (y1 - oy) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  } else if (oy < y0 || oy > y1) return null;
  if (tmin > tmax || tmax < 0) return null;
  return tmin >= 0 ? tmin : tmax;
}

// ---- Rendering ----
function render() {
  ctx.save();
  ctx.scale(scale, scale);

  // Background
  ctx.fillStyle = "#16213e";
  ctx.fillRect(0, 0, W, H);

  // Fading blocks
  for (const fb of fadingBlocks) {
    ctx.globalAlpha = fb.fade * 0.5;
    drawRoundRect(fb.x, fb.y, fb.w, fb.h, 4, fb.color);
    ctx.globalAlpha = 1;
  }

  // Blocks
  for (const b of blocks) {
    if (!b.alive) continue;
    const opacity = 0.5 + 0.5 * (b.hp / b.maxHp);
    ctx.globalAlpha = opacity;
    drawRoundRect(b.x, b.y, b.w, b.h, 4, blockColor(b.hp));
    ctx.globalAlpha = 1;

    // HP text
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.hp, b.x + b.w / 2, b.y + b.h / 2);

    // Power-up indicator
    if (b.power) {
      ctx.fillStyle = PW_COLORS[b.power];
      ctx.beginPath();
      ctx.arc(b.x + b.w - 5, b.y + 5, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Drops
  for (const d of drops) {
    if (!d.active) continue;
    ctx.fillStyle = PW_COLORS[d.kind] || "#fff";
    ctx.beginPath();
    ctx.arc(d.x, d.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(d.kind, d.x, d.y);
  }

  // Photons
  for (const p of photons) {
    if (!p.active) continue;
    // Halo
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = p.type === "flame" ? "#fc5c65" : (p.type === "laser" ? "#45aaf2" : "#b8e6ff");
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Core
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.type === "flame" ? "#ff7675" : (p.type === "laser" ? "#74b9ff" : "#e8f8ff");
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Trajectory preview
  if (phase === AIMING && aiming) {
    const pts = trajectoryPreview();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
      else ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Launch point indicator
  if (phase === AIMING || phase === FIRING || phase === SIMULATING) {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.arc(launchX, LAUNCH_Y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // HUD
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "bold 14px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Score: " + score, 10, 10);
  ctx.textAlign = "right";
  ctx.fillText("Level " + level, W - 10, 10);
  ctx.textAlign = "left";
  ctx.fillText("Balls: " + ballCount, 10, 30);

  // Active buffs indicator
  const buffTexts = [];
  if (nextBuffs.addDamage > 0) buffTexts.push("+Dmg");
  if (nextBuffs.big) buffTexts.push("Big");
  if (nextBuffs.flame) buffTexts.push("Flame");
  if (nextBuffs.laser) buffTexts.push("Laser");
  if (nextBuffs.pierce > 0) buffTexts.push("Pierce");
  if (nextBuffs.speedMul > 1) buffTexts.push("Speed");
  if (buffTexts.length) {
    ctx.textAlign = "center";
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "rgba(255,220,100,0.8)";
    ctx.fillText("Next: " + buffTexts.join(", "), W / 2, H - 16);
  }

  // Game over overlay
  if (phase === GAME_OVER) {
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Game Over", W / 2, H / 2 - 40);
    ctx.font = "16px sans-serif";
    ctx.fillText("Score: " + score, W / 2, H / 2);
    ctx.fillText("Level: " + level, W / 2, H / 2 + 28);
    ctx.font = "13px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
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

// ---- Main loop ----
let lastTime = 0, accumulator = 0;

function loop(timestamp) {
  requestAnimationFrame(loop);
  let dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;
  if (dt > 0.1) dt = 0.1;                       // clamp after tab switch

  // Phase-specific logic
  switch (phase) {
    case FIRING:
      fireTimer += dt;
      while (fireTimer >= FIRE_INTERVAL && fireQueue > 0) {
        spawnPhoton();
        fireQueue--;
        fireTimer -= FIRE_INTERVAL;
        if (fireQueue <= 0) { phase = SIMULATING; break; }
      }
      // Fall through to simulate active photons
      accumulator += dt;
      while (accumulator >= PHYSICS_DT) { updatePhysics(PHYSICS_DT); accumulator -= PHYSICS_DT; }
      break;

    case SIMULATING:
      accumulator += dt;
      while (accumulator >= PHYSICS_DT) { updatePhysics(PHYSICS_DT); accumulator -= PHYSICS_DT; }
      // Check if all returned
      if (photonsReturned >= photons.length && photons.length > 0) {
        phase = ROUND_END;
      }
      break;

    case ROUND_END:
      // Clean up photons
      for (const p of photons) photonPool.release(p);
      photons.length = 0;
      // Clean up remaining drops
      for (const d of drops) dropPool.release(d);
      drops.length = 0;
      // Set next launch point
      if (firstReturnX !== null) launchX = firstReturnX;
      // Reset one-shot buffs (keep Multi permanent via ballCount)
      nextBuffs = freshBuffs();
      // Advance
      phase = ADVANCE;
      advanceLevel();
      accumulator = 0;
      break;

    default:
      break;
  }

  render();
}

// ---- Start ----
initGame();
requestAnimationFrame(loop);
