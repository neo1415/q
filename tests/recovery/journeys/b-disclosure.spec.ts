import { expect, test, type Page } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { runQ } from "../support/flows.js";
import { call } from "../support/http.js";
import { answer, type ScriptRule } from "../support/script.js";
import { CAST, founderOf, world } from "../support/stack.js";
import {
  READ_QUESTION,
  SKIM_OTHER,
  dbRaises,
  inputAfter,
  moneyText,
  shareRaiseWithNetwork,
  type DbRaise,
} from "./journey-fixtures.js";

/**
 * Journey B, disclosure: one raise, one answer, on every surface (R2
 * raiseFor). Three company shapes from the seed, classified by the LOCAL
 * database: a private objective with a pitch that says the raise ("Mizan
 * shape"), a disclosed objective, and neither. For one investor the
 * Discover card, the profile and the raise Q's capital tool was handed
 * must say the same figure from the same source; a founder of another
 * tenant sees none of the private figure.
 */
const investor = CAST.investor;

function nameOf(companyId: string): string {
  return (
    world().companies.find((company) => company.companyId === companyId)
      ?.name ?? companyId
  );
}

type RaiseView = {
  readonly source: "DISCLOSED_OBJECTIVE" | "PITCH_CLAIM" | "NONE";
  readonly money: { readonly amount: string; readonly currency: string } | null;
};

const LABEL: Record<RaiseView["source"], string> = {
  DISCLOSED_OBJECTIVE: "Disclosed raise",
  PITCH_CLAIM: "From their pitch",
  NONE: "Not shared with you",
};

async function profileRaise(
  email: string,
  companyId: string,
): Promise<RaiseView | null> {
  const reply = await call(
    email,
    "api",
    "GET",
    `/v1/companies/${companyId}/profile`,
  );
  if (reply.status !== 200) return null;
  return (
    (reply.body as { overview?: { raiseView?: RaiseView } | null }).overview
      ?.raiseView ?? null
  );
}

type Shape = { readonly db: DbRaise; readonly view: RaiseView };

async function shapes(): Promise<{
  mizan: Shape | undefined;
  disclosed: Shape | undefined;
  neither: Shape | undefined;
}> {
  const db = dbRaises(world().companies.map((company) => company.companyId));
  const seen: Shape[] = [];
  for (const row of db) {
    const view = await profileRaise(investor, row.companyId);
    if (view !== null) seen.push({ db: row, view });
  }
  // Narrow shares depend on the investor's relationship; leave them out so
  // each shape is decided by the database alone.
  const plain = seen.filter((shape) => !shape.db.narrowlyShared);
  return {
    mizan: plain.find(
      (s) =>
        s.db.amount !== null &&
        !s.db.networkShared &&
        s.view.source === "PITCH_CLAIM",
    ),
    disclosed: plain.find((s) => s.db.amount !== null && s.db.networkShared),
    neither: plain.find((s) => !s.db.networkShared && s.view.source === "NONE"),
  };
}

/** Walks Discover (neutral "Next company", never Save/Pass) to the company's card. */
async function discoverCard(page: Page, companyId: string) {
  await page.goto("/discover");
  const card = page.locator(`[data-company-id="${companyId}"]`).first();
  for (let i = 0; i < 25; i += 1) {
    if (await card.isVisible().catch(() => false)) return card;
    const next = page.getByRole("button", { name: "Next company" }).first();
    if (!(await next.isEnabled().catch(() => false))) break;
    await next.click();
    await page.waitForTimeout(400);
  }
  throw new Error(
    `company ${companyId} is not in this investor's Discover feed`,
  );
}

async function raiseOnScreen(scope: ReturnType<Page["locator"]>) {
  const fact = scope.locator("[data-raise-fact]").first();
  await expect(fact).toBeVisible();
  const amount = fact.locator("[data-raise-amount]");
  return {
    source: await fact.getAttribute("data-raise-fact"),
    exact:
      (await amount.count()) === 0 ? null : await amount.getAttribute("title"),
    // The figure as shown; the profile also links the label to the pitch
    // moment ("From their pitch, 0:06"), which the card does not carry.
    shown: (await amount.count()) === 0 ? null : await amount.innerText(),
    text: (await fact.innerText()).replace(/\s+/gu, " ").trim(),
  };
}

function capitalTurn(companyId: string): ScriptRule[] {
  return [
    SKIM_OTHER,
    READ_QUESTION,
    {
      name: "b-capital-tool",
      when: { task: "COMPANY_ANALYST", user: "raising", afterTool: null },
      reply: {
        toolCalls: [
          { name: "get_capital_objective", arguments: { companyId } },
        ],
      },
    },
    {
      name: "b-capital-answer",
      when: { task: "COMPANY_ANALYST", afterTool: "get_capital_objective" },
      reply: answer("Here is what they have shared about their raise."),
    },
  ];
}

/** The raise Q's capital tool handed the model (`raise` in its result). */
function raiseQWasGiven(input: string): {
  source: string | null;
  amount: string | null;
  currency: string | null;
} {
  const match =
    /"raise":\{"source":"([A-Z_]+)","money":(?:null|\{"amount":"([0-9.]+)","currency":"([A-Z]{3})"\})/u.exec(
      input,
    );
  return {
    source: match?.[1] ?? null,
    amount: match?.[2] ?? null,
    currency: match?.[3] ?? null,
  };
}

let unshare: (() => Promise<void>) | null = null;
test.afterEach(async () => {
  await unshare?.();
  unshare = null;
});

/** The seed's Clinicrest has an ACTIVE USD objective, shared with no one. */
const DISCLOSER = "clinicrest";

for (const key of ["mizan", "disclosed", "neither"] as const) {
  test(`B ${key}: Discover card = profile = Q's figure and source, for one investor`, async ({
    browser,
  }) => {
    if (key === "disclosed")
      unshare = await shareRaiseWithNetwork(
        founderOf(DISCLOSER),
        world().company(DISCLOSER).companyId,
      );
    const shape = (await shapes())[key];
    expect(
      shape,
      `the seed has a ${key}-shape company for this investor`,
    ).toBeDefined();
    if (shape === undefined) return;
    const { db, view } = shape;
    const want = LABEL[view.source];
    const exact =
      view.money === null
        ? null
        : moneyText(view.money.amount, view.money.currency);

    // The database decides what the reader may hold.
    if (key === "disclosed") {
      expect.soft(view.source).toBe("DISCLOSED_OBJECTIVE");
      expect.soft(view.money?.amount).toBe(db.amount);
      expect.soft(view.money?.currency).toBe(db.currency);
    } else {
      expect
        .soft(view.source, "a private objective is never disclosed")
        .not.toBe("DISCLOSED_OBJECTIVE");
    }

    const page = await (await contextAs(browser, investor)).newPage();
    const card = await raiseOnScreen(await discoverCard(page, db.companyId));
    await page.goto(`/company/${db.companyId}`);
    const profile = await raiseOnScreen(page.locator("[data-company-profile]"));
    await page.context().close();

    expect.soft(card.source, "card source").toBe(view.source);
    expect.soft(profile.source, "profile source").toBe(view.source);
    expect.soft(card.shown, "card figure = profile figure").toBe(profile.shown);
    expect.soft(card.text).toContain(want);
    expect.soft(profile.text).toContain(want);
    expect.soft(card.exact, "card exact figure").toBe(exact);
    expect.soft(profile.exact, "profile exact figure").toBe(exact);
    if (key === "mizan" && db.amount !== null && db.currency !== null) {
      // The private objective's figure appears only if the pitch says the same.
      if (view.money?.amount !== db.amount)
        expect.soft(card.text).not.toContain(moneyText(db.amount, db.currency));
      expect.soft(card.text).not.toContain("Disclosed raise");
    }

    const run = await runQ(
      investor,
      `What is ${nameOf(db.companyId)} raising?`,
      capitalTurn(db.companyId),
    );
    const given = raiseQWasGiven(inputAfter(run.vendor, "b-capital-answer"));
    expect.soft(given.source, "Q's source = card's source").toBe(view.source);
    expect
      .soft(given.amount, "Q's figure = card's figure")
      .toBe(view.money?.amount ?? null);
    expect.soft(given.currency).toBe(view.money?.currency ?? null);
  });
}

test("B other tenant: a founder of another company sees nothing of the Mizan-shape private figure", async ({
  browser,
}) => {
  const shape = (await shapes()).mizan;
  expect(shape, "the seed has a Mizan-shape company").toBeDefined();
  if (shape?.db.amount == null || shape.db.currency === null) return;
  const { companyId, amount, currency } = shape.db;
  const privateWords = moneyText(amount, currency);

  const view = await profileRaise(CAST.otherFounder, companyId);
  expect
    .soft(view?.source ?? "NONE", "never the disclosed objective")
    .not.toBe("DISCLOSED_OBJECTIVE");

  const page = await (await contextAs(browser, CAST.otherFounder)).newPage();
  await page.goto(`/company/${companyId}`);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const body = await page.locator("body").innerText();
  await page.context().close();
  expect.soft(body).not.toContain(privateWords);
  expect.soft(body).not.toContain("Disclosed raise");

  const run = await runQ(
    CAST.otherFounder,
    `What is ${nameOf(companyId)} raising?`,
    capitalTurn(companyId),
  );
  const read = inputAfter(run.vendor, "b-capital-answer");
  // The whole model input, not just the answer: the Context Firewall.
  const all = run.vendor.map((request) => request.input ?? "").join("\n");
  expect
    .soft(all, "the private amount never reaches the model")
    .not.toContain(`"amount":"${amount}"`);
  expect
    .soft(raiseQWasGiven(read).source ?? "NONE")
    .not.toBe("DISCLOSED_OBJECTIVE");
});
