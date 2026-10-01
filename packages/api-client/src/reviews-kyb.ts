import {
  ADMIN_KYB_DOCUMENT_PATH,
  ADMIN_REVIEW_DECISION_PATH,
  ADMIN_REVIEWS_PATH,
  AdminKybDocumentDtoSchema,
  AdminReviewDecisionDtoSchema,
  AdminReviewListDtoSchema,
  adminPath,
  HumanReviewDtoSchema,
  HumanReviewListDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  KYB_PATH,
  KybDtoSchema,
  REVIEWS_PATH,
  type HumanReviewRequest,
  type KybRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** ADMIN-3: the person's own human reviews and their organisation's KYB. */

export const listReviews = (session: ApiSession) =>
  call(session, "GET", REVIEWS_PATH, HumanReviewListDtoSchema);

export const requestHumanReview = (
  session: ApiSession,
  body: HumanReviewRequest,
  idempotencyKey: string,
) =>
  call(session, "POST", REVIEWS_PATH, HumanReviewDtoSchema, {
    body,
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
  });

export const getKyb = (session: ApiSession) =>
  call(session, "GET", KYB_PATH, KybDtoSchema);

export const submitKyb = (
  session: ApiSession,
  body: KybRequest,
  idempotencyKey: string,
) =>
  call(session, "POST", KYB_PATH, KybDtoSchema, {
    body,
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
  });

export const getAdminReviews = (session: ApiSession, all = false) =>
  call(
    session,
    "GET",
    `${ADMIN_REVIEWS_PATH}${all ? "?all=1" : ""}`,
    AdminReviewListDtoSchema,
  );

export const decideAdminReview = (
  session: ApiSession,
  reviewId: string,
  body: {
    readonly outcome: "UPHELD" | "CHANGED" | "NEEDS_EVIDENCE";
    readonly reason: string;
  },
) =>
  call(
    session,
    "POST",
    adminPath(ADMIN_REVIEW_DECISION_PATH, { reviewId }),
    AdminReviewDecisionDtoSchema,
    { body },
  );

export const getAdminKybDocument = (
  session: ApiSession,
  submissionId: string,
) =>
  call(
    session,
    "GET",
    adminPath(ADMIN_KYB_DOCUMENT_PATH, { submissionId }),
    AdminKybDocumentDtoSchema,
  );
