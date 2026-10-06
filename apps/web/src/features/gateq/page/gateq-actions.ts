"use server";

import { z } from "zod";

import {
  archiveGateqApplications,
  assignGateqApplications,
  getGateqInboxItem,
  labelGateqApplications,
  listClaimableCompanies,
  noteGateqApplication,
  passGateqApplication,
  replyGateqApplication,
  requestCompanyClaim,
  saveStartupAlert,
  setGateqReplyPromise,
  starGateqApplications,
  discoverCompanies,
} from "@capital-q/api-client";
import {
  CompanyClaimRequestSchema,
  GateqInboxArchiveRequestSchema,
  GateqInboxAssignRequestSchema,
  GateqInboxLabelRequestSchema,
  GateqInboxNoteRequestSchema,
  GateqInboxPassRequestSchema,
  GateqInboxReplyRequestSchema,
  GateqInboxSettingsRequestSchema,
  GateqInboxStarRequestSchema,
  parseStartupDescription,
  StartupAlertRequestSchema,
  type ClaimableCompanyDto,
  type CompanyClaimResultDto,
  type GateqInboxDetailDto,
} from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * The GateQ page's server actions (F2-F4). Each validates at the trust
 * boundary and calls the API as the signed-in person; GateQ's own gateway
 * authority decides on the server. A refusal is one plain sentence.
 */

export type Done<T = null> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();
const FAILED = "That didn't go through. Please try again.";

async function withSession<T>(
  work: (
    session: NonNullable<Awaited<ReturnType<typeof apiSession>>>,
  ) => Promise<T>,
): Promise<Done<T>> {
  const session = await apiSession();
  if (session === null)
    return { ok: false, message: "Sign in again to carry on." };
  try {
    return { ok: true, value: await work(session) };
  } catch {
    return { ok: false, message: FAILED };
  }
}

export async function loadDetailAction(
  gatewayId: string,
  applicationId: string,
): Promise<Done<GateqInboxDetailDto>> {
  if (
    !Id.safeParse(gatewayId).success ||
    !Id.safeParse(applicationId).success
  ) {
    return { ok: false, message: FAILED };
  }
  return withSession((session) =>
    getGateqInboxItem(session, gatewayId, applicationId),
  );
}

export async function starAction(
  gatewayId: string,
  input: unknown,
): Promise<Done> {
  const parsed = GateqInboxStarRequestSchema.safeParse(input);
  if (!Id.safeParse(gatewayId).success || !parsed.success)
    return { ok: false, message: FAILED };
  return withSession(
    async (s) => (await starGateqApplications(s, gatewayId, parsed.data), null),
  );
}

export async function archiveAction(
  gatewayId: string,
  input: unknown,
): Promise<Done> {
  const parsed = GateqInboxArchiveRequestSchema.safeParse(input);
  if (!Id.safeParse(gatewayId).success || !parsed.success)
    return { ok: false, message: FAILED };
  return withSession(
    async (s) => (
      await archiveGateqApplications(s, gatewayId, parsed.data),
      null
    ),
  );
}

export async function labelAction(
  gatewayId: string,
  input: unknown,
): Promise<Done> {
  const parsed = GateqInboxLabelRequestSchema.safeParse(input);
  if (!Id.safeParse(gatewayId).success || !parsed.success)
    return { ok: false, message: FAILED };
  return withSession(
    async (s) => (
      await labelGateqApplications(s, gatewayId, parsed.data),
      null
    ),
  );
}

export async function assignAction(
  gatewayId: string,
  input: unknown,
): Promise<Done> {
  const parsed = GateqInboxAssignRequestSchema.safeParse(input);
  if (!Id.safeParse(gatewayId).success || !parsed.success)
    return { ok: false, message: FAILED };
  return withSession(
    async (s) => (
      await assignGateqApplications(s, gatewayId, parsed.data),
      null
    ),
  );
}

export async function noteAction(
  gatewayId: string,
  applicationId: string,
  input: unknown,
): Promise<Done> {
  const parsed = GateqInboxNoteRequestSchema.safeParse(input);
  if (
    !Id.safeParse(gatewayId).success ||
    !Id.safeParse(applicationId).success ||
    !parsed.success
  ) {
    return { ok: false, message: FAILED };
  }
  return withSession(
    async (s) => (
      await noteGateqApplication(s, gatewayId, applicationId, parsed.data),
      null
    ),
  );
}

/** Consequential: the exact words the person approved by pressing Send. */
export async function passAction(
  gatewayId: string,
  applicationId: string,
  input: unknown,
): Promise<Done> {
  const parsed = GateqInboxPassRequestSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "Pick a reason and write the message first." };
  if (
    !Id.safeParse(gatewayId).success ||
    !Id.safeParse(applicationId).success
  ) {
    return { ok: false, message: FAILED };
  }
  return withSession(
    async (s) => (
      await passGateqApplication(s, gatewayId, applicationId, parsed.data),
      null
    ),
  );
}

export async function replyAction(
  gatewayId: string,
  applicationId: string,
  input: unknown,
): Promise<Done> {
  const parsed = GateqInboxReplyRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Write the reply first." };
  if (
    !Id.safeParse(gatewayId).success ||
    !Id.safeParse(applicationId).success
  ) {
    return { ok: false, message: FAILED };
  }
  return withSession(
    async (s) => (
      await replyGateqApplication(s, gatewayId, applicationId, parsed.data),
      null
    ),
  );
}

export async function replyPromiseAction(
  gatewayId: string,
  input: unknown,
): Promise<Done> {
  const parsed = GateqInboxSettingsRequestSchema.safeParse(input);
  if (!Id.safeParse(gatewayId).success || !parsed.success)
    return { ok: false, message: FAILED };
  return withSession(
    async (s) => (await setGateqReplyPromise(s, gatewayId, parsed.data), null),
  );
}

export async function searchClaimableAction(
  text: string,
): Promise<Done<readonly ClaimableCompanyDto[]>> {
  const query = z.string().trim().min(2).max(120).safeParse(text);
  if (!query.success) return { ok: true, value: [] };
  return withSession(
    async (s) => (await listClaimableCompanies(s, query.data)).companies,
  );
}

export async function claimAction(
  companyId: string,
  input: unknown,
): Promise<Done<CompanyClaimResultDto>> {
  const parsed = CompanyClaimRequestSchema.safeParse(input);
  if (!Id.safeParse(companyId).success || !parsed.success) {
    return { ok: false, message: "Check the email and try again." };
  }
  return withSession((s) => requestCompanyClaim(s, companyId, parsed.data));
}

export type FoundStartup = {
  readonly companyId: string;
  readonly name: string;
  readonly oneLiner: string | null;
  readonly stage: string | null;
  readonly country: string | null;
};

/**
 * "Find a startup": the description, read deterministically, as Discover's
 * own filters over what this investor may already see. The mandate-ranked
 * slate stays the authority on who appears; no model decides.
 */
export async function findStartupsAction(
  description: string,
): Promise<Done<readonly FoundStartup[]>> {
  const text = z.string().trim().min(3).max(500).safeParse(description);
  if (!text.success)
    return { ok: false, message: "Describe the company in a few words." };
  const query = parseStartupDescription(text.data);
  return withSession(async (s) => {
    const slate = await discoverCompanies(s, {
      limit: 30,
      filters: query.filters,
    });
    const words = query.words;
    return slate.items
      .filter(
        (item) =>
          words.length === 0 ||
          words.some((word) =>
            `${item.canonicalName} ${item.shortDescription ?? ""}`
              .toLowerCase()
              .includes(word),
          ),
      )
      .slice(0, 20)
      .map((item) => ({
        companyId: item.companyId,
        name: item.canonicalName,
        oneLiner: item.shortDescription,
        stage: item.currentStageCode,
        country: item.headquartersCountry,
      }));
  });
}

export async function saveAlertAction(input: unknown): Promise<Done> {
  const parsed = StartupAlertRequestSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, message: "Describe the company in a few words." };
  return withSession(
    async (s) => (await saveStartupAlert(s, parsed.data), null),
  );
}
