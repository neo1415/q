import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { PublicCardDto, PublicCardField } from "@capital-q/contracts";

import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";
import { fieldsForAudience } from "@/features/q-card/card-content";
import { PublicCardView } from "@/features/q-card/public-card-view";
import { qrSvg } from "@/features/q-card/qr";

// Read per request: the harness's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Q Card harness",
  robots: { index: false },
};

/**
 * The public Q Card (Q Story S6) with synthetic fixtures, for screenshots
 * and design review: no API, database or provider is reached. The audience
 * filter is the page's own (`fieldsForAudience`), so `?audience=public`
 * shows exactly what an anonymous scanner would get from this projection.
 *
 * Development only; a production build serves it only when
 * CQ_DEV_PREVIEW=1 is set on that server. `?subject=company|investor|person`,
 * `?audience=public|participant`, `?empty=1` (a company with nothing shared).
 */

const COMPANY_FIELDS: readonly PublicCardField[] = [
  {
    key: "shortDescription",
    value:
      "Cross-border freight booking for East African shippers: one quote, one tracking link, customs paperwork done before the truck leaves.",
    scope: "public_external",
  },
  { key: "currentStageCode", value: "seed", scope: "public_external" },
  { key: "headquartersCity", value: "Nairobi", scope: "public_external" },
  { key: "headquartersCountry", value: "KE", scope: "public_external" },
  {
    key: "websiteUrl",
    value: "https://kivu.example/",
    scope: "public_external",
  },
  {
    key: "tractionMetrics",
    value: "ARR, Customers, Growth",
    scope: "public_external",
    detail: {
      kind: "METRICS",
      metrics: [
        {
          label: "ARR",
          amount: "1240000",
          currency: "USD",
          unit: null,
          period: "As of Sep 2026",
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
        {
          label: "Customers",
          amount: "312",
          currency: null,
          unit: "customers",
          period: "As of Sep 2026",
          truthClass: "VERIFIED",
          evidenceStatus: "PLATFORM_VERIFIED",
        },
        {
          label: "Growth",
          amount: "18.5",
          currency: null,
          unit: "%",
          period: "As of Sep 2026",
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
        },
        {
          label: "Gross margin",
          amount: "41",
          currency: null,
          unit: "%",
          period: null,
          truthClass: "ESTIMATE",
          evidenceStatus: "SELF_REPORTED",
        },
      ],
    },
  },
  {
    key: "currentRaise",
    value: "2500000 USD",
    scope: "public_external",
    detail: {
      kind: "RAISE",
      stageCode: "seed",
      instrumentCode: "safe",
      target: { amount: "2500000", currency: "USD" },
      useOfFunds:
        "Two new corridors (Kampala, Kigali), a customs desk in Malaba, and six engineers.",
      targetCloseDate: "2026-12-31",
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
    },
  },
  {
    key: "relationshipSummary",
    value: "Connected: 6",
    scope: "network_visible",
    detail: {
      kind: "RELATIONSHIPS",
      stages: [
        { label: "Interest expressed", count: 9 },
        { label: "Connected", count: 6 },
        { label: "Met", count: 4 },
        { label: "In diligence", count: 2 },
      ],
    },
  },
  {
    key: "investabilitySummary",
    value: "Investable",
    scope: "network_visible",
    detail: {
      kind: "INTELLIGENCE",
      status: "ASSESSED",
      band: "Investable",
      confidence: "Moderate confidence",
      strengths: ["Traction", "Market", "Team"],
      areasScored: 9,
      areasTotal: 12,
      method: "FDN InvestIQ v1",
      assessedAt: "2026-10-18T09:00:00.000Z",
    },
  },
  {
    key: "team",
    value: "Amina Otieno, Joseph Mwangi",
    scope: "network_visible",
    detail: {
      kind: "TEAM",
      members: [
        { name: "Amina Otieno", role: "Co-founder, CEO" },
        { name: "Joseph Mwangi", role: "Co-founder, CTO" },
        { name: "Grace Wanjiru", role: "Head of Operations" },
        { name: "David Ochieng", role: null },
      ],
    },
  },
  {
    key: "documentsOnRequest",
    value: "3 documents",
    scope: "network_visible",
    detail: {
      kind: "DOCUMENTS",
      documents: [
        { title: "Pitch deck, Q3 2026", category: "Company" },
        { title: "Financial model 2026–2028", category: "Financials" },
        { title: "Customer contracts summary", category: "Commercial" },
      ],
    },
  },
  { key: "foundedDate", value: "2021-03-01", scope: "network_visible" },
];

const INVESTOR_FIELDS: readonly PublicCardField[] = [
  { key: "investorType", value: "VC", scope: "public_external" },
  {
    key: "publicDescription",
    value:
      "Seed and Series A investor in B2B software and logistics across East and West Africa.",
    scope: "public_external",
  },
  { key: "hqCountry", value: "KE", scope: "public_external" },
  {
    key: "websiteUrl",
    value: "https://savanna.example/",
    scope: "public_external",
  },
  {
    key: "mandateTypicalCheque",
    value: "$250K–$1.5M",
    scope: "public_external",
  },
  { key: "mandateStages", value: "Seed; Series A", scope: "public_external" },
  {
    key: "deploymentState",
    value: "ACTIVELY_INVESTING",
    scope: "public_external",
  },
  {
    key: "mandateSectors",
    value: "Logistics; B2B software; Fintech infrastructure",
    scope: "public_external",
  },
  {
    key: "mandateLookFor",
    value: "Repeat founders; Revenue before raise; Cross-border ambition",
    scope: "network_visible",
  },
  {
    key: "team",
    value: "Wanjiku Kamau",
    scope: "network_visible",
    detail: {
      kind: "TEAM",
      members: [
        { name: "Wanjiku Kamau", role: "Managing Partner" },
        { name: "Tunde Adeyemi", role: "Partner" },
      ],
    },
  },
];

const PERSON_FIELDS: readonly PublicCardField[] = [
  {
    key: "headline",
    value: "Backing East African logistics and B2B software from seed.",
    scope: "public_external",
  },
  { key: "roleTitle", value: "Managing Partner", scope: "public_external" },
  { key: "affiliation", value: "Savanna Ventures", scope: "public_external" },
  { key: "countryCode", value: "KE", scope: "network_visible" },
  {
    key: "personFocus",
    value: "Investment focus",
    scope: "public_external",
    detail: {
      kind: "FOCUS",
      side: "INVESTOR",
      organisationHandle: "savanna-ventures",
      fields: [
        { key: "mandateTypicalCheque", value: "$250K–$1.5M" },
        { key: "mandateStages", value: "Seed; Series A" },
        {
          key: "mandateSectors",
          value: "Logistics; B2B software; Fintech infrastructure",
        },
      ],
      raise: null,
    },
  },
];

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function QCardIdentityHarness({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const params = await searchParams;
  const subject = one(params["subject"]);
  const investor = subject === "investor";
  const person = subject === "person";
  const audience =
    one(params["audience"]) === "participant" ? "PARTICIPANT" : "PUBLIC";
  const empty = one(params["empty"]) === "1";
  const handle = person
    ? "wanjiku-kamau"
    : investor
      ? "savanna-ventures"
      : "kivu-freight";
  const projected: PublicCardDto = {
    kind: "CARD",
    handle,
    subjectType: person
      ? "PERSON"
      : investor
        ? "INVESTOR_ORGANISATION"
        : "COMPANY",
    name: person
      ? "Wanjiku Kamau"
      : investor
        ? "Savanna Ventures"
        : "Kivu Freight",
    fields: empty
      ? []
      : [
          ...(person
            ? PERSON_FIELDS
            : investor
              ? INVESTOR_FIELDS
              : COMPANY_FIELDS),
        ],
    verified: ["ORGANISATION_VERIFIED"],
    demoAttested: [],
    audience,
    indexable: false,
  };
  // What the API would hand this audience: the same filter the page applies.
  const card = { ...projected, fields: [...fieldsForAudience(projected)] };
  return (
    <main className="min-h-dvh bg-(--cq-canvas) text-(--cq-text-primary)">
      <PublicBrandStyle />
      <PublicCardView
        card={card}
        displayUrl={`capitalq.app/@${handle}`}
        qrSvg={qrSvg(`https://capitalq.app/@${handle}`)}
      />
    </main>
  );
}
