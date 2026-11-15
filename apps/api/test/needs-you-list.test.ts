import { describe, expect, it } from "vitest";

import { createNeedsYouCurrency } from "@capital-q/app-actions";
import type { ScheduleService } from "@capital-q/communication";
import { parseApiConfig } from "@capital-q/config/api";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  createApp,
  type ApiModules,
  type ApiSecurityDependencies,
} from "../src/app.js";

/**
 * Live check 15 Nov 2026 (O1): the web's Needs you list and its count read
 * the same "still needed" checks as Q's digest and voice opener
 * (app-actions createNeedsYouCurrency). A settled NEEDS_YOU notice is
 * listed as dealt with (history) and left out of the unread count; one
 * that still needs the person stays under Needs you. The subjects' state
 * is answered by a fake executor keyed on the SQL text.
 */

const CONTEXT: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};

const security: ApiSecurityDependencies = {
  authenticator: {
    authenticate: () =>
      Promise.resolve({
        authUserId: AuthUserIdSchema.parse(
          "a0000000-0000-4000-8000-000000000001",
        ),
      }),
  },
  resolver: {
    resolveHumanContext: () =>
      Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
  },
  identities: { lookup: () => Promise.resolve(null) },
};

const DECLINED = "d3ed305c-0000-4000-8000-000000000001";
const WAITING = "11111111-0000-4000-8000-000000000003";
const CONV_REPLIED = "22222222-0000-4000-8000-000000000004";
const CONV_OPEN = "22222222-0000-4000-8000-000000000005";
const id = (n: number) =>
  `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = new Date("2026-11-15T09:00:00.000Z");
const NOTICES = [
  {
    id: id(1),
    kind: "TIME_PROPOSED" as const,
    dedupeKey: `time_proposed:proposal:${DECLINED}:r1:counter`,
    title: "Savanna suggested other times for the call",
  },
  {
    id: id(2),
    kind: "TIME_PROPOSED" as const,
    dedupeKey: `time_proposed:proposal:${WAITING}:r2`,
    title: "Watchly proposed times for a call",
  },
  {
    id: id(3),
    kind: "CHAT_MESSAGE" as const,
    dedupeKey: `chat:${CONV_REPLIED}`,
    title: "Halyard sent you a message",
  },
  {
    id: id(4),
    kind: "CHAT_MESSAGE" as const,
    dedupeKey: `chat:${CONV_OPEN}`,
    title: "Shiftwell sent you a message",
  },
];

const schedule = Object.assign({} as ScheduleService, {
  listNotifications: () =>
    Promise.resolve({
      // The four NEEDS_YOU notices and one unread update.
      unread: NOTICES.length + 1,
      items: [
        ...NOTICES.map((notice) => ({
          id: notice.id,
          kind: notice.kind,
          title: notice.title,
          body: null,
          linkPath: null,
          readAt: null,
          createdAt: at,
          priority: "NEEDS_YOU" as const,
        })),
        {
          id: id(5),
          kind: "REMINDER" as const,
          title: "Send the deck",
          body: null,
          linkPath: null,
          readAt: null,
          createdAt: at,
          priority: "UPDATE" as const,
        },
      ],
    }),
});

function fakeSql() {
  const queries: string[] = [];
  const sql = (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    queries.push(text);
    if (text.includes("from communication.notifications")) {
      return Promise.resolve(
        NOTICES.map((notice) => ({
          id: notice.id,
          kind: notice.kind,
          dedupe_key: notice.dedupeKey,
        })),
      );
    }
    if (text.includes("from communication.meeting_time_proposals")) {
      return Promise.resolve([
        { id: DECLINED, state: "DECLINED", revision: 1 },
        { id: WAITING, state: "PROPOSED", revision: 2 },
      ]);
    }
    if (text.includes("from communication.messages")) {
      return Promise.resolve([{ id: id(3) }]);
    }
    return Promise.resolve([]);
  };
  return { sql: sql as unknown as DatabaseExecutor, queries };
}

type Listed = {
  unread: number;
  items: { id: string; read: boolean; priority: string }[];
};

async function list(needsYou: ApiModules["needsYou"]): Promise<Listed> {
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    schedule,
    needsYou,
  });
  const response = await app.inject({
    method: "GET",
    url: "/v1/notifications",
  });
  expect(response.statusCode).toBe(200);
  return response.json<Listed>();
}

/** What the web lists under Needs you (notice-groups: NEEDS_YOU, unread). */
const needsYouOf = (listed: Listed) =>
  listed.items
    .filter((item) => item.priority === "NEEDS_YOU" && !item.read)
    .map((item) => item.id);

describe("the Needs you list and its count, against the subject's state", () => {
  it("lists a settled proposal or message notice as dealt with, and leaves it out of the count", async () => {
    const { sql, queries } = fakeSql();
    const listed = await list(createNeedsYouCurrency({ sql }));
    expect(needsYouOf(listed)).toEqual([id(2), id(4)]);
    expect(listed.items.map((item) => item.id)).toContain(id(1));
    expect(listed.items.find((item) => item.id === id(1))?.read).toBe(true);
    expect(listed.items.find((item) => item.id === id(3))?.read).toBe(true);
    // The unread update is still unread; only the two settled leave.
    expect(listed.unread).toBe(NOTICES.length + 1 - 2);
    // Their own notices only.
    const read = queries.find((q) => q.includes("communication.notifications"));
    expect(read).toMatch(/user_id = \?/u);
    expect(read).toMatch(/priority = 'NEEDS_YOU'/u);
  });

  it("keeps every notice under Needs you while its subject still waits", async () => {
    const listed = await list({
      settledUnread: () => Promise.resolve(new Set<string>()),
    });
    expect(needsYouOf(listed)).toEqual(NOTICES.map((notice) => notice.id));
    expect(listed.unread).toBe(NOTICES.length + 1);
  });

  it("a check that cannot be read lists notices as stored, never fails the list", async () => {
    const listed = await list({
      settledUnread: () => Promise.reject(new Error("read failed")),
    });
    expect(needsYouOf(listed)).toEqual(NOTICES.map((notice) => notice.id));
    expect(listed.unread).toBe(NOTICES.length + 1);
  });
});
