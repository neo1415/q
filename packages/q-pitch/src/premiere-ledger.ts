import { PILOT_ACTOR, PILOT_CERTIFICATION_LEDGER } from "./pilot.js";
import {
  CertificationLedgerSchema,
  type CertificationEntry,
  type CertificationLedger,
} from "./script.js";

/**
 * The premiere's certification ledger: the browser and code receipts the
 * v5 premiere collected, kept as data after its tours were retired (v7
 * story, coordinator decision 21 Oct). The Q Story's PRODUCT claims rest
 * on these entries (story/claims.ts); nothing here is a tour any more.
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
    /** The acceptance run's browser receipt, when the scene passed on production. */
    live?: {
      readonly receipt: string;
      readonly commit: string;
      readonly at: string;
    },
  ): CertificationEntry => {
    const base = codeEntry({
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
    return live === undefined
      ? base
      : {
          ...base,
          status: "PRODUCTION_LIVE_VERIFIED",
          appCommit: live.commit,
          verifiedAt: live.at,
          verifierType: "BROWSER",
          receipt: live.receipt,
        };
  };
  const run3 = (scene: string) => ({
    receipt: `v5 acceptance run 3 (Playwright, savanna-seed, live): ${scene}; scratchpad v5-acc/run3`,
    commit: "web production f28ab37d (batch Q)",
    at: "2026-10-15 22:13 UTC",
  });
  const run4 = (scene: string) => ({
    receipt: `v5 acceptance run 4 (Playwright, savanna-seed, live): ${scene}; scratchpad v5-acc/run4`,
    commit: "web production 2c2010cb (batch S)",
    at: "2026-10-16 07:00 UTC",
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
      run4(
        'scene 3 complete: carousel.feed NEXT DONE twice; the pitch in focus is labelled "AI presenter · AI-generated" (scene-03.png)',
      ),
    ),
    entry(
      "FEED-SAVE",
      "Savanna saves the company in focus; /discover/saved",
      [
        "Saving puts the company in the investor's saved list, and saving is not interest: the company is not told",
      ],
      ["That the company was contacted"],
      run3(
        "scene 4 complete: button.feed-save DONE, /discover/saved shows the saved company under \"Saving isn't interest. The company isn't told.\" (scene-04.png)",
      ),
    ),
    entry(
      "GATEQ-DOSSIER-VIEW",
      "Maji Loop's submitted application in Savanna's own GateQ inbox (fictional)",
      [
        "An application through the investor's gate opens with the brief frozen from the founder's submission, its qualification against the firm's rules, the interview transcript and the dossier",
      ],
      ["A live interview", "That the founder's statements are verified"],
      run4(
        "scene 8 complete: Maji Loop (3 of 4 rules), Download pack and missing answers on screen; disclosure.gateq-transcript SCROLL_TO + EXPAND DONE, turns on screen (scene-08.png)",
      ),
    ),
    entry(
      "CRM-RECORD-VIEW",
      "Savanna's relationship with Clinicrest (fictional, connected)",
      [
        "A relationship record shows its stage and a dated history of what happened, each entry marked with who can see it",
      ],
      ["Any figure on screen as a Capital Q result"],
      {
        receipt:
          'v5 acceptance run 5 (Playwright, savanna-seed, live): scene 10 complete; section.relationship-history SCROLL_TO DONE, dated entries each marked "Only your side can see this" (scene-10.png); scratchpad v5-acc/run5',
        commit: "web production 7735ec77 (batches T+U)",
        at: "2026-10-16 09:19 UTC",
      },
    ),
    entry(
      "MEETING-PREP-VIEW",
      "The call-booking dialog on Savanna's Clinicrest relationship (opened, never submitted)",
      [
        "A call is booked from the relationship itself, through its own booking flow",
      ],
      ["That a call was booked or sent"],
      run3(
        "scene 11 complete: relationship opened, dialog.book-call OPEN DONE, Book a call dialog on screen; nothing booked (Google Calendar not connected, shown honestly) (scene-11.png)",
      ),
    ),
    entry(
      "DOCUMENT-OPEN",
      "Savanna's documents: the first, a memo Q made",
      ["A memo Q made opens in place, marked with who can see it"],
      ["That a Q-made memo is verified analysis"],
      run4(
        'scene 13 complete: By Q filter DONE (items marked "Only your team"), first memo opened in the document viewer in place (scene-13.png)',
      ),
    ),
    entry(
      "NOTIFICATIONS-VIEW",
      "Savanna's notification panel",
      [
        "The notification panel shows what needs the investor first, then updates",
      ],
      ["Any notification as a result Capital Q produced"],
      run3(
        "scene 14 complete: dialog.notifications OPEN DONE, panel lists updates by day (scene-14.png)",
      ),
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
    {
      featureId: "QP-SUBJECT",
      status: "PRODUCTION_LIVE_VERIFIED",
      actorContext: PILOT_ACTOR,
      fixture:
        "Capital Q's own company record (CQ_Q_PITCH_SUBJECT_COMPANY_ID ee75a7d8-d457-4b59-9ad8-0d64b3026a3d), re-read per viewer",
      appCommit:
        "web production 6d7b521d (release Y) + migration 20261228141700",
      verifiedAt: "2026-10-16 13:10 UTC",
      verifierType: "BROWSER",
      receipt:
        "v5 run 7 scene 16 complete; badge recheck on 6d7b521d as savanna-seed: profile and scene 16 show no verification badge, org standing REVOKED rev 3; scratchpad v5-acc/badge",
      claimsAllowed: [
        {
          claimId: "QP-SUBJECT.c1",
          text: "The tour's subject company is Capital Q's own record on the platform, opened only when the viewer may read it",
        },
      ],
      claimsForbidden: [
        "The raise, valuation or any figure as verified (the USD 2,000,000 raise is the founder's claim)",
        "That Capital Q is assessed more favourably than other companies",
        "Verified traction, customers, revenue or investors",
      ],
      validUntil: {
        invalidatedBy:
          "Next change to subject resolution or the subject record",
      },
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
