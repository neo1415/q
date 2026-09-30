"use server";

import { z } from "zod";

import {
  ApiProblemError,
  finishRehearsal,
  sayInRehearsal,
  startRehearsal,
} from "@capital-q/api-client";
import type { QRehearsalDto } from "@capital-q/contracts";
import { loadWebServerConfig } from "@capital-q/config/web";

import { getSessionAccessToken } from "@/auth/session";

/**
 * The Investor Twin, server side (founder direction 2026-09-30). Server
 * actions so the session token never reaches the browser; the Q API
 * answers only for the rehearsal's own founder.
 */
export type RehearsalResult =
  | { readonly ok: true; readonly value: QRehearsalDto }
  | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();

async function run(
  work: (session: {
    readonly baseUrl: string;
    readonly accessToken: string;
  }) => Promise<QRehearsalDto>,
): Promise<RehearsalResult> {
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (qApiBaseUrl === undefined || accessToken === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    return {
      ok: true,
      value: await work({ baseUrl: qApiBaseUrl, accessToken }),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof ApiProblemError && error.problem?.detail !== undefined
          ? error.problem.detail
          : "Couldn't reach Q just now. Please try again.",
    };
  }
}

export async function startRehearsalAction(
  investorOrganisationId: string,
): Promise<RehearsalResult> {
  const id = Id.safeParse(investorOrganisationId);
  if (!id.success) return { ok: false, message: "Not found." };
  return run((session) =>
    startRehearsal(session, { investorOrganisationId: id.data }),
  );
}

export async function sayInRehearsalAction(
  rehearsalId: string,
  text: string,
): Promise<RehearsalResult> {
  const id = Id.safeParse(rehearsalId);
  const said = z.string().trim().min(1).max(4_000).safeParse(text);
  if (!id.success || !said.success) {
    return { ok: false, message: "Say something first." };
  }
  return run((session) => sayInRehearsal(session, id.data, said.data));
}

export async function finishRehearsalAction(
  rehearsalId: string,
): Promise<RehearsalResult> {
  const id = Id.safeParse(rehearsalId);
  if (!id.success) return { ok: false, message: "Not found." };
  return run((session) => finishRehearsal(session, id.data));
}
