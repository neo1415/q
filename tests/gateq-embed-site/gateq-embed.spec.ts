import { expect, test, type Frame, type Page } from "@playwright/test";

import { startHostSite, startStubCapitalQ, type RunningSite } from "./sites.js";

/**
 * GateQ embedded on an investor's own website (B7), in a real browser.
 *
 * Stand-in (always runs): a fictional investor site on http://localhost:4417
 * pastes Capital Q's REAL embed and launcher scripts, served by a local
 * stand-in whose embed page carries the frame-ancestors header Capital Q
 * writes for a gateway that lists http://localhost:4417. Checks the frame,
 * its sandbox, that neither side can read the other, that the launcher loads
 * nothing until pressed, and that a site NOT on the list cannot frame it.
 *
 * Live (CQ_GATEQ_EMBED_ORIGIN + CQ_GATEQ_EMBED_GATEWAY): the same site frames
 * a real Capital Q web origin and fictional gateway. It fills the first
 * application step inside the frame and presses nothing that saves: no
 * account, no application row, no email. With CQ_GATEQ_EMBED_EXPECT_ALLOWLIST=1
 * (the gateway lists http://localhost:4417 and nothing on 127.0.0.1) it also
 * checks the unlisted origin is refused.
 */

const HOST_PORT = Number(process.env.CQ_GATEQ_EMBED_HOST_PORT ?? "4417");
const STUB_PORT = Number(process.env.CQ_GATEQ_EMBED_STUB_PORT ?? "4418");
const LIVE_ORIGIN = process.env.CQ_GATEQ_EMBED_ORIGIN;
const LIVE_GATEWAY = process.env.CQ_GATEQ_EMBED_GATEWAY;
const STUB_GATEWAY = "gq_kilimafictional0001";
const LISTED = `http://localhost:${String(HOST_PORT)}`;
const UNLISTED = `http://127.0.0.1:${String(HOST_PORT)}`;

const inlineFrame = (page: Page) =>
  page.locator('main iframe[title="Apply with Capital Q"]');

async function embedOf(page: Page): Promise<Frame> {
  const element = await inlineFrame(page).elementHandle();
  const frame = await element?.contentFrame();
  if (frame === null || frame === undefined) throw new Error("no embed frame");
  return frame;
}

/** What the host page sees of the frame: never its document. */
const hostReadsFrame = (page: Page) =>
  page.evaluate(() => {
    const frame = document.querySelector("iframe");
    try {
      return frame?.contentWindow?.document.body.innerText ?? "NO_FRAME";
    } catch (error: unknown) {
      return error instanceof Error ? error.name : "ERROR";
    }
  });

/** What the frame sees of the host page: never its document. */
const frameReadsHost = (frame: Frame) =>
  frame.evaluate(() => {
    try {
      return (
        window.parent.document.getElementById("host-secret")?.textContent ??
        "NO_HOST"
      );
    } catch (error: unknown) {
      return error instanceof Error ? error.name : "ERROR";
    }
  });

/** Chromium shows its own error page in a frame the policy refused. */
async function expectRefused(page: Page, capitalQOrigin: string) {
  await expect(inlineFrame(page)).toHaveCount(1);
  const frame = await embedOf(page);
  await expect
    .poll(() => frame.url().startsWith("chrome-error:"), { timeout: 15_000 })
    .toBe(true);
  expect(frame.url().startsWith(capitalQOrigin)).toBe(false);
  await expect(frame.getByRole("heading", { name: /Apply to/u })).toHaveCount(
    0,
  );
}

test.describe("the embed on another website, against a stand-in", () => {
  let stub: RunningSite;
  let site: RunningSite;
  test.beforeAll(async () => {
    stub = await startStubCapitalQ({
      port: STUB_PORT,
      allowedOrigins: [LISTED],
    });
    site = await startHostSite({
      port: HOST_PORT,
      capitalQOrigin: stub.origin,
      gateway: STUB_GATEWAY,
    });
  });
  test.afterAll(async () => {
    await site.close();
    await stub.close();
  });

  test("frames the gateway on Capital Q's origin, sandboxed, and neither side reads the other", async ({
    page,
  }) => {
    await page.goto(`${LISTED}/`);
    const iframe = inlineFrame(page);
    await expect(iframe).toHaveCount(1);
    await expect(iframe).toHaveAttribute(
      "src",
      `${stub.origin}/g/${STUB_GATEWAY}/embed`,
    );
    await expect(iframe).toHaveAttribute(
      "referrerpolicy",
      "strict-origin-when-cross-origin",
    );
    const sandbox = (await iframe.getAttribute("sandbox")) ?? "";
    expect(sandbox.split(/\s+/u).sort()).toEqual(
      [
        "allow-forms",
        "allow-popups",
        "allow-popups-to-escape-sandbox",
        "allow-same-origin",
        "allow-scripts",
      ].sort(),
    );
    const frame = await embedOf(page);
    await expect(
      frame.getByRole("heading", { name: /Apply to Kilima/u }),
    ).toBeVisible();
    expect(await hostReadsFrame(page)).toBe("SecurityError");
    expect(await frameReadsHost(frame)).toBe("SecurityError");
    // The launcher draws its button and loads nothing until it is pressed:
    // the page and the one inline frame are all there is.
    expect(page.frames()).toHaveLength(2);
    // No horizontal scroll on the host page, phone or desktop.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

  test("a site that is not on the gateway's list cannot frame it", async ({
    page,
  }) => {
    // Same server, other origin: 127.0.0.1 is not the listed localhost.
    await page.goto(`${UNLISTED}/`);
    await expectRefused(page, stub.origin);
  });
});

test.describe("the embed on another website, against a real Capital Q", () => {
  test.skip(
    LIVE_ORIGIN === undefined || LIVE_GATEWAY === undefined,
    "set CQ_GATEQ_EMBED_ORIGIN and CQ_GATEQ_EMBED_GATEWAY (a fictional gateway)",
  );
  let site: RunningSite;
  test.beforeAll(async () => {
    site = await startHostSite({
      port: HOST_PORT,
      capitalQOrigin: LIVE_ORIGIN ?? "",
      gateway: LIVE_GATEWAY ?? "",
    });
  });
  test.afterAll(async () => {
    await site.close();
  });

  test("the gateway's form renders inside the investor's page and takes the first step's answers", async ({
    page,
  }) => {
    await page.goto(`${LISTED}/`);
    const frame = await embedOf(page);
    await expect(
      frame.getByRole("heading", { name: /Apply to/u }).first(),
    ).toBeVisible({
      timeout: 30_000,
    });
    // The first step, filled inside the frame; nothing is pressed that saves.
    const company = frame.getByLabel("Company name");
    await company.fill("Embedcheck Labs (fictional)");
    const reach = frame.getByLabel("Best way to reach you");
    await reach.fill("embed-check@fictional.capitalq.local");
    await expect(company).toHaveValue("Embedcheck Labs (fictional)");
    await expect(reach).toHaveValue("embed-check@fictional.capitalq.local");
    expect(await hostReadsFrame(page)).toBe("SecurityError");
    expect(await frameReadsHost(frame)).toBe("SecurityError");
  });

  test("with an allowlist, an unlisted site cannot frame it", async ({
    page,
  }) => {
    test.skip(
      process.env.CQ_GATEQ_EMBED_EXPECT_ALLOWLIST !== "1",
      "the gateway lists no sites (any site may frame it)",
    );
    await page.goto(`${UNLISTED}/`);
    await expectRefused(page, LIVE_ORIGIN ?? "");
  });
});
