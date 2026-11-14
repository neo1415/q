import { describe, expect, it } from "vitest";

import type { GateqInboxDto, GateqInboxItemDto } from "@capital-q/contracts";
import type { FounderApplication } from "@capital-q/gateq-intake";
import { ActorContextSchema } from "@capital-q/security";

import {
  createAccountDigestGateq,
  founderApplicationsDigestOf,
  inboxDigestOf,
} from "../src/composition/account-digest-gateq.js";

/**
 * Owner 14 Nov 2026: GateQ's part of the account digest -- a founder's own
 * applications and an investor's inbox counts -- read through GateQ's own
 * reads and authority; counts and names only.
 */

const U = (n: number) =>
  `7a1b2c3d-4e5f-4a6b-8c7d-${String(n).padStart(12, "0")}`;

function item(n: number, extra: Partial<GateqInboxItemDto>): GateqInboxItemDto {
  return {
    applicationId: U(n),
    reference: `GQ-${String(n)}`,
    companyName: `Company ${String(n)}`,
    oneLiner: null,
    stage: null,
    sector: null,
    country: null,
    raise: null,
    fit: "FITS",
    rules: { met: 3, total: 3, unknown: 0 },
    starred: false,
    unread: true,
    labels: ["confidential-label"],
    assignee: null,
    folder: "INBOX",
    replyBy: null,
    replyState: "NONE",
    daysLeft: null,
    submittedAt: "2026-11-10T09:00:00.000Z",
    ...extra,
  };
}

const inbox = {
  gateway: {
    id: U(1),
    name: "Savanna Seed",
    publicId: "savanna",
    replyWithinDays: 5,
  },
  viewer: { userId: U(2), canDecide: true, solo: false },
  view: "INBOX",
  counts: {
    INBOX: 3,
    STARRED: 0,
    ASSIGNED_TO_ME: 0,
    FITS: 2,
    PARTIAL: 1,
    NOT_A_FIT: 0,
    PASSED: 0,
    ARCHIVED: 0,
  },
  items: [
    item(10, { replyState: "ON_TRACK", daysLeft: 4 }),
    item(11, { replyState: "OVERDUE", daysLeft: -1, fit: "PARTIAL" }),
    item(12, { replyState: "ANSWERED" }),
    item(13, { replyState: "NONE" }),
  ],
  labels: [],
  members: [],
} as unknown as GateqInboxDto;

describe("GateQ in the account digest", () => {
  it("an investor's inbox: counts, and the owed judgements soonest due first, nothing of the firm's notes", () => {
    const digest = inboxDigestOf(inbox);
    expect(digest).toMatchObject({
      gatewayName: "Savanna Seed",
      unread: 3,
      fits: 2,
      partial: 1,
      notAFit: 0,
      needsJudgement: 2,
    });
    expect(digest.top.map((one) => one.applicationId)).toEqual([U(11), U(10)]);
    expect(JSON.stringify(digest)).not.toContain("confidential-label");
  });

  it("a founder's own applications, newest first, bounded", () => {
    const applications = Array.from({ length: 9 }, (_, i) => ({
      applicationId: U(100 + i),
      fund: `Fund ${String(i)}`,
      gatewayName: "internal name",
      sentAt: "2026-11-11T09:00:00.000Z",
      status: "SENT",
      reasonCode: null,
      message: "a private reply body",
      rules: [],
      replyBy: "2026-11-18",
      investorOrganisationId: null,
      gatewayPublicId: "p",
    })) as FounderApplication[];
    const digest = founderApplicationsDigestOf(applications);
    expect(digest.total).toBe(9);
    expect(digest.applications).toHaveLength(6);
    expect(JSON.stringify(digest)).not.toContain("internal name");
    expect(JSON.stringify(digest)).not.toContain("a private reply body");
  });

  it("reads as the asking person; no gateway or a refused inbox is no inbox", async () => {
    const actor = ActorContextSchema.parse({
      userId: U(3),
      tenantId: U(4),
      organisationId: U(5),
      membershipId: U(6),
      actorType: "HUMAN",
    });
    const asked: unknown[] = [];
    const port = createAccountDigestGateq({
      founders: {
        listFor: (who) => {
          asked.push(who);
          return Promise.resolve([]);
        },
      },
      inbox: {
        ownGatewayId: (who) => {
          asked.push(who);
          return Promise.resolve(null);
        },
        list: () => Promise.resolve({ ok: false }),
      },
    });
    expect(await port.investorInbox?.(actor)).toBeNull();
    expect(await port.founderApplications?.(actor)).toEqual({
      applications: [],
      total: 0,
    });
    expect(asked.every((who) => who === actor)).toBe(true);
    const refused = createAccountDigestGateq({
      founders: { listFor: () => Promise.resolve([]) },
      inbox: {
        ownGatewayId: () => Promise.resolve(U(1)),
        list: () => Promise.resolve({ ok: false }),
      },
    });
    expect(await refused.investorInbox?.(actor)).toBeNull();
  });
});
