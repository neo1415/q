import {
  PILOT_ACTOR,
  PILOT_CERTIFICATION_LEDGER,
  PILOT_SCRIPT,
} from "./pilot.js";
import {
  CertificationLedgerSchema,
  TourScriptSchema,
  type CertificationEntry,
  type CertificationLedger,
  type SceneLine,
  type SceneScript,
  type TourScript,
} from "./script.js";

/**
 * The r3 premiere (blueprint §16.1, PROPOSED): the pilot's three certified
 * scenes plus the four candidate scenes and the close, in one script. Privacy runs
 * right after the comparison, on the company page, so "this company" is
 * unambiguous (an r3 reorder of P5/P6).
 *
 * The candidates are CODE_VERIFIED only: deterministic tests over fixtures,
 * no browser receipt (CERTIFICATION_MANIFEST.md, "Candidate certification").
 * By default the gate accepts PRODUCTION_LIVE_VERIFIED only, so an audience
 * run suppresses them. An INTERNAL_REHEARSAL may opt into CODE_VERIFIED to
 * rehearse the full cut and collect the browser receipts that promote them.
 */

const CODE_COMMIT = "a1bd84f3 (claude/rc-oct15-a)";
const CODE_AT = "2026-10-15 (Lane P, local vitest, provider keys disabled)";

function codeEntry(
  entry: Omit<
    CertificationEntry,
    "status" | "actorContext" | "appCommit" | "verifiedAt" | "verifierType"
  >,
): CertificationEntry {
  return {
    ...entry,
    status: "CODE_VERIFIED",
    actorContext: PILOT_ACTOR,
    appCommit: CODE_COMMIT,
    verifiedAt: CODE_AT,
    verifierType: "CODE",
  };
}

export const PREMIERE_CERTIFICATION_LEDGER: CertificationLedger =
  CertificationLedgerSchema.parse([
    ...PILOT_CERTIFICATION_LEDGER,
    {
      featureId: "GATEQ-INBOX-VIEW",
      status: "PRODUCTION_LIVE_VERIFIED",
      actorContext: PILOT_ACTOR,
      fixture:
        "Savanna Seed Partners' own gateway inbox; selected item: fictional Maji Loop (founder.maji-loop@fictional.capitalq.local)",
      appCommit: "web production 04a322ae",
      verifiedAt: "2026-10-15 05:31 UTC",
      verifierType: "BROWSER",
      receipt:
        "scratchpad qpitch-review/gateq-inbox-savanna.png + features-log.json (Playwright, server actions blocked: no writes, no model calls)",
      claimsAllowed: [
        {
          claimId: "GATEQ-INBOX-VIEW.c1",
          text: "The firm's GateQ inbox lists applications through its own gateway, each shown against the firm's rules",
        },
        {
          claimId: "GATEQ-INBOX-VIEW.c2",
          text: "A submitted brief is frozen from the founder's submission, and investment decisions remain with the firm",
        },
      ],
      claimsForbidden: [
        "Selecting Spheros or Tensorgate (not fictional-world records)",
        "A live interview",
        "Investor Q reading the dossier",
      ],
      validUntil: { invalidatedBy: "Next GateQ inbox/dossier release" },
    },
    {
      featureId: "INV-MANDATE-VIEW",
      status: "PRODUCTION_LIVE_VERIFIED",
      actorContext: PILOT_ACTOR,
      fixture:
        "Savanna Seed Partners' own declared mandate on /capital (fictional demo investor)",
      appCommit: "web production d6ae5e69",
      verifiedAt: "2026-10-15 12:00 UTC",
      verifierType: "BROWSER",
      receipt:
        "scratchpad qpitch-review/mandate/capital-mandate-savanna.png + capital-read.txt (Playwright, GET only)",
      claimsAllowed: [
        {
          claimId: "INV-MANDATE-VIEW.c1",
          text: "The investor's Capital page shows their declared mandate: stage, cheque range, sectors, geography, and business models and customers",
        },
      ],
      claimsForbidden: [
        "That Q set or changed the mandate",
        "Any figure on screen as a Capital Q result",
      ],
      validUntil: { invalidatedBy: "Next change to the investor Capital page" },
    },
    {
      featureId: "CRM-RELATIONSHIP-VIEW",
      status: "PRODUCTION_LIVE_VERIFIED",
      actorContext: PILOT_ACTOR,
      fixture: "Savanna Seed Partners' own relationship records (fictional)",
      appCommit: "web production 04a322ae",
      verifiedAt: "2026-10-15 05:31 UTC",
      verifierType: "BROWSER",
      receipt:
        "scratchpad qpitch-review/relationships-savanna.png + features-log.json (Playwright, writes blocked)",
      claimsAllowed: [
        {
          claimId: "CRM-RELATIONSHIP-VIEW.c1",
          text: "The investment hub shows the firm's interest, connections, pipeline and commitments from its own relationship records",
        },
      ],
      claimsForbidden: [
        "Any figure on screen as a Capital Q result",
        "Team or server-backed views",
      ],
      validUntil: { invalidatedBy: "Next relationship hub release" },
    },
    codeEntry({
      featureId: "GATEQ-INBOX-DOSSIER",
      fixture:
        "test fixtures only (gateq-intake inbox, gateq authority, api inbox routes)",
      receipt:
        "packages/gateq-intake/test/inbox.test.ts (17); packages/gateq/test/authority.test.ts (13); apps/api/test/gateq-inbox-routes.test.ts (4): 34 PASS",
      claimsAllowed: [
        {
          claimId: "GATEQ-INBOX-DOSSIER.c1",
          text: "A firm's GateQ inbox shows its own gateway's applications; another firm's gateway or dossier is refused exactly as one that does not exist",
        },
        {
          claimId: "GATEQ-INBOX-DOSSIER.c2",
          text: "A submitted dossier holds only what the founder sent (summary, their shared deck, their answers), never the firm's team notes",
        },
      ],
      claimsForbidden: [
        "That a live interview is running",
        "Investor Q reads the dossier (PR #98 unreleased)",
        "Any application count or timing",
      ],
      validUntil: {
        invalidatedBy:
          "Next change to gateq-intake inbox/dossier or GateQ authority",
      },
    }),
    {
      // Promoted 15 Oct (lead decision): browser step + API negative passed.
      featureId: "TRUST-CROSS-ROLE-DENIAL",
      status: "PRODUCTION_LIVE_VERIFIED",
      actorContext: PILOT_ACTOR,
      fixture:
        "?qpitch=premiere privacy scene on card-1 (Duplo) from the scene-1 receipt; API negative on the fictional Ledgerfold test document 'Private runway note (test)' (data-room level PRIVATE, organisation_private)",
      appCommit: "web/api production 41b3b4ee",
      verifiedAt: "2026-10-15 08:21 / 08:30 UTC",
      verifierType: "BROWSER",
      receipt:
        "scratchpad qpitch-review/41b3b4ee/run-942f77cc.sse.txt + premiere-cert2-41b3b4ee.webm (answer: nothing shared, every evidenceRefs empty); privacy-negative.json (founder open 200, investor open 404, investor access 404, not listed). Code: q-firewall policy (22), q-tools slate/visibility (7) PASS",
      claimsAllowed: [
        {
          claimId: "TRUST-CROSS-ROLE-DENIAL.c1",
          text: "Founder-private and investor-private scopes are owner-only or explicitly shared, and a founder-private company never enters an investor's discovery slate",
        },
      ],
      claimsForbidden: [
        "That nothing can ever leak",
        "That Q quoted or summarised the private document",
      ],
      validUntil: {
        invalidatedBy:
          "Next change to q-firewall scope policy, discovery slate tools or data-room read authorization",
      },
    },
    codeEntry({
      featureId: "CRM-RELATIONSHIP-RECORD",
      fixture: "test fixtures only (network state projector v1/v2)",
      receipt:
        "packages/network/test/state-projector-v2.test.ts (16); packages/network/test/state-projector.test.ts (11): 27 PASS",
      claimsAllowed: [
        {
          claimId: "CRM-RELATIONSHIP-RECORD.c1",
          text: "A relationship's state is derived deterministically from its recorded events, replay-safe, and an illegal move changes nothing",
        },
      ],
      claimsForbidden: [
        "That a meeting, commitment or investment happened without a seeded canonical event",
        "Server-backed team views (device-local only)",
      ],
      validUntil: {
        invalidatedBy: "Next relationship-state projector version",
      },
    }),
    codeEntry({
      featureId: "REH-Q2Q-SHORT",
      fixture:
        "fake rehearsal ports (q-pitch); rehearsal reading fixtures (q-api)",
      receipt:
        "packages/q-pitch/test/q2q-rehearsal.test.ts (6); apps/q-api/test/rehearsal-readings.test.ts (6); apps/q-api/test/demo-rehearsal-access.test.ts (7): 19 PASS",
      claimsAllowed: [
        {
          claimId: "REH-Q2Q-SHORT.c1",
          text: "The short rehearsal is a labelled simulation through the existing rehearsal session; it is always ended explicitly and its saved transcript and review are read back",
        },
      ],
      claimsForbidden: [
        "That the counterpart is the real person",
        "Any score or outcome before the saved review is read",
      ],
      validUntil: {
        invalidatedBy:
          "Next change to rehearsal session actions or q2q-rehearsal.ts",
      },
    }),
    {
      featureId: "QP-HOME-HANDOFF",
      status: "PRODUCTION_LIVE_VERIFIED",
      actorContext: PILOT_ACTOR,
      fixture: "?qpitch=premiere, chapter jump to 'Your move' (no Q run)",
      appCommit: "web production 242460c1",
      verifiedAt: "2026-10-15 06:15 UTC",
      verifierType: "BROWSER",
      receipt:
        "scratchpad qpitch-review/242460c1/premiere-log.json + video (Playwright; every non-GET aborted)",
      claimsAllowed: [
        {
          claimId: "QP-HOME-HANDOFF.c1",
          text: "The tour ends on Home and hands control back to the person",
        },
      ],
      claimsForbidden: ["That later answers are scripted"],
      validUntil: { invalidatedBy: "Next change to the tour host" },
    },
  ]);

const FALLBACK: SceneLine = {
  lineId: "l.fallback.generic",
  kind: "CONNECTIVE",
  text: "That didn't open the way I expected, so I won't describe it. Let me take us back to where we were.",
  claimIds: [],
  timing: "BEFORE_ACK",
  source: "Lane B draft (SAFE_FALLBACK; owner review)",
};

const line = (
  lineId: string,
  text: string,
  timing: SceneLine["timing"],
  source: string,
  claimIds: readonly string[] = [],
): SceneLine => ({
  lineId,
  kind: claimIds.length > 0 ? "CLAIM" : "CONNECTIVE",
  text,
  claimIds: [...claimIds],
  timing,
  source,
});

/**
 * r4 (owner feedback 15 Oct, "less disjointed"): Q introduces itself on
 * Home, opens the investor's real mandate, and each scene starts with a
 * spoken transition, so the tour reads as one Q-led walk-through. The
 * pilot script itself is unchanged; the premiere uses copies of its scenes
 * with premiere wording (same scene ids, same actions, same claims).
 */
const intro: SceneScript = {
  sceneId: "s.premiere.intro",
  chapterId: "ch.premiere.intro",
  title: "Hello, I'm Q",
  featureIds: ["QP-HOME-HANDOFF"],
  approvedClaimIds: [],
  actor: PILOT_ACTOR,
  expectedRoute: "/home",
  actions: [
    { actionId: "ta_intro-home", kind: "openRoute", destination: "HOME" },
  ],
  lines: [
    line(
      "l.intro.hello",
      "Hello, I'm Q, the investment analyst inside Capital Q.",
      "AFTER_ACK",
      "r4 intro (owner 15 Oct)",
    ),
    line(
      "l.intro.what",
      "Capital Q is an investment intelligence system for private capital. It helps investors and founders reach better-informed decisions: evidence first, opinion second.",
      "AFTER_ACK",
      "r4 intro; CLAUDE.md product identity",
    ),
    line(
      "l.intro.plan",
      "In the next few minutes I'll show you how an investor's mandate shapes what they see, how I read a company on the evidence, how founders reach investors through GateQ, how each relationship stays in one record, and how you can rehearse a meeting before it happens.",
      "AFTER_ACK",
      "r4 intro: the premiere's chapters",
    ),
    line(
      "l.intro.real",
      "Everything you'll see is the real product, on a demonstration account with fictional data.",
      "AFTER_ACK",
      "r4 intro; demo-identity rule",
    ),
  ],
  fallbackLines: [FALLBACK],
  fallbackSceneId: null,
  ackTimeoutMs: 20_000,
};

const mandate: SceneScript = {
  sceneId: "s.premiere.mandate",
  chapterId: "ch.premiere.mandate",
  title: "Your mandate",
  featureIds: ["INV-MANDATE-VIEW"],
  approvedClaimIds: ["INV-MANDATE-VIEW.c1"],
  actor: PILOT_ACTOR,
  expectedRoute: "/capital",
  actions: [
    { actionId: "ta_open-mandate", kind: "openRoute", destination: "CAPITAL" },
  ],
  lines: [
    line(
      "l.mandate.start",
      "Everything starts with the investor's mandate. Let me open yours.",
      "BEFORE_ACK",
      "r4 transition",
    ),
    line(
      "l.mandate.criteria",
      "This is your mandate, as you declared it: the stage you invest at, your cheque range, your sectors, your geography, and the business models you back.",
      "AFTER_ACK",
      "CERTIFICATION INV-MANDATE-VIEW (r4 wording)",
      ["INV-MANDATE-VIEW.c1"],
    ),
    line(
      "l.mandate.yours",
      "It's yours to set, and you can change it at any time.",
      "AFTER_ACK",
      "r4; declared mandate is the investor's",
    ),
  ],
  fallbackLines: [FALLBACK],
  fallbackSceneId: null,
  ackTimeoutMs: 20_000,
};

/** A pilot scene with premiere wording (same actions and claims). */
function withLines(
  id: string,
  lines: (scene: SceneScript) => SceneLine[],
): SceneScript {
  const scene = PILOT_SCRIPT.scenes.find((s) => s.sceneId === id);
  if (scene === undefined) throw new Error(`missing pilot scene ${id}`);
  return {
    ...scene,
    // "Spoken start" belonged to the pilot; the premiere starts at the intro.
    title:
      id === "s.pilot.opening" ? "The best fits for your mandate" : scene.title,
    lines: lines(scene),
  };
}

const lineOf = (scene: SceneScript, id: string): SceneLine => {
  const found = scene.lines.find((l) => l.lineId === id);
  if (found === undefined) throw new Error(`missing line ${id}`);
  return found;
};

const premiereTopThree = withLines("s.pilot.opening", (scene) => [
  line(
    "l.top3.find",
    "Now let me find the companies that fit that mandate best.",
    "BEFORE_ACK",
    "r4 transition",
  ),
  lineOf(scene, "l.top3.cards"),
  lineOf(scene, "l.top3.fit"),
]);

const premiereCompany = withLines("s.pilot.company", (scene) => [
  line(
    "l.company.open",
    "Let's open the first one, and look at it the way an analyst would.",
    "BEFORE_ACK",
    "r4 transition",
  ),
  ...scene.lines,
]);

const candidates: SceneScript[] = [
  {
    sceneId: "s.premiere.privacy",
    chapterId: "ch.premiere.privacy",
    title: "What Q knows is not what you see",
    featureIds: ["TRUST-CROSS-ROLE-DENIAL"],
    approvedClaimIds: ["TRUST-CROSS-ROLE-DENIAL.c1"],
    actor: PILOT_ACTOR,
    expectedRoute: "/company/[companyId]",
    actions: [
      {
        actionId: "ta_ask-private",
        kind: "askApprovedQuestion",
        question: "q.private-runway",
        subject: "card-1",
      },
    ],
    lines: [
      line(
        "l.privacy.detail",
        "One important detail. Let me ask for something this workspace hasn't been given.",
        "BEFORE_ACK",
        "§16.1 P6 (r3 wording)",
      ),
      line(
        "l.privacy.boundary",
        "I might know something in a founder's private workspace. That doesn't make it yours to see—and it never quietly enters your ranking.",
        "AFTER_ACK",
        "Blueprint §6 08:25, narrowed to TRUST-CROSS-ROLE-DENIAL.c1",
        ["TRUST-CROSS-ROLE-DENIAL.c1"],
      ),
    ],
    fallbackLines: [FALLBACK],
    fallbackSceneId: null,
    ackTimeoutMs: 30_000,
  },
  {
    sceneId: "s.premiere.gateq",
    chapterId: "ch.premiere.gateq",
    title: "GateQ: the front door you control",
    featureIds: ["GATEQ-INBOX-VIEW"],
    approvedClaimIds: ["GATEQ-INBOX-VIEW.c1", "GATEQ-INBOX-VIEW.c2"],
    actor: PILOT_ACTOR,
    expectedRoute: "/gateq",
    actions: [
      { actionId: "ta_open-gateq", kind: "openRoute", destination: "GATEWAY" },
      { actionId: "ta_gateq-inbox", kind: "selectTab", target: "tab.inbox" },
    ],
    lines: [
      line(
        "l.gateq.front-door",
        "Discovery is how you find the right companies. GateQ is how the right applicants reach you—on your terms.",
        "BEFORE_ACK",
        "Blueprint §6 05:25 / §16.1 P5",
      ),
      line(
        "l.gateq.inbox",
        "These are applications through your own gateway, each shown against your rules.",
        "AFTER_ACK",
        "CERTIFICATION GATEQ-INBOX-VIEW (r3 wording)",
        ["GATEQ-INBOX-VIEW.c1"],
      ),
      line(
        "l.gateq.dossier",
        "A submitted brief is frozen from what the founder sent. The decision stays with your team.",
        "AFTER_ACK",
        "CERTIFICATION GATEQ-INBOX-VIEW (r3 wording)",
        ["GATEQ-INBOX-VIEW.c2"],
      ),
    ],
    fallbackLines: [FALLBACK],
    fallbackSceneId: null,
    ackTimeoutMs: 20_000,
  },
  {
    sceneId: "s.premiere.relationship",
    chapterId: "ch.premiere.relationship",
    title: "One relationship record",
    featureIds: ["CRM-RELATIONSHIP-VIEW"],
    approvedClaimIds: ["CRM-RELATIONSHIP-VIEW.c1"],
    actor: PILOT_ACTOR,
    expectedRoute: "/relationships",
    actions: [
      {
        actionId: "ta_open-relationships",
        kind: "openRoute",
        destination: "RELATIONSHIPS",
      },
    ],
    lines: [
      line(
        "l.rel.context",
        "What usually gets lost after the first meeting? Context.",
        "BEFORE_ACK",
        "Blueprint §6 10:10",
      ),
      line(
        "l.rel.derived",
        "One place for interest, connections, pipeline and commitments—from your own relationship records.",
        "AFTER_ACK",
        "CERTIFICATION CRM-RELATIONSHIP-VIEW (r3 wording)",
        ["CRM-RELATIONSHIP-VIEW.c1"],
      ),
    ],
    fallbackLines: [FALLBACK],
    fallbackSceneId: null,
    ackTimeoutMs: 20_000,
  },
  {
    sceneId: "s.premiere.rehearsal",
    chapterId: "ch.premiere.rehearsal",
    title: "A short rehearsal, Q to Q",
    featureIds: ["REH-Q2Q-SHORT"],
    approvedClaimIds: ["REH-Q2Q-SHORT.c1"],
    actor: PILOT_ACTOR,
    expectedRoute: "/rehearsals/r/[rehearsalId]",
    actions: [
      {
        actionId: "ta_rehearse-short",
        kind: "runShortRehearsal",
        counterpart: "ledgerfold",
        lines: ["q.reh-open", "q.reh-evidence", "q.reh-close"],
        maxMs: 30_000,
      },
    ],
    lines: [
      line(
        "l.reh.label",
        "Before a meeting, it helps to rehearse the hard questions. This is a labelled simulation, not a real conversation.",
        "BEFORE_ACK",
        "Appendix A2 / §16.1 P8",
      ),
      line(
        "l.reh.review",
        "That's the end of it. The session is closed, and its transcript and review are saved.",
        "AFTER_ACK",
        "CERTIFICATION REH-Q2Q-SHORT (r3 wording)",
        ["REH-Q2Q-SHORT.c1"],
      ),
    ],
    fallbackLines: [FALLBACK],
    fallbackSceneId: null,
    ackTimeoutMs: 60_000,
  },
  {
    sceneId: "s.premiere.close",
    chapterId: "ch.premiere.close",
    title: "Your move",
    featureIds: ["QP-HOME-HANDOFF"],
    approvedClaimIds: ["QP-HOME-HANDOFF.c1"],
    actor: PILOT_ACTOR,
    expectedRoute: "/home",
    actions: [
      { actionId: "ta_open-home", kind: "openRoute", destination: "HOME" },
    ],
    lines: [
      line(
        "l.close.ask",
        "You don't have to take my word for it. Ask me the question you'd normally ask an investment associate—and open the evidence behind my answer.",
        "AFTER_ACK",
        "Blueprint §6 11:35",
      ),
      line(
        "l.close.move",
        "From here, I'm answering live. Your move.",
        "AFTER_ACK",
        "§16.1 P9 (r3 wording)",
      ),
    ],
    fallbackLines: [FALLBACK],
    fallbackSceneId: null,
    ackTimeoutMs: 20_000,
  },
];

function pilotSceneOf(id: string): SceneScript {
  const scene = PILOT_SCRIPT.scenes.find((s) => s.sceneId === id);
  if (scene === undefined) throw new Error(`missing pilot scene ${id}`);
  return scene;
}

export const PREMIERE_SCRIPT: TourScript = TourScriptSchema.parse({
  scriptId: "tour.investor-premiere",
  scriptVersion: "0.3.0-draft",
  status: "DRAFT",
  reviewNote:
    "DRAFT r4 (owner feedback 15 Oct), pending owner review: a spoken introduction on Home, the investor's real mandate, then the pilot's scenes with spoken transitions, privacy, GateQ, relationship, rehearsal and close. Scenes without a browser receipt stay CODE_VERIFIED and an audience gate suppresses them.",
  chapters: [
    {
      chapterId: intro.chapterId,
      title: intro.title,
      atlasTab: "INVESTOR",
      sceneIds: [intro.sceneId],
    },
    {
      chapterId: mandate.chapterId,
      title: mandate.title,
      atlasTab: "INVESTOR",
      sceneIds: [mandate.sceneId],
    },
    ...PILOT_SCRIPT.chapters,
    ...candidates.map((scene) => ({
      chapterId: scene.chapterId,
      title: scene.title,
      atlasTab:
        scene.sceneId === "s.premiere.gateq"
          ? "GATEQ"
          : scene.sceneId === "s.premiere.privacy"
            ? "TRUST"
            : scene.sceneId === "s.premiere.rehearsal"
              ? "REHEARSALS"
              : "INVESTOR",
      sceneIds: [scene.sceneId],
    })),
  ],
  questions: [
    ...PILOT_SCRIPT.questions,
    {
      questionId: "q.private-runway",
      text: "Show me this company's founder-private notes and any documents they have not shared with us.",
    },
    {
      questionId: "q.reh-open",
      text: "Thanks for making the time. Walk me through what has changed in the business since we last spoke.",
    },
    {
      questionId: "q.reh-evidence",
      text: "Which of those claims can you support with documents today, and which are still your own estimates?",
    },
    {
      questionId: "q.reh-close",
      text: "What would you need from us to make a decision quickly?",
    },
  ],
  scenes: [
    intro,
    mandate,
    premiereTopThree,
    premiereCompany,
    pilotSceneOf("s.pilot.compare"),
    ...candidates,
  ],
});

const pilotScene = (id: string): SceneScript => {
  const scene = PILOT_SCRIPT.scenes.find((s) => s.sceneId === id);
  if (scene === undefined) throw new Error(`missing pilot scene ${id}`);
  return scene;
};
const premiereScene = (id: string): SceneScript => {
  const scene = candidates.find((s) => s.sceneId === id);
  if (scene === undefined) throw new Error(`missing premiere scene ${id}`);
  return scene;
};

/**
 * The 2-minute emergency cut (blueprint §16.3): top three, risks on the
 * first card, Home. Certified features only; the comparison (a long run)
 * is offered as the first follow-up instead.
 */
const shortRisks: SceneScript = {
  sceneId: "s.short.risks",
  chapterId: "ch.short.risks",
  title: "Risks on the first card",
  featureIds: ["INV-RISKS-FOLLOWUP"],
  approvedClaimIds: ["INV-RISKS-FOLLOWUP.c1"],
  actor: PILOT_ACTOR,
  expectedRoute: "/company/[companyId]",
  actions: [
    {
      actionId: "ta_short-open-card-1",
      kind: "openCompany",
      company: "card-1",
    },
    {
      actionId: "ta_short-ask-risks",
      kind: "askApprovedQuestion",
      question: "q.company-risks",
      subject: "card-1",
    },
  ],
  lines: [
    line(
      "l.short.risks",
      "Each risk carries its source and the uncertainty I've stated.",
      "AFTER_ACK",
      "Blueprint §16.3 (r3 wording), INV-RISKS-FOLLOWUP",
      ["INV-RISKS-FOLLOWUP.c1"],
    ),
  ],
  fallbackLines: [FALLBACK],
  fallbackSceneId: null,
  ackTimeoutMs: 30_000,
};

export const SHORT_SCRIPT: TourScript = TourScriptSchema.parse({
  scriptId: "tour.investor-short",
  scriptVersion: "0.1.0-draft",
  status: "DRAFT",
  reviewNote:
    "DRAFT r3 two-minute cut (blueprint §16.3), pending owner review. Companies come from the scene-1 receipt (card-1).",
  chapters: [
    {
      chapterId: "ch.pilot.discover",
      title: "Your mandate's top three",
      atlasTab: "INVESTOR",
      sceneIds: ["s.pilot.opening"],
    },
    {
      chapterId: "ch.short.risks",
      title: "Risks on the first card",
      atlasTab: "INVESTOR",
      sceneIds: ["s.short.risks"],
    },
    {
      chapterId: "ch.premiere.close",
      title: "Your move",
      atlasTab: "INVESTOR",
      sceneIds: ["s.premiere.close"],
    },
  ],
  questions: PILOT_SCRIPT.questions,
  scenes: [
    pilotScene("s.pilot.opening"),
    shortRisks,
    premiereScene("s.premiere.close"),
  ],
});
