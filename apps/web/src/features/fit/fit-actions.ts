"use server";

import { z } from "zod";

import { getFitProfiles, getFitQView, getFitTop } from "@capital-q/api-client";
import {
  FIT_IDS_MAX,
  type FitComparisonDto,
  type FitCompanyDto,
  type QViewDto,
} from "@capital-q/contracts";

import { qApiSession } from "@/features/q/context";

/**
 * Fit with the reader's own mandate, read through the Q API under their
 * own session (ADR 0052). Server actions so the token stays on the
 * server. Ids are input, never proof: the Q API answers only for companies
 * this reader may see. Every failure is the same quiet null: a card
 * without a fit is still a card.
 */

const Ids = z.array(z.string().uuid()).min(1).max(FIT_IDS_MAX);
const Id = z.string().uuid();

export async function fitProfilesAction(
  companyIds: readonly string[],
): Promise<readonly FitCompanyDto[] | null> {
  const ids = Ids.safeParse([...new Set(companyIds)]);
  const session = await qApiSession();
  if (!ids.success || session === null) return null;
  try {
    return (await getFitProfiles(session, ids.data)).items;
  } catch {
    return null;
  }
}

/** Q's view; asked after the fit has rendered, never on the critical path. */
export async function fitQViewAction(
  companyId: string,
): Promise<QViewDto | null> {
  const id = Id.safeParse(companyId);
  const session = await qApiSession();
  if (!id.success || session === null) return null;
  try {
    return await getFitQView(session, id.data);
  } catch {
    return null;
  }
}

export async function fitTopAction(
  limit = 3,
): Promise<FitComparisonDto | null> {
  const session = await qApiSession();
  if (session === null) return null;
  try {
    return await getFitTop(session, Math.max(1, Math.min(10, limit)));
  } catch {
    return null;
  }
}
