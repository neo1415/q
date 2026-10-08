import { expect, type Locator, type Page } from "@playwright/test";
import type { QTurnDisposition, QUiActReceipt } from "@capital-q/contracts";

/**
 * Talking to Q the way a person does, and reading what the product shows.
 * Every selector the recovery suite depends on lives here or in pages.ts,
 * so a markup change is one edit.
 *
 * Contract hooks this file relies on (requested from the lead, spec §3.3):
 *   G-R1  window CustomEvent "cq:ui-act-receipt" per UI act      (C)
 *   G-R3  [data-q-turn-id][data-q-disposition] per rendered turn (A, B, E)
 * Until they land, tests that read them are annotated expected red.
 */

export const TERMINAL: readonly QTurnDisposition[] = [
  "ANSWERED",
  "CLARIFIED",
  "ACTED",
  "FAILED",
  "CANCELLED",
  "SUPERSEDED",
  "IGNORED",
];

export function composer(page: Page): Locator {
  return page
    .getByPlaceholder(/^(Message Q|Ask Q|Type instead)/u)
    .first();
}

/** Opens Q from wherever the person is (the Q page, or the shell's Ask Q). */
export async function openQ(page: Page): Promise<void> {
  if (await composer(page).isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Ask Q" }).first().click();
  await expect(composer(page)).toBeVisible({ timeout: 30_000 });
}

export function settledAnswers(page: Page): Locator {
  return page.locator('[data-q-answer="settled"]');
}

/** Types a message to Q and waits for Q's settled answer to it. */
export async function ask(page: Page, text: string): Promise<Locator> {
  await openQ(page);
  const before = await settledAnswers(page).count();
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(settledAnswers(page)).toHaveCount(before + 1, { timeout: 120_000 });
  return settledAnswers(page).nth(before);
}

/** Sends without waiting for an answer (failure tests). */
export async function send(page: Page, text: string): Promise<void> {
  await openQ(page);
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

export function turns(page: Page): Locator {
  return page.locator("[data-q-turn-id]");
}

/** SPEC §4.3: the last accepted turn reaches a terminal disposition (G-R3). */
export async function expectLastTurnTerminal(
  page: Page,
  allowed: readonly QTurnDisposition[] = TERMINAL,
  timeout = 120_000,
): Promise<QTurnDisposition> {
  const last = turns(page).last();
  await expect(last).toHaveAttribute(
    "data-q-disposition",
    new RegExp(`^(${allowed.join("|")})$`, "u"),
    { timeout },
  );
  return (await last.getAttribute("data-q-disposition")) as QTurnDisposition;
}

/** Records every UI act receipt the page reports (G-R1). Call before goto. */
export async function recordReceipts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const own = window as Window & { __cqReceipts?: unknown[] };
    own.__cqReceipts = [];
    window.addEventListener("cq:ui-act-receipt", (event) => {
      own.__cqReceipts?.push((event as CustomEvent).detail);
    });
  });
}

export type SeenReceipt = QUiActReceipt & { act?: string; target?: string };

export async function receipts(page: Page): Promise<SeenReceipt[]> {
  return page.evaluate(
    () => ((window as Window & { __cqReceipts?: unknown[] }).__cqReceipts ?? []) as never,
  );
}

export async function expectReceipt(
  page: Page,
  match: Partial<SeenReceipt>,
  timeout = 30_000,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await receipts(page)).some((receipt) =>
          Object.entries(match).every(
            ([key, value]) => (receipt as Record<string, unknown>)[key] === value,
          ),
        ),
      { timeout, message: `a UI act receipt matching ${JSON.stringify(match)}` },
    )
    .toBe(true);
}

/** The model-facing screen tool (SPEC §3: `operate_screen`) as a scripted call. */
export function operateScreen(
  act: string,
  target?: string,
  extra: { index?: number; value?: string | boolean | null } = {},
) {
  return {
    name: "operate_screen",
    arguments: { act, ...(target === undefined ? {} : { target }), ...extra },
  };
}
