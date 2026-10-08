import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Browser } from "@playwright/test";

import { contextAs } from "./auth.js";
import { installDeepgramFake } from "./deepgram-fake.js";
import { awaits, proves } from "./expected-red.js";
import { runQ } from "./flows.js";
import { call, isRefusal, type Service } from "./http.js";
import { ask, expectLastTurnTerminal, send } from "./q.js";
import { answer, useScript, type ScriptRule } from "./script.js";
import { RUN_PATH } from "./stack.js";

/**
 * One promise (Q.01-Q.08), twelve acceptance steps, each its own test so the
 * table shows exactly which step holds. The steps are SPEC §5's ten plus two
 * from CLAUDE.md (honesty, measurement); request G-R7 asks the lead to
 * confirm them against the founder brief.
 *
 *   1 journey      the person reaches the promise's page and it shows the thing
 *   2 data         the seeded world holds data for it (unknown is not empty)
 *   3 backend      the endpoint behind it answers the owner
 *   4 UI           the promise's own element is on the page
 *   5 text         Q, asked by text, answers and the turn ends terminally
 *   6 voice        the same, spoken (standard line, Deepgram faked)
 *   7 persistence  the exchange is stored and read back
 *   8 authorization  someone else cannot use what makes it work
 *   9 failure      a model outage is a visible, retryable failure
 *  10 integration  the capability is wired into Q (its tool is offered)
 *  11 honesty      the page shows no invented figure and names what is unknown
 *  12 measurement  the turn left its timing line ("q answer produced")
 */
export type Await = readonly [rows: readonly string[], why: string];

export type PromiseSpec = {
  readonly id: string;
  readonly title: string;
  readonly actor: string;
  readonly page: string;
  readonly landmark: RegExp;
  readonly data: {
    readonly service: Service;
    readonly path: string;
    readonly nonEmpty: (body: unknown) => boolean;
  };
  readonly backend: {
    readonly service: Service;
    readonly method?: string;
    readonly path: string;
    readonly body?: unknown;
  };
  readonly ui: string;
  readonly question: string;
  readonly expected: string;
  readonly authorization: {
    readonly as: string;
    readonly service: Service;
    readonly path: string;
    /** "refused": 401/403/404. Or a string the reply must NOT contain. */
    readonly expect: "refused" | { readonly mustNotContain: string };
  };
  readonly tools: RegExp;
  readonly honesty: { readonly forbid?: RegExp; readonly require?: RegExp };
  readonly awaits?: Partial<Record<number, Await>>;
};

const STEPS = [
  "journey",
  "data",
  "backend",
  "UI",
  "text",
  "voice",
  "persistence",
  "authorization",
  "failure",
  "integration",
  "honesty",
  "measurement",
] as const;

export function promiseSuite(spec: PromiseSpec): void {
  const rules = (): ScriptRule[] => [
    {
      name: `${spec.id}-answer`,
      when: { user: escape(spec.question) },
      reply: answer(spec.expected),
    },
  ];
  const step = (
    n: number,
    body: (args: { browser: Browser }) => Promise<void>,
  ) => {
    test(`${spec.id} step ${String(n)} ${STEPS[n - 1] ?? ""}`, async ({
      browser,
    }) => {
      proves(spec.id, n, STEPS[n - 1] ?? "");
      const pending = spec.awaits?.[n];
      if (pending !== undefined) awaits(pending[0], pending[1]);
      await body({ browser });
    });
  };

  test.describe(`${spec.id} ${spec.title}`, () => {
    step(1, async ({ browser }) => {
      const page = await (await contextAs(browser, spec.actor)).newPage();
      await page.goto(spec.page);
      await expect(page.locator("main")).toContainText(spec.landmark, {
        timeout: 60_000,
      });
    });

    step(2, async () => {
      const reply = await call(
        spec.actor,
        spec.data.service,
        "GET",
        spec.data.path,
      );
      expect(reply.status, reply.text.slice(0, 160)).toBe(200);
      expect(
        spec.data.nonEmpty(reply.body),
        `seeded data behind ${spec.id}: ${reply.text.slice(0, 160)}`,
      ).toBe(true);
    });

    step(3, async () => {
      const reply = await call(
        spec.actor,
        spec.backend.service,
        spec.backend.method ?? "GET",
        spec.backend.path,
        spec.backend.body,
      );
      expect(reply.status, reply.text.slice(0, 200)).toBeLessThan(300);
    });

    step(4, async ({ browser }) => {
      const page = await (await contextAs(browser, spec.actor)).newPage();
      await page.goto(spec.page);
      await expect(page.locator(spec.ui).first()).toBeVisible({
        timeout: 60_000,
      });
    });

    step(5, async ({ browser }) => {
      const page = await (await contextAs(browser, spec.actor)).newPage();
      await useScript(rules());
      await page.goto("/home");
      const reply = await ask(page, spec.question);
      await expect(reply).toContainText(spec.expected);
      await expectLastTurnTerminal(page, ["ANSWERED"]);
    });

    step(6, async ({ browser }) => {
      awaits(["G-R2"], "no offline voice credential");
      const page = await (await contextAs(browser, spec.actor)).newPage();
      const line = await installDeepgramFake(page);
      await useScript(rules());
      await page.goto("/home");
      await page
        .getByRole("button", { name: /Talk with Q/u })
        .first()
        .click();
      await expect
        .poll(() => line.settings() !== null, { timeout: 60_000 })
        .toBe(true);
      expect(await line.say(spec.question)).toContain(spec.expected);
    });

    step(7, async () => {
      const run = await runQ(spec.actor, spec.question, rules());
      expect(run.status).toBe("COMPLETED");
      const again = await call(
        spec.actor,
        "q-api",
        "GET",
        `/v1/q/runs/${run.runId}`,
      );
      expect(again.text).toContain(spec.expected);
      expect(again.text).toContain(spec.question.slice(0, 20));
    });

    step(8, async () => {
      const reply = await call(
        spec.authorization.as,
        spec.authorization.service,
        "GET",
        spec.authorization.path,
      );
      if (spec.authorization.expect === "refused") {
        expect(
          isRefusal(reply),
          `${spec.authorization.as} got ${String(reply.status)}`,
        ).toBe(true);
      } else {
        expect(reply.text).not.toContain(
          spec.authorization.expect.mustNotContain,
        );
      }
    });

    step(9, async ({ browser }) => {
      const outage: ScriptRule[] = [
        {
          name: `${spec.id}-outage`,
          when: { user: escape(spec.question) },
          reply: {
            status: 503,
            body: { error: { message: "scripted outage" } },
          },
        },
      ];
      const run = await runQ(spec.actor, spec.question, outage);
      expect(run.status).toBe("FAILED");
      const page = await (await contextAs(browser, spec.actor)).newPage();
      await useScript(outage);
      await page.goto("/home");
      await send(page, spec.question);
      await expect(
        page.getByText(/isn't available|couldn't|try again/iu).last(),
      ).toBeVisible({ timeout: 90_000 });
    });

    step(10, async () => {
      const run = await runQ(spec.actor, spec.question, rules());
      const offered = new Set(
        run.vendor.flatMap((request) => request.tools ?? []),
      );
      expect(
        [...offered].filter((name) => spec.tools.test(name)),
        `a tool matching ${String(spec.tools)} is offered`,
      ).not.toEqual([]);
    });

    step(11, async ({ browser }) => {
      const page = await (await contextAs(browser, spec.actor)).newPage();
      await page.goto(spec.page);
      const main = page.locator("main");
      await expect(main).toContainText(spec.landmark, { timeout: 60_000 });
      const text = await main.innerText();
      if (spec.honesty.forbid !== undefined)
        expect(text).not.toMatch(spec.honesty.forbid);
      if (spec.honesty.require !== undefined)
        expect(text).toMatch(spec.honesty.require);
    });

    step(12, async () => {
      const run = await runQ(spec.actor, spec.question, rules());
      await expect
        .poll(
          () =>
            readFileSync(resolve(RUN_PATH, "q-api.log"), "utf8")
              .split("\n")
              .some(
                (line) =>
                  line.includes(run.runId) &&
                  line.includes('"q answer produced"'),
              ),
          { timeout: 30_000 },
        )
        .toBe(true);
    });
  });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
