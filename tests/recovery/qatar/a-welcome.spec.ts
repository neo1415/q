import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { call } from "../support/http.js";
import { localSql } from "../support/local-db.js";
import { navigationReceipts, recordReceipts } from "../support/q.js";
import { answer, useScript } from "../support/script.js";
import { world } from "../support/stack.js";
import {
  READ_QUESTION,
  SKIM_OTHER,
  moves,
  pathOf,
  relationshipId,
  uuid,
  watchMoves,
} from "../journeys/journey-fixtures.js";
import {
  escape,
  fakeMark,
  fakeSince,
  logMark,
  logSince,
  measure,
  quiet,
  requireQatarStack,
  latestQText,
  sendTimed,
  toolNamesSince,
  threadText,
  waitForLog,
} from "./kit.js";

/**
 * A. The welcome and its follow-ups (W1, founder 2026-10-10: "Q already
 * knows what it just told me").
 *
 * A TensorGate-shaped arrival item is made in the LOCAL database for the
 * seeded founder Maji Loop: the investor Rift Valley Seed has a pending
 * interest, wrote a message proposing a time, and a call is booked. Then
 * on /home, as the founder: "what's the request?", "what did they say?",
 * "did they accept the time?" and "open the conversation".
 *
 * The model's words are scripted (so the test knows what Q "decided"); what
 * is under test is that Q was HANDED the snapshot's facts without fetching
 * (no tool round, zero tool calls in q-api's own log), that the snapshot
 * reads cost no more database round trips than a cached read should, and
 * that "open the conversation" ends VERIFIED at the snapshot's openPath.
 * All measurements are LOCAL+MOCK.
 */
const founderCompany = (() => {
  const w = world();
  const company = w.companies.find((c) => /maji/iu.test(`${c.key} ${c.name}`));
  const investor = w.investors.find((i) => /rift/iu.test(`${i.key} ${i.name}`));
  if (company === undefined || investor === undefined)
    throw new Error("the seed has no Maji Loop / Rift Valley Seed pair");
  return { company, investor };
})();
const { company, investor } = founderCompany;
const FOUNDER = company.founderEmail;
const TAG = randomUUID().slice(0, 6);
const THEIR_TEXT = `Could we do Thursday 3pm for a call? (qa-${TAG})`;

type SnapshotItem = {
  readonly key: string;
  readonly headline: string;
  readonly availability: string;
  readonly counterpart: {
    readonly kind: string;
    readonly id: string;
    readonly name: string | null;
  } | null;
  readonly openPath: string | null;
  readonly facts: {
    readonly request: {
      readonly kind: string;
      readonly summary: string;
      readonly from: string | null;
    } | null;
    readonly theirLatestMessage: { readonly text: string | null } | null;
    readonly messageCount: number | null;
    readonly meeting: {
      readonly booked: boolean;
      readonly status: string;
    } | null;
  };
};
type Snapshot = {
  readonly version: string;
  readonly items: readonly SnapshotItem[];
};

async function snapshotOf(): Promise<Snapshot> {
  const reply = await call(FOUNDER, "q-api", "GET", "/v1/q/arrival-snapshot");
  expect(reply.status, `snapshot: ${reply.text.slice(0, 200)}`).toBe(200);
  return reply.body as Snapshot;
}

/** The snapshot GETs' `request timing` lines since a mark: dbRoundTrips by call. */
function timingsSince(mark: number): number[] {
  return logSince(mark, "request timing")
    .filter((l) => l["route"] === "/v1/q/arrival-snapshot")
    .map((l) => Number(l["dbRoundTrips"]));
}

let item: SnapshotItem;
let page: Page;

test.beforeAll(async ({ browser }) => {
  requireQatarStack();
  const relationship = relationshipId(
    company.companyId,
    investor.investorOrganisationId,
  );
  // The investor's side of the thread and a booked call, written as the
  // rows the product would hold (the calendar is disabled locally).
  const rel = uuid(relationship);
  const investorEmail = investor.email;
  if (!/^[a-z0-9.-]+@fictional\.capitalq\.local$/u.test(investorEmail))
    throw new Error("synthetic accounts only");
  localSql(
    `insert into communication.conversations (tenant_id, relationship_id)
       select r.tenant_id, r.id from network.relationships r
        where r.id = '${rel}'
          and not exists (select 1 from communication.conversations c where c.relationship_id = r.id)`,
  );
  localSql(
    `insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, body, idempotency_key)
       select r.tenant_id, c.id, u.id, 'INVESTOR', 'TEXT', '${THEIR_TEXT.replace(/'/gu, "''")}', 'qa-${TAG}-msg'
         from network.relationships r
         join communication.conversations c on c.relationship_id = r.id
         join auth.users a on a.email = '${investorEmail}'
         join identity.user_profiles u on u.auth_user_id = a.id
        where r.id = '${rel}'`,
  );
  localSql(
    `insert into communication.meetings
       (tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose,
        starts_at, ends_at, time_zone, status, google_event_id, idempotency_key)
     select r.tenant_id, r.id, u.id, m.tenant_id, 'QA ${TAG}: intro call',
            now() + interval '4 days', now() + interval '4 days 30 minutes', 'UTC',
            'SCHEDULED', 'qa${TAG}${randomUUID().replace(/-/gu, "").slice(0, 12)}', 'qa-${TAG}-meet'
       from network.relationships r
       join auth.users a on a.email = '${investorEmail}'
       join identity.user_profiles u on u.auth_user_id = a.id
       join identity.organisation_memberships m on m.user_id = u.id and m.membership_status = 'active'
      where r.id = '${rel}'
      limit 1`,
  );
  // Outside the snapshot's trust window the next read confirms the change.
  await new Promise((r) => setTimeout(r, 16_000));
  const snapshot = await snapshotOf();
  const found = snapshot.items.find(
    (i) =>
      i.counterpart?.id === investor.investorOrganisationId ||
      /rift valley/iu.test(i.headline),
  );
  if (found === undefined)
    throw new Error(
      `no arrival item for Rift Valley Seed; headlines: ${snapshot.items.map((i) => i.headline).join(" | ")}`,
    );
  item = found;
  page = await (await contextAs(browser, FOUNDER)).newPage();
  await watchMoves(page);
  await recordReceipts(page);
});

test.afterAll(async () => {
  await page?.context().close();
});

test("A1 the snapshot holds the TensorGate-shaped facts: request, their words, the booked call, the way to open it", () => {
  expect(item.availability).toBe("OK");
  expect(item.facts.request, "a request with words").not.toBeNull();
  console.log(
    `A1 request kind=${String(item.facts.request?.kind)} (LOCAL+MOCK world)`,
  );
  expect(item.facts.theirLatestMessage?.text).toContain(`qa-${TAG}`);
  expect(item.facts.meeting?.booked, "the call is booked").toBe(true);
  expect(item.openPath).toBe(
    `/relationships/investor/${investor.investorOrganisationId}/messages`,
  );
});

test("A2 a snapshot read inside the trust window costs fewer round trips than a rebuild; a Q turn does not wipe it", async () => {
  // Control: any non-GET by this person ends trust (http/q-arrival-snapshot.ts
  // registerArrivalSnapshotInvalidation). A malformed receipt POST is the
  // cheapest harmless one; the hook runs whatever the status.
  await call(FOUNDER, "q-api", "POST", "/v1/q/ui-act-receipts", {});
  let mark = logMark();
  await snapshotOf();
  const rebuilt = await waitForLog(mark, "request timing", 2, 10_000).then(() =>
    timingsSince(mark),
  );
  mark = logMark();
  for (let i = 0; i < 4; i += 1) await snapshotOf();
  await waitForLog(mark, "request timing", 4, 10_000);
  const cached = timingsSince(mark);
  console.log(
    `SNAPSHOT dbRoundTrips[${"LOCAL+MOCK"}] rebuild=${JSON.stringify(rebuilt)} cached=${JSON.stringify(cached)}`,
  );
  test.info().annotations.push({
    type: "measure",
    description: `LOCAL+MOCK snapshot dbRoundTrips rebuild=${JSON.stringify(rebuilt)} cached=${JSON.stringify(cached)}`,
  });
  const rebuildCost = rebuilt[0] ?? 0;
  expect(cached.length, "four cached reads logged").toBe(4);
  for (const n of cached) {
    expect(
      n,
      "a cached read is only the actor lookup, no snapshot rebuild",
    ).toBeLessThanOrEqual(3);
  }
  expect(
    new Set(cached.slice(1)).size,
    "settled cached reads cost the same each time",
  ).toBe(1);

  // A Q turn is itself an own non-GET: does it end the trust? One scripted
  // turn, then the next snapshot read must still be a cached one.
  await useScript([
    SKIM_OTHER,
    READ_QUESTION,
    {
      name: "a2-plain",
      when: { task: "COMPANY_ANALYST", user: "qa plain ping", afterTool: null },
      reply: answer("Ping received."),
    },
  ]);
  await page.goto("/home");
  const before = logMark();
  await sendTimed(page, "qa plain ping");
  await expect(page.getByText("Ping received.").first()).toBeVisible({
    timeout: 60_000,
  });
  await quiet();
  await snapshotOf();
  await snapshotOf();
  await waitForLog(before, "request timing", 2, 10_000);
  const after = timingsSince(before);
  const last = after.at(-1) ?? -1;
  console.log(
    `SNAPSHOT dbRoundTrips[LOCAL+MOCK] after a Q turn: ${JSON.stringify(after)} (cached=${String(cached[0])}, rebuild=${String(rebuildCost)})`,
  );
  expect(
    Math.max(...after),
    "after a Q turn every read is still a cached cost (a turn must not wipe the snapshot)",
  ).toBeLessThanOrEqual(3);
  void last;
});

test("A3 the welcome follow-ups are answered from the snapshot: facts in the model's context, no tool round, no extra reads", async () => {
  const them = item.counterpart?.name ?? "Rift Valley Seed";
  const asks = [
    {
      say: "what's the request?",
      aspect: "REQUEST",
      reply:
        `${them} wants to connect. ${item.facts.request?.summary ?? ""}`.trim(),
      needs: [/The request:/u, new RegExp(escape(them), "u")],
    },
    {
      say: "what did they say?",
      aspect: "THEIR_MESSAGE",
      reply: `Their latest message: "${item.facts.theirLatestMessage?.text ?? ""}"`,
      needs: [new RegExp(escape(`qa-${TAG}`), "u")],
    },
    {
      say: "did they accept the time?",
      aspect: "MEETING",
      reply: "The call is booked, so the time is confirmed on both calendars.",
      needs: [/it is booked|booked/u],
    },
  ] as const;
  await page.goto("/home");
  const turnsLogged: Record<string, unknown>[] = [];
  for (const [index, ask] of asks.entries()) {
    await useScript([
      {
        name: `a3-skim-${String(index)}`,
        when: { task: "TURN_SKIM", user: escape(ask.say) },
        reply: {
          json: {
            kind: "ARRIVAL_FOLLOWUP",
            confidence: "HIGH",
            count: null,
            discover: null,
            person: null,
            arrival: { item: item.key, aspect: ask.aspect },
          },
        },
      },
      READ_QUESTION,
      {
        name: `a3-${String(index)}`,
        when: {
          task: "COMPANY_ANALYST",
          user: escape(ask.say),
          afterTool: null,
        },
        reply: answer(ask.reply),
      },
    ]);
    await quiet(1_500);
    const mark = await fakeMark();
    const log = logMark();
    const started = await sendTimed(page, ask.say);
    await expect
      .poll(async () => (await latestQText(page)).length, { timeout: 60_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(4_000);
    const answerText = await threadText(page);
    console.log(`A3 "${ask.say}" -> ${answerText.slice(-420)}`);
    measure(
      `A3.${String(index + 1)} send->answer "${ask.say}"`,
      Date.now() - started,
    );
    const [produced] = await waitForLog(log, "q answer produced", 1, 8_000);
    const rounds = (await fakeSince(mark)).filter(
      (r) => r.rule === `a3-${String(index)}`,
    );
    const round = rounds[0];
    expect
      .soft(
        rounds.length,
        "answered by code from the snapshot: no analyst round",
      )
      .toBe(0);
    console.log(
      `A3 analyst rounds for "${ask.say}": ${String(rounds.length)} (0 = answered by code from the snapshot)`,
    );
    expect(
      round?.answeredTools ?? [],
      "no tool had answered: no fetch",
    ).toEqual([]);
    for (const need of ask.needs) {
      expect
        .soft(
          rounds.length > 0 ? (round?.input ?? "") : answerText,
          `the answer or the model's context carries ${String(need)}`,
        )
        .toMatch(need);
    }
    const names = toolNamesSince(log);
    console.log(`A3 "${ask.say}" tools finished by code: ${names.join(", ")}`);
    expect
      .soft(names, "a follow-up is answered from the snapshot: no tool reads")
      .toEqual([]);
    turnsLogged.push({
      ask: ask.say,
      toolCalls: produced?.["toolCalls"],
      prepareArrivalMs: (
        produced?.["prepareMs"] as Record<string, number> | undefined
      )?.["arrival"],
      totalMs: produced?.["totalMs"],
    });
  }
  console.log(`A3 turns[LOCAL+MOCK] ${JSON.stringify(turnsLogged)}`);
  test.info().annotations.push({
    type: "measure",
    description: `LOCAL+MOCK ${JSON.stringify(turnsLogged)}`,
  });
});

test("A4 'open the conversation' ends VERIFIED on the snapshot's openPath", async () => {
  const say = "open the conversation";
  const path = item.openPath ?? "";
  expect(path).not.toBe("");
  await useScript([
    SKIM_OTHER,
    READ_QUESTION,
    {
      name: "a4-open",
      when: { task: "COMPANY_ANALYST", user: escape(say), afterTool: null },
      reply: {
        toolCalls: [
          {
            name: "open_page",
            arguments: {
              page: "RELATIONSHIP_INVESTOR_MESSAGES",
              id: investor.investorOrganisationId,
            },
          },
        ],
      },
    },
    {
      name: "a4-open-answer",
      when: { task: "COMPANY_ANALYST", afterTool: "open_page" },
      reply: answer("Opening your conversation…"),
    },
  ]);
  await page.goto("/home");
  const started = await sendTimed(page, say);
  await expect(page).toHaveURL(new RegExp(`${escape(path)}$`, "u"), {
    timeout: 60_000,
  });
  measure("A4 send->URL (open the conversation)", Date.now() - started);
  await expect
    .poll(
      async () =>
        (await moves(page)).outcomes
          .filter((o) => pathOf(o.expected) === path)
          .map((o) => o.status),
      { timeout: 30_000, message: "one VERIFIED outcome for the conversation" },
    )
    .toEqual(["DONE"]);
  console.log(
    `A4 landed ${page.url()} chat log present: ${String(await page.getByRole("log").count())}`,
  );
  const done = () =>
    navigationReceipts(page).navigations.some(
      (n) => n.status === "DONE" && pathOf(n.route ?? "") === path,
    );
  for (let i = 0; i < 40 && !done(); i += 1) await page.waitForTimeout(500);
  expect(done(), "q-api received a DONE receipt for the conversation").toBe(
    true,
  );
});
