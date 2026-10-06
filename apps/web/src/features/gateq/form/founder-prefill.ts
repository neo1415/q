import "server-only";

import { getCompany, listDocuments } from "@capital-q/api-client";

import { getSessionUser } from "@/auth/session";
import { apiSession, resolveOwnContext } from "@/features/q/context";

import type { FormPrefill, Material } from "./form-model";

/**
 * What the GateQ form starts from for a signed-in founder (F1): their
 * company's profile and the documents they could choose to share. Nothing
 * here is sent anywhere: the form shows it, the founder changes what they
 * like, and only what they confirm and tick leaves when they press Send.
 */
export type FounderFormContext = {
  readonly signedIn: boolean;
  readonly prefill: FormPrefill | null;
  readonly needsCompany: boolean;
  readonly materials: readonly Material[];
};

const TYPE_WORDS: Readonly<Record<string, string>> = {
  PITCH_DECK: "Pitch deck",
  FINANCIAL_MODEL: "Financial model",
  MANAGEMENT_ACCOUNTS: "Management accounts",
  COMPANY_PROFILE: "Company profile",
  FINANCIAL: "Financials",
};

export async function founderFormContext(): Promise<FounderFormContext> {
  const user = await getSessionUser().catch(() => null);
  if (user === null) {
    return {
      signedIn: false,
      prefill: null,
      needsCompany: false,
      materials: [],
    };
  }
  const session = await apiSession();
  const context = await resolveOwnContext().catch(() => ({
    kind: "NONE" as const,
  }));
  if (session === null || context.kind !== "FOUNDER") {
    // An investor or a person with no company applies like anyone else.
    return {
      signedIn: true,
      prefill: null,
      needsCompany: context.kind === "NONE",
      materials: [],
    };
  }
  const [company, documents] = await Promise.all([
    getCompany(session, context.companyId).catch(() => null),
    listDocuments(session, { companyId: context.companyId, limit: 20 })
      .then((result) => result.documents)
      .catch(() => []),
  ]);
  const name = company?.canonicalName ?? context.label;
  if (name === null) {
    return { signedIn: true, prefill: null, needsCompany: true, materials: [] };
  }
  return {
    signedIn: true,
    needsCompany: false,
    prefill: {
      companyName: name,
      oneLiner: company?.shortDescription ?? null,
      stageCode: company?.currentStageCode ?? null,
      country: company?.headquartersCountry ?? null,
      contactName: null,
      contactEmail: user.email,
    },
    materials: documents
      .filter((document) => document.status !== "ARCHIVED")
      .slice(0, 10)
      .map((document) => ({
        id: document.id,
        name: document.title,
        detail: `${TYPE_WORDS[document.documentType] ?? "Document"} · only if you tick it`,
      })),
  };
}
