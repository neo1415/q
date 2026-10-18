import { describe, expect, it } from "vitest";

import type { AppActionPorts } from "@capital-q/app-actions";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import {
  APP_ACTION_TYPES,
  createAppActionDefinitions,
} from "../src/composition/app-actions.js";
import { createChatMessageSendAction } from "../src/composition/chat-actions.js";
import { createCompanyVisibilitySetAction } from "../src/composition/company-visibility-action.js";
import { createEmailSendAction } from "../src/composition/email-action.js";
import {
  createMeetingRescheduleAction,
  createMeetingScheduleAction,
  createReminderCreateAction,
} from "../src/composition/schedule-actions.js";

/**
 * ADR 0040, profile area: a change Q prepared through a generated tool is
 * approved and run through the SAME declaration, as the approver. Q's
 * approvals bind the values, not the version: two cards approved in a row
 * must not fail the second on the first's version.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const OTHER = "b0000000-0000-4000-8000-000000000002";
const ORG = "d0000000-0000-4000-8000-000000000001";
const COMPANY = "a0000000-0000-4000-8000-000000000001";

const APPROVER: ActorContext = {
  userId: UserIdSchema.parse(USER),
  tenantId: TenantIdSchema.parse(TENANT),
  organisationId: OrganisationIdSchema.parse(ORG),
  actorType: "HUMAN",
};

function fakes() {
  const updates: unknown[] = [];
  const people: unknown[] = [];
  const ports: AppActionPorts = {
    companies: {
      // The record moved on since the card was prepared at version 7.
      getCompany: () => Promise.resolve({ version: 9 } as never),
      getMyCompanyMembership: () => Promise.reject(new Error("unused")),
      setCompanyVisibility: () => Promise.reject(new Error("unused")),
      updateCompany: (command) => {
        updates.push(command.input);
        return Promise.resolve({ version: 10 } as never);
      },
      upsertMyCompanyMembership: () => Promise.reject(new Error("unused")),
      updateMyFounderProfile: () => Promise.reject(new Error("unused")),
      updateCompanyTeamFacts: () => Promise.reject(new Error("unused")),
    },
    capital: {
      // The raise moved on since the card was prepared at version 3.
      getCapitalObjective: () => Promise.resolve({ version: 5 } as never),
      getCurrentCapitalObjective: () => Promise.reject(new Error("unused")),
      createCapitalObjective: () => Promise.reject(new Error("unused")),
      updateCapitalObjective: (command) => {
        updates.push(command.input);
        return Promise.resolve({ version: 6 } as never);
      },
      closeCapitalObjective: () => Promise.reject(new Error("unused")),
      replaceCapitalObjective: () => Promise.reject(new Error("unused")),
    },
    people: {
      read: () => Promise.resolve({ version: 4 } as never),
      update: (input) => {
        people.push(input);
        return Promise.resolve({ version: 5 } as never);
      },
    },
  };
  const definitions = createAppActionDefinitions(ports);
  const definition = (type: string) => {
    const found = definitions.find((d) => d.actionType === type);
    if (found === undefined) throw new Error(`no ${type}`);
    return found;
  };
  return { definition, updates, people, ports };
}

const approved = (actionType: string, payload: unknown) =>
  ({
    actionId: "11111111-1111-4111-8111-111111111111",
    runId: "f0000000-0000-4000-8000-000000000051",
    tenantId: TENANT,
    organisationId: ORG,
    actionType,
    actionVersion: 1,
    idempotencyKey: "k",
    payloadHash: "h",
    approvalId: "22222222-2222-4222-8222-222222222222",
    approvedByUserId: USER,
    payload,
    targets: [],
  }) as never;

const context = {
  approver: APPROVER,
  correlationId: "cor_00000000-0000-4000-8000-000000000001",
  attempt: 1,
} as never;

describe("approved profile changes run through the declaration", () => {
  it("every generated profile tool has its approval type composed", () => {
    expect(APP_ACTION_TYPES).toEqual(
      expect.arrayContaining([
        "app.person.profile.update",
        "app.company.profile.update",
        "app.company.team.me.upsert",
        "app.company.founder_profile.me.update",
        "app.company.team_facts.update",
        "app.investor.profile.update",
        "app.investor.representative.me.upsert",
        "app.q_card.handle.claim",
        "app.q_card.update",
      ]),
    );
  });

  it("a company change Q prepared is applied to the profile as it stands when approved", async () => {
    const { definition, updates } = fakes();
    const action = definition("app.company.profile.update");
    const outcome = await action.executor.execute(
      approved("app.company.profile.update", {
        companyId: COMPANY,
        input: { headquartersCity: "Nairobi", expectedVersion: 7 },
        atLatest: true,
      }),
      context,
    );
    expect(outcome).toMatchObject({ outcome: "EXECUTED" });
    expect(updates).toEqual([
      { headquartersCity: "Nairobi", expectedVersion: 9 },
    ]);
  });

  it("their own profile only: another person's id is refused at approval and changes nobody", async () => {
    const { definition, people } = fakes();
    const action = definition("app.person.profile.update");
    expect(
      await action.authorize(
        { userId: OTHER, input: { displayName: "Ada" } },
        APPROVER,
      ),
    ).toEqual({ outcome: "DENY", code: "NOT_AVAILABLE" });
    const outcome = await action.executor.execute(
      approved("app.person.profile.update", {
        userId: USER,
        input: { timeZone: "Africa/Lagos" },
      }),
      context,
    );
    expect(outcome).toMatchObject({ outcome: "EXECUTED" });
    expect(people).toEqual([
      {
        userId: USER,
        expectedVersion: 4,
        changes: { timeZone: "Africa/Lagos" },
      },
    ]);
  });

  it("the raise form's one card runs through the member it names, at the raise as it stands", async () => {
    const { definition, updates } = fakes();
    const action = definition("app.capital.objective.change");
    const outcome = await action.executor.execute(
      approved("app.capital.objective.change", {
        operation: "UPDATE",
        input: {
          companyId: COMPANY,
          capitalObjectiveId: "0bec0000-0000-4000-8000-000000000001",
          atLatest: true,
          input: { targetStage: "seed", expectedVersion: 3 },
        },
      }),
      context,
    );
    expect(outcome).toMatchObject({
      outcome: "EXECUTED",
      result: { says: "Done. Your raise is updated." },
    });
    expect(updates).toEqual([{ targetStage: "seed", expectedVersion: 5 }]);
  });
});

/**
 * Lead 2026-10-03: only a setter's newer card replaces an older one for the
 * same target; additive actions (messages, diligence requests and shares,
 * reminders, meetings) keep every card waiting.
 */
describe("which cards replace older ones for the same target", () => {
  const definitions = createAppActionDefinitions({});
  const supersedes = (type: string) =>
    definitions.find((definition) => definition.actionType === type)
      ?.supersedes === true;

  it.each([
    "app.document.deck_audience.set",
    "app.pitch.details.set",
    "app.disclosure.raise.share",
    "app.disclosure.share.revoke",
    "app.investor.visibility.set",
    "app.company.profile.update",
    "app.person.profile.update",
    "app.q_card.update",
    "app.relationship.outcome.change",
    "app.capital.objective.change",
    "app.investor.mandate.change",
  ])("%s is a setter: a newer card replaces the older", (type) => {
    expect(supersedes(type)).toBe(true);
  });

  it.each(["app.diligence.change"])(
    "%s is additive: two different cards for one target both wait",
    (type) => {
      expect(definitions.some((d) => d.actionType === type)).toBe(true);
      expect(supersedes(type)).toBe(false);
    },
  );
});

describe("the legacy action types: setters replace, additive cards coexist", () => {
  const none = {} as never;
  it("messages, emails, reminders and new meetings are additive", () => {
    for (const definition of [
      createChatMessageSendAction(none),
      createEmailSendAction(none),
      createReminderCreateAction(none),
      createMeetingScheduleAction(none),
    ]) {
      expect(definition.supersedes, definition.actionType).not.toBe(true);
    }
  });

  it("a meeting's new time and their company's visibility are setters", () => {
    for (const definition of [
      createMeetingRescheduleAction(none),
      createCompanyVisibilitySetAction(none),
    ]) {
      expect(definition.supersedes, definition.actionType).toBe(true);
    }
  });
});

describe("app cards name who they are for (QA 2026-10-03, instruction ff4ceb3f)", () => {
  const RELATIONSHIP = "e0000000-0000-4000-8000-000000000001";
  const definitions = createAppActionDefinitions(fakes().ports, {
    nameOf: (_actor, target) =>
      Promise.resolve(
        target.kind === "COMPANY"
          ? "Clinicrest"
          : target.kind === "RELATIONSHIP"
            ? "Ajopot"
            : null,
      ),
  });
  const definition = (type: string) => {
    const found = definitions.find((entry) => entry.actionType === type);
    if (found === undefined) throw new Error(`${type} not composed`);
    return found;
  };

  it("an interest card names the company", async () => {
    const express = definition("app.relationship.interest.express");
    const payload = {
      companyId: COMPANY,
      idempotencyKey: "k-express-0001",
      input: { surface: "FEED" },
    };
    const targets = express.targets(payload);
    expect(await express.describeFor?.(payload, targets, APPROVER)).toEqual({
      summary: "Express interest in Clinicrest",
      preview: "Clinicrest is told you're interested.",
    });
  });

  it("a message card names who gets it and shows the words; a call card says when", async () => {
    const send = definition("app.chat.message.send");
    const message = {
      relationshipId: RELATIONSHIP,
      idempotencyKey: "k-chat-0001",
      input: { kind: "TEXT", body: "Hello from Savanna." },
    };
    const targets = send.targets(message);
    expect(targets).toEqual([
      { kind: "RELATIONSHIP", relationshipId: RELATIONSHIP },
    ]);
    expect(await send.describeFor?.(message, targets, APPROVER)).toEqual({
      summary: "Send Ajopot this message",
      preview: "Hello from Savanna.",
    });
    const book = definition("app.schedule.meeting.book");
    const call = {
      relationshipId: RELATIONSHIP,
      idempotencyKey: "k-book-0001",
      input: {
        purpose: "Intro call",
        startsAt: "2026-10-05T10:00:00.000Z",
        durationMinutes: 30,
        timeZone: "UTC",
      },
    };
    const described = await book.describeFor?.(
      call,
      book.targets(call),
      APPROVER,
    );
    expect(described?.summary).toBe("Book a call with Ajopot");
    expect(described?.preview).toContain("Intro call");
    expect(described?.preview).toContain("30 minutes");
  });

  it("interest and connection-request answers name who, read from their own inbox (lead 2026-10-03)", async () => {
    const INTEREST = "f0000000-0000-4000-8000-000000000001";
    const REQUEST = "f0000000-0000-4000-8000-000000000002";
    const inbox = createAppActionDefinitions(
      {
        ...fakes().ports,
        ownCompanyId: () => Promise.resolve(COMPANY),
        interests: {
          expressInterest: () => Promise.reject(new Error("unused")),
          respondToInterest: () => Promise.reject(new Error("unused")),
          mayRespondToInterest: () => Promise.resolve(true),
          listIncomingInterest: ({ companyId }) =>
            Promise.resolve(
              companyId === COMPANY
                ? ([
                    {
                      interest: { id: INTEREST },
                      investor: { displayName: "Kazikit Capital" },
                    },
                  ] as never)
                : [],
            ),
        },
        connections: {
          requestConnection: () => Promise.reject(new Error("unused")),
          respondToConnectionRequest: () => Promise.reject(new Error("unused")),
          listConnectionRequests: (() =>
            Promise.resolve([
              {
                interest: { id: REQUEST },
                company: { canonicalName: "Savanna Health" },
              },
            ])) as never,
        },
      },
      {},
    );
    const card = async (type: string, interestId: string) => {
      const found = inbox.find((entry) => entry.actionType === type);
      const payload = {
        interestId,
        idempotencyKey: "k-answer-0001",
        input: {},
      };
      return found?.describeFor?.(payload, [], APPROVER);
    };
    expect(await card("app.relationship.interest.accept", INTEREST)).toEqual({
      summary: "Accept Kazikit Capital's interest",
      preview: "Kazikit Capital is told you'd like to talk.",
    });
    expect(
      (await card("app.relationship.interest.decline", INTEREST))?.summary,
    ).toBe("Decline Kazikit Capital's interest");
    expect(
      await card("app.relationship.connection_request.accept", REQUEST),
    ).toEqual({
      summary: "Accept Savanna Health's connection request",
      preview: "Savanna Health is told you'd like to connect.",
    });
    // Not in their inbox: the card reads without a name.
    expect(
      (await card("app.relationship.interest.accept", REQUEST))?.summary,
    ).toBe("Accept their interest");
  });

  it("no name known: the card still reads, unnamed", async () => {
    const unnamed = createAppActionDefinitions(fakes().ports).find(
      (entry) => entry.actionType === "app.relationship.interest.express",
    );
    const payload = {
      companyId: COMPANY,
      idempotencyKey: "k-express-0002",
      input: { surface: "FEED" },
    };
    expect((await unnamed?.describeFor?.(payload, [], APPROVER))?.summary).toBe(
      "Express interest",
    );
  });
});
