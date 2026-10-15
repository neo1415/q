import { z } from "zod";

import {
  EvidenceStatusSchema,
  LifecycleStatusSchema,
  MarketplaceVisibilitySchema,
  TruthClassSchema,
} from "@capital-q/contracts";

/**
 * The Capital Q demo-founder knowledge pack (directive 2026-10-15 §E). It is
 * the bounded, versioned source set Q may answer from when an investor asks
 * about Capital Q itself after the tour.
 *
 * - **Sources:** only approved product specifications (locked PADL first) and
 *   the verified feature inventory (CERTIFICATION_MANIFEST.md).
 * - **Unknowns stay unknown.** No revenue, customers, funding, valuation,
 *   team or market size enters as fact. Each one is an explicit UNKNOWN entry
 *   that says so and offers a human follow-up.
 * - **ADR-001 axes:** truth class, evidence status and lifecycle stay
 *   separate.
 * - **This file is source material, not Q memory.** Reaching Q goes through
 *   the governed knowledge Write Gate and retrieval (Lane S / integration
 *   owner). Nothing here is injected into a prompt.
 */

export const PACK_TOPICS = [
  "POSITIONING",
  "PRINCIPLES",
  "Q",
  "TRUST",
  "GATEQ",
  "RELATIONSHIPS",
  "LIVE_FEATURES",
  "BUSINESS",
] as const;

export const PackSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("SPEC"),
      /** Repo path of the approved source text. */
      ref: z.string().regex(/^docs\/[A-Za-z0-9/_.-]+$/u),
      section: z.string().trim().min(1).max(120),
    })
    .strict(),
  z
    .object({
      kind: z.literal("CERTIFICATION"),
      featureId: z.string().regex(/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/u),
    })
    .strict(),
  /** No approved source: the entry records the absence. */
  z.object({ kind: z.literal("NONE") }).strict(),
]);

const DIGIT = /[0-9]/u;

export const PackEntrySchema = z
  .object({
    entryId: z.string().regex(/^kp\.[a-z0-9][a-z0-9.-]{1,62}$/u),
    topic: z.enum(PACK_TOPICS),
    statement: z.string().trim().min(1).max(600),
    truthClass: TruthClassSchema,
    evidenceStatus: EvidenceStatusSchema,
    lifecycleStatus: LifecycleStatusSchema,
    visibility: MarketplaceVisibilitySchema,
    source: PackSourceSchema,
    /** May Q present this as something the product does today? */
    liveCapability: z.boolean(),
  })
  .strict()
  .refine(
    (e) =>
      e.truthClass !== "UNKNOWN" ||
      (e.evidenceStatus === "NO_EVIDENCE" &&
        e.source.kind === "NONE" &&
        !e.liveCapability),
    {
      message: "an UNKNOWN has no evidence, no source and no capability claim",
    },
  )
  .refine((e) => e.source.kind !== "NONE" || e.truthClass === "UNKNOWN", {
    message: "only an UNKNOWN may lack a source",
  })
  .refine((e) => !e.liveCapability || e.source.kind === "CERTIFICATION", {
    message: "a live capability rests on a certification entry",
  })
  .refine(
    (e) => e.source.kind === "CERTIFICATION" || !DIGIT.test(e.statement),
    {
      message: "numbers come only from certified entries (no invented metrics)",
    },
  );
export type PackEntry = z.infer<typeof PackEntrySchema>;

export const KnowledgePackSchema = z
  .object({
    packId: z.literal("capital-q.demo-founder"),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$/u),
    status: z.enum(["PROPOSED", "OWNER_APPROVED"]),
    refreshedAt: z.iso.date(),
    /** Re-read the sources when any of these changes. */
    refreshOn: z.array(z.string().trim().min(1).max(200)).min(1).max(8),
    entries: z.array(PackEntrySchema).min(1).max(128),
  })
  .strict()
  .refine(
    (p) => new Set(p.entries.map((e) => e.entryId)).size === p.entries.length,
    {
      message: "entry ids are unique",
    },
  );
export type KnowledgePack = z.infer<typeof KnowledgePackSchema>;

const PADL =
  "docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt";
const SPEC =
  "docs/product-sources/text/Real_CAPITAL_Q_PRODUCT_SPECIFICATION.txt";
const GATEQ =
  "docs/product-sources/text/CapitalQ_GateQ_Product_Feature_Specification.txt";

/** Product design as Capital Q states it: the company's own claim, documented. */
const designed = {
  truthClass: "USER_CLAIM",
  evidenceStatus: "DOCUMENT_SUPPORTED",
  lifecycleStatus: "CURRENT",
  visibility: "public_external",
  liveCapability: false,
} as const;

/** Browser-verified on 13 Oct; re-certification due (blueprint §16). */
const certified = {
  truthClass: "VERIFIED",
  evidenceStatus: "PLATFORM_VERIFIED",
  lifecycleStatus: "STALE",
  visibility: "public_external",
  liveCapability: true,
} as const;

const unknown = {
  truthClass: "UNKNOWN",
  evidenceStatus: "NO_EVIDENCE",
  lifecycleStatus: "CURRENT",
  visibility: "public_external",
  source: { kind: "NONE" },
  liveCapability: false,
} as const;

const NOT_PROVIDED =
  "has not been provided as approved company material, so Q does not know it and will not estimate it. A human follow-up can answer it.";

export const CAPITAL_Q_KNOWLEDGE_PACK: KnowledgePack =
  KnowledgePackSchema.parse({
    packId: "capital-q.demo-founder",
    version: "0.1.0-proposed",
    status: "PROPOSED",
    refreshedAt: "2026-10-15",
    refreshOn: [
      "docs/product-sources/ text changes",
      "docs/specs/q-pitch/CERTIFICATION_MANIFEST.md changes",
      "owner supplies approved business material",
    ],
    entries: [
      {
        ...designed,
        entryId: "kp.category",
        topic: "POSITIONING",
        statement:
          "Capital Q is an AI-native Investment Intelligence Operating System for private capital. It is not a fundraising marketplace, investor directory, CRM, pitch deck repository or document management platform.",
        source: { kind: "SPEC", ref: PADL, section: "Decision #001 (locked)" },
      },
      {
        ...designed,
        entryId: "kp.purpose",
        topic: "POSITIONING",
        statement:
          "Its primary purpose is to generate trusted investment intelligence that enables better investment decisions while reducing information asymmetry between founders and investors.",
        source: { kind: "SPEC", ref: PADL, section: "Decision #001 (locked)" },
      },
      {
        ...designed,
        entryId: "kp.trust-principle",
        topic: "PRINCIPLES",
        statement: "Trust is Capital Q's primary product principle.",
        source: { kind: "SPEC", ref: PADL, section: "Decision #005" },
      },
      {
        ...designed,
        entryId: "kp.evidence-first",
        topic: "PRINCIPLES",
        statement: "Evidence always takes priority over opinion.",
        source: { kind: "SPEC", ref: PADL, section: "Decision #006" },
      },
      {
        ...designed,
        entryId: "kp.long-term",
        topic: "PRINCIPLES",
        statement:
          "Capital Q optimises for long-term investment relationships, not activity volume.",
        source: { kind: "SPEC", ref: PADL, section: "Decision #008" },
      },
      {
        ...designed,
        entryId: "kp.q-analyst",
        topic: "Q",
        statement:
          "Q is Capital Q's investment intelligence analyst and reasons like an institutional investment analyst; assessment precedes advice.",
        source: {
          kind: "SPEC",
          ref: PADL,
          section: "Decisions #009, #010, #012",
        },
      },
      {
        ...designed,
        entryId: "kp.asymmetry",
        topic: "POSITIONING",
        statement:
          "Capital Q is designed to reduce information asymmetry within private capital markets.",
        source: { kind: "SPEC", ref: SPEC, section: "3.1 What Capital Q Is" },
      },
      {
        ...designed,
        entryId: "kp.gateq-structure",
        topic: "GATEQ",
        statement:
          "Regardless of how a founder originally presents the company, GateQ converts the information into the same core structure, so investment teams can compare companies like-for-like.",
        source: {
          kind: "SPEC",
          ref: GATEQ,
          section: "Standardised Application Profile",
        },
      },
      {
        ...certified,
        entryId: "kp.live.top3",
        topic: "LIVE_FEATURES",
        statement:
          "Q ranks an investor's top three companies by mandate fit and shows exactly those three canonical companies as cards. Fit is not quality.",
        source: { kind: "CERTIFICATION", featureId: "INV-DISCOVER-TOP3" },
      },
      {
        ...certified,
        entryId: "kp.live.findings",
        topic: "LIVE_FEATURES",
        statement:
          "Q answers about a selected company with evidence-labelled findings bound to exactly that company.",
        source: { kind: "CERTIFICATION", featureId: "INV-PROFILE-FINDINGS" },
      },
      {
        ...certified,
        entryId: "kp.live.risks",
        topic: "LIVE_FEATURES",
        statement:
          "Q gives a sourced risk view with stated uncertainty on the same company. It is not a complete diligence.",
        source: { kind: "CERTIFICATION", featureId: "INV-RISKS-FOLLOWUP" },
      },
      {
        ...certified,
        entryId: "kp.live.compare",
        topic: "LIVE_FEATURES",
        statement:
          "Q compares two named canonical companies against the mandate in one table; a measure a company lacks shows 'Not recorded', never a low level.",
        source: { kind: "CERTIFICATION", featureId: "INV-COMPARE-TABLE" },
      },
      {
        ...unknown,
        entryId: "kp.unknown.revenue",
        topic: "BUSINESS",
        statement: `Capital Q's revenue ${NOT_PROVIDED}`,
      },
      {
        ...unknown,
        entryId: "kp.unknown.customers",
        topic: "BUSINESS",
        statement: `Capital Q's customers, paying users and pipeline ${NOT_PROVIDED}`,
      },
      {
        ...unknown,
        entryId: "kp.unknown.funding",
        topic: "BUSINESS",
        statement: `Capital Q's funding history, current round and valuation ${NOT_PROVIDED}`,
      },
      {
        ...unknown,
        entryId: "kp.unknown.pricing",
        topic: "BUSINESS",
        statement: `Capital Q's pricing and business model ${NOT_PROVIDED}`,
      },
      {
        ...unknown,
        entryId: "kp.unknown.unit-economics",
        topic: "BUSINESS",
        statement: `Capital Q's unit economics, margins and cost per workflow ${NOT_PROVIDED}`,
      },
      {
        ...unknown,
        entryId: "kp.unknown.market-size",
        topic: "BUSINESS",
        statement: `Capital Q's market size ${NOT_PROVIDED}`,
      },
      {
        ...unknown,
        entryId: "kp.unknown.team",
        topic: "BUSINESS",
        statement: `Capital Q's team and legal entity details ${NOT_PROVIDED}`,
      },
      {
        ...unknown,
        entryId: "kp.unknown.time-saved",
        topic: "BUSINESS",
        statement: `Any measured time or cost saving for investors ${NOT_PROVIDED}`,
      },
    ],
  });

/**
 * What Q may say about a topic. UNKNOWN entries are returned like any
 * other, so the answer states the gap instead of omitting it.
 */
export function packEntriesFor(
  pack: KnowledgePack,
  topic: PackEntry["topic"],
): readonly PackEntry[] {
  return pack.entries.filter((e) => e.topic === topic);
}
