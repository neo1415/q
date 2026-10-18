import { z } from "zod";

/**
 * Q Pitch v6, founder track: Capital Q presented by Q on the owner's
 * fourteen-section template (FOUNDER_PROFILE_SECTIONS, 16 Oct), the same
 * structure every founder's Overview uses. The page /q-pitch/capital-q
 * renders exactly this, and the narration lights each section while it
 * speaks about it, so screen and voice cannot drift apart.
 *
 * Honest by construction (owner, 16 Oct): Capital Q is pre-seed and
 * bootstrapping. No traction, customers, revenue, investors, market size
 * or team size is stated; what is not known says so. Every section names
 * the repository sources it is drawn from (a test checks they exist), and
 * the only figure, the raise, is labelled as the founders' own claim.
 */

const PADL =
  "docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt";
const SPEC =
  "docs/product-sources/text/Real_CAPITAL_Q_PRODUCT_SPECIFICATION.txt";
const GATEQ =
  "docs/product-sources/text/CapitalQ_GateQ_Product_Feature_Specification.txt";
const LANDING = "docs/ai-handoff/LANDING-PROMISES.md";
const INVESTIQ = "docs/ai-handoff/INVESTIQ-METHODOLOGY.md";
const RECS =
  "docs/architecture/19_Capital_Q_Discovery_Matching_Recommendation_Architecture.md";

export const PitchSectionSchema = z
  .object({
    /** Stable key; the section's anchor is `fdr.02.pitch.<key>`. */
    key: z.string().regex(/^[a-z][a-z-]{1,30}$/u),
    title: z.string().trim().min(1).max(60),
    /** One line, shown while the section is closed. */
    summary: z.string().trim().min(1).max(160),
    /** Short paragraphs or points, shown open. Plain words. */
    points: z.array(z.string().trim().min(1).max(320)).min(1).max(5),
    /**
     * How sure this is, in the ADR-001 sense: the company's own documented
     * design (USER_CLAIM), or explicitly not known (UNKNOWN).
     */
    standing: z.enum(["DOCUMENTED", "FOUNDER_CLAIM", "NOT_KNOWN"]),
    sources: z.array(z.string().trim().min(5).max(200)).min(1).max(4),
  })
  .strict();
export type PitchSection = z.infer<typeof PitchSectionSchema>;

export const CAPITAL_Q_PITCH_STAGE =
  "Pre-seed · bootstrapping · demonstration data where companies appear";

export const CAPITAL_Q_PITCH: readonly PitchSection[] = z
  .array(PitchSectionSchema)
  .length(14)
  .parse([
    {
      key: "opportunity",
      title: "Opportunity and Economics",
      summary:
        "Private capital runs on fragmented information. Capital Q turns it into trusted, comparable intelligence.",
      points: [
        "Private capital markets are inefficient because business information is fragmented, inconsistent and difficult to evaluate.",
        "Capital Q exists to reduce that information asymmetry, for investors and founders at once.",
        "Market size and unit economics have not been provided as approved company material, so they are not stated here, and Q will not estimate them.",
      ],
      standing: "DOCUMENTED",
      sources: [
        `${PADL} Decision #001`,
        `${PADL} purpose`,
        "packages/q-pitch/src/knowledge-pack.ts kp.unknown.market-size",
      ],
    },
    {
      key: "problem",
      title: "The Problem",
      summary:
        "The problem isn't a lack of opportunities. It's finding the right ones.",
      points: [
        "Every business presents itself differently, so every new investment means starting from scratch.",
        "Too much time searching, too much time screening, too many opportunities missed.",
        "Founders cannot see what stops them from raising, or which investors genuinely fit them.",
      ],
      standing: "DOCUMENTED",
      sources: [`${LANDING} LP-05 to LP-07`, `${SPEC} 3.1`],
    },
    {
      key: "solution",
      title: "Solution",
      summary:
        "An AI-native investment intelligence operating system, with one analyst, Q, at its centre.",
      points: [
        "Capital Q is not a marketplace, a CRM, a directory or a document store. Its product is trusted investment intelligence.",
        "Q reasons like an institutional investment analyst: evidence first, opinion second, and assessment before advice.",
        "Investors find what fits their mandate; founders become investable and reach the investors most likely to back them.",
      ],
      standing: "DOCUMENTED",
      sources: [`${PADL} Decisions #001, #009, #010`, `${SPEC} 3.1`],
    },
    {
      key: "how-it-works",
      title: "How It Works",
      summary:
        "Q learns, assesses, matches, qualifies and connects, in one standard structure.",
      points: [
        "Q learns each investor's thesis and onboards each business through a conversation, from the materials it already has.",
        "It turns every company into the same structure and assesses it on its evidence, and shows the founder what to improve next.",
        "Investors see the companies that fit their declared mandate; founders see the investors whose published criteria they meet.",
        "Through GateQ, investors set the bar, Q interviews applicants first, and the first meeting starts with alignment, not discovery.",
      ],
      standing: "DOCUMENTED",
      sources: [`${LANDING} LP-14 to LP-20`, `${GATEQ} overview`],
    },
    {
      key: "business-model",
      title: "Business Model",
      summary:
        "Layered: diagnosis first, paid strategic intelligence on top. Ranking is never for sale.",
      points: [
        "Diagnosis is the core: Q assesses, explains and benchmarks, because trust comes first.",
        "Deeper strategic intelligence, such as a capital readiness blueprint, is the paid layer; specialist human execution is optional on top.",
        "There is no pay-to-rank, ever. Price levels are not set yet.",
      ],
      standing: "DOCUMENTED",
      sources: [`${PADL} Decision #85`, `${RECS} no pay-to-rank`],
    },
    {
      key: "vision",
      title: "Our Vision",
      summary:
        "The institutional operating system for private capital markets.",
      points: [
        "Rather than a standalone marketplace, CRM, data room or fundraising tool, Capital Q is designed as the operating system both sides of private capital work in.",
        "It optimises for long-term investment relationships, not activity volume.",
      ],
      standing: "DOCUMENTED",
      sources: [`${PADL} Decisions #69, #008`],
    },
    {
      key: "team",
      title: "Our Team",
      summary:
        "Not the subject of this pitch right now. No claims about its size.",
      points: [
        "Capital Q comes from FDN Capital Partners. The founders speak for the team themselves; Q makes no claim about who or how many.",
      ],
      standing: "NOT_KNOWN",
      sources: [
        `${LANDING} capture notes (FDN Capital Partners)`,
        "packages/q-pitch/src/knowledge-pack.ts kp.unknown.team",
      ],
    },
    {
      key: "go-to-market",
      title: "Go-to-Market Strategy",
      summary:
        "Offered through FDN Capital Partners, with a waitlist and demos for both sides.",
      points: [
        "Investors and businesses join through a waitlist or a demo.",
        "The plan beyond that is for the founders to set out; Q does not state it as fact.",
      ],
      standing: "DOCUMENTED",
      sources: [`${LANDING} LP-04`],
    },
    {
      key: "competition",
      title: "Competitive Landscape",
      summary:
        "Incumbents are CRMs, marketplaces, directories and document stores. Capital Q is none of them.",
      points: [
        "Generic AI assistants can summarise a deck, but hold no canonical, permissioned record and no evidence status.",
        "Capital Q's category is investment intelligence: one trusted, comparable view of each opportunity, built for both sides.",
      ],
      standing: "DOCUMENTED",
      sources: [`${PADL} Decision #001`, `${SPEC} 3.1`],
    },
    {
      key: "moats",
      title: "Moats",
      summary:
        "Trusted structure, not the model: canonical records, evidence on every fact, history that compounds.",
      points: [
        "One canonical record per company, per investor and per relationship, so both sides work from the same truth.",
        "Evidence and provenance on every fact; unknown stays unknown; founder-private data never shapes what an investor sees.",
        "InvestIQ, FDN's proprietary assessment framework, and relationship history that compounds with use.",
      ],
      standing: "DOCUMENTED",
      sources: [
        `${PADL} Decision #85`,
        `${LANDING} LP-25`,
        `${INVESTIQ} two scores`,
      ],
    },
    {
      key: "roadmap",
      title: "Roadmap",
      summary:
        "What you are seeing is the working core. The full system is specified; sequencing is the founders' to set.",
      points: [
        "The product specification and the locked architecture decision log define the whole system.",
        "This tour shows only what works today, on the real product, with demonstration companies labelled as such.",
      ],
      standing: "DOCUMENTED",
      sources: [`${SPEC} scope`, `${PADL} decision log`],
    },
    {
      key: "why-now",
      title: "Why Us? Why Now?",
      summary:
        "AI can now read like an analyst, at a cost every investor and founder can reach.",
      points: [
        "AI can now read a deck, a pitch and a data room and reason over them like an analyst, at a cost that makes it available beyond the largest firms.",
        "Deal flow keeps growing while investors' time does not: the bottleneck has moved from finding opportunities to understanding them quickly and fairly.",
        "Capital Q was built evidence-first from day one: trust is its primary product principle, and evidence always takes priority over opinion.",
      ],
      standing: "DOCUMENTED",
      sources: [
        `${LANDING} LP-01, LP-05 to LP-07`,
        `${PADL} Decisions #005, #006`,
      ],
    },
    {
      key: "ask",
      title: "Our Ask",
      summary: "A USD 2 million raise, as the founders state it.",
      points: [
        "Capital Q's record states a USD 2 million raise. It is the founders' own claim, shown as a claim like anyone else's.",
        "Terms and use of funds are for the founders to discuss directly.",
      ],
      standing: "FOUNDER_CLAIM",
      sources: ["Capital Q company record (raise: founder claim)"],
    },
    {
      key: "closing",
      title: "Closing",
      summary: "Evidence before opinion. Trust over engagement.",
      points: [
        "Capital Q reduces investment uncertainty and optimises for qualified investment relationships, not activity.",
      ],
      standing: "DOCUMENTED",
      sources: [`${PADL} Decisions #005, #006, #008`],
    },
  ]);

/** The anchor id of a pitch section on the founder track's step two. */
export function pitchSectionAnchor(key: string): `fdr.02.pitch.${string}` {
  return `fdr.02.pitch.${key}`;
}
