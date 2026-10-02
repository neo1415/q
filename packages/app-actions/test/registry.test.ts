import { describe, expect, it } from "vitest";

import { ActorContextSchema } from "@capital-q/security";

import {
  APP_ACTIONS,
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
      ["document.deck_audience.set", "set_deck_audience", "CONSEQUENTIAL"],
    ]);
  });
});

describe("the reader's compact list", () => {
  it("every declaration has a short label of 2 to 5 words", () => {
    for (const action of APP_ACTIONS) {
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
  });
});
