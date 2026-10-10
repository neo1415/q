import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import { call, tokenFor } from "../support/http.js";
import { localSql } from "../support/local-db.js";
import { emitLive, livePeers } from "../support/live-fake.js";
import type { ScriptRule, VendorRequest } from "../support/script.js";
import { API_URL } from "../support/stack.js";

/**
 * The founder's five demo journeys (G2): shared observations. Every
 * journey compares three readings of one fact -- what Q was given or said,
 * what the screen shows, and the LOCAL database row -- never "no error".
 * Database access is the local container only (support/local-db.ts).
 */

export function uuid(value: string): string {
  if (!/^[0-9a-f-]{36}$/u.test(value)) throw new Error(`not a uuid: ${value}`);
  return value;
}

function rows(sql: string): string[][] {
  const out = localSql(sql);
  return out === ""
    ? []
    : out
        .split("\n")
        .filter((line) => !/^(UPDATE|INSERT|DELETE) \d+/u.test(line))
        .map((line) => line.split("|"));
}

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

/** The one canonical relationship row for a company and an investor organisation. */
export function relationshipId(
  companyId: string,
  investorOrganisationId: string,
): string {
  const id = localSql(
    `select id from network.relationships where company_id = '${uuid(companyId)}' and investor_organisation_id = '${uuid(investorOrganisationId)}'`,
  );
  if (id === "") throw new Error("the seed has no relationship for that pair");
  return uuid(id);
}

/** message_sent events on the history: what the brief's `messages.count` folds. */
export function messageEventCount(relationship: string): number {
  return Number(
    localSql(
      `select count(*) from network.relationship_events where relationship_id = '${uuid(relationship)}' and event_type = 'message_sent'`,
    ),
  );
}

export type DbMessage = { readonly sentAt: string; readonly side: string };

/** The thread's latest real message (edits and tombstones are not messages). */
export function latestMessage(relationship: string): DbMessage | null {
  const [row] = rows(
    `select to_char(m.created_at at time zone 'UTC', ${ISO}), m.sender_side
       from communication.messages m
       join communication.conversations c on c.id = m.conversation_id
      where c.relationship_id = '${uuid(relationship)}'
        and m.kind in ('TEXT', 'ATTACHMENT', 'VOICE_NOTE')
        and not exists (select 1 from communication.messages t
                         where t.revises_message_id = m.id and t.kind = 'TOMBSTONE')
      order by m.created_at desc limit 1`,
  );
  return row === undefined
    ? null
    : { sentAt: row[0] ?? "", side: row[1] ?? "" };
}

export type DbMeeting = {
  readonly id: string;
  readonly status: string;
  readonly startsAt: string;
};

/** The next SCHEDULED call still ahead (the brief's `nextScheduled`). */
export function nextScheduledMeeting(relationship: string): DbMeeting | null {
  const [row] = rows(
    `select id, status, to_char(starts_at at time zone 'UTC', ${ISO})
       from communication.meetings
      where relationship_id = '${uuid(relationship)}' and status = 'SCHEDULED'
        and starts_at > now()
      order by starts_at limit 1`,
  );
  return row === undefined
    ? null
    : { id: row[0] ?? "", status: row[1] ?? "", startsAt: row[2] ?? "" };
}

async function postWithKey(
  email: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await tokenFor(email)}`,
      "content-type": "application/json",
      "idempotency-key": `recovery-g2-${randomUUID()}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text === "" ? null : (JSON.parse(text) as unknown);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

/** A chat message as the person sends it on the chat screen (the product's own route). */
export async function sendMessage(
  email: string,
  relationship: string,
  text: string,
): Promise<void> {
  const reply = await postWithKey(
    email,
    `/v1/relationships/${uuid(relationship)}/messages`,
    { kind: "TEXT", body: text },
  );
  expect(reply.status, `send as ${email}: ${JSON.stringify(reply.body)}`).toBe(
    201,
  );
}

/**
 * One SCHEDULED call ahead, booked through the product's own route. The
 * local stack has no Google calendar (provider keys are disabled), so a
 * booking can stay SCHEDULING; the calendar's confirmation is then the
 * one condition the harness sets in the LOCAL database, as a calendar
 * reply would have.
 */
export async function bookScheduledCall(
  email: string,
  relationship: string,
  startsAt: Date,
): Promise<DbMeeting> {
  const reply = await postWithKey(
    email,
    `/v1/relationships/${uuid(relationship)}/meetings`,
    {
      purpose: "G2 journey A: first call",
      startsAt: startsAt.toISOString(),
      durationMinutes: 30,
      timeZone: "UTC",
    },
  );
  expect(
    [200, 201],
    `book as ${email}: ${String(reply.status)} ${JSON.stringify(reply.body)}`,
  ).toContain(reply.status);
  const booked = (reply.body as { id?: unknown } | null)?.id;
  const id = uuid(typeof booked === "string" ? booked : "");
  localSql(
    `update communication.meetings
        set status = 'SCHEDULED',
            meet_link = coalesce(meet_link, 'https://meet.google.com/abc-defg-hij'),
            updated_at = clock_timestamp()
      where id = '${id}' and status = 'SCHEDULING'`,
  );
  const meeting = nextScheduledMeeting(relationship);
  if (meeting === null) throw new Error("the booked call is not SCHEDULED");
  return meeting;
}

/** "27 Sept 2026": the relationship screen's day (date-format.ts formatDay, UTC). */
export function dayText(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** "2026-10-12 09:00 UTC": the brief facts' time (relationship-brief-facts.ts). */
export function factTime(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** "USD 4,000,000": the raise's exact words (money-text.ts moneyText). */
export function moneyText(amount: string, currency: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const cents = /^0*$/u.test(fraction) ? "" : `.${fraction}`;
  return `${currency} ${grouped}${cents}`;
}

/** The text Q's model read after a tool answered (tool results are in the request input). */
export function inputAfter(
  requests: readonly VendorRequest[],
  rule: string,
): string {
  return requests
    .filter((request) => request.rule === rule)
    .map((request) => request.input ?? "")
    .join("\n");
}

/** The Relationship Brief as the person's own bearer reads it (R1). */
export async function readBrief(
  email: string,
  relationship: string,
): Promise<BriefView> {
  const reply = await call(
    email,
    "api",
    "GET",
    `/v1/network/relationships/${uuid(relationship)}/brief`,
  );
  expect(reply.status, `brief: ${reply.text.slice(0, 200)}`).toBe(200);
  return reply.body as BriefView;
}

/** The fields of RelationshipBriefSchema (contracts/http/relationship-brief.ts) the journeys read. */
export type BriefView = {
  readonly relationshipId: string;
  readonly counterparty: { readonly name: string | null };
  readonly messages: {
    readonly count: number;
    readonly latest:
      | {
          readonly status: "OK";
          readonly message: {
            readonly from: string;
            readonly senderName: string;
            readonly sentAt: string;
          } | null;
        }
      | { readonly status: "UNAVAILABLE"; readonly reason: string };
  };
  readonly meetings:
    | {
        readonly status: "OK";
        readonly nextScheduled: {
          readonly id: string;
          readonly status: string;
          readonly startsAt: string;
        } | null;
      }
    | { readonly status: "UNAVAILABLE"; readonly reason: string };
};

/**
 * Holds an ACCESS EXCLUSIVE lock on one LOCAL table for `ms`, so every
 * read of it waits: a source that is slow past its statement timeout, as
 * a hosted database under load would be. Returns the release.
 */
export function holdTableLock(table: string, ms: number): () => void {
  if (!/^[a-z_]+\.[a-z_]+$/u.test(table)) throw new Error("not a table name");
  const container =
    process.env["CQ_RECOVERY_DB_CONTAINER"] ?? "supabase_db_capital-q";
  if (!/^supabase_db_/u.test(container))
    throw new Error("local database container only");
  const child: ChildProcess = spawn(
    "docker",
    [
      "exec",
      container,
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `begin; lock table ${table} in access exclusive mode; select pg_sleep(${String(Math.ceil(ms / 1000))}); commit;`,
    ],
    { stdio: "ignore" },
  );
  return () => {
    child.kill("SIGTERM");
    // The backend can outlive the client: end any session still holding it.
    localSql(
      `select pg_terminate_backend(pid) from pg_stat_activity where query like 'begin; lock table ${table}%' and pid <> pg_backend_pid()`,
    );
  };
}

// --- the raise, in the database (journey B) ---------------------------------

export type DbRaise = {
  readonly companyId: string;
  /** The ACTIVE objective's exact amount, or null when there is none. */
  readonly amount: string | null;
  readonly currency: string | null;
  /** A live network_visible share of that objective. */
  readonly networkShared: boolean;
  /** A live relationship_shared or specifically_shared policy on it. */
  readonly narrowlyShared: boolean;
};

export function dbRaises(companyIds: readonly string[]): DbRaise[] {
  const list = companyIds.map((id) => `'${uuid(id)}'`).join(",");
  return rows(
    `select c.id, o.target_amount::text, o.currency_code,
            exists (select 1 from permissions.disclosure_policies p
                     where p.resource_id = o.id and p.revoked_at is null
                       and p.scope_type = 'network_visible'),
            exists (select 1 from permissions.disclosure_policies p
                     where p.resource_id = o.id and p.revoked_at is null
                       and p.scope_type in ('relationship_shared', 'specifically_shared'))
       from core.companies c
       left join core.capital_objectives o
         on o.company_id = c.id and o.status = 'ACTIVE'
      where c.id in (${list})
      order by c.id`,
  ).map(
    ([companyId = "", amount = "", currency = "", net = "", narrow = ""]) => ({
      companyId,
      amount: amount === "" ? null : amount,
      currency: currency === "" ? null : currency,
      networkShared: net === "t",
      narrowlyShared: narrow === "t",
    }),
  );
}

// --- the browser's own record of Q's moves (journeys C and E) ---------------

export type SeenOutcome = {
  readonly status: "DONE" | "FAILED";
  readonly intentId: string;
  readonly expected: string;
  readonly route?: string;
  readonly reason?: string;
  /** performance.now() when the lifecycle reported it. */
  readonly at: number;
  /** location.pathname + search at that moment. */
  readonly where: string;
  /** GPT-Live events the page had sent to the provider by then. */
  readonly liveSentBefore: number;
};
export type SeenOpened = {
  readonly text: string;
  readonly at: number;
  readonly where: string;
};
export type MoveLog = {
  readonly outcomes: SeenOutcome[];
  readonly opened: SeenOpened[];
  readonly pushes: string[];
};

/**
 * Records, inside the page, every navigation outcome the R3 lifecycle
 * dispatches (`cq:navigation-receipt`), every history push, and the first
 * moment each Q answer reads "Opened …" or "You're home." -- with where
 * the browser was at that instant. "Q's final wording only after
 * VERIFIED" is then a comparison of two timestamps from one clock.
 */
export async function watchMoves(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log = { outcomes: [], opened: [], pushes: [] } as {
      outcomes: unknown[];
      opened: { text: string }[];
      pushes: string[];
    };
    const own = window as unknown as {
      __cqMoves: typeof log;
      __cqLiveSent?: unknown[];
    };
    own.__cqMoves = log;
    const where = () => `${location.pathname}${location.search}`;
    window.addEventListener("cq:navigation-receipt", (event) => {
      const detail = (event as CustomEvent).detail as Record<string, unknown>;
      log.outcomes.push({
        ...detail,
        at: performance.now(),
        where: where(),
        liveSentBefore: (own.__cqLiveSent ?? []).length,
      });
    });
    const push = history.pushState.bind(history);
    history.pushState = (data, unused, url) => {
      if (url !== undefined && url !== null) log.pushes.push(String(url));
      push(data, unused, url);
    };
    setInterval(() => {
      for (const node of document.querySelectorAll("[data-q-answer]")) {
        const text = (node.textContent ?? "").trim();
        if (!/\bOpened\b|You're home\./u.test(text)) continue;
        if (log.opened.some((seen) => seen.text === text)) continue;
        log.opened.push({ text, at: performance.now(), where: where() } as {
          text: string;
        });
      }
    }, 40);
  });
}

export function moves(page: Page): Promise<MoveLog> {
  return page.evaluate(
    () => (window as unknown as { __cqMoves: MoveLog }).__cqMoves,
  );
}

export function pathOf(url: string): string {
  return new URL(url, "http://x").pathname;
}

/** Receipt batches the page POSTed to /api/q-ui-acts, verbatim (to replay one). */
export function captureReceiptPosts(page: Page): string[] {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/q-ui-acts"))
      posts.push(request.postData() ?? "");
  });
  return posts;
}

// --- scripted readings -------------------------------------------------------

/** The reader's verdict for a plain question to Q (no tool, no move). */
export const READ_QUESTION: ScriptRule = {
  name: "g2-reader-question",
  when: { task: "TURN_READER" },
  reply: {
    json: {
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: true,
    },
  },
};

/** B's fast lane (TURN_SKIM) reading a discovery question; inert where there is no skim. */
export function skimDiscover(
  words: string,
  count: number,
  sectors: readonly string[],
): ScriptRule {
  return {
    name: "skim-discover",
    when: { task: "TURN_SKIM", user: words },
    reply: {
      json: {
        kind: "DISCOVER_COMPANIES",
        confidence: "HIGH",
        count,
        discover: { sectors: [...sectors], ranking: "NONE" },
      },
    },
  };
}

/** Every other turn, the skim waits for the full reading (rec-g baseline). */
export const SKIM_OTHER: ScriptRule = {
  name: "g2-skim-other",
  when: { task: "TURN_SKIM" },
  reply: {
    json: { kind: "OTHER", confidence: "HIGH", count: null, discover: null },
  },
};

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

// --- GPT-Live (MOCK) ---------------------------------------------------------

/** Starts the GPT-Live line on the page with the RTCPeerConnection fake installed. */
export async function startLive(page: Page): Promise<void> {
  const talk = page
    .getByRole("button", { name: /Talk with Q/u })
    .filter({ visible: true })
    .first();
  const end = page
    .getByRole("button", { name: /^End/u })
    .filter({ visible: true })
    .first();
  await expect(talk.or(end).first()).toBeVisible({ timeout: 30_000 });
  if (!(await end.isVisible().catch(() => false))) {
    try {
      await talk.click({ timeout: 5_000 });
    } catch {
      await expect(end).toBeVisible({ timeout: 10_000 });
    }
  }
  await expect.poll(() => livePeers(page), { timeout: 30_000 }).toBe(1);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as Window & { __cqLiveOpen?: () => boolean }
            ).__cqLiveOpen?.() === true,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  await emitLive(page, {
    type: "session.started",
    session: { id: "live_fake_g2", model: "gpt-live-1" },
  });
}
