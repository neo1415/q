/**
 * The Q Workspace's pane layout (W1.3, W1.4, W1.5): pure rules, shared by
 * the client store, the boot script and Q's `LAYOUT_SET`.
 */
export const Q_PANE_MIN = 300;
export const Q_PANE_MAX = 640;
export const Q_PANE_DEFAULT = 380;
/** One arrow-key step of the separator. */
export const Q_PANE_STEP = 24;

export const LAYOUT_STORAGE_KEY = "cq-workspace-layout";

export type PaneState = "open" | "collapsed";

export type WorkspaceLayout = {
  readonly qWidth: number;
  readonly qPane: PaneState;
  readonly pagePane: PaneState;
};

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  qWidth: Q_PANE_DEFAULT,
  qPane: "open",
  pagePane: "open",
};

export function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return Q_PANE_DEFAULT;
  return Math.round(Math.min(Q_PANE_MAX, Math.max(Q_PANE_MIN, width)));
}

function paneOf(raw: unknown): PaneState {
  return raw === "collapsed" ? "collapsed" : "open";
}

/**
 * Both panes are never collapsed together: the screen would hold nothing.
 * When a change would do that, the pane the change did not name opens.
 */
export function settle(
  next: WorkspaceLayout,
  named: "qPane" | "pagePane" | null,
): WorkspaceLayout {
  if (next.qPane === "open" || next.pagePane === "open") return next;
  return named === "qPane"
    ? { ...next, pagePane: "open" }
    : { ...next, qPane: "open" };
}

/** A stored layout, read defensively: anything odd is the default. */
export function parseLayout(raw: string | null): WorkspaceLayout {
  if (raw === null) return DEFAULT_LAYOUT;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return DEFAULT_LAYOUT;
    const record = value as Record<string, unknown>;
    return settle(
      {
        qWidth: clampWidth(
          typeof record["qWidth"] === "number"
            ? record["qWidth"]
            : Q_PANE_DEFAULT,
        ),
        qPane: paneOf(record["qPane"]),
        pagePane: paneOf(record["pagePane"]),
      },
      null,
    );
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** Q's `LAYOUT_SET`: only the panes it names change. */
export function applyLayoutSet(
  current: WorkspaceLayout,
  set: { readonly qPane?: PaneState; readonly pagePane?: PaneState },
): WorkspaceLayout {
  const next: WorkspaceLayout = {
    ...current,
    ...(set.qPane === undefined ? {} : { qPane: set.qPane }),
    ...(set.pagePane === undefined ? {} : { pagePane: set.pagePane }),
  };
  // A request naming both panes collapsed keeps Q (the conversation).
  const named =
    set.qPane !== undefined && set.pagePane === undefined
      ? "qPane"
      : set.pagePane !== undefined && set.qPane === undefined
        ? "pagePane"
        : "pagePane";
  return settle(next, named);
}

/**
 * Applied to `<html>` before the first paint (and by the store after), so
 * the panes are the right size in the very first frame: no layout shift.
 * Attributes rather than React state, because they exist before hydration.
 */
export const WORKSPACE_BOOT_SCRIPT = `try{var d=document.documentElement,r=localStorage.getItem(${JSON.stringify(
  LAYOUT_STORAGE_KEY,
)}),v=r?JSON.parse(r):{},w=typeof v.qWidth==="number"&&isFinite(v.qWidth)?Math.min(${Q_PANE_MAX},Math.max(${Q_PANE_MIN},Math.round(v.qWidth))):${Q_PANE_DEFAULT},q=v.qPane==="collapsed",p=v.pagePane==="collapsed";if(q&&p){q=false}d.style.setProperty("--cq-ws-q-width",w+"px");if(q)d.setAttribute("data-cq-ws-q","collapsed");if(p)d.setAttribute("data-cq-ws-page","collapsed")}catch(e){}`;
