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
  type Chapter,
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

/** Read-only views verified in a browser on production (GET only). */
function viewEntries(
  views: readonly {
    featureId: string;
    fixture: string;
    receipt: string;
    claims: readonly string[];
    forbidden: readonly string[];
  }[],
): CertificationEntry[] {
  return views.map((view) => ({
    featureId: view.featureId,
    status: "PRODUCTION_LIVE_VERIFIED",
    actorContext: PILOT_ACTOR,
    fixture: view.fixture,
    appCommit: "web production d6ae5e69",
    verifiedAt: "2026-10-15 13:28 UTC",
    verifierType: "BROWSER",
    receipt: view.receipt,
    claimsAllowed: view.claims.map((text, index) => ({
      claimId: `${view.featureId}.c${String(index + 1)}`,
      text,
    })),
    claimsForbidden: [...view.forbidden],
    validUntil: { invalidatedBy: `Next change to the ${view.featureId} page` },
  }));
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
    ...viewEntries([
      {
        featureId: "EXPLORE-VIEW",
        fixture: "/explore as Savanna Seed Partners (fictional demo investor)",
        receipt:
          "scratchpad qpitch-review/coverage/explore-savanna.png + pages-read.txt (Playwright, GET only)",
        claims: [
          "Explore searches companies, investors, people and pitches, and marks each pitch against the investor's mandate",
          "Pitch summaries in Explore are labelled as AI-presented and AI-generated",
        ],
        forbidden: ["That an AI presenter is the real founder"],
      },
      {
        featureId: "QWORK-VIEW",
        fixture: "/work as Savanna Seed Partners (fictional demo investor)",
        receipt:
          "scratchpad qpitch-review/coverage/work-savanna.png + pages-read.txt (Playwright, GET only)",
        claims: [
          "Q Work shows what needs the investor, what Q suggests next and what Q has done, and nothing is sent until the investor decides",
        ],
        forbidden: [
          "That Q sent anything during the tour",
          "Any count or cost on screen as a result",
        ],
      },
      {
        featureId: "DOCUMENTS-VIEW",
        fixture:
          "/documents as Savanna Seed Partners (fictional demo investor)",
        receipt:
          "scratchpad qpitch-review/coverage/documents-savanna.png + pages-read.txt (Playwright, GET only)",
        claims: [
          "Documents holds the firm's documents, including memos and briefs Q made, each marked with who can see it",
        ],
        forbidden: [
          "That a Q-made memo is verified analysis",
          "Opening a document's content",
        ],
      },
      {
        featureId: "DAILY-VIEW",
        fixture: "/daily as Savanna Seed Partners (fictional demo investor)",
        receipt:
          "scratchpad qpitch-review/coverage/daily-savanna.png + pages-read.txt (Playwright, GET only)",
        claims: [
          "The Q Daily is an edition written for the investor, following their mandate's sectors and stage, with each story's source named",
        ],
        forbidden: [
          "That a news story is verified by Capital Q",
          "Naming a story's companies as recommendations",
        ],
      },
    ]),
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
      featureId: "QP-SUBJECT",
      fixture:
        "Capital Q's own company record (CQ_Q_PITCH_SUBJECT_COMPANY_ID ee75a7d8-d457-4b59-9ad8-0d64b3026a3d), re-read per viewer",
      receipt:
        "apps/web/test/q-pitch-host.test.ts 'the tour's subject company' (2) PASS; browser receipt pending (production auth 504/500 at 13:48-13:51 UTC)",
      claimsAllowed: [
        {
          claimId: "QP-SUBJECT.c1",
          text: "The tour's subject company is Capital Q's own record on the platform, opened only when the viewer may read it",
        },
      ],
      claimsForbidden: [
        "The raise, valuation or any figure as verified (the USD 2,000,000 raise is the founder's claim)",
        "That Capital Q is assessed more favourably than other companies",
      ],
      validUntil: {
        invalidatedBy:
          "Next change to subject resolution or the subject record",
      },
    }),
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
      "In the next few minutes I'll show you how an investor's mandate shapes what they see, how I read a company on the evidence, how founders reach investors through GateQ, how each relationship stays in one record, the work I do for you, and how you can rehearse a meeting before it happens. You can stop me or jump ahead at any time.",
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

/** A short, navigation-only tour stop with one transition and its claims. */
function viewScene(input: {
  id: string;
  title: string;
  featureId: string;
  destination: "EXPLORE" | "WORK" | "DOCUMENTS" | "DAILY";
  route: string;
  before: string;
  after: readonly (readonly [string, readonly string[]])[];
}): SceneScript {
  const key = input.id.replace(/^s\.premiere\./u, "");
  return {
    sceneId: input.id,
    chapterId: `ch.premiere.${key}`,
    title: input.title,
    featureIds: [input.featureId],
    approvedClaimIds: input.after.flatMap(([, claims]) => [...claims]),
    actor: PILOT_ACTOR,
    expectedRoute: input.route,
    actions: [
      {
        actionId: `ta_open-${key}`,
        kind: "openRoute",
        destination: input.destination,
      },
    ],
    lines: [
      line(
        `l.${key}.start`,
        input.before,
        "BEFORE_ACK",
        "r4 coverage transition",
      ),
      ...input.after.map(([text, claims], index) =>
        line(
          `l.${key}.${String.fromCharCode(97 + index)}`,
          text,
          "AFTER_ACK",
          `CERTIFICATION ${input.featureId} (r4 wording)`,
          claims,
        ),
      ),
    ],
    fallbackLines: [FALLBACK],
    fallbackSceneId: null,
    ackTimeoutMs: 20_000,
  };
}

const explore = viewScene({
  id: "s.premiere.explore",
  title: "Explore the whole network",
  featureId: "EXPLORE-VIEW",
  destination: "EXPLORE",
  route: "/explore",
  before:
    "Beyond your recommendations, you can look across the whole network yourself.",
  after: [
    [
      "Explore searches companies, investors, people and pitches, and marks each pitch against your mandate.",
      ["EXPLORE-VIEW.c1"],
    ],
    [
      "The pitch videos are AI-presented summaries, and they're labelled that way.",
      ["EXPLORE-VIEW.c2"],
    ],
  ],
});

const work = viewScene({
  id: "s.premiere.work",
  title: "Q Work: what I do for you",
  featureId: "QWORK-VIEW",
  destination: "WORK",
  route: "/work",
  before: "Now, the work itself.",
  after: [
    [
      "This is what needs you, what I suggest next, and what I've already done. Nothing is sent until you decide.",
      ["QWORK-VIEW.c1"],
    ],
  ],
});

const documents = viewScene({
  id: "s.premiere.documents",
  title: "Your documents",
  featureId: "DOCUMENTS-VIEW",
  destination: "DOCUMENTS",
  route: "/documents",
  before: "When work turns into paper, it lands here.",
  after: [
    [
      "Your documents, including the memos and briefs I've drafted, each marked with who can see it.",
      ["DOCUMENTS-VIEW.c1"],
    ],
  ],
});

const daily = viewScene({
  id: "s.premiere.daily",
  title: "The Q Daily",
  featureId: "DAILY-VIEW",
  destination: "DAILY",
  route: "/daily",
  before: "And there's the Q Daily.",
  after: [
    [
      "An edition written for you, following your mandate's sectors and stage, with each story's source named.",
      ["DAILY-VIEW.c1"],
    ],
  ],
});

/**
 * Slice 8 (owner 15 Oct): the example company everyone recognises is Capital
 * Q itself, read by Q under the same rules as any company. Named only by
 * the server (`subject`), re-checked for the viewer; the scene falls back
 * honestly when there is no subject.
 */
const subjectScene: SceneScript = {
  sceneId: "s.premiere.subject",
  chapterId: "ch.premiere.subject",
  title: "Capital Q, on its own platform",
  featureIds: ["QP-SUBJECT", "INV-PROFILE-FINDINGS"],
  approvedClaimIds: ["QP-SUBJECT.c1", "INV-PROFILE-FINDINGS.c1"],
  actor: PILOT_ACTOR,
  expectedRoute: "/company/[companyId]",
  actions: [
    { actionId: "ta_open-subject", kind: "openCompany", company: "subject" },
    {
      actionId: "ta_ask-subject",
      kind: "askApprovedQuestion",
      question: "q.company-profile",
      subject: "subject",
    },
  ],
  lines: [
    line(
      "l.subject.open",
      "Now a company you'll recognise: Capital Q itself, on its own platform.",
      "BEFORE_ACK",
      "r4 slice 8",
      ["QP-SUBJECT.c1"],
    ),
    line(
      "l.subject.rules",
      "I read it by the same rules as every other company.",
      "BEFORE_ACK",
      "r4 slice 8",
    ),
    line(
      "l.subject.findings",
      "What the founders state, what documents support, and what is still unknown, kept apart. Their raise is their own claim until evidence says otherwise.",
      "AFTER_ACK",
      "CERTIFICATION INV-PROFILE-FINDINGS (r4 wording); QP-SUBJECT forbidden list",
      ["INV-PROFILE-FINDINGS.c1"],
    ),
  ],
  fallbackLines: [FALLBACK],
  fallbackSceneId: null,
  ackTimeoutMs: 45_000,
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

/**
 * A first GateQ conversation, Q to Q (owner 15 Oct, item 5): Q as the
 * investor and a labelled simulation of the fictional applicant Maji Loop,
 * through the same short-rehearsal path (one of the actor's own rehearsal
 * partners, resolved on the server). Short: two approved lines.
 */
const gateqInterview: SceneScript = {
  sceneId: "s.premiere.gateq-interview",
  chapterId: "ch.premiere.gateq-interview",
  title: "A first conversation with an applicant, Q to Q",
  featureIds: ["REH-Q2Q-SHORT"],
  approvedClaimIds: ["REH-Q2Q-SHORT.c1"],
  actor: PILOT_ACTOR,
  expectedRoute: "/rehearsals/r/[rehearsalId]",
  actions: [
    {
      actionId: "ta_gateq-q2q",
      kind: "runShortRehearsal",
      counterpart: "maji-loop",
      lines: ["q.gq-open", "q.gq-evidence"],
      maxMs: 45_000,
    },
  ],
  lines: [
    line(
      "l.gq.both",
      "Here's what a first conversation with an applicant can sound like. I'll play both sides: my own voice is the investor, the other voice is a labelled simulation of the founder, not the real person.",
      "BEFORE_ACK",
      "r4 (owner 15 Oct: Q plays both sides)",
    ),
    line(
      "l.gq.saved",
      "That's the end of it. The session is closed, and its transcript and review are saved.",
      "AFTER_ACK",
      "CERTIFICATION REH-Q2Q-SHORT (r3 wording)",
      ["REH-Q2Q-SHORT.c1"],
    ),
    line(
      "l.gq.decision",
      "The decision still stays with you.",
      "AFTER_ACK",
      "r4; GateQ authority",
    ),
  ],
  fallbackLines: [FALLBACK],
  fallbackSceneId: null,
  ackTimeoutMs: 120_000,
};

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
        lines: ["q.reh-open", "q.reh-evidence"],
        maxMs: 45_000,
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
        "l.reh.voices",
        "I'll play both sides: in my own voice, the investor; in the other voice, a simulation of the founder.",
        "BEFORE_ACK",
        "r4 (owner 15 Oct: Q plays both sides)",
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
    ackTimeoutMs: 120_000,
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

/**
 * What the audience may call each chapter aloud (slice 6, owner 15 Oct:
 * "show me GateQ", "go to the CRM part", "demo rehearsals").
 */
const SPOKEN_NAMES: Readonly<Record<string, readonly string[]>> = {
  "ch.premiere.intro": ["introduction", "intro", "the beginning", "start"],
  "ch.premiere.mandate": ["mandate", "my mandate", "investor mandate"],
  "ch.pilot.discover": [
    "top three",
    "discover",
    "discovery",
    "best fits",
    "recommendations",
    "matches",
  ],
  "ch.pilot.company": [
    "company",
    "company analysis",
    "analysis",
    "findings",
    "risks",
    "evidence",
  ],
  "ch.pilot.compare": ["comparison", "compare", "side by side"],
  "ch.premiere.privacy": ["privacy", "trust", "permissions", "private data"],
  "ch.premiere.gateq": [
    "gateq",
    "gate q",
    "gate",
    "applications",
    "inbox",
    "front door",
  ],
  "ch.premiere.relationship": [
    "crm",
    "relationships",
    "relationship",
    "pipeline",
    "investment hub",
  ],
  "ch.premiere.rehearsal": [
    "rehearsal",
    "rehearsals",
    "rehearse",
    "q to q",
    "practice",
    "meeting rehearsal",
  ],
  "ch.premiere.gateq-interview": [
    "gateq interview",
    "applicant conversation",
    "first conversation",
    "interview",
    "interviews",
  ],
  "ch.premiere.subject": [
    "capital q",
    "capital q itself",
    "your own company",
    "the subject company",
  ],
  "ch.premiere.explore": ["explore", "search", "the network", "find companies"],
  "ch.premiere.work": [
    "q work",
    "work",
    "tasks",
    "what q does",
    "agent",
    "agents",
  ],
  "ch.premiere.documents": ["documents", "memos", "files"],
  "ch.premiere.daily": ["q daily", "daily", "the daily", "news", "briefing"],
  "ch.premiere.close": ["the end", "your move", "close", "wrap up"],
};

function spoken<T extends { readonly chapterId: string }>(chapter: T): T {
  const names = SPOKEN_NAMES[chapter.chapterId];
  return names === undefined
    ? chapter
    : { ...chapter, spokenNames: [...names] };
}

function pilotSceneOf(id: string): SceneScript {
  const scene = PILOT_SCRIPT.scenes.find((s) => s.sceneId === id);
  if (scene === undefined) throw new Error(`missing pilot scene ${id}`);
  return scene;
}

const PREMIERE_SCENES: SceneScript[] = [
  intro,
  mandate,
  premiereTopThree,
  premiereCompany,
  pilotSceneOf("s.pilot.compare"),
  ...candidates.flatMap((scene) =>
    scene.sceneId === "s.premiere.privacy"
      ? [scene, subjectScene, explore]
      : scene.sceneId === "s.premiere.gateq"
        ? [scene, gateqInterview]
        : scene.sceneId === "s.premiere.relationship"
          ? [scene, work, documents, daily]
          : [scene],
  ),
];

const ATLAS_TAB: Readonly<Record<string, Chapter["atlasTab"]>> = {
  "ch.premiere.gateq": "GATEQ",
  "ch.premiere.gateq-interview": "GATEQ",
  "ch.premiere.privacy": "TRUST",
  "ch.premiere.rehearsal": "REHEARSALS",
  "ch.premiere.work": "Q_WORK",
  "ch.premiere.daily": "DAILY",
};

/** Chapters in scene order; a pilot chapter keeps the pilot's title. */
function premiereChapters(scenes: readonly SceneScript[]): Chapter[] {
  const chapters: Chapter[] = [];
  for (const scene of scenes) {
    const last = chapters.at(-1);
    if (last?.chapterId === scene.chapterId) {
      last.sceneIds.push(scene.sceneId);
      continue;
    }
    const pilot = PILOT_SCRIPT.chapters.find(
      (c) => c.chapterId === scene.chapterId,
    );
    chapters.push({
      chapterId: scene.chapterId,
      title: pilot?.title ?? scene.title,
      atlasTab: pilot?.atlasTab ?? ATLAS_TAB[scene.chapterId] ?? "INVESTOR",
      sceneIds: [scene.sceneId],
    });
  }
  return chapters;
}

export const PREMIERE_SCRIPT: TourScript = TourScriptSchema.parse({
  scriptId: "tour.investor-premiere",
  scriptVersion: "0.3.0-draft",
  status: "DRAFT",
  reviewNote:
    "DRAFT r4 (owner feedback 15 Oct), pending owner review: a spoken introduction on Home, the investor's real mandate, then the pilot's scenes with spoken transitions, privacy, GateQ, relationship, rehearsal and close. Scenes without a browser receipt stay CODE_VERIFIED and an audience gate suppresses them.",
  chapters: premiereChapters(PREMIERE_SCENES).map(spoken),
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
      questionId: "q.gq-open",
      text: "Thanks for applying. In two sentences, what does the business do, and why does it fit our mandate?",
    },
    {
      questionId: "q.gq-evidence",
      text: "What can you show us today that supports that, and what is still an estimate?",
    },
    {
      questionId: "q.reh-close",
      text: "What would you need from us to make a decision quickly?",
    },
  ],
  scenes: PREMIERE_SCENES,
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
