import type { QUiActIntent } from "@capital-q/contracts";
import {
  consequentialLabel,
  instantRequestOf,
  type InstantPageAct,
  type InstantRequest,
} from "@capital-q/q-specialists/instant-request";

import { Q_MATERIAL_CLOSE_EVENT } from "../client-actions";
import { materialDocumentOpen } from "../screen";
import { performUiAct } from "../ui-act-controller";
import {
  actionable,
  controlOf,
  isDisabled,
  KIND_ACTS,
  registeredControlIds,
  stateElement,
  stateOf,
  type ControlEntry,
} from "./registry";
import { routeTrail } from "./route-state";
import { closeShown } from "./show-store";

/**
 * Lane 7 (owner 2026-10-21: "close it", "go back", "press Book a call" --
 * immediately, every time, from any page): the requests the screen does by
 * itself, done here in the same task as the sentence's end, with no server
 * and no model. Each is done only when the screen can plainly do it now
 * (something is open to close, a page of this app is behind them, there is
 * room to scroll, exactly one control has that name); otherwise null, and
 * Q's answer says what is so.
 *
 * Never a consequential control: anything that sends, approves, deletes,
 * pays or changes a relationship keeps Q's Prepare -> Approval path.
 */

export type InstantDone = {
  /** What was done, for the voice line and the timing event. */
  readonly what: "CLOSE" | InstantPageAct | "PRESS";
};

function actId(): string {
  return `uia_now_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function visible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.closest("[data-q-hidden], [hidden], [inert]") !== null) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

/**
 * The open dialogs over the page, the topmost (last in the document)
 * first. Q's own sheet, where they may be typing "close it", is not one.
 */
function openDialogs(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="alertdialog"], dialog[open]',
    ),
  ]
    .filter(
      (dialog) =>
        visible(dialog) &&
        dialog.closest("[data-q-sheet], [data-q-dock]") === null &&
        dialog.querySelector("[data-q-composer-input]") === null,
    )
    .reverse();
}

function pressEscape(target: HTMLElement): void {
  const init: KeyboardEventInit = {
    key: "Escape",
    code: "Escape",
    bubbles: true,
    cancelable: true,
  };
  target.dispatchEvent(new KeyboardEvent("keydown", init));
  target.dispatchEvent(new KeyboardEvent("keyup", init));
}

/**
 * Closes the topmost thing over the page: what Q is showing, a dialog
 * (its own close control, else Escape, as a person would), the document
 * open in the Q room, a card in the Q room. False when nothing is open.
 */
export function closeTopmost(): boolean {
  if (closeShown()) return true;
  const dialog = openDialogs()[0];
  if (dialog !== undefined) {
    // A confirmation is never dismissed by a voice: it may be the very
    // step that asks them.
    if (dialog.getAttribute("role") === "alertdialog") return false;
    const close = dialog.querySelector<HTMLElement>(
      '[data-q-close], button[aria-label^="Close" i], button[aria-label^="Dismiss" i]',
    );
    if (close !== null && visible(close) && !isDisabled(close)) {
      close.click();
    } else {
      pressEscape(
        dialog.contains(document.activeElement) &&
          document.activeElement instanceof HTMLElement
          ? document.activeElement
          : dialog,
      );
    }
    return true;
  }
  if (materialDocumentOpen()) {
    window.dispatchEvent(new Event(Q_MATERIAL_CLOSE_EVENT));
    return true;
  }
  const card = document.querySelector<HTMLElement>("[data-q-room-close]");
  if (card !== null && visible(card)) {
    card.click();
    return true;
  }
  return false;
}

/** The element that scrolls: the shell's main area, else the document. */
function scroller(): Element {
  const main = document.getElementById("main");
  if (main !== null && main.scrollHeight > main.clientHeight + 1) return main;
  return document.scrollingElement ?? document.documentElement;
}

/** Whether the page can do this act now (else Q's answer says why not). */
function pageActPossible(act: InstantPageAct): boolean {
  if (act === "BACK") return routeTrail().length >= 2;
  if (act === "FORWARD") return false;
  const area = scroller();
  const room = area.scrollHeight - area.clientHeight;
  if (room <= 1) return false;
  return act === "SCROLL_DOWN" || act === "SCROLL_BOTTOM"
    ? area.scrollTop < room - 1
    : area.scrollTop > 0;
}

/** A visible name, as the person reads it: lower case, letters and digits. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+(?:button|tab|link)$/u, "")
    .trim();
}

function accessibleName(element: HTMLElement): string {
  const labelled = element.getAttribute("aria-labelledby");
  const byId =
    labelled === null
      ? null
      : labelled
          .split(/\s+/u)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ");
  return (
    element.getAttribute("aria-label") ??
    byId ??
    element.textContent ??
    ""
  ).trim();
}

type Pressable =
  | { readonly kind: "CONTROL"; readonly entry: ControlEntry }
  | { readonly kind: "ELEMENT"; readonly element: HTMLElement };

/** The page's own elements a person could press, outside Q's own surfaces. */
const PRESSABLE =
  'button:not([type="submit"]), [role="button"], [role="tab"], a[href], summary';

function pressableNamed(
  key: string,
  as: "TAB" | "ANY",
): Pressable[] | "CONSEQUENTIAL" {
  const found: Pressable[] = [];
  const seen = new Set<HTMLElement>();
  for (const id of registeredControlIds()) {
    const entry = controlOf(id);
    if (entry === undefined) continue;
    if (as === "TAB" && entry.kind !== "TAB") continue;
    if (entry.kind === "LIST" || entry.kind === "SECTION") continue;
    const root = entry.element();
    if (root === null || root === document.documentElement) continue;
    if (!root.isConnected || !visible(root)) continue;
    const target = stateElement(entry.kind, root);
    const name = accessibleName(target);
    if (nameKey(name) !== key) continue;
    if (consequentialLabel(name)) return "CONSEQUENTIAL";
    seen.add(actionable(root));
    found.push({ kind: "CONTROL", entry });
  }
  if (found.length > 0) return found;
  // A control the page did not register is still one a person can press.
  for (const element of document.querySelectorAll<HTMLElement>(PRESSABLE)) {
    if (seen.has(element) || !visible(element) || isDisabled(element)) continue;
    if (as === "TAB" && element.getAttribute("role") !== "tab") continue;
    // Q's own composer, dock and notices are not the page.
    if (
      element.closest(
        '[data-q-dock], [data-q-sheet], [role="alertdialog"], form',
      ) !== null
    ) {
      continue;
    }
    const name = accessibleName(element);
    if (nameKey(name) !== key) continue;
    if (consequentialLabel(name)) return "CONSEQUENTIAL";
    found.push({ kind: "ELEMENT", element });
  }
  return found;
}

/**
 * What a press is for this kind, through the controller (so it reports a
 * receipt like any act of Q's); null: a plain click on its own element.
 */
function pressAct(entry: ControlEntry): QUiActIntent["act"] | null {
  if (entry.kind === "TAB") return "SELECT_TAB";
  if (entry.kind === "DISCLOSURE" || entry.kind === "MENU") {
    const root = entry.element();
    const open =
      root !== null &&
      stateOf(entry.kind, stateElement(entry.kind, root)) === "OPEN";
    return open ? "CLOSE" : "OPEN";
  }
  return KIND_ACTS[entry.kind].includes("ACTIVATE") ? "ACTIVATE" : null;
}

function press(request: Extract<InstantRequest, { kind: "PRESS" }>): boolean {
  // The words themselves name a consequential act ("press Express
  // interest"): never by code.
  if (consequentialLabel(request.label)) return false;
  const key = nameKey(request.label);
  if (key.length === 0) return false;
  const found = pressableNamed(key, request.as);
  // Several with that name: Q asks which, never a guess.
  if (found === "CONSEQUENTIAL" || found.length !== 1) return false;
  const one = found[0];
  if (one === undefined) return false;
  if (one.kind === "ELEMENT") {
    one.element.click();
    return true;
  }
  const act = pressAct(one.entry);
  if (act === null) {
    const root = one.entry.element();
    if (root === null) return false;
    actionable(root).click();
    return true;
  }
  const intent: QUiActIntent = {
    kind: "UI_ACT",
    actId: actId(),
    act,
    target: one.entry.id,
  };
  void performUiAct(intent).catch(() => undefined);
  return true;
}

/**
 * The words' instant request, done now; null when they make none, or the
 * screen cannot plainly do it (Q's answer then decides and says).
 */
export function instantAct(text: string): InstantDone | null {
  if (typeof document === "undefined") return null;
  const request = instantRequestOf(text);
  if (request === null) return null;
  switch (request.kind) {
    case "CLOSE":
      return closeTopmost() ? { what: "CLOSE" } : null;
    case "PAGE_ACT": {
      if (!pageActPossible(request.act)) return null;
      void performUiAct({
        kind: "UI_ACT",
        actId: actId(),
        act: request.act,
      });
      return { what: request.act };
    }
    case "PRESS":
      return press(request) ? { what: "PRESS" } : null;
  }
}
