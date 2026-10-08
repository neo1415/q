import type {
  QControlKind,
  QManifestControl,
  QUiAct,
  QUiActIntent,
  QUiActReceipt,
} from "@capital-q/contracts";

/**
 * RECOVERY-2026-10 (C1): the controls a page lets Q operate, by semantic
 * id (docs/recovery/specs/C-app-control.md §3.1).
 *
 * A control is registered while it is mounted, with the element a person
 * would click. Its state is read from that element's own ARIA attributes
 * each time it is asked for, so registering adds no second state model and
 * cannot drift from what assistive technology announces. Only ids, kinds,
 * states and list sizes leave the browser (q.screen.v2); labels never do.
 *
 * W7: no runtime import from the contracts package (it would load with
 * the first paint). The id rule and the bound below are the contract's
 * (ui-act.ts), pinned by registry.test.ts; the server checks in full.
 */
export const CONTROL_ID =
  /^[a-z][a-z0-9_-]{0,31}(\.[a-z0-9][a-z0-9_-]{0,47}){1,3}$/u;
export const CONTROLS_MAX = 48;

export type ControlStatus = QUiActReceipt["status"];

/**
 * A page's own handler for an act its kind does not do by default (a
 * filter's value, a dialog's close). Returns the receipt status; throwing
 * is FAILED.
 */
export type ControlHandler = (
  intent: QUiActIntent,
) => Promise<ControlStatus> | ControlStatus;

export type ControlEntry = {
  readonly id: string;
  readonly kind: QControlKind;
  /** The element a person would click or see; null while not mounted. */
  readonly element: () => HTMLElement | null;
  readonly onAct?: ControlHandler | undefined;
  /** Its own handler decides every act; the kind's default never runs. */
  readonly exclusive?: boolean | undefined;
  /** LIST: how many items it holds, when the page knows better than the DOM. */
  readonly count?: (() => number | undefined) | undefined;
};

type Registered = ControlEntry & { readonly order: number };

const controls = new Map<string, Registered>();
const listeners = new Set<() => void>();
let order = 0;
let notifying = false;

function changed(): void {
  if (notifying) return;
  notifying = true;
  queueMicrotask(() => {
    notifying = false;
    for (const listener of listeners) listener();
  });
}

/** Heard (once per batch) whenever a control registers or leaves. */
export function subscribeControls(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Registers a control; the returned function unregisters it. An id that
 * breaks the contract's rule is refused (a no-op), so a typo can never
 * reach the manifest. The newest registration of an id wins while it is
 * mounted (a page replacing its own panel).
 */
export function registerControl(entry: ControlEntry): () => void {
  if (!CONTROL_ID.test(entry.id)) return () => undefined;
  order += 1;
  const registered: Registered = { ...entry, order };
  controls.set(entry.id, registered);
  changed();
  return () => {
    if (controls.get(entry.id) === registered) {
      controls.delete(entry.id);
      changed();
    }
  };
}

export function controlOf(id: string): ControlEntry | undefined {
  return controls.get(id);
}

/** Every registered id (tests; the "Q can operate" count). */
export function registeredControlIds(): readonly string[] {
  return [...controls.keys()];
}

/** Clears every registration (tests). */
export function resetControls(): void {
  controls.clear();
  changed();
}

const INTERACTIVE =
  'a[href], button, summary, input, select, textarea, [role="tab"], [role="button"], [role="link"], [role="menuitem"], [role="switch"], [role="checkbox"], [tabindex]';

/**
 * The element an act works on. A `<QControl>` wrapper is `display:
 * contents` around the page's own control, so the act goes to the first
 * interactive element inside it (the link of a tab, the button of a menu).
 */
export function actionable(element: HTMLElement): HTMLElement {
  if (element.matches(INTERACTIVE)) return element;
  return element.querySelector<HTMLElement>(INTERACTIVE) ?? element;
}

/** Kinds that act through a click on the page's own interactive element. */
const CLICK_KINDS: ReadonlySet<QControlKind> = new Set([
  "TAB",
  "BUTTON",
  "MENU",
  "DISCLOSURE",
  "TOGGLE",
  "LIST_ITEM",
  "INPUT",
]);

/**
 * The element whose ARIA tells a control's state: the interactive element
 * inside a clickable control's marker, or the part itself (a section, a
 * list, a dialog).
 */
export function stateElement(
  kind: QControlKind,
  element: HTMLElement,
): HTMLElement {
  return CLICK_KINDS.has(kind) ? actionable(element) : element;
}

export function isInteractive(element: HTMLElement): boolean {
  return element.matches(INTERACTIVE);
}

// ---------------------------------------------------------------------------
// State, read from the element's own ARIA.
// ---------------------------------------------------------------------------

export type ControlState = NonNullable<QManifestControl["state"]>;

function attribute(element: Element, name: string): string | null {
  return element.getAttribute(name);
}

export function isDisabled(element: HTMLElement): boolean {
  if (attribute(element, "aria-disabled") === "true") return true;
  return "disabled" in element && element.disabled === true;
}

/** The closed state a kind reports, or undefined when it has none. */
export function stateOf(
  kind: QControlKind,
  element: HTMLElement,
): ControlState | undefined {
  if (isDisabled(element)) return "DISABLED";
  switch (kind) {
    case "TAB": {
      const selected = attribute(element, "aria-selected");
      const current = attribute(element, "aria-current");
      return selected === "true" || (current !== null && current !== "false")
        ? "SELECTED"
        : undefined;
    }
    case "DISCLOSURE":
    case "MENU":
    case "DIALOG": {
      const expanded = attribute(element, "aria-expanded");
      if (expanded === "true") return "OPEN";
      if (expanded === "false") return "CLOSED";
      if (kind === "DIALOG") return "OPEN";
      return undefined;
    }
    case "TOGGLE": {
      const on =
        attribute(element, "aria-pressed") ??
        attribute(element, "aria-checked") ??
        ("checked" in element && typeof element.checked === "boolean"
          ? String(element.checked)
          : null);
      if (on === "true") return "ON";
      if (on === "false") return "OFF";
      return undefined;
    }
    case "SECTION":
    case "LIST":
    case "LIST_ITEM":
    case "BUTTON":
    case "FILTER":
    case "INPUT":
    case "CAROUSEL":
      return undefined;
  }
}

/**
 * The items of a list, in order: those the page marked `data-q-item`,
 * else its list items, else (a plain grid of cards) its element children.
 */
export function listItems(element: HTMLElement): HTMLElement[] {
  const marked = element.querySelectorAll<HTMLElement>("[data-q-item]");
  if (marked.length > 0) return [...marked];
  const items = element.querySelectorAll<HTMLElement>(
    'li, [role="listitem"], [role="option"], [role="row"]',
  );
  if (items.length > 0) return [...items];
  const box =
    element.children.length === 1 && element.firstElementChild !== null
      ? element.firstElementChild
      : element;
  return [...box.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
}

function hidden(element: HTMLElement): boolean {
  return element.closest("[data-q-hidden]") !== null || element.hidden;
}

/** Which acts each kind takes by default (ui-act.ts's own notes). */
export const KIND_ACTS: Readonly<Record<QControlKind, readonly QUiAct[]>> = {
  TAB: ["SELECT_TAB", "ACTIVATE", "SCROLL_TO", "FOCUS"],
  SECTION: ["SCROLL_TO", "FOCUS"],
  LIST: ["SELECT_ITEM", "SCROLL_TO", "FOCUS"],
  LIST_ITEM: ["ACTIVATE", "SCROLL_TO", "FOCUS"],
  BUTTON: ["ACTIVATE", "SCROLL_TO", "FOCUS"],
  MENU: ["OPEN", "CLOSE", "EXPAND", "COLLAPSE", "SCROLL_TO", "FOCUS"],
  DISCLOSURE: ["EXPAND", "COLLAPSE", "OPEN", "CLOSE", "SCROLL_TO", "FOCUS"],
  FILTER: ["FILTER", "SCROLL_TO", "FOCUS"],
  TOGGLE: ["SET", "SCROLL_TO", "FOCUS"],
  INPUT: ["FOCUS", "SCROLL_TO"],
  DIALOG: ["CLOSE", "FOCUS"],
  CAROUSEL: ["NEXT", "PREVIOUS", "SCROLL_TO", "FOCUS"],
};

const KIND_RANK: Readonly<Record<QControlKind, number>> = {
  DIALOG: 0,
  TAB: 1,
  SECTION: 2,
  LIST: 3,
  FILTER: 4,
  MENU: 5,
  DISCLOSURE: 6,
  TOGGLE: 7,
  CAROUSEL: 8,
  BUTTON: 9,
  INPUT: 10,
  LIST_ITEM: 11,
};

/**
 * What travels in the manifest's `controls`: every mounted, visible
 * control (an open dialog first, then tabs, sections, lists, the rest),
 * bounded to the contract's maximum. Ids, kinds, states and counts only.
 */
export function manifestControls(): QManifestControl[] {
  const out: { readonly control: QManifestControl; readonly rank: number }[] =
    [];
  for (const entry of controls.values()) {
    const element = entry.element();
    if (element === null || !element.isConnected || hidden(element)) continue;
    const state = stateOf(entry.kind, stateElement(entry.kind, element));
    let count: number | undefined;
    if (entry.kind === "LIST") {
      const counted = entry.count?.() ?? listItems(element).length;
      count = Math.max(0, Math.min(10_000, Math.round(counted)));
    }
    out.push({
      control: {
        id: entry.id,
        kind: entry.kind,
        ...(state === undefined ? {} : { state }),
        ...(count === undefined ? {} : { count }),
      },
      rank: KIND_RANK[entry.kind] * 1_000_000 + entry.order,
    });
  }
  return out
    .sort((left, right) => left.rank - right.rank)
    .slice(0, CONTROLS_MAX)
    .map((one) => one.control);
}
