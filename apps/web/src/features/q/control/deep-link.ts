import type {
  QNavigateTargetDetail,
  QVoiceDestination,
} from "@capital-q/contracts";

import { destinationPath } from "@/features/voice/destinations";

/**
 * Q Workspace W3.2: the exact place on a page, as a URL. A move's
 * `target` (contracts, W3.1) becomes query values and a fragment the
 * pages themselves read, so a deep link the person pastes, a link Q
 * offers and a move Q makes all land on the same element:
 *
 *   ?doc=<id>       the data room's viewer opens on that document
 *   ?slide=<n>      the deck's viewer starts at that slide (with open=1)
 *   ?message=<id>   the thread scrolls to that message and marks it
 *   ?item=<id>      the Board scrolls to that item and marks it
 *   ?tab=<key>      the page's own tab (an investor page's "looks-for")
 *   ?sub=<key>      a part of that tab (an Overview section, a deck section)
 *   #section-<id>   the page scrolls to that QSection and marks it
 *   #latest         the page's latest entry (the end of a thread)
 *
 * Every value is an id the contract bounded; the page follows only ids it
 * has and authorises every read as the person, as for a typed URL.
 */

export const SECTION_HASH_PREFIX = "section-";
export const LATEST_HASH = "latest";

const BASE = "http://route.local";

/** A path with the target's query values and fragment set on it. */
export function withNavigateTarget(
  path: string,
  target: QNavigateTargetDetail | undefined,
): string {
  if (target === undefined) return path;
  let url: URL;
  try {
    url = new URL(path, BASE);
  } catch {
    return path;
  }
  if (url.origin !== BASE) return path;
  const params = url.searchParams;
  if (target.tab !== undefined) params.set("tab", target.tab);
  if (target.sub !== undefined) params.set("sub", target.sub);
  if (target.documentId !== undefined) {
    params.set("doc", target.documentId.toLowerCase());
  }
  if (target.slide !== undefined) {
    params.set("slide", String(target.slide));
    params.set("open", "1");
  }
  if (target.messageId !== undefined) {
    params.set("message", target.messageId.toLowerCase());
  }
  if (target.itemId !== undefined) {
    params.set("item", target.itemId.toLowerCase());
  }
  // The thread is the record page itself (a relationship's messages);
  // `threadId` names it for the decision, and adds nothing to the URL.
  if (target.sectionId !== undefined) {
    url.hash = `${SECTION_HASH_PREFIX}${target.sectionId}`;
  } else if (target.position === "latest" && target.messageId === undefined) {
    url.hash = LATEST_HASH;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * NAVIGATE's path (or a spoken move's): the destination's, at the target
 * (null: no page, such as an interview hand-off).
 */
export function navigateIntentPath(intent: {
  readonly destination: QVoiceDestination;
  readonly target?: QNavigateTargetDetail | undefined;
}): string | null {
  const path = destinationPath(intent.destination);
  return path === null ? null : withNavigateTarget(path, intent.target);
}

/** What a page's URL asks to arrive at, if anything. */
export type ArrivalTarget =
  | { readonly kind: "SECTION"; readonly id: string }
  | { readonly kind: "MESSAGE"; readonly id: string }
  | { readonly kind: "ITEM"; readonly id: string }
  | { readonly kind: "LATEST" };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SECTION = /^[a-z][a-z0-9-]{0,39}$/u;

/** The arrival a URL names (message, item, section, latest), or null. */
export function arrivalTargetOf(href: string): ArrivalTarget | null {
  let url: URL;
  try {
    url = new URL(href, BASE);
  } catch {
    return null;
  }
  const message = url.searchParams.get("message")?.toLowerCase();
  if (message !== undefined && ID.test(message)) {
    return { kind: "MESSAGE", id: message };
  }
  const item = url.searchParams.get("item")?.toLowerCase();
  if (item !== undefined && ID.test(item)) return { kind: "ITEM", id: item };
  const hash = url.hash.replace(/^#/u, "");
  if (hash.startsWith(SECTION_HASH_PREFIX)) {
    const id = hash.slice(SECTION_HASH_PREFIX.length);
    return SECTION.test(id) ? { kind: "SECTION", id } : null;
  }
  if (hash === LATEST_HASH) return { kind: "LATEST" };
  return null;
}

/**
 * The element an arrival lands on, in `root`: a message or Board item by
 * its own data attribute; a section by its QSection id, else (a page's
 * older anchor such as /profile's `#mandate`) the element with that id;
 * the latest entry of a thread or list. Ids are matched exactly, never
 * built into a selector.
 */
export function arrivalElement(
  target: ArrivalTarget,
  root: ParentNode = document,
): HTMLElement | null {
  const byAttribute = (attribute: string, value: string) =>
    [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(
      (element) => element.getAttribute(attribute)?.toLowerCase() === value,
    ) ?? null;
  switch (target.kind) {
    case "MESSAGE":
      return byAttribute("data-q-message", target.id);
    case "ITEM":
      return byAttribute("data-board-item", target.id);
    case "SECTION":
      return (
        byAttribute("data-q-section", target.id) ??
        [...root.querySelectorAll<HTMLElement>("[id]")].find(
          (element) => element.id === target.id,
        ) ??
        null
      );
    case "LATEST": {
      const entries = root.querySelectorAll<HTMLElement>(
        "[data-q-message], [data-board-item]",
      );
      return entries.item(entries.length - 1) ?? null;
    }
  }
}

/**
 * The element that has a box: a QSection marker is `display: contents`
 * (it adds no box), so it scrolls to and marks its first child that has.
 */
export function boxOf(element: HTMLElement): HTMLElement | null {
  if (element.getClientRects().length > 0) return element;
  for (const child of element.children) {
    if (!(child instanceof HTMLElement)) continue;
    const box = boxOf(child);
    if (box !== null) return box;
  }
  return null;
}
