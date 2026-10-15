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

/**
 * Premiere v5 (owner override 16 Oct): the new visual beats. CODE_VERIFIED
 * until the browser acceptance run on the deployed SHA promotes them; the
 * receipts are the q-pitch tests and a read-only browser look (16 Oct).
 */
function v5Entries(): CertificationEntry[] {
  const entry = (
    featureId: string,
    fixture: string,
    claims: readonly string[],
    forbidden: readonly string[],
  ): CertificationEntry =>
    codeEntry({
      featureId,
      fixture,
      receipt:
        "packages/q-pitch/test/premiere.test.ts (v5); scratchpad qpitch-review/v5-look (read-only browser look, 16 Oct)",
      claimsAllowed: claims.map((text, index) => ({
        claimId: `${featureId}.c${String(index + 1)}`,
        text,
      })),
      claimsForbidden: [...forbidden],
      validUntil: { invalidatedBy: `Next change to the ${featureId} surface` },
    });
  return [
    entry(
      "FEED-VIEW",
      "Savanna's Discover feed (fictional companies with READY pitches)",
      [
        "Discover plays pitches one company at a time, and an AI presenter is labelled as one",
      ],
      [
        "That a presenter is the real founder",
        "Any ranking as a quality judgement",
      ],
    ),
    entry(
      "FEED-SAVE",
      "Savanna saves the company in focus; /discover/saved",
      [
        "Saving puts the company in the investor's saved list, and saving is not interest: the company is not told",
      ],
      ["That the company was contacted"],
    ),
    entry(
      "GATEQ-DOSSIER-VIEW",
      "Maji Loop's submitted application in Savanna's own GateQ inbox (fictional)",
      [
        "An application through the investor's gate opens with the brief frozen from the founder's submission, its qualification against the firm's rules, the interview transcript and the dossier",
      ],
      ["A live interview", "That the founder's statements are verified"],
    ),
    entry(
      "CRM-RECORD-VIEW",
      "Savanna's relationship with Clinicrest (fictional, connected)",
      [
        "A relationship record shows its stage and a dated history of what happened, each entry marked with who can see it",
      ],
      ["Any figure on screen as a Capital Q result"],
    ),
    entry(
      "MEETING-PREP-VIEW",
      "The call-booking dialog on Savanna's Clinicrest relationship (opened, never submitted)",
      [
        "A call is booked from the relationship itself, through its own booking flow",
      ],
      ["That a call was booked or sent"],
    ),
    entry(
      "DOCUMENT-OPEN",
      "Savanna's documents: the first, a memo Q made",
      ["A memo Q made opens in place, marked with who can see it"],
      ["That a Q-made memo is verified analysis"],
    ),
    entry(
      "NOTIFICATIONS-VIEW",
      "Savanna's notification panel",
      [
        "The notification panel shows what needs the investor first, then updates",
      ],
      ["Any notification as a result Capital Q produced"],
    ),
  ];
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
      featureId: "DATAROOM-VIEW",
      status: "PRODUCTION_LIVE_VERIFIED",
      actorContext: PILOT_ACTOR,
      fixture:
        "Harbourline Cargo (fictional) data room as Savanna Seed Partners, connected through express interest + founder accept (q-pitch-demo-access.mjs, 15 Oct)",
      appCommit: "web production a52754b1",
      verifiedAt: "2026-10-15 14:40 UTC",
      verifierType: "BROWSER",
      receipt:
        "scratchpad qpitch-review/fictional/harbourline-dataroom-savanna.png + harbourline-dataroom-read.txt (GET + tab click); demo-access-run.json",
      claimsAllowed: [
        {
          claimId: "DATAROOM-VIEW.c1",
          text: "Once connected, the investor sees the company's data room: each listed document shows its level, public ones open now and the others on request",
        },
      ],
      claimsForbidden: [
        "That documents marked shared-only or private are visible",
        "That a document's content is verified",
      ],
      validUntil: {
        invalidatedBy: "Next change to data-room access or levels",
      },
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
    ...v5Entries(),
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

/**
 * Owner decision 15 Oct: the two scenes after the top three open NAMED
 * fictional companies with a playable pitch (DEMO_COMPANIES), presented as
 * "a company with a pitch", never as a mandate rank. The ranking itself is
 * untouched (scene 1 still shows whatever it returns).
 */
const pilotCompany = PILOT_SCRIPT.scenes.find(
  (s) => s.sceneId === "s.pilot.company",
);
if (pilotCompany === undefined) throw new Error("missing s.pilot.company");

const pilotCompare = PILOT_SCRIPT.scenes.find(
  (s) => s.sceneId === "s.pilot.compare",
);
if (pilotCompare === undefined) throw new Error("missing s.pilot.compare");
const premiereCompare: SceneScript = {
  ...pilotCompare,
  title: "Two companies with pitches, side by side",
  actions: [
    {
      actionId: "ta_compare-two",
      kind: "buildComparison",
      question: "q.compare-two",
      companies: ["harbourline-cargo", "clinicrest"],
    },
  ],
  lines: pilotCompare.lines.map((l) =>
    l.lineId === "l.compare.intro"
      ? line(
          "l.compare.intro",
          "Let me put Harbourline Cargo next to another company with a pitch, Clinicrest, against your mandate.",
          "BEFORE_ACK",
          "owner decision 15 Oct (named fictional companies)",
        )
      : l,
  ),
};

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
  "ch.premiere.feed": ["pitches", "the feed", "discover feed", "videos"],
  "ch.premiere.save": ["save", "saved", "saved companies"],
  "ch.premiere.crm-record": [
    "relationship record",
    "clinicrest",
    "history",
    "the record",
  ],
  "ch.premiere.meeting": ["meeting", "meetings", "book a call", "calls"],
  "ch.premiere.notifications": ["notifications", "approvals", "what needs me"],
  "ch.premiere.capital-q": [
    "capital q",
    "capital q itself",
    "your own company",
    "fundraising",
  ],
  "ch.atlas.risks": ["risk analysis", "the risks chapter"],
  "ch.premiere.subject": [
    "capital q analysis",
    "q on capital q",
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

// ---------------------------------------------------------------------------
// Premiere v5 (owner override 16 Oct): one continuous investor tour of the
// strongest demos, 5 to 7 minutes; deeper material is in the Atlas script.
// Every visual step is a deterministic, receipted act (never a model).
// ---------------------------------------------------------------------------

const introV5: SceneScript = {
  ...intro,
  lines: [
    line(
      "l.intro.hello",
      "Hello, I'm Q, the investment analyst inside Capital Q.",
      "AFTER_ACK",
      "v5 intro",
    ),
    line(
      "l.intro.what",
      "Capital Q is an investment intelligence system for private capital. Its purpose is trusted investment intelligence: better decisions, and less information asymmetry between founders and investors.",
      "AFTER_ACK",
      "knowledge pack kp.category, kp.purpose, kp.asymmetry (PADL #001)",
    ),
    line(
      "l.intro.rules",
      "Two rules run through everything: evidence comes before opinion, and the aim is long-term relationships, not activity.",
      "AFTER_ACK",
      "knowledge pack kp.evidence-first, kp.long-term (PADL #006, #008)",
    ),
    line(
      "l.intro.plan",
      "I'll show you discovery, analysis, GateQ, the relationship record, the work I do for you and a short rehearsal, on a demonstration account with fictional companies. Stop me, or jump ahead, at any time.",
      "AFTER_ACK",
      "v5 intro: the tour's chapters",
    ),
  ],
};

const feedV5: SceneScript = {
  sceneId: "s.premiere.feed",
  chapterId: "ch.premiere.feed",
  title: "Discover: pitches, one at a time",
  featureIds: ["FEED-VIEW"],
  approvedClaimIds: ["FEED-VIEW.c1"],
  actor: PILOT_ACTOR,
  expectedRoute: "/discover",
  actions: [
    { actionId: "ta_open-feed", kind: "openRoute", destination: "DISCOVER" },
    {
      actionId: "ta_feed-next",
      kind: "uiAct",
      act: "NEXT",
      target: "carousel.feed",
    },
    {
      actionId: "ta_feed-next-2",
      kind: "uiAct",
      act: "NEXT",
      target: "carousel.feed",
    },
  ],
  lines: [
    line(
      "l.feed.start",
      "Now to Discover, where you meet companies through their pitches.",
      "BEFORE_ACK",
      "v5 transition",
    ),
    line(
      "l.feed.view",
      "Each pitch plays here, one company at a time, and an AI presenter is labelled as one.",
      "AFTER_ACK",
      "CERTIFICATION FEED-VIEW (v5 wording)",
      ["FEED-VIEW.c1"],
    ),
  ],
  fallbackLines: [FALLBACK],
  fallbackSceneId: null,
  ackTimeoutMs: 30_000,
};

const saveV5: SceneScript = {
  sceneId: "s.premiere.save",
  chapterId: "ch.premiere.save",
  title: "Save one for later",
  featureIds: ["FEED-SAVE"],
  approvedClaimIds: ["FEED-SAVE.c1"],
  actor: PILOT_ACTOR,
  expectedRoute: "/discover/saved",
  actions: [
    {
      actionId: "ta_feed-save",
      kind: "uiAct",
      act: "ACTIVATE",
      target: "button.feed-save",
    },
    { actionId: "ta_open-saved", kind: "openRoute", destination: "SAVED" },
  ],
  lines: [
    line("l.save.keep", "I'll keep this one for later.", "BEFORE_ACK", "v5"),
    line(
      "l.save.effect",
      "It's in your saved list now. Saving isn't interest: the company isn't told.",
      "AFTER_ACK",
      "CERTIFICATION FEED-SAVE (v5 wording)",
      ["FEED-SAVE.c1"],
    ),
  ],
  fallbackLines: [FALLBACK],
  fallbackSceneId: null,
  ackTimeoutMs: 20_000,
};

const companyV5: SceneScript = {
  ...pilotCompany,
  title: "A company with a pitch, on the evidence",
  featureIds: ["INV-PROFILE-FINDINGS", "DATAROOM-VIEW"],
  approvedClaimIds: ["INV-PROFILE-FINDINGS.c1", "DATAROOM-VIEW.c1"],
  actions: [
    {
      actionId: "ta_open-harbourline",
      kind: "openCompany",
      company: "harbourline-cargo",
    },
    {
      actionId: "ta_ask-profile",
      kind: "askApprovedQuestion",
      question: "q.company-profile",
      subject: "harbourline-cargo",
    },
    { actionId: "ta_open-deck", kind: "selectTab", target: "tab.deck" },
    { actionId: "ta_open-dataroom", kind: "selectTab", target: "tab.dataroom" },
  ],
  lines: [
    line(
      "l.company.open",
      "Let's open a company with a pitch: Harbourline Cargo, a fictional demo company. I'll read it the way an analyst would.",
      "BEFORE_ACK",
      "v5 (named fictional company)",
    ),
    lineOf(pilotCompany, "l.company.separate"),
    lineOf(pilotCompany, "l.company.unknown"),
    line(
      "l.company.dataroom",
      "Its deck and its data room are here too. You're connected, so each document shows its level: the public ones open now, the rest on request.",
      "AFTER_ACK",
      "CERTIFICATION DATAROOM-VIEW (v5 wording)",
      ["DATAROOM-VIEW.c1"],
    ),
  ],
};

const gateqAppV5: SceneScript = {
  sceneId: "s.premiere.gateq",
  chapterId: "ch.premiere.gateq",
  title: "GateQ: the front door you control",
  featureIds: ["GATEQ-INBOX-VIEW", "GATEQ-DOSSIER-VIEW"],
  approvedClaimIds: ["GATEQ-INBOX-VIEW.c1", "GATEQ-DOSSIER-VIEW.c1"],
  actor: PILOT_ACTOR,
  expectedRoute: "/gateq",
  actions: [
    {
      actionId: "ta_open-application",
      kind: "openRecord",
      record: "GATEQ_APPLICATION",
      key: "maji-loop-application",
    },
  ],
  lines: [
    line(
      "l.gateq.front-door",
      "Discovery is how you find companies. GateQ is how the right applicants reach you, on your terms.",
      "BEFORE_ACK",
      "Blueprint §6 05:25 / v5",
    ),
    line(
      "l.gateq.inbox",
      "These are applications through your own gateway, each shown against your rules.",
      "AFTER_ACK",
      "CERTIFICATION GATEQ-INBOX-VIEW",
      ["GATEQ-INBOX-VIEW.c1"],
    ),
    line(
      "l.gateq.dossier",
      "Maji Loop applied through your gate. Its brief is frozen from what the founder sent, next to its qualification against your rules, the interview transcript and the dossier.",
      "AFTER_ACK",
      "CERTIFICATION GATEQ-DOSSIER-VIEW (v5 wording)",
      ["GATEQ-DOSSIER-VIEW.c1"],
    ),
    line(
      "l.gateq.decision",
      "The decision stays with your team.",
      "AFTER_ACK",
      "v5; GateQ authority",
    ),
  ],
  fallbackLines: [FALLBACK],
  fallbackSceneId: null,
  ackTimeoutMs: 25_000,
};

const crmRecordV5: SceneScript = {
  sceneId: "s.premiere.crm-record",
  chapterId: "ch.premiere.crm-record",
  title: "One relationship, its whole history",
  featureIds: ["CRM-RECORD-VIEW"],
  approvedClaimIds: ["CRM-RECORD-VIEW.c1"],
  actor: PILOT_ACTOR,
  expectedRoute: "/relationships/company/[companyId]",
  actions: [
    {
      actionId: "ta_open-relationship",
      kind: "openRecord",
      record: "RELATIONSHIP",
      key: "clinicrest",
    },
  ],
  lines: [
    line("l.crm.open", "Here's one of them: Clinicrest.", "BEFORE_ACK", "v5"),
    line(
      "l.crm.history",
      "Where the relationship stands, and everything that happened, in order, each entry marked with who can see it.",
      "AFTER_ACK",
      "CERTIFICATION CRM-RECORD-VIEW (v5 wording)",
      ["CRM-RECORD-VIEW.c1"],
    ),
  ],
  fallbackLines: [FALLBACK],
  fallbackSceneId: null,
  ackTimeoutMs: 25_000,
};

const meetingV5: SceneScript = {
  sceneId: "s.premiere.meeting",
  chapterId: "ch.premiere.meeting",
  title: "Preparing a meeting",
  featureIds: ["MEETING-PREP-VIEW"],
  approvedClaimIds: ["MEETING-PREP-VIEW.c1"],
  actor: PILOT_ACTOR,
  expectedRoute: "/relationships/company/[companyId]",
  actions: [
    {
      actionId: "ta_open-booking",
      kind: "openRecord",
      record: "RELATIONSHIP_CALLS",
      key: "clinicrest",
    },
  ],
  lines: [
    line("l.meeting.ready", "Ready to meet?", "BEFORE_ACK", "v5"),
    line(
      "l.meeting.flow",
      "A call is booked from the relationship itself, through its own booking flow.",
      "AFTER_ACK",
      "CERTIFICATION MEETING-PREP-VIEW (v5 wording)",
      ["MEETING-PREP-VIEW.c1"],
    ),
    line(
      "l.meeting.yours",
      "I can prepare it, but nothing is sent until you confirm.",
      "AFTER_ACK",
      "v5; human approval for consequential actions",
    ),
  ],
  fallbackLines: [FALLBACK],
  fallbackSceneId: null,
  ackTimeoutMs: 25_000,
};

const documentsV5: SceneScript = {
  ...documents,
  featureIds: ["DOCUMENTS-VIEW", "DOCUMENT-OPEN"],
  approvedClaimIds: ["DOCUMENTS-VIEW.c1", "DOCUMENT-OPEN.c1"],
  actions: [
    ...documents.actions,
    {
      actionId: "ta_open-first-document",
      kind: "uiAct",
      act: "SELECT_ITEM",
      target: "list.documents",
      index: 1,
    },
  ],
  lines: [
    ...documents.lines,
    line(
      "l.documents.open",
      "Here's one I drafted, open in place, marked for your team only.",
      "AFTER_ACK",
      "CERTIFICATION DOCUMENT-OPEN (v5 wording)",
      ["DOCUMENT-OPEN.c1"],
    ),
  ],
};

const notificationsV5: SceneScript = {
  sceneId: "s.premiere.notifications",
  chapterId: "ch.premiere.notifications",
  title: "What needs you",
  featureIds: ["NOTIFICATIONS-VIEW"],
  approvedClaimIds: ["NOTIFICATIONS-VIEW.c1"],
  actor: PILOT_ACTOR,
  expectedRoute: "/documents",
  actions: [
    {
      actionId: "ta_open-notifications",
      kind: "uiAct",
      act: "OPEN",
      target: "dialog.notifications",
    },
  ],
  lines: [
    line(
      "l.notifications.open",
      "And when something needs you, it waits here.",
      "BEFORE_ACK",
      "v5",
    ),
    line(
      "l.notifications.view",
      "What needs you comes first, then the updates.",
      "AFTER_ACK",
      "CERTIFICATION NOTIFICATIONS-VIEW (v5 wording)",
      ["NOTIFICATIONS-VIEW.c1"],
    ),
  ],
  fallbackLines: [FALLBACK],
  fallbackSceneId: null,
  ackTimeoutMs: 20_000,
};

const capitalQV5: SceneScript = {
  sceneId: "s.premiere.capital-q",
  chapterId: "ch.premiere.capital-q",
  title: "Capital Q, on its own platform",
  featureIds: ["QP-SUBJECT"],
  approvedClaimIds: ["QP-SUBJECT.c1"],
  actor: PILOT_ACTOR,
  expectedRoute: "/company/[companyId]",
  actions: [
    { actionId: "ta_open-capital-q", kind: "openCompany", company: "subject" },
  ],
  lines: [
    line(
      "l.capq.open",
      "One more company you'll recognise.",
      "BEFORE_ACK",
      "v5",
    ),
    line(
      "l.capq.itself",
      "Capital Q itself, on its own platform.",
      "AFTER_ACK",
      "CERTIFICATION QP-SUBJECT",
      ["QP-SUBJECT.c1"],
    ),
    line(
      "l.capq.claims",
      "Its fundraising details are the founders' own statements, and they're shown as claims, like anyone else's.",
      "AFTER_ACK",
      "v5; QP-SUBJECT forbidden list (no figure as verified)",
    ),
  ],
  fallbackLines: [FALLBACK],
  fallbackSceneId: null,
  ackTimeoutMs: 20_000,
};

const atlasRisks: SceneScript = {
  ...pilotCompany,
  sceneId: "s.atlas.risks",
  chapterId: "ch.atlas.risks",
  title: "Risks, on the evidence",
  featureIds: ["INV-RISKS-FOLLOWUP"],
  approvedClaimIds: ["INV-RISKS-FOLLOWUP.c1"],
  actions: [
    {
      actionId: "ta_atlas-open-harbourline",
      kind: "openCompany",
      company: "harbourline-cargo",
    },
    {
      actionId: "ta_atlas-ask-risks",
      kind: "askApprovedQuestion",
      question: "q.company-risks",
      subject: "harbourline-cargo",
    },
  ],
  lines: [lineOf(pilotCompany, "l.company.risks")],
};

const premiereScene = (id: string): SceneScript => {
  const scene = candidates.find((s) => s.sceneId === id);
  if (scene === undefined) throw new Error(`missing premiere scene ${id}`);
  return scene;
};

const rehearsalV5: SceneScript = (() => {
  const scene = premiereScene("s.premiere.rehearsal");
  return {
    ...scene,
    actions: [
      // Whatever the previous scene left open is closed first.
      {
        actionId: "ta_close-notifications",
        kind: "uiAct",
        act: "CLOSE",
        target: "dialog.notifications",
      },
      ...scene.actions,
    ],
  };
})();

const closeV5: SceneScript = (() => {
  const scene = premiereScene("s.premiere.close");
  return {
    ...scene,
    lines: [
      line(
        "l.close.recap",
        "That's Capital Q: the right companies found faster, read on the evidence, and every relationship kept in one record.",
        "AFTER_ACK",
        "v5 close",
      ),
      ...scene.lines,
    ],
  };
})();

/** The main cut: the strongest demos, in one continuous Q-led walk. */
const MAIN_SCENES: SceneScript[] = [
  introV5,
  mandate,
  feedV5,
  saveV5,
  premiereTopThree,
  companyV5,
  premiereCompare,
  gateqAppV5,
  premiereScene("s.premiere.relationship"),
  crmRecordV5,
  meetingV5,
  work,
  documentsV5,
  notificationsV5,
  rehearsalV5,
  capitalQV5,
  closeV5,
];

/** The Atlas: the main cut plus the deeper chapters, each in its place. */
const ATLAS_SCENES: SceneScript[] = MAIN_SCENES.flatMap((scene) =>
  scene.sceneId === "s.premiere.save"
    ? [scene, explore]
    : scene.sceneId === "s.pilot.company"
      ? [scene, atlasRisks]
      : scene.sceneId === "s.pilot.compare"
        ? [scene, premiereScene("s.premiere.privacy")]
        : scene.sceneId === "s.premiere.gateq"
          ? [scene, gateqInterview]
          : scene.sceneId === "s.premiere.documents"
            ? [scene, daily]
            : scene.sceneId === "s.premiere.capital-q"
              ? [scene, subjectScene]
              : [scene],
);

const ATLAS_TAB: Readonly<Record<string, Chapter["atlasTab"]>> = {
  "ch.premiere.gateq": "GATEQ",
  "ch.premiere.gateq-interview": "GATEQ",
  "ch.premiere.privacy": "TRUST",
  "ch.premiere.rehearsal": "REHEARSALS",
  "ch.premiere.work": "Q_WORK",
  "ch.premiere.daily": "DAILY",
  "ch.premiere.crm-record": "INVESTOR",
  "ch.premiere.meeting": "MEETINGS",
  "ch.premiere.notifications": "Q_WORK",
  "ch.atlas.risks": "INVESTOR",
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

const PREMIERE_QUESTIONS = [
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
];

export const PREMIERE_SCRIPT: TourScript = TourScriptSchema.parse({
  scriptId: "tour.investor-premiere",
  scriptVersion: "0.5.0-draft",
  status: "DRAFT",
  reviewNote:
    "DRAFT v5 (owner override 16 Oct): one continuous Q-led investor tour, 5 to 7 minutes: Home intro and proposition, mandate, Discover pitches and a save, the top three, a company with deck and data room, a comparison, a GateQ application with its dossier, the CRM and one relationship, a meeting prepared, Q Work, a Q-made document, notifications, a short Q-to-Q rehearsal, Capital Q's own profile, and the hand-over. Deeper chapters are in the Atlas script.",
  chapters: premiereChapters(MAIN_SCENES).map(spoken),
  questions: PREMIERE_QUESTIONS,
  scenes: MAIN_SCENES,
});

/** The Feature Atlas: every chapter, the deeper ones included. */
export const ATLAS_SCRIPT: TourScript = TourScriptSchema.parse({
  scriptId: "tour.investor-atlas",
  scriptVersion: "0.5.0-draft",
  status: "DRAFT",
  reviewNote:
    "DRAFT v5 Feature Atlas: the premiere's chapters plus the deeper ones (Explore, risks, privacy, a GateQ Q-to-Q, the Q Daily, Q's reading of Capital Q). Same gate and ledger as the premiere.",
  chapters: premiereChapters(ATLAS_SCENES).map(spoken),
  questions: PREMIERE_QUESTIONS,
  scenes: ATLAS_SCENES,
});

const pilotScene = (id: string): SceneScript => {
  const scene = PILOT_SCRIPT.scenes.find((s) => s.sceneId === id);
  if (scene === undefined) throw new Error(`missing pilot scene ${id}`);
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
