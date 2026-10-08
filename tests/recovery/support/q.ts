import { expect, type Locator, type Page } from "@playwright/test";
/**
 * Mirrors of the lead's contracts (packages/contracts/src/q/turn.ts and
 * ui-act.ts). The root test project does not depend on @capital-q/contracts;
 * these are what the DOM is read against, nothing is produced from them.
 */
type QTurnDisposition =
  | "ANSWERED"
  | "CLARIFIED"
  | "ACTED"
  | "FAILED"
  | "CANCELLED"
  | "SUPERSEDED"
  | "IGNORED";
type QUiActReceipt = {
  readonly actId: string;
  readonly status: "DONE" | "TARGET_MISSING" | "NOT_APPLICABLE" | "FAILED";
  readonly seq?: number;
};

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
  return page.getByPlaceholder(/^(Message Q|Ask Q|Type instead)/u).first();
}

/** Opens Q from wherever the person is (the Q page, or the shell's Ask Q). */
export async function openQ(page: Page): Promise<void> {
  if (
    await composer(page)
      .isVisible()
      .catch(() => false)
  )
    return;
  // Off the Q page, Q is the floating dock ("Q, ready, about …"; ADR 0017).
  const dock = page.locator("[data-q-dock] [data-q-dock-button]");
  await (
    (await dock.isVisible().catch(() => false))
      ? dock
      : page.getByRole("button", { name: /^(Ask Q|Q, )/u }).first()
  ).click();
  await expect(composer(page)).toBeVisible({ timeout: 30_000 });
}

/** Starts the voice line (the Q page shows "Talk with Q" twice: stage and composer). */
export async function talk(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /Talk with Q/u })
    .first()
    .click();
}

export function settledAnswers(page: Page): Locator {
  return page.locator('[data-q-answer="settled"]');
}

/** Types a message to Q and waits for Q's settled answer to it. */
export async function ask(page: Page, text: string): Promise<Locator> {
  await openQ(page);
  // The dock loads its history after it opens; count once it has settled,
  // so an old answer arriving late is not taken for the new one.
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const before = await settledAnswers(page).count();
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(settledAnswers(page)).toHaveCount(before + 1, {
    timeout: 120_000,
  });
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
): Promise<QTurnDisposition | null> {
  // Soft: a missing disposition is reported, and the test still goes on to
  // check the real effects (URL, tab, section, server state), so one run
  // shows everything that is wrong rather than the first thing.
  if ((await turns(page).count()) === 0) {
    await page.waitForTimeout(3_000);
    if ((await turns(page).count()) === 0) {
      expect
        .soft(0, "no rendered turn carries data-q-turn-id (G-R3)")
        .toBeGreaterThan(0);
      return null;
    }
  }
  const last = turns(page).last();
  await expect
    .soft(last)
    .toHaveAttribute(
      "data-q-disposition",
      new RegExp(`^(${allowed.join("|")})$`, "u"),
      {
        timeout,
      },
    );
  return (await last.getAttribute(
    "data-q-disposition",
  )) as QTurnDisposition | null;
}

export type SeenReceipt = QUiActReceipt & { act?: string; target?: string };

const seen = new WeakMap<Page, SeenReceipt[]>();

/**
 * Records every UI act receipt the page reports to the server. Workstream C
 * reports them as a batch POST to /api/q-ui-acts ({reports: [{intent,
 * receipt}]}, apps/web/src/features/q/control/receipt-reporter.ts), so the
 * suite reads the same body the server receives. A receipt is evidence the
 * product believes it acted; every test also checks the effect itself.
 */
export type SeenNavigation = {
  readonly status: "DONE" | "FAILED";
  readonly expected: string | null;
  readonly route?: string;
};
const navigationsSeen = new WeakMap<Page, SeenNavigation[]>();
const acceptedSeen = new WeakMap<Page, number[]>();

/** INC-1 navigation receipts the page reported, and q-api's `accepted` counts. */
export function navigationReceipts(page: Page): {
  readonly navigations: readonly SeenNavigation[];
  readonly accepted: readonly number[];
} {
  return {
    navigations: [...(navigationsSeen.get(page) ?? [])],
    accepted: [...(acceptedSeen.get(page) ?? [])],
  };
}

export async function recordReceipts(page: Page): Promise<void> {
  const list: SeenReceipt[] = [];
  seen.set(page, list);
  const navigations: SeenNavigation[] = [];
  navigationsSeen.set(page, navigations);
  const accepted: number[] = [];
  acceptedSeen.set(page, accepted);
  // The batch is sent with `keepalive`, whose response body Playwright's
  // response event does not expose; passing it through a route does.
  await page.route("**/api/q-ui-acts", async (route) => {
    const response = await route.fetch();
    try {
      const body = (await response.json()) as { accepted?: unknown };
      accepted.push(
        typeof body.accepted === "number" ? body.accepted : -response.status(),
      );
    } catch {
      accepted.push(-response.status());
    }
    await route.fulfill({ response });
  });
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/q-ui-acts")
    ) {
      try {
        const body = JSON.parse(request.postData() ?? "{}") as {
          navigations?: SeenNavigation[];
        };
        navigations.push(...(body.navigations ?? []));
      } catch {
        // Not JSON: not a receipt batch.
      }
    }
    if (
      request.method() !== "POST" ||
      !request.url().includes("/api/q-ui-acts")
    )
      return;
    try {
      const body = JSON.parse(request.postData() ?? "{}") as {
        reports?: Array<{
          intent?: { act?: string; target?: string };
          receipt?: QUiActReceipt;
        }>;
      };
      for (const report of body.reports ?? []) {
        if (report.receipt === undefined) continue;
        list.push({
          ...report.receipt,
          ...(report.intent?.act === undefined
            ? {}
            : { act: report.intent.act }),
          ...(report.intent?.target === undefined
            ? {}
            : { target: report.intent.target }),
        });
      }
    } catch {
      // Not JSON: not a receipt batch.
    }
  });
  await Promise.resolve();
}

export function receipts(page: Page): Promise<SeenReceipt[]> {
  return Promise.resolve([...(seen.get(page) ?? [])]);
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
            ([key, value]) =>
              (receipt as Record<string, unknown>)[key] === value,
          ),
        ),
      {
        timeout,
        message: `a UI act receipt matching ${JSON.stringify(match)}`,
      },
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
