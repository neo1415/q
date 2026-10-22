/**
 * Q Pitch v6: the section Q is talking about, on screen and lit (owner,
 * 16 Oct: "highlighting is mandatory for each section Q talks about").
 *
 * Deterministic and local: the section is found by its stable anchor id
 * (`data-qp-anchor`, or an existing marker mapped below), brought into
 * view, opened or closed when the line says so, and marked `data-qp-lit`
 * for the stylesheet's gold ring. One section is lit at a time. Nothing
 * here is authority: it moves the viewer's own screen, as a scroll would.
 */

/**
 * Anchors placed by a stable existing marker rather than by markup: one
 * table per track, so a page's own markup never encodes tour step numbers.
 * `select` finds the element; `tap`, when the line opens it, is what a
 * person would press to bring it forward (a card into the spotlight).
 */
export type AnchorPlacement = {
  readonly select: string;
  readonly tap?: string | undefined;
};
const placements = new Map<string, AnchorPlacement>();

/** Registers a track's placements (idempotent; later ones win). */
export function placeAnchors(
  table: Readonly<Record<string, AnchorPlacement>>,
): void {
  for (const [anchor, placement] of Object.entries(table)) {
    placements.set(anchor, placement);
  }
}

/**
 * An anchor's element, or null when the page does not have it (yet). A
 * shared element may carry several anchors, space-separated (one per
 * track: `inv.07.crm.hub fdr.05.crm.hub`). An anchor placed by marker is
 * written onto the element it finds, so the stylesheet treats both alike.
 */
export function anchorElement(anchor: string): HTMLElement | null {
  const escaped = anchor.replace(/["\\\s]/gu, "");
  const marked = document.querySelector<HTMLElement>(
    `[data-qp-anchor~="${escaped}"]`,
  );
  if (marked !== null) return marked;
  const placement = placements.get(anchor);
  if (placement === undefined) return null;
  let found: HTMLElement | null;
  try {
    found = document.querySelector<HTMLElement>(placement.select);
  } catch {
    return null;
  }
  if (found === null) return null;
  const existing = found.getAttribute("data-qp-anchor");
  found.setAttribute(
    "data-qp-anchor",
    existing === null ? anchor : `${existing} ${anchor}`,
  );
  return found;
}

/** What to press to bring the anchor forward, when its placement says. */
function tapOf(anchor: string, element: HTMLElement): HTMLElement | null {
  const tap = placements.get(anchor)?.tap;
  if (tap === undefined) return null;
  try {
    return element.matches(tap)
      ? element
      : element.querySelector<HTMLElement>(tap);
  } catch {
    return null;
  }
}

const LIT = "data-qp-lit";

/** Lights nothing: the step left, the tour paused or ended. */
export function unlightAll(): void {
  for (const element of document.querySelectorAll<HTMLElement>(`[${LIT}]`)) {
    element.removeAttribute(LIT);
  }
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The element's own <details>, when it is one or holds one first. */
function disclosureOf(element: HTMLElement): HTMLDetailsElement | null {
  if (element instanceof HTMLDetailsElement) return element;
  return element.querySelector<HTMLDetailsElement>(":scope > details") ?? null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * The anchor's element, as soon as the page renders it: answered by a
 * MutationObserver on the next change (about a frame), not a 100 ms poll
 * (engine audit, 21 Oct). Null when it never appears within `waitMs`.
 */
function waitForAnchor(
  anchor: string,
  signal: AbortSignal,
  waitMs: number,
): Promise<HTMLElement | null> {
  const found = anchorElement(anchor);
  if (found !== null || signal.aborted) return Promise.resolve(found);
  return new Promise((resolve) => {
    let done = false;
    const finish = (element: HTMLElement | null) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(element);
    };
    const observer = new MutationObserver(() => {
      const element = anchorElement(anchor);
      if (element !== null) finish(element);
    });
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(anchorElement(anchor)), waitMs);
    signal.addEventListener("abort", onAbort, { once: true });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-qp-anchor", "open", "aria-expanded", "class"],
    });
  });
}

/** A card's move into the spotlight (its layout animation is 380 ms). */
const TAP_SETTLE_MS = 450;

/** How long a page may take to render a section the step opened. */
export const ANCHOR_WAIT_MS = 4_000;

/**
 * Bring `anchor` into view, open or close it if asked, and light it.
 * Resolves true once it is lit, false when the page never showed it
 * (the line is still spoken; the receipt records the miss).
 */
export async function lightSection(
  anchor: string,
  options: { readonly open?: boolean | undefined },
  signal: AbortSignal,
  waitMs: number = ANCHOR_WAIT_MS,
): Promise<boolean> {
  let element = await waitForAnchor(anchor, signal, waitMs);
  if (element === null || signal.aborted) return false;
  if (options.open === true) {
    const tap = tapOf(anchor, element);
    if (tap !== null && tap.getAttribute("aria-expanded") !== "true") {
      // Pressed as a person would; the page re-renders the section in its
      // larger place, so it is found again once the move has settled.
      tap.click();
      await sleep(TAP_SETTLE_MS, signal);
      element = anchorElement(anchor) ?? element;
    }
  }
  const disclosure = disclosureOf(element);
  if (disclosure !== null && options.open !== undefined) {
    disclosure.open = options.open;
  }
  unlightAll();
  element.setAttribute(LIT, "");
  if (typeof element.scrollIntoView === "function") {
    element.scrollIntoView({
      behavior: reducedMotion() ? "auto" : "smooth",
      block: "start",
      inline: "nearest",
    });
  }
  return true;
}
