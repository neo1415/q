import { describe, expect, it } from "vitest";

import { CorrelationIdSchema } from "@capital-q/contracts";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import {
  APP_ACTIONS,
  type AnyAppAction,
  type AppActionContext,
  type AppActionPorts,
} from "../src/index.js";

/**
 * G-D23 follow-up (lead 2026-10-09): the actions a demo can reach answer
 * their own authorize step with the real resource check, so Q never shows
 * a card the person cannot act on (not theirs, or no longer open).
 */

const COMPANY = "00000000-0000-4000-8000-0000000000c1";
const OTHER_COMPANY = "00000000-0000-4000-8000-0000000000c2";
const MINE = "00000000-0000-4000-8000-0000000001a1";
const NOT_MINE = "00000000-0000-4000-8000-0000000001a2";

const card: AppActionContext = {
  actor: {
    userId: UserIdSchema.parse("00000000-0000-4000-8000-00000000d001"),
    tenantId: TenantIdSchema.parse("00000000-0000-4000-8000-0000000000a1"),
    organisationId: OrganisationIdSchema.parse(
      "00000000-0000-4000-8000-0000000000a2",
    ),
    membershipId: MembershipIdSchema.parse(
      "00000000-0000-4000-8000-0000000000e1",
    ),
    actorType: "HUMAN",
  },
  idempotencyKey: "authorize",
  correlationId: CorrelationIdSchema.parse(
    "cor_00000000-0000-4000-8000-00000000c0de",
  ),
  surface: "Q",
};

function action(name: string): AnyAppAction {
  const found = APP_ACTIONS.find((one) => one.name === name);
  if (found === undefined) throw new Error(`no app action ${name}`);
  return found;
}

const ports = {
  ownCompanyId: () => Promise.resolve(COMPANY),
  interests: {
    mayRespondToInterest: ({ interestId }: { interestId: string }) =>
      Promise.resolve(interestId === MINE),
  },
  connections: {
    // The investor's inbox holds open requests only.
    listConnectionRequests: () =>
      Promise.resolve([
        { interest: { id: MINE }, company: { canonicalName: "Northbound" } },
      ]),
  },
  schedule: {
    organisedMeeting: (_actor: unknown, meetingId: string) =>
      Promise.resolve(
        meetingId === MINE
          ? { id: MINE, status: "SCHEDULED" }
          : meetingId === NOT_MINE
            ? { id: NOT_MINE, status: "CANCELLED" }
            : null,
      ),
  },
} as unknown as AppActionPorts;

const answer = (interestId: string) => ({
  interestId,
  idempotencyKey: "answer-key-0001",
  input: {},
});

async function allowed(name: string, input: unknown): Promise<boolean> {
  const one = action(name);
  const parsed: unknown = one.input.parse(input);
  return (await one.authorize(ports, card, parsed)).ok;
}

describe("demo actions: a card only for what the person can act on", () => {
  it.each([
    "relationship.interest.accept",
    "relationship.interest.decline",
    "relationship.connection_request.accept",
    "relationship.connection_request.decline",
  ])("%s: only an open item in their own inbox", async (name) => {
    expect(await allowed(name, answer(MINE))).toBe(true);
    expect(await allowed(name, answer(NOT_MINE))).toBe(false);
  });

  it("schedule.meeting.cancel: only a call they organised that is still on", async () => {
    const name = "schedule.meeting.cancel";
    expect(await allowed(name, { meetingId: MINE })).toBe(true);
    // Already cancelled.
    expect(await allowed(name, { meetingId: NOT_MINE })).toBe(false);
    // Someone else's call (or none).
    expect(
      await allowed(name, {
        meetingId: "00000000-0000-4000-8000-0000000001a3",
      }),
    ).toBe(false);
  });

  it("document.access.folder_level: only their own company's folder, bound to it", async () => {
    const name = "document.access.folder_level";
    const own = {
      companyId: COMPANY,
      folderCode: "financials",
      level: "PRIVATE",
    };
    expect(await allowed(name, own)).toBe(true);
    expect(await allowed(name, { ...own, companyId: OTHER_COMPANY })).toBe(
      false,
    );
    expect(action(name).targets(own)).toEqual([
      { kind: "COMPANY", companyId: COMPANY },
    ]);
    // A newer level for the same folder replaces the older card; another
    // folder's card stays.
    const key = action(name).supersedeKey;
    expect(key?.(own)).toBe(key?.({ ...own, level: "PUBLIC" }));
    expect(key?.(own)).not.toBe(key?.({ ...own, folderCode: "legal_ip" }));
  });
});
