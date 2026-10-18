import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type {
  ApplicationSummaryDto,
  PublicGatewayDto,
} from "@capital-q/contracts";

import {
  ApplyExperience,
  type ApplyPreview,
} from "@/features/gateq/apply-experience";
import { PolicyEditor } from "@/features/gateq/policy-editor";

export const metadata: Metadata = {
  title: "GateQ fit check",
  robots: { index: false },
};

/**
 * Every state of the "Do we fit? Ask Q" panel (P7), for design review and
 * the screenshot checks. Development only; nothing here calls the API.
 * `?state=intro|questions|thinking|fits|consent|partial|no|shared|error|limited`
 * (founder side) or `?state=mandate|drafted` (the investor's rules editor)
 * and `?layout=page` for the gateway page instead of the embed panel.
 */

const GATEWAY: PublicGatewayDto = {
  publicId: "gq_preview0000000000000000000",
  organisationDisplayName: "Demo Ridge Capital",
  title: "Do we fit? Ask Q about Demo Ridge Capital",
  description: "Fictional investor for previews.",
  inboundMode: "QUALIFIED",
  acceptingApplications: true,
  criteria: [
    { label: "Stage", requiredness: "REQUIRED", dimension: "STAGE" },
    {
      label: "Where you're based",
      requiredness: "REQUIRED",
      dimension: "GEOGRAPHY",
    },
    { label: "Sector", requiredness: "REQUIRED", dimension: "TAXONOMY" },
    {
      label: "Cheque size",
      requiredness: "PREFERRED",
      dimension: "CHEQUE_COMPATIBILITY",
    },
  ],
  publishedAt: "2026-10-05T09:00:00.000Z",
};

const application = (
  access: ApplicationSummaryDto["access"],
  unmet: string[],
  stillNeeded: string[],
): ApplicationSummaryDto => ({
  reference: "ga_preview",
  status: access === "MAY_APPLY" ? "READY_TO_SUBMIT" : "IN_PROGRESS",
  declaredName: "Lumen Pay (fictional)",
  facts: [
    {
      dimension: "company.name",
      summary: "Lumen Pay",
      provenance: "APPLICANT_PROVIDED",
    },
    {
      dimension: "company.stage",
      summary: "seed",
      provenance: "APPLICANT_PROVIDED",
    },
    {
      dimension: "company.country",
      summary: "NG",
      provenance: "APPLICANT_PROVIDED",
    },
    {
      dimension: "raise.amount",
      summary: "750000 USD",
      provenance: "APPLICANT_PROVIDED",
    },
  ],
  documentCount: 0,
  submittedAt: null,
  access,
  unmet,
  stillNeeded,
});

const CONVERSATION = [
  {
    from: "Q" as const,
    text: "Hi, I'm Q. I'll check whether you fit Demo Ridge Capital's mandate. What are you building, and where is the company based?",
  },
  {
    from: "YOU" as const,
    text: "Lumen Pay: merchant payments for informal retailers. We're in Lagos.",
  },
  {
    from: "Q" as const,
    text: "Thanks. What stage are you at, and how much are you raising?",
  },
  { from: "YOU" as const, text: "Seed, raising $750k." },
];

const STATES: Readonly<Record<string, ApplyPreview>> = {
  intro: { stage: "INTRO" },
  questions: {
    stage: "TALKING",
    lines: CONVERSATION.slice(0, 3),
    application: application("NEEDS_INFORMATION", [], ["Stage", "Cheque size"]),
  },
  thinking: {
    stage: "TALKING",
    lines: CONVERSATION,
    application: application("NEEDS_INFORMATION", [], ["Stage", "Cheque size"]),
    pending: true,
  },
  fits: {
    stage: "TALKING",
    lines: CONVERSATION,
    application: application("MAY_APPLY", [], []),
  },
  consent: {
    stage: "TALKING",
    lines: CONVERSATION,
    application: application("MAY_APPLY", [], []),
    consenting: true,
  },
  partial: {
    stage: "STOPPED",
    lines: CONVERSATION.slice(0, 2),
    application: application("NEEDS_INFORMATION", [], ["Stage", "Cheque size"]),
  },
  no: {
    stage: "TALKING",
    lines: CONVERSATION,
    application: application("MAY_NOT_APPLY", ["Where you're based"], []),
  },
  shared: {
    stage: "SHARED",
    lines: CONVERSATION,
    application: application("MAY_APPLY", [], []),
  },
  error: {
    stage: "TALKING",
    lines: CONVERSATION,
    application: application("NEEDS_INFORMATION", [], ["Stage"]),
    problem: {
      message: "Couldn't reach Capital Q just now. Please try again.",
      rateLimited: false,
    },
  },
  limited: {
    stage: "TALKING",
    lines: CONVERSATION,
    application: application("NEEDS_INFORMATION", [], ["Stage"]),
    problem: {
      message:
        "That's a lot in a short time. Give it a few minutes, then carry on.",
      rateLimited: true,
    },
  },
};

const MANDATE =
  "Demo Ridge Capital (fictional) invests $250k to $1.5m in pre-seed to Series A fintech and payments companies in West Africa and Kenya. We don't invest in online betting.";

const node = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const DRAFTED = {
  proposals: [
    {
      dimension: "STAGE" as const,
      requiredness: "REQUIRED" as const,
      label: "Stage",
      config: {
        type: "STAGE" as const,
        allowedStageCodes: ["pre_seed", "seed", "series_a"],
      },
      valueLabels: ["Pre-seed", "Seed", "Series A"],
      quote: MANDATE,
    },
    {
      dimension: "GEOGRAPHY" as const,
      requiredness: "REQUIRED" as const,
      label: "Where you're based",
      config: {
        type: "GEOGRAPHY" as const,
        allowedCountries: ["NG", "GH", "CI", "SN", "BJ", "TG", "KE"],
      },
      valueLabels: [
        "Nigeria",
        "Ghana",
        "Côte d'Ivoire",
        "Senegal",
        "Benin",
        "Togo",
        "Kenya",
      ],
      quote: MANDATE,
    },
    {
      dimension: "SECTOR" as const,
      requiredness: "REQUIRED" as const,
      label: "Sector",
      config: {
        type: "TAXONOMY" as const,
        vocabularyCode: "industry",
        allowedNodeIds: [node(1), node(2)],
      },
      valueLabels: ["Fintech", "Payments"],
      quote: MANDATE,
    },
    {
      dimension: "SECTOR" as const,
      requiredness: "REQUIRED" as const,
      label: "Sectors we don't fund",
      config: {
        type: "EXCLUDED_TAXONOMY" as const,
        vocabularyCode: "industry",
        excludedNodeIds: [node(3)],
      },
      valueLabels: ["Online betting"],
      quote: "We don't invest in online betting.",
    },
    {
      dimension: "CHEQUE" as const,
      requiredness: "PREFERRED" as const,
      label: "Cheque size",
      config: {
        type: "CHEQUE_COMPATIBILITY" as const,
        currency: "USD",
        minCheque: "250000",
        maxCheque: "1500000",
      },
      valueLabels: ["USD 250000–1500000"],
      quote: MANDATE,
    },
  ],
  notFound: [],
  excludedPlaces: [],
};

export default async function GateQPreviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const name = typeof params["state"] === "string" ? params["state"] : "intro";
  const preview: ApplyPreview = STATES[name] ?? { stage: "INTRO" };
  const page = params["layout"] === "page";
  if (name === "mandate" || name === "drafted") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 px-4 py-10">
        <h2 className="cq-title-sm text-(--cq-text-primary)">Your rules</h2>
        <PolicyEditor
          hasRules={false}
          preview={
            name === "mandate"
              ? { text: MANDATE }
              : { text: MANDATE, extraction: DRAFTED }
          }
        />
      </main>
    );
  }
  return page ? (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-10">
      <ApplyExperience key={name} gateway={GATEWAY} preview={preview} />
    </main>
  ) : (
    <main className="flex min-h-dvh w-full flex-col">
      <ApplyExperience key={name} gateway={GATEWAY} preview={preview} compact />
    </main>
  );
}
