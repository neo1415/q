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
    codeEntry({
      featureId: "TRUST-CROSS-ROLE-DENIAL",
      fixture:
        "test fixtures only (q-firewall policy, q-tools discovery slate/visibility)",
      receipt:
        "packages/q-firewall/test/policy.test.ts (22); packages/q-tools/test/discovery-slate-network.test.ts (3); packages/q-tools/test/visibility-tools.test.ts (4): 29 PASS",
      claimsAllowed: [
        {
          claimId: "TRUST-CROSS-ROLE-DENIAL.c1",
          text: "Founder-private and investor-private scopes are owner-only or explicitly shared, and a founder-private company never enters an investor's discovery slate",
        },
      ],
      claimsForbidden: [
        "That Q's on-screen answer was a refusal, until a browser receipt shows it",
        "That nothing can ever leak",
      ],
      validUntil: {
        invalidatedBy:
          "Next change to q-firewall scope policy or discovery slate tools",
      },
    }),
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
        subject: "ledgerfold",
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

export const PREMIERE_SCRIPT: TourScript = TourScriptSchema.parse({
  scriptId: "tour.investor-premiere",
  scriptVersion: "0.2.0-draft",
  status: "DRAFT",
  reviewNote:
    "DRAFT r3 (blueprint §16), pending owner review. Scenes 1-3 are the pilot's certified scenes (re-certification due). GateQ, privacy, relationship, rehearsal and close are CODE_VERIFIED only; an audience gate suppresses them until browser receipts promote them. q.private-runway and the q.reh-* lines are new approved-question proposals.",
  chapters: [
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
  scenes: [...PILOT_SCRIPT.scenes, ...candidates],
});
