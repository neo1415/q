import { describe, expect, it } from "vitest";

import {
  Q_CLIENT_ACTION_TOOLS,
  Q_INSTANT_ACTION_TOOLS,
  Q_NAVIGATE_DESTINATIONS,
} from "@capital-q/contracts";

import {
  createDefaultQTools,
  createNotePreferenceTool,
  createOnboardingTools,
  eligibleCapabilities,
  Q_CAPABILITIES,
  Q_CAPABILITY_EXCLUSIONS,
  type QCapabilityRunFacts,
  type QToolPorts,
} from "../src/index.js";

/**
 * The capability registry is complete (R20): every tool this package can
 * compose, and every screen Q can open, is in it or excluded with a
 * reason; every entry names something real; and the approval class a
 * person experiences matches what the tool is.
 */

// Factories only capture their ports; no port is called to build a tool.
const STUB = {} as never;
const EVERY_PORT: QToolPorts = {
  companies: STUB,
  capital: STUB,
  mandates: STUB,
  investors: STUB,
  authorization: STUB,
  disclosure: STUB,
  investorFeed: STUB,
  discovery: STUB,
  recommendationExplanations: STUB,
  research: STUB,
  profiles: STUB,
  relationships: STUB,
  email: STUB,
  profileChanges: STUB,
  pitchMoments: STUB,
  visibility: STUB,
  handleClaims: STUB,
  pendingProposals: { inConversation: STUB, approve: STUB, decline: STUB },
  qCards: STUB,
  clientActions: true,
  approvalInbox: STUB,
  discoveryDecisions: STUB,
  documents: STUB,
};

const EVERY_TOOL = [
  ...createDefaultQTools(EVERY_PORT),
  ...createOnboardingTools(STUB),
  createNotePreferenceTool(STUB),
];

const toolEntries = Q_CAPABILITIES.flatMap((capability) =>
  capability.performedBy.kind === "TOOL"
    ? [{ capability, providerName: capability.performedBy.providerName }]
    : [],
);

describe("the capability registry is complete", () => {
  it("every tool is in the registry or excluded with a reason", () => {
    const listed = new Set(toolEntries.map((entry) => entry.providerName));
    const missing = EVERY_TOOL.map((tool) => tool.providerName).filter(
      (name) =>
        !listed.has(name) &&
        (Q_CAPABILITY_EXCLUSIONS.tools[name] ?? "").length === 0,
    );
    expect(missing).toEqual([]);
  });

  it("every tool entry names a tool that exists", () => {
    const real = new Set(EVERY_TOOL.map((tool) => tool.providerName));
    expect(
      toolEntries
        .map((entry) => entry.providerName)
        .filter((name) => !real.has(name)),
    ).toEqual([]);
  });

  it("a read is INSTANT and a change is Prepare → Approve, as the tool is classified", () => {
    const byName = new Map(EVERY_TOOL.map((tool) => [tool.providerName, tool]));
    for (const { capability, providerName } of toolEntries) {
      const tool = byName.get(providerName);
      if (tool === undefined) continue;
      if (capability.surfaces.includes("ONBOARDING")) {
        // The loop's writes are scoped delegation over the person's own
        // onboarding (ADR 0016), not Approval Engine work.
        expect(capability.approval, providerName).toBe("INSTANT");
        continue;
      }
      if (
        providerName === "approve_pending_proposal" ||
        (Q_CLIENT_ACTION_TOOLS as readonly string[]).includes(providerName) ||
        (Q_INSTANT_ACTION_TOOLS as readonly string[]).includes(providerName)
      ) {
        // The person's own decision on a change another capability
        // prepared, or the app's own action in their browser, reversible
        // there: done at once, never an Approval Engine action of its own.
        expect(capability.approval, providerName).toBe("INSTANT");
        expect(capability.executes, providerName).toEqual([]);
        expect(capability.acts, providerName).toBe(true);
        continue;
      }
      expect(capability.acts, providerName).toBe(
        tool.classification !== "READ_ONLY",
      );
      expect(capability.approval, providerName).toBe(
        tool.classification === "READ_ONLY" ? "INSTANT" : "PREPARE_APPROVE",
      );
      expect(capability.executes.length > 0, providerName).toBe(
        capability.approval === "PREPARE_APPROVE",
      );
    }
  });

  it("the client actions and the Q Card read are registered tools (live test 2026-09-27 #4)", () => {
    const listed = new Set(toolEntries.map((entry) => entry.providerName));
    for (const name of [
      ...Q_CLIENT_ACTION_TOOLS,
      ...Q_INSTANT_ACTION_TOOLS,
      "get_q_card",
      "list_pending_approvals",
      "list_my_documents",
    ]) {
      expect(listed.has(name), name).toBe(true);
      expect(
        EVERY_TOOL.some((tool) => tool.providerName === name),
        name,
      ).toBe(true);
    }
  });

  it("every screen Q can open is a navigation entry", () => {
    const screens = Q_CAPABILITIES.flatMap((capability) =>
      capability.performedBy.kind === "HAND" &&
      capability.performedBy.hand.kind === "NAVIGATE"
        ? [capability.performedBy.hand.destination]
        : [],
    );
    expect([...screens].sort()).toEqual([...Q_NAVIGATE_DESTINATIONS].sort());
  });

  it("what only the person can do is offered with a real screen and a reason (R33)", () => {
    const offers = Q_CAPABILITIES.flatMap((capability) =>
      capability.performedBy.kind === "OFFER"
        ? [{ id: capability.id, offer: capability.performedBy.offer }]
        : [],
    );
    expect(offers.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        "offer.gmail_connect",
        "offer.pitch_video_upload",
      ]),
    );
    for (const { id, offer } of offers) {
      expect(
        (Q_NAVIGATE_DESTINATIONS as readonly string[]).includes(
          offer.destination,
        ),
        id,
      ).toBe(true);
      expect(offer.reason.length, id).toBeGreaterThan(20);
    }
  });

  it("ids are unique and every entry states its eligibility", () => {
    const ids = Q_CAPABILITIES.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const capability of Q_CAPABILITIES) {
      expect(capability.eligibility.length, capability.id).toBeGreaterThan(0);
      expect(capability.does.length, capability.id).toBeLessThanOrEqual(240);
    }
  });
});

describe("a run's capabilities come from composed facts, never words", () => {
  const facts = (over: Partial<QCapabilityRunFacts>): QCapabilityRunFacts => ({
    surface: "HOME_Q",
    offeredTools: new Set<string>(),
    company: false,
    ownInvestorOrganisation: false,
    artifacts: false,
    ownMandate: false,
    visibility: false,
    ...over,
  });
  const ids = (f: QCapabilityRunFacts) =>
    eligibleCapabilities(f).map((capability) => capability.id);

  it("a tool is a capability only when the run offers it", () => {
    expect(ids(facts({}))).not.toContain("tool.propose_profile_change");
    expect(
      ids(facts({ offeredTools: new Set(["propose_profile_change"]) })),
    ).toContain("tool.propose_profile_change");
  });

  it("the visibility screen and change need a company; the own mandate needs an investor's own organisation", () => {
    expect(ids(facts({ visibility: true }))).not.toContain(
      "navigate.COMPANY_VISIBILITY",
    );
    expect(ids(facts({ visibility: true }))).not.toContain(
      "hand.set_visibility",
    );
    expect(ids(facts({ visibility: true, company: true }))).toEqual(
      expect.arrayContaining([
        "navigate.COMPANY_VISIBILITY",
        "hand.set_visibility",
      ]),
    );
    expect(ids(facts({ artifacts: true, ownMandate: true }))).not.toContain(
      "document.OWN_MANDATE",
    );
    expect(
      ids(
        facts({
          artifacts: true,
          ownMandate: true,
          ownInvestorOrganisation: true,
        }),
      ),
    ).toContain("document.OWN_MANDATE");
  });

  it("the onboarding loop has its own hands and none of Home Q's", () => {
    const loop = ids(
      facts({
        surface: "ONBOARDING",
        offeredTools: new Set(["record_answers", "propose_profile_change"]),
        artifacts: true,
      }),
    );
    expect(loop).toEqual(["tool.record_answers"]);
  });

  it("the same composition reuses one cached list", () => {
    const a = eligibleCapabilities(facts({ company: true }));
    const b = eligibleCapabilities(facts({ company: true }));
    expect(a).toBe(b);
  });
});
