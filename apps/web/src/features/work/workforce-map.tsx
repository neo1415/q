"use client";

import { useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { cx } from "@capital-q/ui";
import {
  Check,
  CircleAlert,
  Clock,
  Hand,
  ICON_STROKE,
  ListChecks,
  Maximize2,
  Minus,
  Moon,
  Pause,
  Plus,
  RotateCw,
  X,
} from "@capital-q/ui/icons";

import {
  STATE_WORDS,
  fitView,
  mapLayout,
  mapLinks,
  sinceWords,
  stateCounts,
  stateLabel,
  stateRank,
  zoomAbout,
  zoomLevel,
  type AgentNode,
  type AgentState,
  type View,
} from "./workforce-agents";
import { dollars } from "./workforce-view";

/**
 * Q's team as a map (P7; mockup docs/design/2026-10-06/workforce): Lead Q
 * in the middle, each specialist around it with its state as a ring, a
 * glyph and words. Zoom with the buttons, pinch, Ctrl/⌘ + scroll or the
 * keyboard (+, −, 0, arrows); drag to move. Far out shows rings and names,
 * close in shows the job, since when and the month's cost. Hover shows a
 * card; a click opens the specialist's panel. A list twin carries the
 * same content for screen readers and small screens.
 *
 * Motion only for real state: a working ring turns, a live hand-off line
 * carries one dot; both stop under reduced motion. Glow is Lead Q's only.
 */

type Role = AgentNode["role"];

const ICON = { size: 12, strokeWidth: 2.25, "aria-hidden": true } as const;

function StateGlyph({
  state,
  size = 12,
}: {
  readonly state: AgentState;
  readonly size?: number;
}) {
  const props = { ...ICON, size };
  switch (state) {
    case "working":
      return <RotateCw {...props} />;
    case "thinking":
      return <ListChecks {...props} />;
    case "waiting":
      return <Clock {...props} />;
    case "asking":
      return <Hand {...props} />;
    case "held":
      return <CircleAlert {...props} />;
    case "failed":
      return <X {...props} />;
    case "done":
      return <Check {...props} />;
    case "idle":
      return <Moon {...props} />;
    case "paused":
      return <Pause {...props} />;
  }
}

/** The ring's colour token, by state; never the only carrier of meaning. */
const RING_TONE: Readonly<Record<AgentState, string>> = {
  asking: "var(--cq-accent)",
  held: "var(--cq-warning)",
  failed: "var(--cq-danger)",
  working: "var(--cq-accent)",
  thinking: "var(--cq-accent)",
  waiting: "var(--cq-text-tertiary)",
  paused: "var(--cq-text-tertiary)",
  done: "var(--cq-positive)",
  idle: "var(--cq-border-strong)",
};

/** The ring's line style, so it reads in greyscale and forced colours. */
const RING_STYLE: Readonly<Record<AgentState, string>> = {
  asking: "border-[3px] border-solid",
  held: "border-[2.5px] border-solid",
  failed: "border-4 border-double",
  working: "border-2 border-solid",
  thinking: "border-2 border-dashed",
  waiting: "border-[2.5px] border-dotted",
  paused: "border-2 border-dashed",
  done: "border-2 border-solid",
  idle: "border border-solid",
};

const LEGEND_STYLE: Readonly<Record<AgentState, string>> = {
  asking: "border-solid",
  held: "border-solid",
  failed: "border-[3px] border-double",
  working: "border-solid",
  thinking: "border-dashed",
  waiting: "border-dotted",
  paused: "border-dashed",
  done: "border-solid",
  idle: "border border-solid",
};

const LABEL_TONE: Readonly<Record<AgentState, string>> = {
  asking: "text-(--cq-accent) font-semibold",
  held: "text-(--cq-warning)",
  failed: "text-(--cq-danger)",
  working: "text-(--cq-text-secondary)",
  thinking: "text-(--cq-text-secondary)",
  waiting: "text-(--cq-text-secondary)",
  paused: "text-(--cq-text-secondary)",
  done: "text-(--cq-positive)",
  idle: "text-(--cq-text-tertiary)",
};

export function AgentRing({
  node,
  size = 44,
}: {
  readonly node: Pick<AgentNode, "state" | "mono" | "lead">;
  readonly size?: number;
}) {
  const reduced = useReducedMotion() === true;
  const tone = RING_TONE[node.state];
  return (
    <span
      aria-hidden="true"
      data-ring={node.state}
      className={cx(
        "relative grid flex-none place-items-center rounded-full font-semibold tracking-[-0.01em]",
        node.lead
          ? "bg-(--cq-text-primary) text-(--cq-canvas) shadow-[0_0_28px_6px_var(--cq-q-bloom)]"
          : node.state === "asking"
            ? "bg-(--cq-accent-soft) text-(--cq-accent)"
            : node.state === "idle"
              ? "text-(--cq-text-tertiary)"
              : "bg-(--cq-surface-subtle)",
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.32) }}
    >
      <span
        className={cx("absolute -inset-1 rounded-full", RING_STYLE[node.state])}
        style={{
          borderColor: tone,
          ...(node.state === "asking"
            ? {
                boxShadow: `0 0 0 3px var(--cq-surface-raised), 0 0 0 5px ${tone}`,
              }
            : {}),
        }}
      />
      {node.state === "working" && !reduced ? (
        <span className="absolute -inset-1 animate-[spin_2.4s_linear_infinite] rounded-full border-2 border-transparent border-t-(--cq-surface-raised)" />
      ) : null}
      {node.state === "thinking" && !reduced ? (
        <span
          className="absolute -inset-1 animate-pulse rounded-full border-2 border-dashed"
          style={{ borderColor: tone }}
        />
      ) : null}
      {node.mono}
      <span
        className="absolute -right-1.5 -bottom-1.5 grid place-items-center rounded-full border-[1.5px] bg-(--cq-surface-raised)"
        style={{
          borderColor: tone,
          color: tone,
          width: Math.max(16, size * 0.45),
          height: Math.max(16, size * 0.45),
        }}
      >
        <StateGlyph
          state={node.state}
          size={Math.max(10, Math.round(size * 0.27))}
        />
      </span>
    </span>
  );
}

export function StateLabel({
  node,
  className,
}: {
  readonly node: Pick<AgentNode, "state" | "pause" | "waitingOn">;
  readonly className?: string | undefined;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-[13px] font-medium",
        LABEL_TONE[node.state],
        className,
      )}
    >
      <StateGlyph state={node.state} size={13} />
      {stateLabel(node)}
    </span>
  );
}

const ago = sinceWords;

export function WorkforceTeam({
  nodes,
  now,
  onOpen,
  approve,
}: {
  readonly nodes: readonly AgentNode[];
  /** The reader's clock (ms), for "since". */
  readonly now: number;
  readonly onOpen: (role: Role) => void;
  /** The inline approve for an asking node (the Approval Engine's own). */
  readonly approve: (node: AgentNode) => ReactNode;
}) {
  const [filter, setFilter] = useState<AgentState | null>(null);
  const [mode, setMode] = useState<"map" | "list">("map");
  const counts = stateCounts(nodes);

  return (
    <section
      aria-labelledby="workforce-team-heading"
      className="flex flex-col gap-3"
      data-workforce-team
    >
      <h2 id="workforce-team-heading" className="sr-only">
        Q’s team
      </h2>
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0">
        {counts.map(({ state, count }) => (
          <button
            key={state}
            type="button"
            aria-pressed={filter === state}
            onClick={() => setFilter((now) => (now === state ? null : state))}
            className={cx(
              "inline-flex min-h-11 flex-none items-center gap-1.5 rounded-full border px-3 text-[13.5px] lg:min-h-9",
              filter === state
                ? state === "asking"
                  ? "border-transparent bg-(--cq-accent) text-(--cq-text-inverse)"
                  : "border-transparent bg-(--cq-text-primary) text-(--cq-canvas)"
                : state === "asking"
                  ? "border-(--cq-accent) bg-(--cq-surface-raised) text-(--cq-accent)"
                  : "border-(--cq-border) bg-(--cq-surface-raised)",
            )}
            data-chip={state}
          >
            <b className="cq-numeric font-semibold">{count}</b>
            {STATE_WORDS[state]}
          </button>
        ))}
        <div
          role="group"
          aria-label="Show as"
          className="ml-auto inline-flex flex-none rounded-[10px] border border-(--cq-border) bg-(--cq-surface-raised) p-0.5"
        >
          {(["map", "list"] as const).map((one) => (
            <button
              key={one}
              type="button"
              aria-pressed={mode === one}
              onClick={() => setMode(one)}
              className={cx(
                "min-h-10 rounded-[8px] px-3 text-[14px] lg:min-h-8",
                mode === one
                  ? "bg-(--cq-surface-subtle) font-medium text-(--cq-text-primary)"
                  : "text-(--cq-text-secondary)",
              )}
            >
              {one === "map" ? "Map" : "List"}
            </button>
          ))}
        </div>
      </div>
      {mode === "map" ? (
        <TeamMap
          nodes={nodes}
          now={now}
          filter={filter}
          onOpen={onOpen}
          approve={approve}
        />
      ) : null}
      {/* The list twin: always in the accessibility tree, visible on demand. */}
      <ul
        aria-label="Q’s team, by state"
        className={cx(
          "m-0 list-none overflow-hidden rounded-[16px] border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-0",
          mode === "map" && "sr-only",
        )}
      >
        {[...nodes]
          .sort((a, b) => stateRank(a.state) - stateRank(b.state))
          .filter((node) => filter === null || node.state === filter)
          .map((node) => (
            <li
              key={node.role}
              className="[&+&]:border-t [&+&]:border-(--cq-border-subtle)"
            >
              <button
                type="button"
                onClick={() => onOpen(node.role)}
                className="grid min-h-[68px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 px-4 py-3 text-left hover:bg-(--cq-surface-subtle)"
                data-agent-row={node.role}
              >
                <AgentRing node={node} size={38} />
                <span className="min-w-0">
                  <span className="mr-2 text-[14.5px] font-semibold">
                    {node.name}
                  </span>
                  <StateLabel node={node} />
                  <span className="block truncate text-[13px] text-(--cq-text-secondary)">
                    {node.now}
                  </span>
                </span>
                <span className="cq-numeric text-right text-[12.5px] text-(--cq-text-tertiary)">
                  <span suppressHydrationWarning>
                    {ago(node.since, now) ?? ""}
                  </span>
                  <br />
                  {dollars(node.monthUsd)}
                </span>
              </button>
            </li>
          ))}
      </ul>
      {mode === "map" ? <Legend /> : null}
    </section>
  );
}

function Legend() {
  const order: readonly AgentState[] = [
    "working",
    "thinking",
    "waiting",
    "asking",
    "held",
    "failed",
    "done",
    "paused",
    "idle",
  ];
  return (
    <div
      aria-hidden="true"
      className="hidden flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-(--cq-text-secondary) lg:flex"
    >
      {order.map((state) => (
        <span key={state} className="inline-flex items-center gap-1.5">
          <span
            className={cx(
              "inline-block h-3 w-3 rounded-full border-2",
              LEGEND_STYLE[state],
            )}
            style={{ borderColor: RING_TONE[state] }}
          />
          {STATE_WORDS[state]}
        </span>
      ))}
    </div>
  );
}

type Size = { readonly width: number; readonly height: number };

function TeamMap({
  nodes,
  now,
  filter,
  onOpen,
  approve,
}: {
  readonly nodes: readonly AgentNode[];
  readonly now: number;
  readonly filter: AgentState | null;
  readonly onOpen: (role: Role) => void;
  readonly approve: (node: AgentNode) => ReactNode;
}) {
  const reduced = useReducedMotion() === true;
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [eased, setEased] = useState(false);
  const touched = useRef(false);
  const [hover, setHover] = useState<{
    role: Role;
    left: number;
    top: number;
  } | null>(null);

  const compact = size !== null && size.width < 600;
  const layout = mapLayout(
    nodes.map((node) => node.role),
    compact,
  );
  const world = { width: layout.width, height: layout.height };

  // Measure before paint, so the first frame is already fitted: no jump.
  useLayoutEffect(() => {
    const el = viewport.current;
    if (el === null) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const worldWidth = world.width;
  const worldHeight = world.height;
  useLayoutEffect(() => {
    if (size === null || touched.current) return;
    setView(fitView(size, { width: worldWidth, height: worldHeight }));
  }, [size, worldWidth, worldHeight]);

  const zoomBy = useCallback(
    (factor: number, px?: number, py?: number, ease = true) => {
      touched.current = true;
      setEased(ease && !reduced);
      setView((now) =>
        zoomAbout(
          now,
          now.scale * factor,
          px ?? (size?.width ?? 0) / 2,
          py ?? (size?.height ?? 0) / 2,
        ),
      );
    },
    [reduced, size],
  );
  const fit = () => {
    if (size === null) return;
    touched.current = false;
    setEased(!reduced);
    setView(fitView(size, world));
  };

  // Ctrl/⌘ + wheel (and trackpad pinch, which arrives as one) zooms; a
  // plain wheel scrolls the page as usual. Non-passive, so it is bound here.
  useEffect(() => {
    const el = viewport.current;
    if (el === null) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(
        Math.exp(-event.deltaY * 0.01),
        event.clientX - rect.left,
        event.clientY - rect.top,
        false,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const moved = useRef(0);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      (event.target as Element).closest("[data-map-controls],[data-map-action]")
    )
      return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    moved.current = 0;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a !== undefined && b !== undefined) {
        pinch.current = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          scale: view.scale,
        };
      }
    }
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const last = pointers.current.get(event.pointerId);
    if (last === undefined) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const rect = event.currentTarget.getBoundingClientRect();
    if (pointers.current.size === 2 && pinch.current !== null) {
      const [a, b] = [...pointers.current.values()];
      if (a === undefined || b === undefined) return;
      const start = pinch.current;
      touched.current = true;
      setEased(false);
      setView((now) =>
        zoomAbout(
          now,
          (start.scale * Math.hypot(a.x - b.x, a.y - b.y)) /
            Math.max(1, start.distance),
          (a.x + b.x) / 2 - rect.left,
          (a.y + b.y) / 2 - rect.top,
        ),
      );
      moved.current += 10;
      return;
    }
    moved.current += Math.abs(dx) + Math.abs(dy);
    if (moved.current > 4) {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      touched.current = true;
      setDragging(true);
      setEased(false);
      setHover(null);
      setView((now) => ({ ...now, x: now.x + dx, y: now.y + dy }));
    }
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    setDragging(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const pan = (x: number, y: number) => {
      touched.current = true;
      setEased(!reduced);
      setView((now) => ({ ...now, x: now.x + x, y: now.y + y }));
    };
    const keys: Record<string, () => void> = {
      "+": () => zoomBy(1.25),
      "=": () => zoomBy(1.25),
      "-": () => zoomBy(1 / 1.25),
      "0": fit,
      ArrowLeft: () => pan(40, 0),
      ArrowRight: () => pan(-40, 0),
      ArrowUp: () => pan(0, 40),
      ArrowDown: () => pan(0, -40),
    };
    const run = keys[event.key];
    if (run === undefined) return;
    event.preventDefault();
    run();
  };

  const level = zoomLevel(view.scale);
  const inverse = Math.min(1 / view.scale, 1.6);
  const links = mapLinks(nodes);
  const byRole = new Map(nodes.map((node) => [node.role, node]));
  const hovered = hover === null ? undefined : byRole.get(hover.role);

  return (
    <div className="relative">
      <div
        ref={viewport}
        tabIndex={0}
        role="application"
        aria-roledescription="map"
        aria-label="Q’s team map. Plus and minus zoom, 0 fits, arrow keys move. The list below has the same content."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className={cx(
          "relative -mx-4 h-[470px] touch-none overflow-hidden border-y border-(--cq-border-subtle) bg-(--cq-surface) bg-[radial-gradient(color-mix(in_oklab,var(--cq-text-primary)_9%,transparent)_1px,transparent_1.2px)] bg-size-[24px_24px] select-none lg:mx-0 lg:h-[600px] lg:rounded-[16px] lg:border-x",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        data-map
        data-zoom={level}
      >
        <div
          className={cx(
            "absolute top-0 left-0 origin-top-left will-change-transform",
            eased &&
              "transition-transform duration-(--cq-motion-base) ease-out",
            size === null && "invisible",
          )}
          style={{
            width: world.width,
            height: world.height,
            transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.scale)})`,
          }}
          onTransitionEnd={() => setEased(false)}
        >
          <svg
            aria-hidden="true"
            width={world.width}
            height={world.height}
            className="pointer-events-none absolute top-0 left-0 overflow-visible"
          >
            {links.map((link) => {
              const a = layout.at.get(link.from);
              const b = layout.at.get(link.to);
              if (a === undefined || b === undefined) return null;
              return (
                <g key={`${link.from}-${link.to}`} data-link={link.kind}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={
                      link.kind === "plain" || link.kind === "peer"
                        ? "var(--cq-border)"
                        : "var(--cq-accent)"
                    }
                    strokeWidth={link.kind === "ask" ? 2 : 1.6}
                    strokeOpacity={link.kind === "live" ? 0.7 : 1}
                    strokeDasharray={
                      link.kind === "ask"
                        ? "2 5"
                        : link.kind === "peer"
                          ? "4 5"
                          : undefined
                    }
                  />
                  {link.kind === "live" && !reduced ? (
                    <circle r={3.5} fill="var(--cq-accent)">
                      <animateMotion
                        dur="2.6s"
                        repeatCount="indefinite"
                        path={`M${String(a.x)},${String(a.y)} L${String(b.x)},${String(b.y)}`}
                      />
                    </circle>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {nodes.map((node) => {
            const at = layout.at.get(node.role);
            if (at === undefined) return null;
            const dim = filter !== null && node.state !== filter;
            const since = ago(node.since, now);
            return (
              <div
                key={node.role}
                data-agent={node.role}
                data-state={node.state}
                className={cx(
                  "absolute rounded-[14px] transition-opacity duration-(--cq-motion-base)",
                  level === "far"
                    ? "w-auto max-w-[150px] p-1.5"
                    : cx(
                        "border bg-(--cq-surface-raised) p-3 pl-3.5 hover:border-(--cq-border-strong) hover:shadow-[0_6px_24px_-10px_rgb(0_0_0/0.25)]",
                        node.lead ? "w-[248px]" : "w-[224px]",
                        node.state === "asking"
                          ? "border-(--cq-accent)"
                          : "border-(--cq-border-subtle)",
                      ),
                  dim && "opacity-30",
                )}
                style={{
                  left: at.x,
                  top: at.y,
                  transform: `translate(-50%, -50%)${level === "far" ? ` scale(${String(inverse)})` : ""}`,
                }}
                onPointerEnter={(event) => {
                  if (event.pointerType !== "mouse" || dragging) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const right = rect.right + 292 < window.innerWidth;
                  setHover({
                    role: node.role,
                    left: right
                      ? rect.right + 12
                      : Math.max(8, rect.left - 292),
                    top: Math.max(
                      8,
                      Math.min(window.innerHeight - 200, rect.top),
                    ),
                  });
                }}
                onPointerLeave={() => setHover(null)}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (moved.current > 4) return;
                    setHover(null);
                    onOpen(node.role);
                  }}
                  aria-label={`${node.name}: ${stateLabel(node)}. ${node.now}`}
                  className={cx(
                    "grid w-full cursor-pointer items-center text-left",
                    level === "far"
                      ? "justify-items-center gap-2"
                      : "grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1",
                  )}
                >
                  <AgentRing node={node} size={level === "far" ? 40 : 44} />
                  <span
                    className={cx("min-w-0", level === "far" && "text-center")}
                  >
                    <span
                      className={cx(
                        "block truncate leading-tight font-semibold",
                        level === "far" ? "text-[13px]" : "text-[15.5px]",
                      )}
                    >
                      {node.name}
                    </span>
                    <StateLabel
                      node={node}
                      className={
                        level === "far"
                          ? "justify-center text-[11.5px]"
                          : undefined
                      }
                    />
                  </span>
                  {level === "far" ? null : (
                    <span
                      className={cx(
                        "col-span-2 mt-1.5 overflow-hidden text-[13.5px] leading-snug text-(--cq-text-secondary) [-webkit-box-orient:vertical] [display:-webkit-box]",
                        level === "near"
                          ? "[-webkit-line-clamp:4]"
                          : "[-webkit-line-clamp:2]",
                      )}
                    >
                      {node.now}
                    </span>
                  )}
                  {level === "near" ? (
                    <span className="col-span-2 mt-2 flex flex-col gap-1 border-t border-(--cq-border-subtle) pt-2 text-[12.5px] text-(--cq-text-tertiary)">
                      <span className="flex justify-between gap-2">
                        <span>Job</span>
                        <span className="truncate text-(--cq-text-primary)">
                          {node.job ?? "—"}
                        </span>
                      </span>
                      <span className="flex justify-between gap-2">
                        <span>Since</span>
                        <span
                          className="cq-numeric text-(--cq-text-primary)"
                          suppressHydrationWarning
                        >
                          {since ?? "—"}
                        </span>
                      </span>
                      <span className="flex justify-between gap-2">
                        <span>This month</span>
                        <span className="cq-numeric text-(--cq-text-primary)">
                          {node.runs} {node.runs === 1 ? "run" : "runs"} today ·{" "}
                          {dollars(node.monthUsd)}
                        </span>
                      </span>
                    </span>
                  ) : null}
                </button>
                {node.state === "asking" &&
                node.approval !== null &&
                level !== "far" ? (
                  <div className="mt-2 flex flex-wrap gap-1.5" data-map-action>
                    {approve(node)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div
          role="group"
          aria-label="Zoom"
          data-map-controls
          className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-[12px] border border-(--cq-border) bg-(--cq-surface-raised) p-[3px] shadow-[0_4px_18px_-8px_rgb(0_0_0/0.25)]"
        >
          <MapButton label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
            <Minus size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </MapButton>
          <span
            className="cq-numeric min-w-12 text-center text-[13px] text-(--cq-text-secondary)"
            aria-live="polite"
          >
            {Math.round(view.scale * 100)}%
          </span>
          <MapButton label="Zoom in" onClick={() => zoomBy(1.25)}>
            <Plus size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </MapButton>
          <MapButton label="Fit everyone" onClick={fit}>
            <Maximize2 size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </MapButton>
        </div>
        <p className="pointer-events-none absolute bottom-3.5 left-3.5 m-0 hidden rounded-md bg-(--cq-surface) px-1.5 text-[12.5px] text-(--cq-text-tertiary) lg:block">
          Drag to move · pinch or Ctrl/⌘ + scroll to zoom
        </p>
      </div>
      {hovered === undefined || hover === null ? null : (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-(--cq-z-popover) w-[280px] rounded-[12px] border border-(--cq-border) bg-(--cq-surface-raised) px-3.5 py-3 text-[13px] shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]"
          style={{ left: hover.left, top: hover.top }}
          data-agent-hover
        >
          <b className="block text-[14px]">{hovered.name}</b>
          <StateLabel node={hovered} />
          <p className="mt-1.5 mb-0 text-(--cq-text-secondary)">
            {hovered.now}
          </p>
          <dl className="mt-2 mb-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-(--cq-text-tertiary)">
            <dt>Job</dt>
            <dd className="m-0 truncate text-right text-(--cq-text-primary)">
              {hovered.job ?? "—"}
            </dd>
            <dt>Since</dt>
            <dd className="cq-numeric m-0 text-right text-(--cq-text-primary)">
              {ago(hovered.since, now) ?? "—"}
            </dd>
            <dt>This month</dt>
            <dd className="cq-numeric m-0 text-right text-(--cq-text-primary)">
              {dollars(hovered.monthUsd)}
            </dd>
          </dl>
        </div>
      )}
    </div>
  );
}

function MapButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-11 w-11 place-items-center rounded-[9px] hover:bg-(--cq-surface-subtle) lg:h-10 lg:w-10"
    >
      {children}
    </button>
  );
}
