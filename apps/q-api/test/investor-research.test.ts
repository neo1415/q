import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { createLogger } from "@capital-q/observability";
import type { InvestorResearchReaderResult } from "@capital-q/q-core";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createInterviewAgent } from "../src/voice/interview-agent.js";
import {
  createInvestorResearch,
  validateReading,
  type InvestorResearch,
  type ResearchPage,
} from "../src/voice/investor-research.js";
import {
  createResearchPublicLinksTool,
  linkInWords,
  publicLink,
} from "../src/voice/investor-research-tool.js";
import { createOnboardingPort } from "../src/voice/onboarding-port.js";

import { readerOf, reading } from "./authority-fixtures.js";
import {
  investorSession,
  turn,
  type InvestorWorld,
  type WorldOptions,
} from "./interviewer-fixtures.js";

/**
 * Research-first investor onboarding (BIZ-009, R13). Properties, over
 * recorded fictional pages and a fake reader (no live web or model):
 *
 * - what the pages state becomes recommendations with their source, on
 *   the right steps; never an answer until the investor accepts;
 * - unknown stays unknown: a page silent on cheque size leaves it unknown,
 *   and a reading whose words are not on the cited page is dropped,
 *   whatever those words are;
 * - a finding that differs from what the investor said is held beside
 *   their answer, and both stand until they decide;
 * - the investor's links reach research only from their own words.
 */

const RETRIEVED = "2026-09-27T08:00:00.000Z";
const SITE = "https://kestrelridge.vc";

const HOME: ResearchPage = {
  url: `${SITE}/`,
  title: "Kestrel Ridge Capital",
  provider: "public_web",
  retrievedAt: RETRIEVED,
  excerpt:
    "Kestrel Ridge Capital is an early-stage venture capital fund. We lead pre-seed and seed rounds for founders building fintech and climate software across West Africa and the United Kingdom. Our first cheque is typically between $150,000 and $500,000.",
};
const PORTFOLIO: ResearchPage = {
  url: `${SITE}/portfolio`,
  title: "Portfolio | Kestrel Ridge",
  provider: "public_web",
  retrievedAt: RETRIEVED,
  excerpt:
    "Our portfolio: Tidewell Payments, Ashgrove Grid, Lumen Ledger, Okra Fields, Harbour Kitchen, Northwind Robotics.",
};
/** The same firm's page with nothing about cheque size on it. */
const HOME_SILENT: ResearchPage = {
  ...HOME,
  excerpt:
    "Kestrel Ridge Capital is an early-stage venture capital fund. We lead pre-seed and seed rounds for founders building fintech and climate software across West Africa and the United Kingdom.",
};

const FULL: InvestorResearchReaderResult = {
  wrongSubject: false,
  investorType: {
    value: "vc",
    sourceIndex: 0,
    quote: "an early-stage venture capital fund",
  },
  thesis: {
    value:
      "We lead pre-seed and seed rounds for founders building fintech and climate software.",
    sourceIndex: 0,
    quote: "We lead pre-seed and seed rounds",
  },
  stages: {
    value: ["pre_seed", "seed"],
    sourceIndex: 0,
    quote: "We lead pre-seed and seed rounds",
  },
  sectors: {
    value: ["fintech", "climate software"],
    sourceIndex: 0,
    quote: "building fintech and climate software",
  },
  geographies: {
    value: ["West Africa", "United Kingdom"],
    sourceIndex: 0,
    quote: "across West Africa and the United Kingdom",
  },
  cheque: {
    currency: "usd",
    min: "150000",
    typical: null,
    max: "500000",
    sourceIndex: 0,
    quote: "typically between $150,000 and $500,000",
  },
  portfolio: {
    value: [
      "Tidewell Payments",
      "Ashgrove Grid",
      "Lumen Ledger",
      "Okra Fields",
      "Harbour Kitchen",
      "Northwind Robotics",
    ],
    sourceIndex: 1,
    quote: "Tidewell Payments, Ashgrove Grid",
  },
};

const NOTHING: InvestorResearchReaderResult = {
  wrongSubject: false,
  investorType: null,
  thesis: null,
  stages: null,
  sectors: null,
  geographies: null,
  cheque: null,
  portfolio: null,
};

const stepsOf = (findings: readonly { stepKey: string }[]) =>
  findings.map((f) => f.stepKey).sort();

describe("a reading becomes cited findings on the journey's own steps", () => {
  it("maps what the pages state, each with its page as the source", () => {
    const findings = validateReading(FULL, [HOME, PORTFOLIO], SITE);
    expect(stepsOf(findings)).toEqual(
      [
        "I0.investor_type",
        "I11.additional_context",
        "I2.cheque_max",
        "I2.cheque_min",
        "I2.currency",
        "I2.stages",
        "I3.geography",
        "I3.sectors",
        "I8.portfolio",
      ].sort(),
    );
    // BIZ-009 acceptance: at least four of stage, sector, geography,
    // cheque and portfolio pre-proposed with a source link.
    const core = findings.filter((f) =>
      [
        "I2.stages",
        "I3.sectors",
        "I3.geography",
        "I2.cheque_min",
        "I8.portfolio",
      ].includes(f.stepKey),
    );
    expect(core.length).toBeGreaterThanOrEqual(4);
    for (const finding of findings) {
      expect(finding.sources[0]?.sourceType).toBe("PUBLIC_WEBSITE");
      expect(finding.sources[0]?.url.startsWith(SITE)).toBe(true);
      expect(finding.because).toContain(
        "found on their website (kestrelridge.vc)",
      );
    }
    const min = findings.find((f) => f.stepKey === "I2.cheque_min");
    expect(min?.value).toBe(150000);
    const portfolio = findings.find((f) => f.stepKey === "I8.portfolio");
    // The step keeps five names, one per line.
    expect(String(portfolio?.value).split("\n")).toHaveLength(5);
  });

  it("names a declared profile link and a registry as what they are", () => {
    const profile: ResearchPage = {
      url: "https://www.linkedin.com/company/kestrel-ridge",
      title: "Kestrel Ridge Capital",
      provider: "public_profile",
      retrievedAt: RETRIEVED,
      excerpt: "Kestrel Ridge Capital\nVenture capital fund.\nLagos, Nigeria",
    };
    const findings = validateReading(
      {
        ...NOTHING,
        investorType: {
          value: "vc",
          sourceIndex: 0,
          quote: "Venture capital fund",
        },
      },
      [profile],
      SITE,
    );
    expect(findings[0]?.sources[0]?.sourceType).toBe("PUBLIC_PROFILE");
    expect(findings[0]?.because).toContain("profile link they gave");
  });
});

describe("unknown stays unknown", () => {
  it("a page that says nothing about cheque size leaves the cheque unknown", () => {
    const findings = validateReading(
      { ...FULL, cheque: null },
      [HOME_SILENT, PORTFOLIO],
      SITE,
    );
    for (const step of [
      "I2.currency",
      "I2.cheque_min",
      "I2.cheque_typical",
      "I2.cheque_max",
    ]) {
      expect(stepsOf(findings)).not.toContain(step);
    }
    expect(stepsOf(findings)).toContain("I2.stages");
  });

  it("a figure whose words are not on the cited page is dropped, however it is worded", () => {
    // Unseen wordings a reader might invent to fill the gap: none is on
    // the page, so none becomes a finding.
    for (const quote of [
      "typically between $150,000 and $500,000",
      "Tickets from $250k",
      "cheques of 100k-1m",
      "We write £200,000 first cheques",
      "initial investments of up to USD 750,000",
    ]) {
      const findings = validateReading(
        {
          ...NOTHING,
          cheque: {
            currency: "usd",
            min: "250000",
            typical: null,
            max: "1000000",
            sourceIndex: 0,
            quote,
          },
        },
        [HOME_SILENT],
        SITE,
      );
      expect(findings, quote).toEqual([]);
    }
  });

  it("a citation to a page that does not exist, or the wrong page, is dropped", () => {
    expect(
      validateReading(
        {
          ...NOTHING,
          stages: { value: ["seed"], sourceIndex: 5, quote: "seed rounds" },
        },
        [HOME],
        SITE,
      ),
    ).toEqual([]);
    expect(
      validateReading(
        {
          ...NOTHING,
          stages: {
            value: ["seed"],
            sourceIndex: 1,
            quote: "pre-seed and seed rounds",
          },
        },
        [HOME, PORTFOLIO],
        SITE,
      ),
    ).toEqual([]);
  });

  it("shapes the journey cannot hold are left unknown, not guessed", () => {
    const cheque = FULL.cheque;
    if (cheque === null) throw new Error("fixture");
    const cases: readonly InvestorResearchReaderResult[] = [
      // a currency the journey does not record
      { ...NOTHING, cheque: { ...cheque, currency: "dollars" } },
      // an amount that is not a plain number
      { ...NOTHING, cheque: { ...cheque, min: "150k", max: "half a million" } },
      // a range that runs backwards
      { ...NOTHING, cheque: { ...cheque, min: "500000", max: "150000" } },
      // a stage the journey does not have
      {
        ...NOTHING,
        stages: {
          value: ["growth"],
          sourceIndex: 0,
          quote: "We lead pre-seed and seed rounds",
        },
      },
      // an investor type that is not an option
      {
        ...NOTHING,
        investorType: {
          value: "hedge fund",
          sourceIndex: 0,
          quote: "an early-stage venture capital fund",
        },
      },
    ];
    for (const item of cases) {
      expect(validateReading(item, [HOME], SITE), JSON.stringify(item)).toEqual(
        [],
      );
    }
  });

  it("pages about somebody else produce nothing", () => {
    expect(
      validateReading({ ...FULL, wrongSubject: true }, [HOME, PORTFOLIO], SITE),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Findings into the person's onboarding
// ---------------------------------------------------------------------------

const TAXONOMY = {
  fintech: "d0000000-0000-4000-8000-000000000001",
  "climate software": "d0000000-0000-4000-8000-000000000002",
  "west africa": "d0000000-0000-4000-8000-000000000003",
  "united kingdom": "d0000000-0000-4000-8000-000000000004",
};
const MANDATE = "e0000000-0000-4000-8000-000000000001";

const actor = ActorContextSchema.parse({
  userId: "b0000000-0000-4000-8000-000000000001",
  tenantId: "c0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});
const logger = createLogger(
  { serviceName: "q-api-test", environment: "test" },
  { level: "silent" },
);

function worldWith(recorded: Record<string, string>): InvestorWorld {
  const options: WorldOptions = {
    currentStepKey: "I0.investor_type",
    recorded: { "I0.organisation_name": "Kestrel Ridge Capital", ...recorded },
    taxonomy: TAXONOMY,
  };
  return investorSession(options);
}

function researchFor(
  world: InvestorWorld,
  pages: readonly ResearchPage[],
  result: InvestorResearchReaderResult | null,
): { research: InvestorResearch; done: Promise<void> } {
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const session = turn(world, "").session;
  const research = createInvestorResearch({
    read: () => Promise.resolve(pages),
    reader: () => Promise.resolve(result),
    portFor: ({ actor: who, session: own, onboardingSessionId }) => {
      const port = createOnboardingPort({
        session: own,
        onboardingSessionId,
        journeyType: "investor",
        ownerUserId: who.userId,
        personTurns: [],
        recommendations: world.recommendations,
      });
      return {
        answeredSteps: port.answeredSteps,
        recommendFound: async (items) => {
          const out = await port.recommendFound(items);
          finish();
          return out;
        },
      };
    },
    logger,
  });
  void session;
  return { research, done };
}

const SESSION = "f0000000-0000-4000-8000-000000000010";

async function pendingOf(world: InvestorWorld) {
  return world.recommendations.pending({
    userId: actor.userId as never,
    sessionId: SESSION,
  });
}

describe("findings are held as recommendations with their source, never as answers", () => {
  it("offers what can be accepted now, and the rest once its prerequisite is answered", async () => {
    const world = worldWith({});
    const { research, done } = researchFor(world, [HOME, PORTFOLIO], FULL);
    expect(
      research.consider({
        actor,
        session: turn(world, "").session,
        onboardingSessionId: SESSION,
        identity: {
          firmName: "Kestrel Ridge Capital",
          websiteUrl: SITE,
          profileUrls: [],
        },
      }),
    ).toBe(true);
    await done;

    // No mandate chosen yet: only the steps that do not need one.
    let pending = await pendingOf(world);
    expect(pending.map((p) => p.stepKey).sort()).toEqual([
      "I0.investor_type",
      "I8.portfolio",
    ]);
    for (const item of pending) {
      expect(item.sources[0]).toEqual({
        sourceType: "PUBLIC_WEBSITE",
        sourceId: expect.stringContaining(
          "kestrelridge.vc",
        ) as unknown as string,
      });
      expect(item.rationale).toContain("found on their website");
    }

    world.record("I1.mandate_context", {
      type: "RESOURCE_REFERENCE",
      resourceType: "INVESTOR_MANDATE",
      resourceIds: [MANDATE],
    });
    const port = createOnboardingPort({
      session: turn(world, "").session,
      onboardingSessionId: SESSION,
      journeyType: "investor",
      ownerUserId: actor.userId,
      personTurns: [],
      recommendations: world.recommendations,
    });
    expect(await research.offerReady(SESSION, port)).toBeGreaterThanOrEqual(6);
    pending = await pendingOf(world);
    const byStep = new Map(pending.map((p) => [p.stepKey, p.value]));
    expect(byStep.get("I2.stages")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["pre_seed", "seed"],
    });
    expect(byStep.get("I2.currency")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "usd",
    });
    expect(byStep.get("I3.sectors")).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: [TAXONOMY.fintech, TAXONOMY["climate software"]],
    });

    // Offered once: asking again offers nothing new.
    expect(await research.offerReady(SESSION, port)).toBe(0);
    // Zero values became declared: research only recommends.
    for (const step of [
      "I0.investor_type",
      "I2.stages",
      "I2.currency",
      "I3.sectors",
      "I8.portfolio",
    ]) {
      expect(world.recordedValue(step), step).toBeUndefined();
    }
  });

  it("a finding that differs from what they said is held beside their answer; the same one is not offered", async () => {
    const world = worldWith({
      "I1.mandate_context": MANDATE,
      "I2.stages": "series_a",
      "I0.investor_type": "vc",
    });
    const { research, done } = researchFor(world, [HOME, PORTFOLIO], FULL);
    research.consider({
      actor,
      session: turn(world, "").session,
      onboardingSessionId: SESSION,
      identity: {
        firmName: "Kestrel Ridge Capital",
        websiteUrl: SITE,
        profileUrls: [],
      },
    });
    await done;
    const pending = await pendingOf(world);
    // Their answer stands, untouched...
    expect(world.recordedValue("I2.stages")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["series_a"],
    });
    // ...and the site's version waits beside it for their decision.
    expect(pending.find((p) => p.stepKey === "I2.stages")?.value).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["pre_seed", "seed"],
    });
    // What they already said is not offered back to them.
    expect(pending.some((p) => p.stepKey === "I0.investor_type")).toBe(false);
  });

  it("a phrase no category names is left out, and the rest still offered", async () => {
    const world = worldWith({ "I1.mandate_context": MANDATE });
    const { research, done } = researchFor(world, [HOME, PORTFOLIO], {
      ...NOTHING,
      sectors: {
        value: ["fintech", "quantum basket weaving"],
        sourceIndex: 0,
        quote: "building fintech and climate software",
      },
    });
    research.consider({
      actor,
      session: turn(world, "").session,
      onboardingSessionId: SESSION,
      identity: {
        firmName: "Kestrel Ridge Capital",
        websiteUrl: SITE,
        profileUrls: [],
      },
    });
    await done;
    const sectors = (await pendingOf(world)).find(
      (p) => p.stepKey === "I3.sectors",
    );
    expect(sectors?.value).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: [TAXONOMY.fintech],
    });
  });

  it("the same identity is read once; a website given later reads again", () => {
    const world = worldWith({});
    const { research } = researchFor(world, [], NOTHING);
    const base = {
      actor,
      session: turn(world, "").session,
      onboardingSessionId: SESSION,
    };
    const name = {
      firmName: "Kestrel Ridge Capital",
      websiteUrl: null,
      profileUrls: [],
    };
    expect(research.consider({ ...base, identity: name })).toBe(true);
    expect(research.consider({ ...base, identity: name })).toBe(false);
    expect(
      research.consider({ ...base, identity: { ...name, websiteUrl: SITE } }),
    ).toBe(true);
    // The link is remembered: naming the firm again does not forget it.
    expect(research.consider({ ...base, identity: name })).toBe(false);
  });

  it("says the notice once, then that nothing was found, once", async () => {
    const world = worldWith({});
    const research = createInvestorResearch({
      read: () => Promise.resolve([]),
      reader: () => Promise.resolve(null),
      portFor: () => {
        throw new Error("nothing to offer");
      },
      logger,
    });
    research.consider({
      actor,
      session: turn(world, "").session,
      onboardingSessionId: SESSION,
      identity: {
        firmName: "Kestrel Ridge Capital",
        websiteUrl: null,
        profileUrls: [],
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(research.takeNote(SESSION)).toBe("STARTED");
    expect(research.status(SESSION)).toBe("NOTHING_FOUND");
    expect(research.takeNote(SESSION)).toBe("NOTHING_FOUND");
    expect(research.takeNote(SESSION)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The investor's links
// ---------------------------------------------------------------------------

describe("a link reaches research only from the person's own words", () => {
  it("accepts a link written or said aloud, in unseen wordings", () => {
    for (const [link, words] of [
      ["kestrelridge.vc", "Our site is kestrelridge.vc if that helps."],
      ["kestrelridge dot vc", "you'll find us at kestrelridge dot vc"],
      [
        "https://kestrelridge.vc/team",
        "The team page is https://kestrelridge.vc/team",
      ],
      ["www.kestrelridge.vc", "website's www.kestrelridge.vc"],
      [
        "https://www.linkedin.com/company/kestrel-ridge",
        "here's our LinkedIn https://www.linkedin.com/company/kestrel-ridge",
      ],
    ] as const) {
      expect(linkInWords(link, words), words).toBe(true);
    }
  });

  it("refuses a link that is not in their words, and anything not a public address", () => {
    expect(linkInWords("kestrelridge.vc", "we're called Kestrel Ridge")).toBe(
      false,
    );
    expect(publicLink("localhost:3000")).toBeNull();
    expect(publicLink("http://127.0.0.1/admin")).toBeNull();
    expect(publicLink("intranet")).toBeNull();
    expect(publicLink("kestrelridge.vc")).toBe("https://kestrelridge.vc/");
  });

  it("the tool hands only a stated link to research", async () => {
    const asked: unknown[] = [];
    const tool = createResearchPublicLinksTool({
      ownerUserId: actor.userId,
      personTurns: ["Our site is kestrelridge dot vc"],
      research: (links) => {
        asked.push(links);
        return true;
      },
    });
    const context = {} as never;
    const ok = await tool.execute(
      {
        website: "kestrelridge dot vc",
        profileLinks: [],
        quote: "Our site is kestrelridge dot vc",
      },
      context,
      { userId: actor.userId } as never,
    );
    expect(ok).toEqual({ outcome: "RESEARCHING" });
    expect(asked).toEqual([
      { websiteUrl: "https://kestrelridge.vc/", profileUrls: [] },
    ]);

    const invented = await tool.execute(
      {
        website: "kestrel-ridge.com",
        profileLinks: [],
        quote: "Our site is kestrelridge dot vc",
      },
      context,
      { userId: actor.userId } as never,
    );
    expect(invented).toMatchObject({ outcome: "REFUSED" });
    expect(asked).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The interview loop: notice, then "here's what I found", then acceptance
// ---------------------------------------------------------------------------

function firewall(): ContextFirewallPort {
  const plan = {
    tenantId: actor.tenantId,
    actor: { userId: actor.userId },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
    subjects: [],
    scopes: [
      {
        kind: "OWN_ONBOARDING",
        filter: { tenantId: actor.tenantId, userId: actor.userId },
        sensitivity: "CONFIDENTIAL",
      },
    ],
    maxSensitivity: "CONFIDENTIAL",
  } as unknown as PermittedContextPlan;
  return { plan: () => Promise.resolve({ outcome: "AUTHORISED", plan }) };
}

/** A model that makes one tool call (or none), then replies; prompts kept. */
function scripted(call: { name: string; args: unknown } | null): {
  gateway: ModelGateway;
  prompts: string[];
} {
  const prompts: string[] = [];
  let round = 0;
  const gateway = {
    execute: (request: { messages: readonly { content: string }[] }) => {
      prompts.push(request.messages.map((m) => m.content).join("\n"));
      round += 1;
      return Promise.resolve(
        round === 1 && call !== null
          ? {
              output: {
                kind: "TOOL_CALLS",
                text: "",
                calls: [
                  { callId: "c1", name: call.name, arguments: call.args },
                ],
              },
            }
          : {
              output: {
                kind: "TEXT",
                text: JSON.stringify({ reply: "Ok.", asking: null }),
              },
            },
      );
    },
  } as unknown as ModelGateway;
  return { gateway, prompts };
}

describe("the interview says what was found and the investor's yes makes it theirs", () => {
  it("the opening turn starts research from the firm and carries the notice", async () => {
    const world = worldWith({});
    const { research } = researchFor(world, [], NOTHING);
    const { gateway, prompts } = scripted(null);
    await createInterviewAgent({
      gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      investorResearch: research,
    }).turn({ ...turn(world, ""), actor });
    expect(research.status(SESSION)).not.toBe("NONE");
    expect(prompts.join("\n")).toContain("Research is starting");
    expect(prompts.join("\n")).toContain("research_public_links");
  });

  it("findings are in the state as not yet said; on their approval they are accepted exactly", async () => {
    const world = worldWith({ "I1.mandate_context": MANDATE });
    const { research, done } = researchFor(world, [HOME, PORTFOLIO], FULL);
    research.consider({
      actor,
      session: turn(world, "").session,
      onboardingSessionId: SESSION,
      identity: {
        firmName: "Kestrel Ridge Capital",
        websiteUrl: SITE,
        profileUrls: [],
      },
    });
    await done;

    // Turn one: Q says what it found. The state names the source.
    const first = scripted(null);
    await createInterviewAgent({
      gateway: first.gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      investorResearch: research,
    }).turn({ ...turn(world, "Hi, I'm ready."), actor });
    const said = first.prompts.join("\n");
    expect(said).toContain("found on their website (kestrelridge.vc)");
    expect(said).toContain("not yet said to them");
    expect(world.recordedValue("I2.stages")).toBeUndefined();

    // Turn two: they approve; only then is it theirs, exactly as found.
    const second = scripted({
      name: "accept_recommendation",
      args: { stepKeys: ["I2.stages", "I2.currency"] },
    });
    await createInterviewAgent({
      gateway: second.gateway,
      firewall: firewall(),
      logger,
      recommendations: world.recommendations,
      investorResearch: research,
      delegation: readerOf(reading({ approved: ["I2.stages", "I2.currency"] })),
    }).turn({ ...turn(world, "Yep, that's us."), actor });
    expect(world.recordedValue("I2.stages")).toEqual({
      type: "MULTI_SELECT",
      optionKeys: ["pre_seed", "seed"],
    });
    expect(world.recordedValue("I2.currency")).toEqual({
      type: "SINGLE_SELECT",
      optionKey: "usd",
    });
    // Not approved, not recorded.
    expect(world.recordedValue("I3.sectors")).toBeUndefined();
  });

  it("a finding nobody has said yet cannot be approved, whatever the words", async () => {
    for (const words of [
      "Yes to all of that.",
      "sure, go with it",
      "Sounds right to me",
    ]) {
      const world = worldWith({ "I1.mandate_context": MANDATE });
      const { research, done } = researchFor(world, [HOME, PORTFOLIO], FULL);
      research.consider({
        actor,
        session: turn(world, "").session,
        onboardingSessionId: SESSION,
        identity: {
          firmName: "Kestrel Ridge Capital",
          websiteUrl: SITE,
          profileUrls: [],
        },
      });
      await done;
      const { gateway } = scripted({
        name: "accept_recommendation",
        args: { stepKeys: ["I2.stages"] },
      });
      await createInterviewAgent({
        gateway,
        firewall: firewall(),
        logger,
        recommendations: world.recommendations,
        investorResearch: research,
        // A reader that (wrongly) reads approval: the guard still holds,
        // because the finding was held between turns and never said.
        delegation: readerOf(reading({ approved: ["I2.stages"] })),
      }).turn({ ...turn(world, words), actor });
      expect(world.recordedValue("I2.stages"), words).toBeUndefined();
    }
  });
});
