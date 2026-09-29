/**
 * Capital Q splash, "Living Convergence" (founder handoff revision 3,
 * 2026-09-29): scattered particles spiral into the Q over 4.8 seconds,
 * then a sparse, irregular glow keeps the formed Q alive. One Canvas2D
 * surface, no dependencies, no network. Ported from the founder's
 * `splash.js` as it was supplied, typed; behaviour is unchanged.
 *
 * Reduced motion renders the finished Q at once and schedules no frames.
 * Hidden tabs, pause and destroy stop every frame. Completion is a visual
 * event only: the app's own readiness never waits on it.
 */

export type SplashTheme = "light" | "dark" | "system";

export type SplashController = {
  readonly replay: () => void;
  readonly setTheme: (theme: SplashTheme) => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly finish: () => void;
  readonly destroy: () => void;
};

type Particle = {
  readonly tx: number;
  readonly ty: number;
  readonly angle: number;
  readonly spread: number;
  readonly lane: number;
  readonly delay: number;
  readonly r: number;
  readonly tint: number;
  readonly phase: number;
  readonly period: number;
  readonly glow: boolean;
};

export const SPLASH_DURATION_MS = 4_800;
const TAU = Math.PI * 2;

export function createCapitalQSplash(
  root: HTMLElement,
  options: { readonly onComplete?: () => void } = {},
): SplashController {
  const canvas = root.querySelector<HTMLCanvasElement>(".cq-splash-canvas");
  const mark = root.querySelector<SVGElement>(".cq-splash-mark");
  const capital = root.querySelector<HTMLElement>(".cq-splash-capital");
  const tagline = root.querySelector<HTMLElement>(".cq-splash-tagline");
  const ctx = canvas?.getContext("2d", { alpha: true }) ?? null;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const appearance = matchMedia("(prefers-color-scheme: light)");

  let width = 0;
  let height = 0;
  let cx = 0;
  let cy = 0;
  let size = 0;
  let particles: Particle[] = [];
  let raf = 0;
  let elapsed = 0;
  let last = 0;
  let lastPaint = 0;
  let dead = false;
  let paused = false;
  let finished = false;
  let light = false;
  let slow = 0;
  let quality = 1;
  let seed = 81;

  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const smooth = (value: number) => {
    const x = clamp(value);
    return x * x * (3 - 2 * x);
  };
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
  };

  const sprites = new Map<boolean, HTMLCanvasElement>();
  function sprite(isLight: boolean): HTMLCanvasElement {
    const cached = sprites.get(isLight);
    if (cached !== undefined) return cached;
    const c = document.createElement("canvas");
    c.width = 48;
    c.height = 48;
    const g = c.getContext("2d");
    if (g !== null) {
      const grad = g.createRadialGradient(24, 24, 0, 24, 24, 24);
      grad.addColorStop(
        0,
        isLight ? "rgba(33,94,207,.8)" : "rgba(193,226,255,1)",
      );
      grad.addColorStop(
        0.13,
        isLight ? "rgba(43,106,214,.5)" : "rgba(108,176,255,.65)",
      );
      grad.addColorStop(
        0.42,
        isLight ? "rgba(53,116,231,.13)" : "rgba(52,122,251,.18)",
      );
      grad.addColorStop(1, "rgba(40,103,235,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 48, 48);
    }
    sprites.set(isLight, c);
    return c;
  }

  function palette() {
    light =
      root.dataset["theme"] === "light" ||
      (root.dataset["theme"] === "system" && appearance.matches);
  }

  function measure() {
    if (canvas === null || mark === null) return;
    const b = root.getBoundingClientRect();
    const m = mark.getBoundingClientRect();
    width = b.width;
    height = b.height;
    size = m.width;
    cx = m.left - b.left + size / 2;
    cy = m.top - b.top + size / 2;
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    palette();
    seed = 81;
    const count = width < 540 ? 1_050 : 1_600;
    particles = Array.from({ length: count }, (_, i) => {
      const tail = i > count * 0.84;
      const angle = random() * TAU;
      const radius = Math.sqrt(55 * 55 + random() * (81 * 81 - 55 * 55));
      const along = random();
      const across = (random() - 0.5) * 23;
      const tx = tail
        ? 123 + along * 52 + across * 0.707
        : 100 + Math.cos(angle) * radius;
      const ty = tail
        ? 121 + along * 52 - across * 0.707
        : 96 + Math.sin(angle) * radius;
      return {
        tx: ((tx - 100) / 200) * size,
        ty: ((ty - 100) / 200) * size,
        angle,
        spread: 0.5 + random() * 0.75,
        lane: i % 3,
        delay: random() * 550,
        r: 0.35 + random() * 0.85,
        tint: i % 4,
        phase: random() * TAU,
        period: 950 + random() * 1_800,
        glow: random() > 0.87,
      };
    });
    draw(motion.matches ? SPLASH_DURATION_MS : elapsed);
  }

  function draw(ms: number) {
    if (ctx === null) return;
    ctx.clearRect(0, 0, width, height);
    const reduced = motion.matches;
    const label = 0.58 + 0.42 * smooth((ms - 650) / 2_400);
    const sub = smooth((ms - 3_300) / 1_000);
    if (capital !== null) capital.style.opacity = String(label);
    if (tagline !== null) {
      tagline.style.opacity = String(sub);
      tagline.style.transform = `translateY(${String((1 - sub) * 6)}px)`;
    }
    const colors = light
      ? ["#20457e", "#2c61ae", "#4081d4", "#3262a5"]
      : ["#4872b5", "#78a9ec", "#b7d9ff", "#4e8ae0"];
    const glowSprite = sprite(light);
    const intro = smooth(ms / 550);
    const settle = smooth((ms - 3_200) / 1_100);
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p === undefined) continue;
      // The final granular silhouette survives a reduced rendering budget.
      if (quality < 1 && i % 2 === 1 && ms < 3_800) continue;
      const t = smooth((ms - 650 - p.delay) / 2_850);
      const inv = 1 - t;
      const theta =
        p.angle + ms * 0.00036 * (p.lane === 1 ? -1 : 1) + p.lane * 1.8;
      const orbit = Math.min(width * 0.65, size * 1.8) * p.spread;
      const x0 = Math.cos(theta) * orbit - (width > 540 ? size * 0.35 : 0);
      const y0 = Math.sin(theta) * orbit * (0.44 + p.lane * 0.13);
      const twist = Math.sin(t * Math.PI) * size * 0.21;
      const x = cx + x0 * inv + p.tx * t + Math.cos(theta + 1.57) * twist;
      const y = cy + y0 * inv + p.ty * t + Math.sin(theta + 1.57) * twist;
      const pulse = reduced
        ? 0
        : Math.max(0, Math.sin((ms / p.period) * TAU + p.phase)) ** 12 * settle;
      const colour = colors[p.tint] ?? "#78a9ec";
      ctx.globalAlpha =
        intro *
        ((light ? 0.68 : 0.48) + p.tint * (light ? 0.08 : 0.13) + pulse * 0.12);
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x, y, p.r * (size / 240) * (light ? 1.15 : 1), 0, TAU);
      ctx.fill();
      if (p.glow && pulse > 0.12) {
        const diameter = 10 + pulse * 16;
        ctx.globalAlpha = pulse * (light ? 0.45 : 0.78);
        ctx.drawImage(
          glowSprite,
          x - diameter / 2,
          y - diameter / 2,
          diameter,
          diameter,
        );
      }
      if (i % 19 === 0 && inv > 0.1) {
        ctx.globalAlpha = 0.16 * intro * inv;
        ctx.strokeStyle = colour;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(
          x - Math.sin(theta) * 12 * inv,
          y + Math.cos(theta) * 7 * inv,
        );
        ctx.stroke();
      }
    }
    // A broad, faint halo under the formed Q, from the one cached sprite.
    if (settle > 0 && !light) {
      ctx.globalCompositeOperation = "destination-over";
      ctx.globalAlpha = 0.13 * settle;
      ctx.drawImage(
        glowSprite,
        cx - size * 0.73,
        cy - size * 0.73,
        size * 1.46,
        size * 1.46,
      );
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function notifyComplete() {
    if (finished) return;
    finished = true;
    root.dataset["playing"] = "false";
    options.onComplete?.();
  }
  function queue() {
    if (
      !dead &&
      !paused &&
      !document.hidden &&
      !motion.matches &&
      ctx !== null
    ) {
      raf = requestAnimationFrame(frame);
    }
  }
  function frame(now: number) {
    if (dead || paused || document.hidden) return;
    if (last !== 0) {
      const delta = now - last;
      elapsed += delta;
      if (elapsed < SPLASH_DURATION_MS && delta > 28) slow += 1;
      if (slow >= 12) quality = 0.5;
    }
    last = now;
    // 60fps formation, 30fps idle shimmer, 20fps on a slower device.
    if (
      elapsed < SPLASH_DURATION_MS ||
      now - lastPaint >= (quality < 1 ? 50 : 32)
    ) {
      draw(elapsed);
      lastPaint = now;
    }
    if (elapsed >= SPLASH_DURATION_MS) notifyComplete();
    queue();
  }
  function play() {
    if (dead) return;
    cancelAnimationFrame(raf);
    elapsed = 0;
    last = 0;
    lastPaint = 0;
    finished = false;
    paused = false;
    slow = 0;
    quality = 1;
    root.dataset["playing"] = "true";
    if (ctx === null) {
      notifyComplete();
      return;
    }
    root.dataset["canvas"] = "true";
    measure();
    if (motion.matches) {
      elapsed = SPLASH_DURATION_MS;
      draw(SPLASH_DURATION_MS);
      notifyComplete();
      return;
    }
    queue();
  }
  function onVisibility() {
    cancelAnimationFrame(raf);
    last = 0;
    if (!document.hidden) queue();
  }
  function onMotion() {
    cancelAnimationFrame(raf);
    last = 0;
    if (motion.matches) {
      elapsed = Math.max(SPLASH_DURATION_MS, elapsed);
      draw(elapsed);
      notifyComplete();
    } else {
      queue();
    }
  }
  function onAppearance() {
    palette();
    draw(elapsed);
  }

  const resize = new ResizeObserver(measure);
  resize.observe(root);
  motion.addEventListener("change", onMotion);
  appearance.addEventListener("change", onAppearance);
  document.addEventListener("visibilitychange", onVisibility);
  play();

  return {
    replay: play,
    setTheme: (theme) => {
      root.dataset["theme"] = theme;
      onAppearance();
    },
    pause: () => {
      paused = true;
      cancelAnimationFrame(raf);
      last = 0;
    },
    resume: () => {
      if (!paused) return;
      paused = false;
      last = 0;
      queue();
    },
    finish: () => {
      elapsed = Math.max(SPLASH_DURATION_MS, elapsed);
      draw(elapsed);
      notifyComplete();
    },
    destroy: () => {
      dead = true;
      cancelAnimationFrame(raf);
      resize.disconnect();
      motion.removeEventListener("change", onMotion);
      appearance.removeEventListener("change", onAppearance);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
