"use client";

import { LazyMotion, m, useMotionValue } from "motion/react";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  ContextMenuRoot,
  ContextMenuTrigger,
} from "@capital-q/ui/context-menu";
import { ICON_SIZE, ICON_STROKE, Mic, Square } from "@capital-q/ui/icons";
import { MenuContent, MenuItem } from "@capital-q/ui/menu";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { ViewTransition } from "@/components/view-transition";
import {
  Q_APERTURE_LABELS,
  QAperture,
  useQMotion,
} from "@/features/q-aperture";
import { useQSessionOptional } from "@/features/q/q-session";

import { obstacleRects, subscribeAvoid, watchLayout } from "./dock-avoid";
import { useDockClass, useDockMenu } from "./use-dock-menu";
import {
  applyMove,
  DEFAULT_PLACEMENT,
  placeDock,
  placementForRelease,
  readHidden,
  readPlacement,
  storePlacement,
  subscribePlacement,
  type DockClass,
  type DockMove,
  type DockSize,
  type DockViewport,
} from "./dock-placement";

/**
 * The Q Dock (ADR 0017 F1; spec §6): Q, floating, on every page but the
 * Q page, which is Q itself.
 *
 * Three presentations of the one conversation store:
 * - **minimal**, the aperture in a 44 px button, its word on hover/focus;
 * - **compact**, a pill while Q works, an approval waits, or a voice line
 *   is open: the task, its stage, the mic-live mark and Stop;
 * - **stashed**, a 12 px tab after a throw past an edge; a tap restores it.
 * Pressing it opens Q beside the page (the expanded panel); "Open Q" there
 * carries the same conversation to the Q page, the aperture morphing into
 * the stage (`q-aperture`), with nothing read again and the line unbroken.
 *
 * It moves only for a reason: the person drags or throws it (it lands on
 * the nearest of six anchors on a desktop, four on a phone), a registered
 * control would be covered (it glides to the nearest free anchor), or the
 * menu moves it -- right click, long press, or Shift+F10 -- which is the
 * non-drag way to do everything a drag does (WCAG 2.5.7).
 *
 * It never covers a control or a heading (`placeDock`): every interactive
 * element and heading on screen is an obstacle, on every page. Where the
 * pill fits nowhere it shows as the minimal button instead.
 */

const Q_PAGE = "/home";
const SPRING = { type: "spring", stiffness: 420, damping: 40 } as const;

type Animate = typeof import("./motion-features").animate;

/** Motion's spring, once the lazy features have arrived; until then, a jump. */
let springTo: Animate | null = null;

const loadFeatures = () =>
  import("./motion-features").then((module) => {
    springTo = module.animate;
    return module.default;
  });

/** The chrome the dock stays off, measured rather than assumed. */
function measureViewport(dockClass: DockClass): DockViewport {
  const rectOf = (selector: string): DOMRect | null => {
    const element = document.querySelector(selector);
    if (element === null) return null;
    const rect = element.getBoundingClientRect();
    return rect.width === 0 || rect.height === 0 ? null : rect;
  };
  const header = rectOf(".cq-shell-header");
  const nav = rectOf(".cq-bottom-nav");
  const sidebar = rectOf(".cq-shell-sidebar");
  return {
    width: document.documentElement.clientWidth,
    height: window.innerHeight,
    insetTop: header === null ? 0 : Math.max(0, header.bottom),
    insetBottom: nav === null ? 0 : Math.max(0, window.innerHeight - nav.top),
    insetLeft: sidebar === null ? 0 : Math.max(0, sidebar.right),
    insetRight: 0,
    gutter: dockClass === "desktop" ? 24 : 12,
  };
}

/** One polite announcement of what Q is doing, at most once a second. */
function useAnnouncement(text: string | undefined): string {
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (text === undefined) return;
    const timer = window.setTimeout(() => setSaid(`Q: ${text}`), 1000);
    return () => window.clearTimeout(timer);
  }, [text]);
  return said;
}

export function QDock() {
  const session = useQSessionOptional();
  const pathname = usePathname();
  const { open: panelOpen, setOpen } = useGlobalQ();
  const dockClass = useDockClass();
  const { motion } = useQMotion();
  const chosen = useSyncExternalStore(
    subscribePlacement,
    () => readPlacement(dockClass),
    () => DEFAULT_PLACEMENT,
  );
  const hidden = useSyncExternalStore(
    subscribePlacement,
    readHidden,
    () => false,
  );
  const hintId = useId();
  const dockMenu = useDockMenu();

  const boxRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  /**
   * Whether the dock has been put on its anchor yet. Kept on the element
   * (`data-placed`) rather than in state: the first placement is a DOM
   * write in a layout effect, and hiding the dock until then is part of it.
   */
  const placed = useRef(false);
  const [layoutTick, setLayoutTick] = useState(0);
  const dragging = useRef(false);
  const justDragged = useRef(false);
  const shownAnchor = useRef<string | null>(null);
  /** A drag just ended: the anchor is flown to even if it is the same one. */
  const released = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** The pill fits nowhere free: shown as the minimal button meanwhile. */
  const [shrunk, setShrunk] = useState(false);
  /** The pill's own size, kept while it is shrunk, to test it again. */
  const fullSize = useRef<DockSize | null>(null);
  // Drag arrives with Motion's features, after the dock has painted; the
  // attribute says when (and the menu moves it before then).
  const [draggable, setDraggable] = useState(false);
  const features = useCallback(
    () =>
      loadFeatures().then((loaded) => {
        // Said once the features have mounted their gesture listeners,
        // two frames after LazyMotion takes them.
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => setDraggable(true));
        });
        return loaded;
      }),
    [],
  );

  const onQPage = pathname === Q_PAGE;
  const presence = session?.presence;
  const q = session?.q;
  const voice = session?.voice;
  const approval = q?.state.approval ?? null;
  const wantsCompact =
    q !== undefined &&
    voice !== undefined &&
    (q.working || approval !== null || voice.active);
  const compact = wantsCompact && !shrunk;
  const stashed = chosen.stashed && !compact;
  // Where the investor feed is on screen the dock merges into its action
  // rail (spec §6.2): hidden in CSS while `[data-feed-immersive]` exists.
  const visible = session !== null && !onQPage && !hidden;
  // The dock's element exists only once Q's presence has arrived (see the
  // early return below). Placement keys on that, not on `visible` alone: a
  // session that arrives before its presence would otherwise run the
  // placement while there is no element, and never again, leaving the dock
  // at the layer's origin (the top-left corner).
  const rendered = visible && presence !== undefined;

  // Re-place on anything that moves the chrome or a registered control.
  useEffect(() => {
    if (!rendered) return;
    let frame = 0;
    const bump = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setLayoutTick((tick) => tick + 1);
      });
    };
    window.addEventListener("resize", bump);
    window.addEventListener("scroll", bump, { passive: true, capture: true });
    const unsubscribe = subscribeAvoid(bump);
    const box = boxRef.current;
    const observer = new ResizeObserver(bump);
    if (box !== null) observer.observe(box);
    // Controls that arrive without a scroll (data loading in, a section
    // opening, a font swapping) move obstacles too.
    const unwatch = watchLayout(bump);
    return () => {
      unwatch();
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", bump);
      window.removeEventListener("scroll", bump, { capture: true });
      unsubscribe();
      observer.disconnect();
    };
  }, [rendered]);

  const still = motion !== "full";
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!rendered || box === null || dragging.current) return;
    const measured = { width: box.offsetWidth, height: box.offsetHeight };
    const showingShrunk = shrunk && wantsCompact;
    if (!showingShrunk) fullSize.current = measured;
    const size =
      showingShrunk && fullSize.current !== null ? fullSize.current : measured;
    const viewport = measureViewport(dockClass);
    const spot = placeDock(chosen, obstacleRects(), viewport, size, dockClass);
    const shouldShrink = wantsCompact && spot.minimal;
    if (shouldShrink !== shrunk) {
      // Layout-driven, before paint: the next pass places the new form.
      setShrunk(shouldShrink);
      return;
    }
    const shown = spot.placement;
    const target = { x: spot.x, y: spot.y };
    // Only a new anchor is flown to. The same anchor moving because the
    // window, the chrome or the dock's own size changed is simply where
    // the dock now is: a resize is not a throw.
    const shownKey = `${shown.side}-${shown.slot}-${String(shown.stashed)}-${String(spot.lastResort)}`;
    const sameAnchor = shownAnchor.current === shownKey && !released.current;
    shownAnchor.current = shownKey;
    released.current = false;
    if (!placed.current || still || sameAnchor || springTo === null) {
      x.set(target.x);
      y.set(target.y);
      // Written through as well: before Motion's element has subscribed to
      // its values (first paint, a cold load) a set alone would not reach
      // the DOM, and the dock would show at the corner of the screen.
      box.style.transform = `translateX(${String(target.x)}px) translateY(${String(target.y)}px)`;
      // And said again once Motion's features have mounted: its element
      // renders from the values it last heard, and a set to the value a
      // motion value already holds is silent, so without this the first
      // render after the features load writes the stale origin back.
      if (draggable) {
        x.dirty();
        y.dirty();
      }
      placed.current = true;
      box.setAttribute("data-placed", "");
      return;
    }
    if (
      Math.abs(x.get() - target.x) < 0.5 &&
      Math.abs(y.get() - target.y) < 0.5
    ) {
      return;
    }
    const spring = springTo;
    const moves = [spring(x, target.x, SPRING), spring(y, target.y, SPRING)];
    return () => {
      for (const move of moves) move.stop();
    };
  }, [
    rendered,
    draggable,
    chosen,
    layoutTick,
    dockClass,
    still,
    compact,
    wantsCompact,
    shrunk,
    stashed,
    x,
    y,
  ]);

  const release = useCallback(
    (velocity: { readonly x: number; readonly y: number }) => {
      const box = boxRef.current;
      dragging.current = false;
      if (box === null) return;
      const size = { width: box.offsetWidth, height: box.offsetHeight };
      const next = placementForRelease(
        { x: x.get(), y: y.get() },
        velocity,
        measureViewport(dockClass),
        size,
        dockClass,
      );
      storePlacement(dockClass, next);
      // The same anchor as before still has to be flown back to.
      released.current = true;
      setLayoutTick((tick) => tick + 1);
    },
    [dockClass, x, y],
  );

  const move = (action: DockMove) => {
    storePlacement(dockClass, applyMove(chosen, action, dockClass));
  };

  const word =
    presence === undefined
      ? "ready"
      : (presence.label ??
        (presence.state === "IDLE"
          ? "ready"
          : Q_APERTURE_LABELS[presence.state]));
  const subject = session?.subject;
  const about =
    subject === undefined || subject.kind === "NONE"
      ? undefined
      : (subject.label ?? undefined);
  const name = ["Q", word, about === undefined ? undefined : `about ${about}`]
    .filter((part) => part !== undefined)
    .join(", ");
  const announcement = useAnnouncement(
    presence?.state === "IDLE" ? undefined : presence?.label,
  );

  if (!visible || session === null || presence === undefined) return null;

  const openPanel = () => {
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }
    setOpen(true);
  };

  // Only one aperture carries the shared name at a time: the panel's while
  // it is open, the dock's otherwise (the Q page's stage has it there).
  const aperture = (
    <ViewTransition
      {...(panelOpen ? {} : { name: "q-aperture" })}
      share="cq-q-morph"
      default="none"
    >
      <QAperture
        state={presence.state}
        size={36}
        inputLevel={voice?.client.inputLevel}
        outputLevel={voice?.client.outputLevel}
      />
    </ViewTransition>
  );

  const body = stashed ? (
    <button
      type="button"
      className="cq-q-dock-stash"
      data-side={chosen.side}
      aria-label="Show Q"
      aria-describedby={hintId}
      onClick={() => move({ kind: "unstash" })}
      data-q-dock-stash
    />
  ) : compact ? (
    <div
      className="cq-q-dock-pill"
      role="group"
      aria-label="Q"
      data-q-dock-pill
    >
      <button
        type="button"
        className="cq-q-dock-pill-open"
        aria-label={name}
        aria-describedby={hintId}
        aria-expanded={panelOpen}
        onClick={openPanel}
        data-q-dock-button
      >
        {aperture}
        <span className="flex min-w-0 flex-col items-start">
          <span className="cq-label truncate text-(--cq-text-primary)">
            {approval !== null ? "Approval needed" : word}
          </span>
          {presence.detail !== undefined ? (
            <span className="cq-caption truncate text-(--cq-text-secondary)">
              {presence.detail}
            </span>
          ) : null}
        </span>
        {voice?.active === true ? (
          <span className="cq-q-dock-mic" data-q-dock-mic>
            <Mic
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
            />
            <span className="sr-only">Microphone on</span>
          </span>
        ) : null}
      </button>
      {voice?.active === true ? (
        <button
          type="button"
          className="cq-q-dock-stop"
          aria-label="End voice"
          onClick={() => void voice.end()}
          data-q-dock-stop
        >
          <Square aria-hidden="true" size={ICON_SIZE.compact} />
        </button>
      ) : q?.working === true ? (
        <button
          type="button"
          className="cq-q-dock-stop"
          aria-label="Stop"
          onClick={() => void q.stop()}
          data-q-dock-stop
        >
          <Square aria-hidden="true" size={ICON_SIZE.compact} />
        </button>
      ) : null}
    </div>
  ) : (
    <button
      type="button"
      className="cq-q-dock-button"
      aria-label={name}
      aria-describedby={hintId}
      aria-expanded={panelOpen}
      onClick={openPanel}
      data-q-dock-button
    >
      {aperture}
      <span className="cq-q-dock-tip" aria-hidden="true">
        {word === "ready" ? "Ask Q" : word}
      </span>
    </button>
  );

  return (
    <aside aria-label="Q dock" className="cq-q-dock-layer" data-q-dock>
      <LazyMotion features={features} strict>
        <ContextMenuRoot open={menuOpen} onOpenChange={setMenuOpen}>
          <ContextMenuTrigger>
            <m.div
              ref={boxRef}
              className="cq-q-dock"
              style={{ x, y }}
              drag
              dragMomentum={false}
              dragElastic={0}
              onDragStart={() => {
                dragging.current = true;
                justDragged.current = true;
              }}
              onDragEnd={(_event, info) => {
                release(still ? { x: 0, y: 0 } : info.velocity);
                // A click that ends a drag is the drag's, not a press.
                window.setTimeout(() => {
                  justDragged.current = false;
                }, 0);
              }}
              data-q-dock-placement={`${chosen.side}-${chosen.slot}${chosen.stashed ? "-stashed" : ""}`}
              data-q-dock-state={presence.state}
              data-q-dock-draggable={draggable ? "" : undefined}
              data-q-dock-minimal={shrunk && wantsCompact ? "" : undefined}
            >
              {body}
            </m.div>
          </ContextMenuTrigger>
          <MenuContent>
            {dockMenu.items.map((item) => (
              <MenuItem key={item.label} onClick={item.run}>
                {item.label}
              </MenuItem>
            ))}
          </MenuContent>
        </ContextMenuRoot>
      </LazyMotion>
      <span id={hintId} className="sr-only">
        Press Shift+F10 to move or hide Q. Control+K opens Q.
      </span>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </aside>
  );
}
