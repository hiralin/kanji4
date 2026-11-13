// three.js reel window: 21-sided reels with canvas-drawn kanji faces, a lacquer front
// panel, paylines, the 吉兆 notice lamp and backlight flashes.
// Positions follow the engine: index p is on the center row, p-1 above, p+1 below,
// and the reels scroll downward (one koma of slip moves the center from p to p-1).
import * as THREE from 'three';

const FALLBACK = ', "Hiragino Mincho ProN", "Yu Mincho", serif';
export const SYMBOLS = {
  七: { font: '"Yuji Syuku"', fill: ['#fffdf2', '#ffd36b'], stroke: '#3d0306', size: 0.8, stretch: 1.5, band: ['#f0503a', '#c0141c', '#7c0710'], rail: '#f2cf72' },
  漢: { font: '"Yuji Syuku"', fill: ['#fff2b8', '#d9a02c'], stroke: '#2a1600', size: 0.76, stretch: 1.4, band: ['#4a8cf0', '#1d55c0', '#0a2466'], rail: '#d9b45f' },
  // 吉 uses a narrower purple band so it never reads as 漢 (full-width blue) while spinning.
  吉: { font: '"Zen Antique"', fill: ['#ffffff', '#ead9ff'], stroke: '#1a0533', size: 0.78, stretch: 1.25, band: ['#a066dc', '#5e2c9e', '#2a0f4d'], rail: '#ece2fa', bandWidth: 0.7 },
  再: { font: '"Dela Gothic One"', fill: ['#8ff0ff', '#0b8fb3'], stroke: '#06303d', size: 0.62 },
  鈴: { font: '"Dela Gothic One"', fill: ['#fff3a0', '#e09a00'], stroke: '#5b3500', size: 0.62 },
  瓜: { font: '"Yuji Syuku"', fill: ['#a6f28a', '#1b7f2e'], stroke: '#0b3313', size: 0.74 },
  桜: { font: '"Kaisei Decol"', weight: 700, fill: ['#ffd0e4', '#e2457f'], stroke: '#5e1030', size: 0.68 },
  ん: { font: '"Hachi Maru Pop"', fill: ['#b9ada0', '#7d7064'], size: 0.6 },
};

const TEX_W = 400;
const TEX_H = 240;
const canvases = {};

/** One reel face (washi paper + glyph). Cached, so the hall cards and the reels share it. */
export function symbolCanvas(ch) {
  if (canvases[ch]) return canvases[ch];
  const s = SYMBOLS[ch];
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  const g = c.getContext('2d');
  g.fillStyle = '#f4ecd8';
  g.fillRect(0, 0, TEX_W, TEX_H);
  for (let i = 0; i < 260; i++) {
    g.strokeStyle = `rgba(120, 90, 50, ${Math.random() * 0.06})`;
    g.lineWidth = Math.random() * 1.5;
    const x = Math.random() * TEX_W;
    const y = Math.random() * TEX_H;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 10);
    g.stroke();
  }
  if (s.band) {
    // Color band (full width unless bandWidth is set) so bonus symbols read as blocks while spinning (目押しの目印).
    const top = TEX_H * 0.13;
    const bh = TEX_H * 0.74;
    const bw = TEX_W * (s.bandWidth ?? 1);
    const left = (TEX_W - bw) / 2;
    const grad = g.createLinearGradient(0, top, 0, top + bh);
    s.band.forEach((col, i) => grad.addColorStop(i / (s.band.length - 1), col));
    g.fillStyle = grad;
    g.fillRect(left, top, bw, bh);
    g.fillStyle = s.rail;
    g.fillRect(left, top - TEX_H * 0.05, bw, TEX_H * 0.04);
    g.fillRect(left, top + bh + TEX_H * 0.01, bw, TEX_H * 0.04);
  }
  const size = TEX_H * s.size;
  g.font = `${s.weight ?? 400} ${size}px ${s.font}${FALLBACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  const m = g.measureText(ch);
  const y = TEX_H / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  g.save();
  g.translate(TEX_W / 2, 0);
  g.scale(s.stretch ?? 1, 1);
  const fill = g.createLinearGradient(0, y - m.actualBoundingBoxAscent, 0, y + m.actualBoundingBoxDescent);
  fill.addColorStop(0, s.fill[0]);
  fill.addColorStop(1, s.fill[1]);
  g.shadowColor = 'rgba(0, 0, 0, 0.3)';
  g.shadowOffsetY = 4;
  g.shadowBlur = 4;
  if (s.stroke) {
    g.lineJoin = 'round';
    g.lineWidth = size * 0.1;
    g.strokeStyle = s.stroke;
    g.strokeText(ch, 0, y);
    g.shadowColor = 'transparent';
  }
  g.fillStyle = fill;
  g.fillText(ch, 0, y);
  g.restore();
  g.fillStyle = 'rgba(0, 0, 0, 0.1)';
  g.fillRect(0, 0, TEX_W, 2);
  g.fillRect(0, TEX_H - 2, TEX_W, 2);
  return (canvases[ch] = c);
}

const mod = (a, n) => ((a % n) + n) % n;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Flash patterns stay at or under 3 flashes per second.
const DUR = { lever: 1.0, notice: 1.6, big: 4, reg: 2.5, win: 0.7, jacin: 1.5, replay: 0.9, bell: 1.0, melon: 1.2, cherry: 1.0 };
// Third-stop flashes, one fixed pattern per role. Blinking stays at or under 3 per second.
const ROLE_FX = { replay: '#5ab4ff', bell: '#ffd36b', melon: '#5ee07a', cherry: '#ff8fb8' };
const MOOD = { normal: '#fff1d6', bigSmall: '#ffd27a', jac: '#9fe6ff' };

function rectPath(path, x0, y0, x1, y1) {
  path.moveTo(x0, y0);
  path.lineTo(x1, y0);
  path.lineTo(x1, y1);
  path.lineTo(x0, y1);
  path.lineTo(x0, y0);
}

export function createReelView(canvas, strips, lines) {
  const N = strips[0].length;
  const STEP = (2 * Math.PI) / N;
  const R = 1.6;
  const FACE_H = 2 * R * Math.tan(Math.PI / N);
  const FACE_W = 0.8;
  const PITCH = FACE_W + 0.12;
  const WIN_H = FACE_H * 3.05;
  const FRONT_Z = R + 0.1;
  const SPEED = (2 * Math.PI * 80) / 60; // 80 rpm
  const ACCEL = SPEED / 0.35;
  const xs = [-PITCH, 0, PITCH];
  const rowY = [R * Math.sin(STEP), 0, -R * Math.sin(STEP)];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.DirectionalLight(0xfff4e0, 1.4);
  key.position.set(0.5, 2.5, 6);
  scene.add(key);

  const textures = {};
  for (const ch of new Set(strips.flat())) {
    const t = new THREE.CanvasTexture(symbolCanvas(ch));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    textures[ch] = t;
  }
  const faceGeo = new THREE.PlaneGeometry(FACE_W, FACE_H * 1.002);
  const reels = strips.map((strip, r) => {
    const group = new THREE.Group();
    group.position.x = xs[r];
    scene.add(group);
    const mats = {};
    strip.forEach((ch, i) => {
      mats[ch] ??= new THREE.MeshStandardMaterial({ map: textures[ch], emissive: new THREE.Color(0xffffff), emissiveMap: textures[ch], emissiveIntensity: 0.5, roughness: 0.5 });
      const face = new THREE.Mesh(faceGeo, mats[ch]);
      const a = -i * STEP;
      face.position.set(0, R * Math.sin(a), R * Math.cos(a));
      face.rotation.x = -a;
      group.add(face);
    });
    return { i: r, group, mats: Object.values(mats), theta: 0, speed: 0, mode: 'idle', grid: 0, target: 0, stoppedAt: -1 };
  });

  // Lacquer front panel with three windows and gold bezels.
  const panelShape = new THREE.Shape();
  rectPath(panelShape, -6, -5, 6, 5);
  const bezel = 0.035;
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0xd9b45f, metalness: 0.8, roughness: 0.3 });
  for (const x of xs) {
    const hole = new THREE.Path();
    rectPath(hole, x - FACE_W / 2, -WIN_H / 2, x + FACE_W / 2, WIN_H / 2);
    panelShape.holes.push(hole);
    const ring = new THREE.Shape();
    rectPath(ring, x - FACE_W / 2 - bezel, -WIN_H / 2 - bezel, x + FACE_W / 2 + bezel, WIN_H / 2 + bezel);
    const inner = new THREE.Path();
    rectPath(inner, x - FACE_W / 2, -WIN_H / 2, x + FACE_W / 2, WIN_H / 2);
    ring.holes.push(inner);
    const ringMesh = new THREE.Mesh(new THREE.ShapeGeometry(ring), bezelMat);
    ringMesh.position.z = FRONT_Z + 0.002;
    scene.add(ringMesh);
  }
  const panel = new THREE.Mesh(new THREE.ShapeGeometry(panelShape), new THREE.MeshStandardMaterial({ color: 0x1b0f0c, roughness: 0.35, metalness: 0.25 }));
  panel.position.z = FRONT_Z;
  scene.add(panel);

  // Darken the top and bottom of each window so the reels read as drums.
  const shadeCanvas = document.createElement('canvas');
  shadeCanvas.width = 4;
  shadeCanvas.height = 256;
  const sg = shadeCanvas.getContext('2d');
  const sgr = sg.createLinearGradient(0, 0, 0, 256);
  sgr.addColorStop(0, 'rgba(0,0,0,0.78)');
  sgr.addColorStop(0.3, 'rgba(0,0,0,0)');
  sgr.addColorStop(0.7, 'rgba(0,0,0,0)');
  sgr.addColorStop(1, 'rgba(0,0,0,0.78)');
  sg.fillStyle = sgr;
  sg.fillRect(0, 0, 4, 256);
  const shadeMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadeCanvas), transparent: true, depthWrite: false });
  for (const x of xs) {
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(FACE_W, WIN_H), shadeMat);
    shade.position.set(x, 0, R + 0.03);
    scene.add(shade);
  }

  // Paylines as thin planes; lines[k] gives the row on each reel.
  const lineMeshes = lines.map((rows) => {
    const pts = rows.map((row, r) => new THREE.Vector2(xs[r], rowY[row]));
    const ext = (a, b) => new THREE.Vector2(a.x + (a.x - b.x) * ((FACE_W / 2) / PITCH), a.y + (a.y - b.y) * ((FACE_W / 2) / PITCH));
    const path = [ext(pts[0], pts[1]), ...pts, ext(pts[2], pts[1])];
    const mat = new THREE.MeshBasicMaterial({ color: 0xd3442b, transparent: true, opacity: 0.3, depthWrite: false });
    const group = new THREE.Group();
    for (let k = 0; k < path.length - 1; k++) {
      const a = path[k];
      const b = path[k + 1];
      const seg = new THREE.Mesh(new THREE.PlaneGeometry(a.distanceTo(b), 0.016), mat);
      seg.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, R + 0.05);
      seg.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
      group.add(seg);
    }
    scene.add(group);
    return { group, mat };
  });

  // 吉兆 notice lamp above the windows, with a soft glow behind it.
  const lampCanvas = document.createElement('canvas');
  lampCanvas.width = 512;
  lampCanvas.height = 180;
  const lg = lampCanvas.getContext('2d');
  lg.font = `140px "Yuji Syuku"${FALLBACK}`;
  lg.textAlign = 'center';
  lg.textBaseline = 'middle';
  lg.fillStyle = '#ffffff';
  lg.fillText('吉兆', 256, 96);
  const lampMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(lampCanvas), transparent: true, color: 0x3a2a22, depthWrite: false });
  const lamp = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.39), lampMat);
  lamp.position.set(0, WIN_H / 2 + 0.36, FRONT_Z + 0.01);
  scene.add(lamp);
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 128;
  const gg = glowCanvas.getContext('2d');
  const ggr = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
  ggr.addColorStop(0, 'rgba(255,255,255,1)');
  ggr.addColorStop(1, 'rgba(255,255,255,0)');
  gg.fillStyle = ggr;
  gg.fillRect(0, 0, 128, 128);
  const glowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(glowCanvas), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.9), glowMat);
  glow.position.set(0, lamp.position.y, FRONT_Z + 0.005);
  scene.add(glow);

  let effects = [];
  let lampOn = false;
  let mood = 'normal';
  let lineCount = lines.length;
  let winLines = [];
  let last = performance.now() / 1000;
  const color = new THREE.Color();
  const view = { onReelStop: () => {}, onAllStopped: () => {} };

  function fit() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const t = Math.tan(THREE.MathUtils.degToRad(15));
    const d = Math.max(2.55 / (2 * t), 3.3 / (2 * t * camera.aspect));
    camera.position.set(0, 0.2, FRONT_Z + d);
    camera.lookAt(0, 0.2, 0);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(fit).observe(canvas);

  function backlight(r, t) {
    color.set(MOOD[mood]);
    let k = 0.5;
    for (const fx of effects) {
      const u = t - fx.start;
      if (u < 0 || u > fx.dur) continue;
      if (fx.type === 'lever') {
        if (reduceMotion()) k = 0.2 + 0.3 * (u / fx.dur);
        else k = Math.floor(u * 6) % 2 === 0 ? 1.5 : 0.04;
        color.set('#ffffff');
      } else if (fx.type === 'notice') {
        color.setHSL((u * 0.8 + r * 0.15) % 1, 0.9, 0.6);
        k = 1.2;
      } else if (fx.type === 'big') {
        color.setHSL((u * 0.5 + r * 0.2) % 1, 0.85, 0.6);
        k = reduceMotion() ? 1.0 : 0.9 + 0.5 * Math.sin(u * Math.PI * 3);
      } else if (fx.type === 'reg') {
        color.set('#8fb8ff');
        k = reduceMotion() ? 1.0 : 0.8 + 0.4 * Math.sin(u * Math.PI * 3);
      } else if (fx.type === 'jacin') {
        color.set('#9fe6ff');
        k = 1.2 - 0.6 * (u / fx.dur);
      } else if (fx.type in ROLE_FX) {
        color.set(ROLE_FX[fx.type]);
        const calm = reduceMotion();
        if (fx.type === 'replay') k = 1.3 * (1 - u / fx.dur) + 0.3; // all reels, one fade
        else if (fx.type === 'bell') k = calm || Math.floor(u * 4) % 2 === 0 ? 1.4 : 0.1; // two blinks
        else if (fx.type === 'melon') k = calm || u * 3 >= r && u * 3 < r + 1.4 ? 1.4 : 0.1; // sweeps left to right
        else k = r === 0 ? (calm || Math.floor(u * 4) % 2 === 0 ? 1.5 : 0.1) : 0.1; // cherry: left reel only
      } else if (fx.type === 'win') {
        k += 0.7 * (1 - u / fx.dur);
      }
    }
    return k;
  }

  function frame() {
    const t = performance.now() / 1000;
    const dt = Math.min(0.05, t - last);
    last = t;
    let stoppedNow = false;
    for (const r of reels) {
      if (r.mode === 'accel') {
        r.speed = Math.min(SPEED, r.speed + ACCEL * dt);
        if (r.speed >= SPEED) r.mode = 'spin';
      }
      if (r.mode !== 'idle') r.theta += r.speed * dt;
      if (r.mode === 'stopping' && r.theta >= r.target) {
        r.theta = -r.position * STEP;
        r.mode = 'idle';
        r.speed = 0;
        r.stoppedAt = t;
        view.onReelStop(r.i);
        stoppedNow = true;
      }
      const since = r.stoppedAt < 0 ? 9 : t - r.stoppedAt;
      r.group.rotation.x = r.theta - 0.05 * Math.exp(-since * 18) * Math.sin(since * 40);
      const flashing = effects.some((fx) => t - fx.start >= 0 && t - fx.start <= fx.dur);
      const k = r.dark && !flashing ? 0.02 : backlight(r.i, t); // a flash shows through the blackout
      for (const m of r.mats) {
        m.emissive.copy(color);
        m.emissiveIntensity = k;
        m.color.setScalar(r.dark && !flashing ? 0.12 : 1); // the scene lights still hit the face, so dim the map too
      }
    }
    if (stoppedNow && reels.every((r) => r.mode === 'idle')) view.onAllStopped();
    effects = effects.filter((fx) => t - fx.start <= fx.dur);
    lineMeshes.forEach((l, i) => {
      const won = winLines.includes(i);
      l.mat.color.set(won ? '#ffd36b' : '#d3442b');
      l.mat.opacity = won ? 0.55 + 0.4 * Math.sin(t * Math.PI * 4) : i < lineCount ? 0.32 : 0.06;
    });
    if (lampOn) {
      lampMat.color.setHSL((t * 0.15) % 1, 0.9, 0.62);
      glowMat.opacity = 0.35 + 0.15 * Math.sin(t * Math.PI * 2);
      glowMat.color.copy(lampMat.color);
    } else {
      lampMat.color.set('#3a2a22');
      glowMat.opacity = 0;
    }
    if (canvas.clientWidth) renderer.render(scene, camera); // skip while the machine screen is hidden
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return Object.assign(view, {
    setPositions(pos) {
      reels.forEach((r, i) => Object.assign(r, { theta: -pos[i] * STEP, position: pos[i], mode: 'idle', speed: 0, stoppedAt: -1 }));
    },
    startSpin() {
      for (const r of reels) Object.assign(r, { mode: 'accel', stoppedAt: -1, dark: false }); // lights come back on at the lever
      winLines = [];
    },
    /** Index on the center row at the moment of the press, or null while the reel is not at full speed. */
    pressIndex(i) {
      const r = reels[i];
      if (r.mode !== 'spin') return null;
      r.grid = Math.ceil(r.theta / STEP) * STEP;
      return mod(Math.round(-r.grid / STEP), N);
    },
    stopAt(i, position) {
      const r = reels[i];
      const press = mod(Math.round(-r.grid / STEP), N);
      r.target = r.grid + mod(press - position, N) * STEP;
      r.position = position;
      r.mode = 'stopping';
    },
    spinning: () => reels.some((r) => r.mode !== 'idle'),
    flash(type) {
      effects.push({ type, start: performance.now() / 1000, dur: DUR[type] });
    },
    setDark(i, on) {
      reels[i].dark = on;
    },
    clearDark() {
      for (const r of reels) r.dark = false;
    },
    setLamp(on) {
      lampOn = on;
    },
    setMood(m) {
      mood = m;
    },
    setLines(count, won = []) {
      lineCount = count;
      winLines = won;
    },
    fit,
  });
}
