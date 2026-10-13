import { CertificationLedgerSchema, TourScriptSchema } from "./script.js";
import type { TourActor } from "./scene-evidence.js";
import type { CertificationLedger, SceneLine, TourScript } from "./script.js";

/**
 * P1 pilot (blueprint §11 P1): spoken start → Discover top three →
 * evidence-backed Q answer and comparison → pause/back (the director's
 * own controls).
 *
 * DRAFT, pending product-owner review (blueprint §15). It uses ONLY the
 * four CERTIFICATION_MANIFEST.md entries, and the blueprint §6 approved
 * lines for those scenes. Departures are marked in each line's `source`
 * and listed in `reviewNote`.
 */

/** The actor every certified entry was verified on. */
export const PILOT_ACTOR: TourActor = {
  role: "INVESTOR",
  account: "investor.savanna-seed@fictional.capitalq.local",
};

const RECEIPT =
  "private /tmp/cq-investor-demo-HZt53D (not committed); scripts/handoff/live/investor-demo-rehearsal.mjs";
const APP_COMMIT = "web 5ce3d76b; q-api c2f08536";
const VERIFIED_AT = "2026-10-13 ~16:50 UTC";

/**
 * Machine form of CERTIFICATION_MANIFEST.md (same entries, same fields).
 * The manifest stays the human ledger; the two must change together.
 */
export const PILOT_CERTIFICATION_LEDGER: CertificationLedger =
  CertificationLedgerSchema.parse([
    {
      featureId: "INV-DISCOVER-TOP3",
      status: "PRODUCTION_LIVE_VERIFIED",
      actorContext: PILOT_ACTOR,
      fixture:
        "Existing fictional seeded companies (Ledgerfold, F2, Ledgerline)",
      appCommit: APP_COMMIT,
      verifiedAt: VERIFIED_AT,
      verifierType: "BROWSER",
      receipt: RECEIPT,
      claimsAllowed: [
        {
          claimId: "INV-DISCOVER-TOP3.c1",
          text: "Q ranks the investor's top three by mandate fit and shows exactly those three canonical companies as cards",
        },
        {
          claimId: "INV-DISCOVER-TOP3.c2",
          text: "Single run: text 3.0 s, cards 3.1 s, settled 3.4 s",
        },
      ],
      claimsForbidden: ["Instant", "fit = quality", "any p95 claim"],
      validUntil: {
        invalidatedBy:
          "Next change to the model-gateway fit path or answer-canvas",
      },
    },
    {
      featureId: "INV-PROFILE-FINDINGS",
      status: "PRODUCTION_LIVE_VERIFIED",
      actorContext: PILOT_ACTOR,
      fixture: "Ledgerfold",
      appCommit: APP_COMMIT,
      verifiedAt: VERIFIED_AT,
      verifierType: "BROWSER",
      receipt: RECEIPT,
      claimsAllowed: [
        {
          claimId: "INV-PROFILE-FINDINGS.c1",
          text: "Q answers about the selected company with evidence-labelled findings and a reference to exactly that company",
        },
        {
          claimId: "INV-PROFILE-FINDINGS.c2",
          text: "7 findings; single run 5.5 s first text, 14.2 s settled",
        },
      ],
      claimsForbidden: [
        '"Verified" for founder-stated facts',
        "any fixed latency claim",
      ],
      validUntil: {
        invalidatedBy:
          "Next change to the analyst prompt/schema or result blocks",
      },
    },
    {
      featureId: "INV-RISKS-FOLLOWUP",
      status: "PRODUCTION_LIVE_VERIFIED",
      actorContext: PILOT_ACTOR,
      fixture: "Ledgerfold",
      appCommit: APP_COMMIT,
      verifiedAt: VERIFIED_AT,
      verifierType: "BROWSER",
      receipt: RECEIPT,
      claimsAllowed: [
        {
          claimId: "INV-RISKS-FOLLOWUP.c1",
          text: "Q gives a sourced risk view with findings and stated uncertainty, still bound to the same company",
        },
        {
          claimId: "INV-RISKS-FOLLOWUP.c2",
          text: "8 findings; 4.8 s / 13.9 s",
        },
      ],
      claimsForbidden: ["Diligence completeness"],
      validUntil: { invalidatedBy: "As INV-PROFILE-FINDINGS" },
    },
    {
      featureId: "INV-COMPARE-TABLE",
      status: "PRODUCTION_LIVE_VERIFIED",
      actorContext: PILOT_ACTOR,
      fixture: "Ledgerfold vs F2",
      appCommit: APP_COMMIT,
      verifiedAt: VERIFIED_AT,
      verifierType: "BROWSER",
      receipt: RECEIPT,
      claimsAllowed: [
        {
          claimId: "INV-COMPARE-TABLE.c1",
          text: "Q compares exactly the two named canonical companies against the mandate in one table",
        },
        {
          claimId: "INV-COMPARE-TABLE.c2",
          text: 'A measure a company lacks shows "Not recorded", never a low level',
        },
        {
          claimId: "INV-COMPARE-TABLE.c3",
          text: "Single run 14.2 s first text, 30.8 s settled",
        },
      ],
      claimsForbidden: ["Fast comparison", "ranking as quality"],
      validUntil: {
        invalidatedBy:
          "Next change to the comparison card builders or answer-canvas",
      },
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

export const PILOT_SCRIPT: TourScript = TourScriptSchema.parse({
  scriptId: "tour.investor-pilot",
  scriptVersion: "0.1.0-draft",
  status: "DRAFT",
  reviewNote:
    "DRAFT pending product-owner review (blueprint §15). Departures from §6: (1) the opening's 'you can interrupt me... calendar' sentence is held back until pause/interrupt is certified (QP-F09); (2) the §6 04:35 line 'every material point has a source and a confidence boundary' is narrowed to INV-RISKS-FOLLOWUP's allowed claim; (3) the top-three, comparison-outcome and fallback sentences are Lane B wording of manifest claimsAllowed; (4) askApprovedQuestion is PROPOSED r2 (QP-F01 §3). Questions are the exact ones of the certified browser run.",
  chapters: [
    {
      chapterId: "ch.pilot.discover",
      title: "Your mandate's top three",
      atlasTab: "INVESTOR",
      sceneIds: ["s.pilot.opening"],
    },
    {
      chapterId: "ch.pilot.company",
      title: "One company, on the evidence",
      atlasTab: "INVESTOR",
      sceneIds: ["s.pilot.company"],
    },
    {
      chapterId: "ch.pilot.compare",
      title: "Side by side against the mandate",
      atlasTab: "INVESTOR",
      sceneIds: ["s.pilot.compare"],
    },
  ],
  questions: [
    {
      questionId: "q.top-three",
      text: "Show my top 3 companies with scores against my mandate and explain why.",
    },
    {
      questionId: "q.company-profile",
      text: "What does this company actually do and why does it fit my mandate? Use its Capital Q records.",
    },
    {
      questionId: "q.company-risks",
      text: "What traction, material risks and missing evidence are on record for this company? Distinguish claims from verified facts.",
    },
    {
      // The host fills {companies} with the fixtures' authorised names.
      questionId: "q.compare-two",
      text: "Compare {companies} against my mandate. Show each company, known facts, mismatches and evidence gaps using the authorized Capital Q records.",
    },
  ],
  scenes: [
    {
      sceneId: "s.pilot.opening",
      chapterId: "ch.pilot.discover",
      title: "Spoken start and the top three",
      featureIds: ["INV-DISCOVER-TOP3"],
      approvedClaimIds: ["INV-DISCOVER-TOP3.c1"],
      actor: PILOT_ACTOR,
      expectedRoute: "/discover",
      actions: [
        {
          actionId: "ta_open-discover",
          kind: "openRoute",
          destination: "DISCOVER",
        },
        {
          actionId: "ta_ask-top-three",
          kind: "askApprovedQuestion",
          question: "q.top-three",
        },
      ],
      lines: [
        {
          lineId: "l.opening.hello",
          kind: "CONNECTIVE",
          text: "Hello. I'm Q. Usually, someone would show you twenty slides about how clever their platform is. I'd rather show you what it actually does.",
          claimIds: [],
          timing: "BEFORE_ACK",
          source: "Blueprint §6 00:00–00:40 (interruption sentence held back)",
        },
        {
          lineId: "l.opening.job",
          kind: "CONNECTIVE",
          text: "Capital Q has one job: help the right businesses and investors reach better-informed decisions with less wasted effort. Let's start with the difficult part—what an investor actually needs to know.",
          claimIds: [],
          timing: "BEFORE_ACK",
          source: "Blueprint §6 00:00–00:40",
        },
        {
          lineId: "l.top3.cards",
          kind: "CLAIM",
          text: "These are the three companies that fit your mandate best, each on its own card.",
          claimIds: ["INV-DISCOVER-TOP3.c1"],
          timing: "AFTER_ACK",
          source: "CERTIFICATION INV-DISCOVER-TOP3 (Lane B wording)",
        },
        {
          lineId: "l.top3.fit",
          kind: "CONNECTIVE",
          text: "Fit isn't the same thing as quality—and neither tells me you're interested.",
          claimIds: [],
          timing: "AFTER_ACK",
          source: "Blueprint §6 03:35–04:35",
        },
      ],
      fallbackLines: [FALLBACK],
      fallbackSceneId: null,
      ackTimeoutMs: 20_000,
    },
    {
      sceneId: "s.pilot.company",
      chapterId: "ch.pilot.company",
      title: "Findings and risks on one company",
      featureIds: ["INV-PROFILE-FINDINGS", "INV-RISKS-FOLLOWUP"],
      approvedClaimIds: ["INV-PROFILE-FINDINGS.c1", "INV-RISKS-FOLLOWUP.c1"],
      actor: PILOT_ACTOR,
      expectedRoute: "/company/[companyId]",
      actions: [
        {
          actionId: "ta_open-ledgerfold",
          kind: "openCompany",
          company: "ledgerfold",
        },
        {
          actionId: "ta_ask-profile",
          kind: "askApprovedQuestion",
          question: "q.company-profile",
          subject: "ledgerfold",
        },
        {
          actionId: "ta_ask-risks",
          kind: "askApprovedQuestion",
          question: "q.company-risks",
          subject: "ledgerfold",
        },
      ],
      lines: [
        {
          lineId: "l.company.present",
          kind: "CONNECTIVE",
          text: "A pitch is a claim about the future. An investment decision needs a view of the present.",
          claimIds: [],
          timing: "BEFORE_ACK",
          source: "Blueprint §6 02:30–03:35",
        },
        {
          lineId: "l.company.separate",
          kind: "CLAIM",
          text: "So I separate what the founder stated, what the documents support, what's missing, and what we haven't verified.",
          claimIds: ["INV-PROFILE-FINDINGS.c1"],
          timing: "BEFORE_ACK",
          source: "Blueprint §6 02:30–03:35",
        },
        {
          lineId: "l.company.unknown",
          kind: "CONNECTIVE",
          text: "The strongest answer isn't always a number. Sometimes it's a precise, useful 'we don't know yet.'",
          claimIds: [],
          timing: "AFTER_ACK",
          source: "Blueprint §6 02:30–03:35",
        },
        {
          lineId: "l.company.risks",
          kind: "CLAIM",
          text: "You shouldn't have to read everything to understand what matters. If you want to challenge my analysis, each risk here carries its source and the uncertainty I've stated.",
          claimIds: ["INV-RISKS-FOLLOWUP.c1"],
          timing: "AFTER_ACK",
          source:
            "Blueprint §6 04:35–05:25, narrowed to INV-RISKS-FOLLOWUP (owner review)",
        },
      ],
      fallbackLines: [FALLBACK],
      fallbackSceneId: null,
      ackTimeoutMs: 30_000,
    },
    {
      sceneId: "s.pilot.compare",
      chapterId: "ch.pilot.compare",
      title: "Two companies against the mandate",
      featureIds: ["INV-COMPARE-TABLE"],
      approvedClaimIds: ["INV-COMPARE-TABLE.c1", "INV-COMPARE-TABLE.c2"],
      actor: PILOT_ACTOR,
      expectedRoute: "/company/[companyId]",
      actions: [
        {
          actionId: "ta_compare-two",
          kind: "buildComparison",
          question: "q.compare-two",
          companies: ["ledgerfold", "f2"],
        },
      ],
      lines: [
        {
          lineId: "l.compare.intro",
          kind: "CONNECTIVE",
          text: "These companies aren't interchangeable. One may fit your cheque and stage. Another may have stronger recorded evidence but miss a key mandate condition.",
          claimIds: [],
          timing: "BEFORE_ACK",
          source: "Blueprint §6 03:35–04:35",
        },
        {
          lineId: "l.compare.table",
          kind: "CLAIM",
          text: "Here they are side by side against your mandate, in one table.",
          claimIds: ["INV-COMPARE-TABLE.c1"],
          timing: "AFTER_ACK",
          source: "CERTIFICATION INV-COMPARE-TABLE (Lane B wording)",
        },
        {
          lineId: "l.compare.not-recorded",
          kind: "CLAIM",
          text: "Where one of them has no record for a measure, it says 'Not recorded'. Unknown isn't a low score.",
          claimIds: ["INV-COMPARE-TABLE.c2"],
          timing: "AFTER_ACK",
          source:
            "CERTIFICATION INV-COMPARE-TABLE; blueprint §6 03:35 'unknown is not zero'",
        },
      ],
      fallbackLines: [FALLBACK],
      fallbackSceneId: null,
      // The certified single run settled at 30.8 s.
      ackTimeoutMs: 45_000,
    },
  ],
});
