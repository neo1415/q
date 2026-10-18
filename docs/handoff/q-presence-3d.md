# Q presence 3D: usage for the landing hero (ADR 0049)

1. Import: `import { QPresence3D } from "@/features/q-swarm/q-presence-3d";` (client component).
2. Hero: `<QPresence3D variant="hero" />` replaces `HeroPresence`; it carries `role="img" aria-label="Q"`.
3. It rests as the 3D cloud and gathers into the tilted working ring once the page scrolls 30% of a viewport (`gatherOnScroll={false}` turns that off).
4. It leans towards the cursor (or a touch) on a no-overshoot spring; nothing to wire.
5. Its box is CSS-sized (300 px, 520 px from `lg`), so no layout shift; give it room, never crop it (ADR 0045 §4).
6. The WebGL2 renderer is a dynamic import (~2.5 KB gz) and never blocks LCP; no WebGL2 falls back to the 2D swarm.
7. Reduced motion or Q motion Calm/Off: one still 3D frame, no drift. Offscreen or hidden tab: no frames.
8. On a dark stage the core whitens and a hue halo shows; on a light surface it draws in the accent only.
9. Other variants: `stage`, `dock`, `voice` render the Q Aperture at those sizes with the same 3D swarm.
10. Do not use it as decoration anywhere that is not Q (ADR 0045 §3).
