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

/** An anchor's element, or null when the page does not have it (yet). */
export function anchorElement(anchor: string): HTMLElement | null {
  const escaped = anchor.replace(/["\\]/gu, "");
  return document.querySelector<HTMLElement>(`[data-qp-anchor="${escaped}"]`);
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
  const until = Date.now() + waitMs;
  let element = anchorElement(anchor);
  while (element === null && !signal.aborted && Date.now() < until) {
    await sleep(100, signal);
    element = anchorElement(anchor);
  }
  if (element === null || signal.aborted) return false;
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
    });
  }
  return true;
}
