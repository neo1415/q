"use server";

import { z } from "zod";

import {
  ApiProblemError,
  requestHumanReview,
  submitKyb,
} from "@capital-q/api-client";
import {
  HumanReviewRequestSchema,
  KybRequestSchema,
} from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * ADMIN-3: asking for a human review, and an organisation's KYB. Server
 * actions, so the session never reaches the browser. The API decides who
 * the person and organisation are; nothing here names either.
 */

export type FormResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly message: string };

function problemMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiProblemError && error.status < 500) {
    return error.message;
  }
  return fallback;
}

export async function requestReviewAction(raw: {
  readonly subjectType: string;
  readonly subjectRef: string | null;
  readonly reason: string;
  /** One key per attempt from the form, so a double press records one case. */
  readonly attemptKey: string;
}): Promise<FormResult> {
  const input = HumanReviewRequestSchema.safeParse({
    subjectType: raw.subjectType,
    subjectRef:
      raw.subjectRef === null || raw.subjectRef === "" ? null : raw.subjectRef,
    reason: raw.reason,
  });
  const key = z.string().min(8).max(200).safeParse(raw.attemptKey);
  if (!input.success || !key.success) {
    return {
      ok: false,
      message: "Say what you want reviewed and why, in at least a sentence.",
    };
  }
  const session = await apiSession();
  if (session === null)
    return { ok: false, message: "Sign in again to continue." };
  try {
    await requestHumanReview(session, input.data, key.data);
    return {
      ok: true,
      message: "Sent. A person at Capital Q will answer within 3 days.",
    };
  } catch (error: unknown) {
    return {
      ok: false,
      message: problemMessage(
        error,
        "Your request wasn't sent. Nothing is lost; try again.",
      ),
    };
  }
}

/** ADMIN-4: one flow -- the organisation's details, the person's, or both. */
export async function submitKybAction(raw: {
  readonly organisation: {
    readonly legalName: string;
    readonly registrationNumber: string;
    readonly jurisdictionCode: string;
    readonly registeredAddress: string;
    readonly websiteUrl: string;
    readonly documentId: string | null;
  } | null;
  readonly person: {
    readonly nameOnId: string;
    readonly role: string;
    readonly documentId: string | null;
  } | null;
  readonly attemptKey: string;
}): Promise<FormResult> {
  const organisation = raw.organisation;
  const input = KybRequestSchema.safeParse({
    organisation:
      organisation === null
        ? null
        : {
            legalName: organisation.legalName,
            registrationNumber: organisation.registrationNumber,
            jurisdictionCode: organisation.jurisdictionCode
              .trim()
              .toUpperCase(),
            registeredAddress:
              organisation.registeredAddress.trim() === ""
                ? null
                : organisation.registeredAddress,
            websiteUrl:
              organisation.websiteUrl.trim() === ""
                ? null
                : organisation.websiteUrl.trim(),
            documentId: organisation.documentId,
          },
    person: raw.person,
  });
  const key = z.string().min(8).max(200).safeParse(raw.attemptKey);
  if (!input.success || !key.success) {
    return {
      ok: false,
      message:
        "Enter the legal name, registration number and a 2-letter country code, and your name as on your ID with your role.",
    };
  }
  const session = await apiSession();
  if (session === null)
    return { ok: false, message: "Sign in again to continue." };
  try {
    await submitKyb(session, input.data, key.data);
    return {
      ok: true,
      message: "Sent to Capital Q. You'll get a notice when it's decided.",
    };
  } catch (error: unknown) {
    return {
      ok: false,
      message: problemMessage(
        error,
        "Your details weren't sent. Nothing is lost; try again.",
      ),
    };
  }
}
