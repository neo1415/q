import { describe, expect, it } from "vitest";

import { handleEverythingGrant } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import {
  APP_ACTIONS,
  appActionToolNames,
  delegableOnItsOwn,
  settleGrant,
  PERSON_ACTIONS,
  misheard,
  parityCases,
  qCapabilityId,
  resolveReference,
  type ReferenceCandidates,
} from "../src/index.js";

/**
 * ADR 0040: the registry itself. Every entry is complete (a tool, a card,
 * a route or a reason it has none), names are coerced by one rule, and
 * the parity eval's cases come from the registry, not from a hand list.
 */

const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  organisationId: "d0000000-0000-4000-8000-000000000001",
  membershipId: "e0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});

describe("the action registry", () => {
  it("names each action once, each tool once, each route once", () => {
    const names = APP_ACTIONS.map((action) => action.name);
    const tools = APP_ACTIONS.flatMap((action) =>
      action.tool === undefined ? [] : [action.tool.name],
    );
    const routes = APP_ACTIONS.flatMap((action) =>
      action.http === undefined
        ? []
        : [`${action.http.method} ${action.http.path}`],
    );
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(tools).size).toBe(tools.length);
    expect(new Set(routes).size).toBe(routes.length);
    for (const action of APP_ACTIONS) {
      expect(action.name).toMatch(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/);
      // An action is served to Q by a generated tool, its family's tool,
      // or (until its area's second step) the hand tool it names.
      if (action.tool === undefined) {
        expect(qCapabilityId(action)).toMatch(
          /^(tool|hand|offer)\.[a-z][a-z_]*$/,
        );
      } else {
        expect(action.tool.eval.say).toHaveLength(2);
      }
    }
  });

  it("the slice, then profile and records: each action's Q tool and classification", () => {
    expect(
      APP_ACTIONS.map((action) => [
        action.name,
        action.tool?.name ??
          (action.qCapability !== undefined
            ? action.qCapability
            : action.viaTool === undefined
              ? `legacy:${action.legacyTool ?? ""}`
              : `via:${action.viaTool}`),
        action.classification,
      ]),
    ).toEqual([
      ["pitch.details.set", "set_pitch_sharing", "CONSEQUENTIAL"],
      ["discovery.company.save", "save_company", "INSTANT"],
      ["discovery.company.unsave", "unsave_company", "INSTANT"],
      ["discovery.company.pass", "pass_company", "INSTANT"],
      ["discovery.company.unpass", "unpass_company", "INSTANT"],
      ["person.profile.update", "update_my_profile", "CONSEQUENTIAL"],
      ["company.profile.update", "update_company_profile", "CONSEQUENTIAL"],
      ["company.team.me.upsert", "set_my_company_role", "CONSEQUENTIAL"],
      [
        "company.founder_profile.me.update",
        "update_my_founder_profile",
        "CONSEQUENTIAL",
      ],
      ["company.team_facts.update", "update_team_facts", "CONSEQUENTIAL"],
      ["investor.profile.update", "update_investor_profile", "CONSEQUENTIAL"],
      [
        "investor.representative.me.upsert",
        "set_my_investor_role",
        "CONSEQUENTIAL",
      ],
      ["q_card.handle.claim", "claim_q_card_handle", "CONSEQUENTIAL"],
      ["q_card.update", "update_q_card", "CONSEQUENTIAL"],
      ["capital.objective.change", "change_my_raise", "CONSEQUENTIAL"],
      ["capital.objective.create", "via:change_my_raise", "CONSEQUENTIAL"],
      ["capital.objective.update", "via:change_my_raise", "CONSEQUENTIAL"],
      ["capital.objective.close", "via:change_my_raise", "CONSEQUENTIAL"],
      ["capital.objective.replace", "via:change_my_raise", "CONSEQUENTIAL"],
      ["investor.mandate.change", "change_my_mandate", "CONSEQUENTIAL"],
      ["investor.mandate.create", "via:change_my_mandate", "CONSEQUENTIAL"],
      ["investor.mandate.update", "via:change_my_mandate", "CONSEQUENTIAL"],
      ["investor.mandate.activate", "via:change_my_mandate", "CONSEQUENTIAL"],
      ["investor.mandate.close", "via:change_my_mandate", "CONSEQUENTIAL"],
      ["company.visibility.set", "hand.set_visibility", "CONSEQUENTIAL"],
      ["investor.visibility.set", "set_investor_visibility", "CONSEQUENTIAL"],
      ["disclosure.raise.share", "share_my_raise", "CONSEQUENTIAL"],
      ["disclosure.share.revoke", "stop_sharing_my_raise", "CONSEQUENTIAL"],
      [
        "relationship.interest.express",
        "legacy:propose_express_interest",
        "CONSEQUENTIAL",
      ],
      [
        "relationship.interest.accept",
        "legacy:propose_interest_answer",
        "CONSEQUENTIAL",
      ],
      [
        "relationship.interest.decline",
        "legacy:propose_interest_answer",
        "CONSEQUENTIAL",
      ],
      [
        "relationship.connection_request.send",
        "legacy:propose_connection_request",
        "CONSEQUENTIAL",
      ],
      [
        "relationship.connection_request.accept",
        "legacy:propose_connection_request_answer",
        "CONSEQUENTIAL",
      ],
      [
        "relationship.connection_request.decline",
        "legacy:propose_connection_request_answer",
        "CONSEQUENTIAL",
      ],
      ["chat.message.send", "legacy:propose_chat_message", "CONSEQUENTIAL"],
      ["chat.message.unsend", "offer.chat_unsend", "INSTANT"],
      ["chat.block", "offer.chat_block", "INSTANT"],
      ["chat.unblock", "offer.chat_unblock", "INSTANT"],
      ["chat.report", "offer.chat_report", "INSTANT"],
      ["schedule.meeting.book", "legacy:propose_meeting", "CONSEQUENTIAL"],
      ["schedule.meeting.join", "join_call", "INSTANT"],
      [
        "schedule.meeting.cancel",
        "legacy:propose_meeting_change",
        "CONSEQUENTIAL",
      ],
      ["schedule.reminder.create", "legacy:propose_reminder", "CONSEQUENTIAL"],
      ["schedule.reminder.dismiss", "legacy:dismiss_reminder", "INSTANT"],
      ["pitch.create", "offer.pitch_video_upload", "CONSEQUENTIAL"],
      ["pitch.delete", "offer.pitch_video_upload", "CONSEQUENTIAL"],
      ["pitch.upload.start", "offer.pitch_video_upload", "CONSEQUENTIAL"],
      ["pitch.upload.cancel", "offer.pitch_video_upload", "CONSEQUENTIAL"],
      ["pitch.playback_policy.set", "via:set_pitch_sharing", "CONSEQUENTIAL"],
      // Post-meeting outcomes (2026-10-02): one family tool, all approved.
      ["relationship.outcome.change", "relationship_outcome", "CONSEQUENTIAL"],
      [
        "relationship.outcome.pass",
        "via:relationship_outcome",
        "CONSEQUENTIAL",
      ],
      [
        "relationship.outcome.pause",
        "via:relationship_outcome",
        "CONSEQUENTIAL",
      ],
      [
        "relationship.outcome.resume",
        "via:relationship_outcome",
        "CONSEQUENTIAL",
      ],
      [
        "relationship.outcome.meeting",
        "via:relationship_outcome",
        "CONSEQUENTIAL",
      ],
      // Diligence (2026-10-02): one family tool, all approved.
      ["diligence.change", "diligence_documents", "CONSEQUENTIAL"],
      ["diligence.document.share", "via:diligence_documents", "CONSEQUENTIAL"],
      ["diligence.document.revoke", "via:diligence_documents", "CONSEQUENTIAL"],
      [
        "diligence.document.request",
        "via:diligence_documents",
        "CONSEQUENTIAL",
      ],
      ["diligence.request.fulfil", "via:diligence_documents", "CONSEQUENTIAL"],
      ["document.deck_audience.set", "set_deck_audience", "CONSEQUENTIAL"],
      ["document.upload.start", "offer.document_upload", "CONSEQUENTIAL"],
      ["document.upload.complete", "offer.document_upload", "CONSEQUENTIAL"],
      ["document.upload.cancel", "offer.document_upload", "CONSEQUENTIAL"],
      [
        "profile_image.upload.start",
        "offer.profile_photo_upload",
        "CONSEQUENTIAL",
      ],
      [
        "profile_image.upload.complete",
        "offer.profile_photo_upload",
        "CONSEQUENTIAL",
      ],
      ["profile_image.remove", "offer.profile_photo_upload", "CONSEQUENTIAL"],
      [
        "settings.notifications.set",
        "legacy:set_notification_settings",
        "INSTANT",
      ],
      ["integrations.google.connect", "offer.gmail_connect", "CONSEQUENTIAL"],
      [
        "integrations.google.disconnect",
        "offer.gmail_connect",
        "CONSEQUENTIAL",
      ],
      [
        "integrations.inbound_email.rotate",
        "offer.q_email_address",
        "CONSEQUENTIAL",
      ],
      [
        "verification.company.request",
        "offer.verification_request",
        "CONSEQUENTIAL",
      ],
      ["review.request", "legacy:propose_human_review", "CONSEQUENTIAL"],
      ["verification.kyb.submit", "offer.kyb_submission", "CONSEQUENTIAL"],
    ]);
  });
});

describe("person-scoped actions (onboarding)", () => {
  it("each is a route under the onboarding actor, served to Q by its loop's own tool, never a new one", () => {
    expect(PERSON_ACTIONS.map((action) => action.name)).toEqual([
      "onboarding.answer.submit",
      "onboarding.answer.revise",
      "onboarding.step.skip",
      "onboarding.answer.withdraw",
      "onboarding.complete",
      "onboarding.suggestion.resolve",
      "onboarding.question.answer",
      "onboarding.question.dismiss",
      "onboarding.reminders.choose",
      "person.name.set",
      "person.profile.edit",
    ]);
    for (const action of PERSON_ACTIONS) {
      expect(qCapabilityId(action), action.name).toMatch(/^tool\.[a-z_]+$/);
    }
  });
});

describe("the reader's compact list", () => {
  it("every declaration has a short label of 2 to 5 words", () => {
    for (const action of [...APP_ACTIONS, ...PERSON_ACTIONS]) {
      const words = (action.short ?? "").trim().split(/\s+/).filter(Boolean);
      expect(words.length, action.name).toBeGreaterThanOrEqual(2);
      expect(words.length, action.name).toBeLessThanOrEqual(5);
    }
  });
});

describe("one coercion for every name", () => {
  const candidates: ReferenceCandidates = (kind) =>
    Promise.resolve(
      kind === "COMPANY"
        ? [
            { id: "c1", name: "Nixo" },
            { id: "c2", name: "Kazikit" },
            { id: "c3", name: "Kazikit Capital" },
          ]
        : kind === "MEDIA"
          ? [{ id: "m1", name: "Nixo pitch" }]
          : [],
    );

  it("a misheard relationship name resolves to it (parity e445cfb9: 'Ledger fold')", async () => {
    const relationships: ReferenceCandidates = (kind) =>
      Promise.resolve(
        kind === "RELATIONSHIP"
          ? [
              { id: "r1", name: "Ledgerfold" },
              { id: "r2", name: "Nixo" },
            ]
          : [],
      );
    expect(
      await resolveReference(
        relationships,
        "RELATIONSHIP",
        actor,
        "Ledger fold",
      ),
    ).toEqual({ kind: "RESOLVED", id: "r1" });
  });

  it("takes one clear match, misheard included; asks about several; finds nothing for none", async () => {
    expect(
      await resolveReference(candidates, "COMPANY", actor, "Nixon"),
    ).toEqual({
      kind: "RESOLVED",
      id: "c1",
    });
    expect(
      (await resolveReference(candidates, "COMPANY", actor, "Kazi")).kind,
    ).toBe("SEVERAL");
    expect(
      await resolveReference(candidates, "COMPANY", actor, "Zorblax"),
    ).toEqual({
      kind: "NONE",
    });
  });

  it("'my pitch video' is the one pitch they have", async () => {
    expect(
      await resolveReference(candidates, "MEDIA", actor, "my pitch video"),
    ).toEqual({ kind: "RESOLVED", id: "m1" });
  });
});

describe("the parity eval's cases come from the registry", () => {
  it("two phrasings and a misheard name per action, two questions per read", () => {
    const cases = parityCases(
      APP_ACTIONS,
      { COMPANY: "Kazikit", MEDIA: "Nixo pitch" },
      { media: "Nixo pitch", feed: "Kazikit" },
    );
    // A misheard variant only where the phrasing names a record.
    expect(cases).toHaveLength(
      APP_ACTIONS.reduce(
        (total, action) =>
          total +
          (action.tool === undefined
            ? 0
            : action.tool.eval.names === undefined
              ? 2
              : action.tool.eval.names === "COMPANY" ||
                  action.tool.eval.names === "MEDIA"
                ? 3
                : 0),
        0,
      ) + 4,
    );
    expect(
      cases.find((c) => c.id === "discovery.company.pass#misheard")?.say,
    ).toBe(`Pass on ${misheard("Kazikit")}.`);
    expect(misheard("Kazikit")).not.toBe("Kazikit");
    // The name proper is misheard, never a parenthetical.
    expect(misheard("Savanna Seed Partners (fictional)")).toBe(
      "Savanna Seed Parters (fictional)",
    );
  });
});

describe("what Q proposes names what it touches (parity eval 2026-10-03)", () => {
  // The Approval Engine refuses a proposal with no targets
  // (ACTION_NOT_PERMITTED): every consequential action Q prepares through
  // its generated tool must name its subject from the payload.
  const ID = "6a0c1f5e-0000-4000-8000-0000000000aa";
  const sample = new Proxy<Record<string, unknown>>(
    {},
    { get: (_target, key) => (typeof key === "string" ? ID : undefined) },
  );
  const proposed = APP_ACTIONS.filter(
    (action) =>
      action.classification === "CONSEQUENTIAL" &&
      // A family's one tool proposes as its members, each tested here.
      action.http !== undefined &&
      (action.tool !== undefined || action.viaTool !== undefined),
  );

  it.each(proposed.map((action) => [action.name, action] as const))(
    "%s has at least one target",
    (_name, action) => {
      expect(action.targets(sample as never).length).toBeGreaterThan(0);
    },
  );
});

describe("a name said without its parenthetical", () => {
  it("'Savanna Seed Parters' finds 'Savanna Seed Partners (fictional)'", async () => {
    const SAVANNA = "6a0c1f5e-0000-4000-8000-0000000000b1";
    const candidates: ReferenceCandidates = () =>
      Promise.resolve([
        { id: SAVANNA, name: "Savanna Seed Partners (fictional)" },
        { id: "6a0c1f5e-0000-4000-8000-0000000000b2", name: "Ledgerfold" },
      ]);
    for (const said of ["Savanna Seed Parters", "Savanna Seed Partners"]) {
      expect(
        await resolveReference(candidates, "RELATIONSHIP", actor, said),
      ).toEqual({ kind: "RESOLVED", id: SAVANNA });
    }
  });
});

/**
 * ADR 0043 (founder decision 2026-10-03): what Q may ever do on its own
 * under a standing instruction, and what always needs a yes.
 */
describe("delegation: what Q may do on its own", () => {
  const named = (name: string) =>
    APP_ACTIONS.find((action) => action.name === name);

  it("only expressing interest, chat messages and booking times are delegable", () => {
    expect(
      APP_ACTIONS.filter(delegableOnItsOwn)
        .map((action) => action.name)
        .sort(),
    ).toEqual([
      "chat.message.send",
      "relationship.interest.express",
      "schedule.meeting.book",
    ]);
  });

  it.each([
    "capital.objective.change",
    "disclosure.raise.share",
    "relationship.outcome.change",
    "relationship.outcome.pass",
    "relationship.interest.decline",
    "relationship.connection_request.decline",
    "investor.mandate.change",
    "verification.kyb.submit",
  ])("%s carries terms, money or a commitment: never Q's alone", (name) => {
    const action = named(name);
    expect(action?.consequence).toBeDefined();
    expect(action === undefined ? true : delegableOnItsOwn(action)).toBe(false);
  });

  it("settling a grant drops undeclared actions and asks for the rest", () => {
    const grant = handleEverythingGrant({ timeZone: "UTC" });
    expect(settleGrant(grant, APP_ACTIONS)).toEqual({
      grant,
      dropped: [],
      askedInstead: [],
    });
    const settled = settleGrant(
      {
        ...grant,
        actions: [
          { action: "relationship.outcome.change", mode: "AUTO" },
          { action: "capital.objective.change", mode: "AUTO" },
          { action: "chat.message.send", mode: "AUTO" },
          { action: "chat.message.send", mode: "ASK" },
          { action: "money.wire.send", mode: "AUTO" },
        ],
      },
      APP_ACTIONS,
    );
    expect(settled.grant.actions).toEqual([
      { action: "relationship.outcome.change", mode: "ASK" },
      { action: "capital.objective.change", mode: "ASK" },
      { action: "chat.message.send", mode: "AUTO" },
    ]);
    expect(settled.dropped).toEqual(["money.wire.send"]);
    expect(settled.askedInstead).toEqual([
      "relationship.outcome.change",
      "capital.objective.change",
    ]);
  });
});

describe("the tools that take declared actions (QA run 4e3b1903)", () => {
  it("include the hand-written proposers, once, and not the interview's own tools", () => {
    const names = appActionToolNames(APP_ACTIONS);
    expect(names).toEqual(
      expect.arrayContaining([
        "propose_express_interest",
        "propose_interest_answer",
        "propose_meeting",
      ]),
    );
    expect(new Set(names).size).toBe(names.length);
    for (const interview of [
      "record_answers",
      "set_aside",
      "confirm_and_finish",
    ])
      expect(names).not.toContain(interview);
  });
});
