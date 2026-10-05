// Q presence prototype (K1-K2): a 3D particle swarm on Canvas 2D with a
// perspective projection, so every frame here is a real render. Shapes are
// target functions; a shape change is a staggered flow, not a cut. The
// production renderer stays raw WebGL2 (ADR 0049); this file only proves the
// shapes, the timing and the two face options.

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rnd) => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(TAU * rnd());

export const PALETTES = {
  blue: { core: [238, 243, 255], light: [111, 155, 255], ember: [62, 99, 201], ink: [37, 78, 190] },
  gold: { core: [255, 245, 220], light: [226, 184, 88], ember: [168, 116, 28], ink: [120, 84, 18] },
};

export const SHAPES = ["cloud", "ring", "wave", "spiral", "constellation", "ribbon", "face"];

// ---- The human face (option B). A sculpted bust lit softly from the front
// and above: the features come from relief and light (a height field with
// a nose, brow ridge, cheeks and lips), not from drawn strokes. Only the
// lid line, iris and catchlight are drawn, thin and dim. The shipped figure
// reads as a "demon" because of hollow black sockets, bright staring eyes
// and edge-traced features; all three are avoided here.
function buildFace(N, rnd) {
  const G = (dx, dy, sx, sy) => Math.exp(-(dx * dx) / sx - (dy * dy) / sy);
  const jaw = (y) => (y < -0.15 ? 1 - 0.3 * Math.pow(clamp((-0.15 - y) / 0.71), 1.3) : 1);
  const halfW = (y) => 0.6 * Math.sqrt(clamp(1 - Math.pow((y - 0.04) / 0.88, 2))) * jaw(y);
  const height = (x, y) => {
    const w = Math.max(halfW(y), 1e-3), ax = Math.abs(x);
    let z = 0.42 * Math.sqrt(clamp(1 - Math.pow(x / (w * 1.06), 2))) * Math.sqrt(clamp(1 - Math.pow((y - 0.04) / 0.92, 2)));
    z += 0.11 * G(x, 0, 0.0035, 1) * clamp((0.12 - y) / 0.1) * clamp((y + 0.22) / 0.06); // bridge
    z += 0.09 * G(x, y + 0.17, 0.006, 0.004); // tip
    z += 0.02 * G(ax - 0.065, y + 0.19, 0.0016, 0.0016); // wings
    z += 0.04 * G(0, y - 0.23, 1, 0.006) * clamp(1 - ax / 0.42); // brow ridge
    z -= 0.04 * G(ax - 0.23, y - 0.1, 0.012, 0.0045); // soft socket
    z += 0.026 * G(ax - 0.23, y - 0.1, 0.0045, 0.0022); // eyeball
    z += 0.05 * G(ax - 0.27, y + 0.12, 0.018, 0.016); // cheeks
    z += 0.04 * G(x, y + 0.385, 0.014, 0.0011); // upper lip
    z += 0.045 * G(x, y + 0.45, 0.011, 0.0016); // lower lip
    z += 0.045 * G(x, y + 0.7, 0.012, 0.008); // chin
    return z;
  };
  // Tone is painted, not lit: a portrait painter's map of where light sits
  // on a face (forehead, nose, cheeks, lips) with soft, never black, shade.
  const tone = (x, y) => {
    const ax = Math.abs(x), w = Math.max(halfW(y), 1e-3);
    let b = 0.42;
    b += 0.28 * G(x, y - 0.4, 0.06, 0.03); // forehead
    b += 0.3 * G(ax - 0.27, y + 0.1, 0.012, 0.01); // cheeks
    b += 0.3 * G(x + 0.012, y + 0.04, 0.0012, 0.025); // nose bridge
    b += 0.25 * G(x, y + 0.16, 0.003, 0.002); // nose tip
    b -= 0.2 * G(x, y + 0.235, 0.008, 0.0012); // under the nose
    b -= 0.12 * G(ax - 0.23, y - 0.1, 0.009, 0.004); // soft eye shade
    b += 0.14 * G(x, y + 0.385, 0.01, 0.0008); // upper lip
    b += 0.24 * G(x, y + 0.45, 0.008, 0.0012); // lower lip
    b -= 0.15 * G(x, y + 0.53, 0.01, 0.0015); // under the lip
    b += 0.12 * G(x, y + 0.7, 0.01, 0.006); // chin
    b -= 0.3 * Math.pow(ax / w, 3); // turning away at the sides
    return clamp(b);
  };
  const mouthY = (x) => -0.418 + 0.05 * Math.pow(x / 0.13, 2) * 0.6;
  const pts = [];
  const add = (x, y, z, part, b) => pts.push({ x, y, z, part, b });
  const alloc = (f) => Math.round(N * f);

  const hairline = (x) => 0.6 - 0.32 * x * x;
  let n;
  // Skin on a jittered grid: an even surface, so light (not clumps) shapes it.
  const step = 0.024;
  for (let gy = -0.86; gy < 0.9; gy += step) {
    for (let gx = -0.62; gx < 0.62; gx += step) {
      const x = gx + (rnd() - 0.5) * step * 0.9, y = gy + (rnd() - 0.5) * step * 0.9;
      const w = halfW(y);
      if (Math.abs(x) > w || y > hairline(x)) continue;
      let b = tone(x, y);
      if (Math.abs(x) < 0.14 && Math.abs(y - mouthY(x)) < 0.008) b *= 0.35;
      const ax = Math.abs(x);
      let part = "skin";
      if (y < mouthY(x) && y > -0.52 && ax < 0.15) part = "lipL";
      else if (y < -0.52) part = "chin";
      add(x, y, height(x, y), part, b);
    }
  }
  // Hair on a coarser grid: framing the face, darker than the skin.
  const hs = 0.028;
  for (let gy = -0.75; gy < 1.12; gy += hs) {
    for (let gx = -0.8; gx < 0.8; gx += hs) {
      const x = gx + (rnd() - 0.5) * hs, y = gy + (rnd() - 0.5) * hs;
      const top = (x / 0.72) ** 2 + ((y - 0.1) / 1.0) ** 2 < 1 && y > 0.05;
      const sides = Math.abs(x) < 0.76 - 0.06 * clamp(-y) && y <= 0.1 && y > -0.75 + 0.25 * (1 - Math.abs(x) / 0.76);
      const inFace = Math.abs(x) < halfW(y) + 0.015 && y <= hairline(x);
      if (!(top || sides) || inFace) continue;
      if (y < -0.5 && Math.abs(x) < 0.3) continue;
      const strand = 0.5 + 0.5 * Math.sin(Math.atan2(y - 0.3, x) * 38 + Math.hypot(x, y - 0.3) * 4);
      const fall = clamp((y + 0.75) / 0.4);
      add(x, y, 0.1 * Math.sqrt(clamp(1 - (x / 0.8) ** 2)) - 0.1, "hair", (0.05 + 0.13 * strand) * fall);
    }
  }
  for (const side of [-1, 1]) {
    const ex = side * 0.23, ey = 0.1;
    const lid = alloc(0.012);
    for (let i = 0; i < lid; i++) {
      const u = (i / (lid - 1)) * 2 - 1;
      const x = ex + u * 0.085, y = ey + 0.036 * (1 - u * u) - 0.004 + gauss(rnd) * 0.003;
      add(x, y, height(x, y) + 0.01, "lid", 0.72);
    }
    const iris = alloc(0.008);
    for (let i = 0; i < iris; i++) {
      const a = (i / iris) * TAU, r = 0.026;
      add(ex + Math.cos(a) * r, ey + 0.004 + Math.sin(a) * r * 0.85, height(ex, ey) + 0.012, "iris", 0.45);
    }
    add(ex + 0.01, ey + 0.016, height(ex, ey) + 0.02, "iris", 0.9);
    add(ex + 0.013, ey + 0.013, height(ex, ey) + 0.02, "iris", 0.75);
    const br = alloc(0.01);
    for (let i = 0; i < br; i++) {
      const u = i / (br - 1);
      const x = side * (0.12 + u * 0.23);
      const y = 0.245 + 0.035 * Math.sin(u * Math.PI * 0.9) - u * 0.01 + gauss(rnd) * 0.005;
      add(x, y, height(x, y) + 0.008, "brow", 0.5);
    }
  }
  // Mouth and nose as quiet lines of light, the same hand as the lids.
  const lineAt = (count, fx, fy, b, part = "line") => {
    for (let i = 0; i < count; i++) {
      const u = (i / (count - 1)) * 2 - 1;
      const x = fx(u), y = fy(u) + gauss(rnd) * 0.0025;
      add(x, y, height(x, y) + 0.012, part, b);
    }
  };
  lineAt(alloc(0.011), (u) => u * 0.13, (u) => mouthY(u * 0.13), 0.7, "mouth");
  lineAt(alloc(0.007), (u) => u * 0.09, (u) => -0.468 + 0.022 * u * u, 0.38, "lipL");
  lineAt(alloc(0.006), (u) => u * 0.06, (u) => -0.372 - 0.012 * Math.cos(u * Math.PI * 2) * (1 - Math.abs(u)), 0.32, "line");
  lineAt(alloc(0.006), (u) => u * 0.065, (u) => -0.2 + 0.03 * u * u, 0.5);
  lineAt(alloc(0.004), (u) => -0.035 + u * 0.004, (u) => 0.02 - (u + 1) * 0.08, 0.26);
  // Over budget: thin skin and hair evenly, never the eyes, brows or lips.
  while (pts.length > N * 0.97) {
    const i = Math.floor(rnd() * pts.length);
    if (pts[i].part === "skin" || pts[i].part === "hair") pts.splice(i, 1);
  }
  while (pts.length < N) {
    if (rnd() < 0.3) add((rnd() * 2 - 1) * 0.19, -0.78 - rnd() * 0.3, 0.12, "neck", 0.14);
    else { const u = rnd() * 2 - 1; add(u * 0.95, -1.12 + 0.16 * (1 - u * u) + gauss(rnd) * 0.02, 0, "neck", 0.12); }
  }
  pts.length = N;
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
  return pts;
}

export class Swarm {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.N = opts.count ?? 1500;
    this.palette = PALETTES[opts.palette ?? "blue"];
    this.surface = opts.surface ?? "dark";
    this.reduced = !!opts.reduced;
    this.scale = opts.scale ?? 0.36;
    this.halo = opts.halo ?? true;
    this.alphaScale = Math.min(1, 1800 / (opts.count ?? 1500));
    this.shape = opts.shape ?? "cloud";
    this.prevShape = this.shape;
    this.morphStart = -10;
    this.state = "idle";
    this.level = 0; this.levelTarget = 0; this.autoLevel = false;
    this.t = 0; this.last = 0; this.running = false;
    this.yaw = 0; this.lean = [0, 0]; this.leanTarget = [0, 0];
    this.blinkAt = 2.2; this.smile = 1;
    const rnd = mulberry(opts.seed ?? 7);
    const N = this.N;
    this.pos = new Float32Array(N * 3);
    this.seed = Array.from({ length: N }, () => [rnd(), rnd(), rnd(), rnd(), gauss(rnd), gauss(rnd), gauss(rnd)]);
    this.dir = this.seed.map((_, i) => {
      const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), a = i * 2.39996323;
      return [Math.cos(a) * r, y, Math.sin(a) * r];
    });
    this.face = buildFace(N, mulberry(11));
    this.knots = [];
    for (let k = 0; k < 11; k++) {
      const a = -Math.PI / 2 + (k / 11) * TAU;
      this.knots.push([Math.cos(a) * 0.68, Math.sin(a) * 0.68, (k % 3) * 0.05 - 0.05]);
    }
    this.knots.push([0.62, -0.62, 0.05], [0.86, -0.86, 0.1]);
    this.sprite = this.makeSprite();
    for (let i = 0; i < N; i++) this.target(this.shape, i, 0, this.pos, i * 3);
    this.resize();
  }

  makeSprite() {
    const s = document.createElement("canvas"); s.width = s.height = 32;
    const g = s.getContext("2d"), p = this.palette;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, `rgba(${p.core},1)`);
    grad.addColorStop(0.25, `rgba(${p.light},0.85)`);
    grad.addColorStop(1, `rgba(${p.ember},0)`);
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
    return s;
  }

  setPalette(name) { this.palette = PALETTES[name]; this.sprite = this.makeSprite(); }
  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setShape(name) {
    if (name === this.shape) return;
    this.prevShape = this.shape; this.shape = name; this.morphStart = this.t;
  }
  setState(s) { this.state = s; this.stateStart = this.t; }
  setLevel(v) { this.levelTarget = v; }
  pointAt(nx, ny) { this.leanTarget = [nx, ny]; }

  target(shape, i, t, out, o) {
    const s = this.seed[i];
    const lv = this.level, st = this.state;
    let x = 0, y = 0, z = 0;
    switch (shape) {
      case "cloud": {
        const d = this.dir[i];
        let rho = 0.92 * Math.pow(s[0], 0.62);
        rho *= 1 + 0.018 * Math.sin(t * 1.05);
        let a = 0;
        if (st === "listening") rho *= 0.8 + 0.22 * lv * (0.6 + 0.4 * Math.sin(t * 7 + s[1] * TAU));
        if (st === "speaking") rho *= 1 + lv * 0.16 * Math.sin(rho * 13 - t * 8);
        if (st === "thinking") a = t * (0.5 / (0.25 + rho));
        if (st === "pleased") rho *= 1 + 0.08 * Math.exp(-((t - (this.stateStart ?? 0)) * 2.5));
        const ca = Math.cos(a), sa = Math.sin(a);
        x = (d[0] * ca - d[2] * sa) * rho; z = (d[0] * sa + d[2] * ca) * rho; y = d[1] * rho;
        x += 0.025 * Math.sin(t * 0.7 + s[1] * TAU); y += 0.025 * Math.cos(t * 0.6 + s[2] * TAU);
        if (st === "listening") z += 0.12;
        if (st === "pleased") y += 0.07 * Math.exp(-((t - (this.stateStart ?? 0)) * 2)) ;
        break;
      }
      case "ring": {
        const th = (i / this.N) * TAU + t * (st === "thinking" ? 0.9 : 0.35);
        const R = 0.8 + s[4] * 0.035 + lv * 0.06 * Math.sin(th * 6 - t * 6);
        const rx = Math.cos(th) * R, ry = Math.sin(th) * R;
        const tilt = 1.12;
        x = rx + s[5] * 0.02; y = ry * Math.cos(tilt) + s[6] * 0.02; z = ry * Math.sin(tilt);
        break;
      }
      case "wave": {
        const W = 60, col = i % W, row = Math.floor(i / W), H = Math.ceil(this.N / W);
        const u = col / (W - 1), v = row / (H - 1);
        x = (u - 0.5) * 2.1; z = (v - 0.5) * 1.2;
        y = (0.13 + 0.2 * lv) * Math.sin(x * 2.6 + t * 1.9 + z * 1.6) + 0.05 * Math.sin(z * 5 - t * 1.2);
        x += s[4] * 0.008; z += s[5] * 0.008;
        break;
      }
      case "spiral": {
        const rho = 0.06 + 0.92 * Math.sqrt(s[0]);
        const arm = i % 2;
        const phi = arm * Math.PI + rho * 5.4 + t * 0.45 + s[4] * 0.22 * (1.1 - rho);
        const px = rho * Math.cos(phi), pz = rho * Math.sin(phi), py = s[5] * 0.045 * (1.3 - rho);
        const tilt = 0.95;
        x = px; y = py * Math.cos(tilt) - pz * Math.sin(tilt); z = py * Math.sin(tilt) + pz * Math.cos(tilt);
        break;
      }
      case "constellation": {
        // The Q mark drawn in knots of light: no connecting lines (not a network).
        const k = this.knots[Math.floor(s[0] * this.knots.length)];
        if (s[1] < 0.74) {
          const sig = 0.035 + 0.02 * s[2];
          x = k[0] + s[4] * sig; y = k[1] + s[5] * sig; z = k[2] + s[6] * sig;
        } else {
          const a = s[2] * TAU;
          x = Math.cos(a) * 0.68 + s[4] * 0.012; y = Math.sin(a) * 0.68 + s[5] * 0.012; z = s[6] * 0.02;
        }
        y += 0.012 * Math.sin(t * 1.3 + s[3] * TAU);
        break;
      }
      case "ribbon": {
        const sp = s[0] * TAU + t * 0.22;
        const w = (s[1] - 0.5) * 0.3;
        const cx = 1.15 * Math.sin(sp), cy = 0.3 * Math.sin(2 * sp) + 0.08 * Math.sin(3 * sp - t), cz = 0.45 * Math.cos(sp);
        const tw = sp * 1.5 + t * 0.4;
        x = cx; y = cy + w * Math.cos(tw); z = cz + w * Math.sin(tw);
        break;
      }
      case "face": {
        const p = this.face[i];
        x = p.x; y = p.y; z = p.z;
        const bp = t - this.blinkAt;
        this.blink = bp > 0 && bp < 0.18 ? Math.sin((bp / 0.18) * Math.PI) : 0;
        if (p.part === "lid") y -= this.blink * 0.03;
        if (p.part === "lipL" || p.part === "mouth") y -= (p.part === "mouth" ? 0.5 : 1) * lv * 0.05 * clamp(1 - Math.pow(x / 0.14, 2));
        if (p.part === "chin") y -= lv * 0.03;
        y += 0.01 * Math.sin(t * 0.9);
        break;
      }
    }
    out[o] = x; out[o + 1] = y; out[o + 2] = z;
  }

  step(dt) {
    this.t += dt;
    const t = this.t;
    if (this.autoLevel) {
      // A synthetic speech envelope: syllables inside phrases.
      const syl = Math.max(0, Math.sin(t * 13) * 0.5 + Math.sin(t * 7.3) * 0.5);
      const phrase = Math.sin(t * 1.4) > -0.6 ? 1 : 0.1;
      this.levelTarget = clamp(syl * phrase * 0.9);
    }
    this.level += (this.levelTarget - this.level) * (1 - Math.exp(-dt * 14));
    if (t > this.blinkAt + 0.2) this.blinkAt = t + 3 + Math.random() * 2.5;
    this.lean[0] += (this.leanTarget[0] - this.lean[0]) * (1 - Math.exp(-dt * 6));
    this.lean[1] += (this.leanTarget[1] - this.lean[1]) * (1 - Math.exp(-dt * 6));
    const k = this.reduced ? 1 : 1 - Math.exp(-dt * 7);
    const mt = t - this.morphStart;
    const morphing = mt < 2.2;
    const A = [0, 0, 0], B = [0, 0, 0];
    for (let i = 0; i < this.N; i++) {
      const o = i * 3, s = this.seed[i];
      this.target(this.shape, i, t, B, 0);
      let tx = B[0], ty = B[1], tz = B[2];
      if (morphing && !this.reduced) {
        this.target(this.prevShape, i, t, A, 0);
        const d = s[2] * 0.5 + (A[1] + 1) * 0.12;
        const p = easeInOut(clamp((mt - d) / 1.1));
        const bell = Math.sin(p * Math.PI);
        tx = A[0] + (B[0] - A[0]) * p + 0.22 * bell * Math.sin(A[1] * 3 + t * 2 + s[3] * 6);
        ty = A[1] + (B[1] - A[1]) * p + 0.22 * bell * Math.cos(A[0] * 3 - t * 1.7);
        tz = A[2] + (B[2] - A[2]) * p + 0.18 * bell * Math.sin(A[2] * 3 + t * 1.3);
      }
      this.pos[o] += (tx - this.pos[o]) * k;
      this.pos[o + 1] += (ty - this.pos[o + 1]) * k;
      this.pos[o + 2] += (tz - this.pos[o + 2]) * k;
    }
  }

  draw() {
    const { ctx, w, h, palette: p } = this;
    ctx.clearRect(0, 0, w, h);
    const S = Math.min(w, h) * this.scale;
    const cx = w / 2, cy = h / 2;
    const dark = this.surface === "dark";
    const faceish = this.shape === "face" || this.prevShape === "face" && this.t - this.morphStart < 1.5;
    const spin = this.reduced ? 0.5 : this.t * (this.shape === "wave" || this.shape === "ribbon" ? 0.05 : 0.12);
    const yaw = (faceish ? 0.16 * Math.sin(this.t * 0.4) : spin) + this.lean[0] * 0.5;
    const pitch = (this.shape === "wave" ? 0.42 : 0.08) + this.lean[1] * 0.3;
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    if (dark && this.halo) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 1.7);
      const lift = 0.16 + this.level * 0.12;
      g.addColorStop(0, `rgba(${p.light},${lift})`);
      g.addColorStop(0.45, `rgba(${p.ember},${lift * 0.35})`);
      g.addColorStop(1, `rgba(${p.ember},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    const base = Math.max(1.1, S * 0.016);
    const F = 3.2;
    for (let i = 0; i < this.N; i++) {
      const o = i * 3;
      const x0 = this.pos[o], y0 = this.pos[o + 1], z0 = this.pos[o + 2];
      const x1 = x0 * cyw + z0 * syw, z1 = -x0 * syw + z0 * cyw;
      const y1 = y0 * cp - z1 * sp, z2 = y0 * sp + z1 * cp;
      const persp = F / (F - z2);
      const sx = cx + x1 * persp * S, sy = cy - y1 * persp * S;
      const depth = clamp((z2 + 1) / 2);
      let b = 0.42 + 0.58 * depth;
      if (this.shape === "face" || this.prevShape === "face") {
        const fb = this.face[i].b;
        const f = this.shape === "face" ? clamp((this.t - this.morphStart) / 1.4) : 1 - clamp((this.t - this.morphStart) / 1.4);
        b *= 1 - f + f * Math.pow(fb, 1.5) * 3.1;
      }
      let r = base * persp * (0.75 + 0.5 * depth);
      if (this.shape === "face") {
        const part = this.face[i].part;
        r *= part === "skin" || part === "hair" || part === "chin" || part === "neck" ? 0.5 : 0.42;
        if (part === "iris") b *= 1 - (this.blink ?? 0);
      }
      if (dark) {
        ctx.globalAlpha = clamp(b * 0.8 * this.alphaScale);
        ctx.drawImage(this.sprite, sx - r * 2, sy - r * 2, r * 4, r * 4);
      } else {
        ctx.globalAlpha = clamp(b * 0.85);
        ctx.fillStyle = depth > 0.55 ? `rgb(${p.ink})` : `rgb(${p.ember})`;
        ctx.fillRect(sx - r * 0.55, sy - r * 0.55, r * 1.1, r * 1.1);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  frame = (now) => {
    if (!this.running) return;
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
    this.last = now;
    this.step(dt); this.draw();
    requestAnimationFrame(this.frame);
  };
  start() { if (this.running) return; this.running = true; this.last = 0; requestAnimationFrame(this.frame); }
  stop() { this.running = false; }
  // For screenshots: advance a fixed time and draw once.
  settle(seconds = 3) { for (let i = 0; i < seconds * 60; i++) this.step(1 / 60); this.draw(); }
}
