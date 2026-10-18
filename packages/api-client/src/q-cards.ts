import {
  PUBLIC_CARD_CODES_PATH,
  PUBLIC_HANDLES_PATH,
  PublicCardCodeDtoSchema,
  PublicHandleResponseSchema,
  Q_CARD_HANDLE_SEGMENT,
  Q_CARDS_PATH,
  QCardDtoSchema,
  type QCardSubjectType,
  type UpdateQCardRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** Handles and the Q Card (BIZ-004). */

function cardPath(subjectType: QCardSubjectType, subjectId: string): string {
  return `${Q_CARDS_PATH}/${subjectType}/${encodeURIComponent(subjectId)}`;
}

/** The organisation's own card; a 404 means none has been made yet. */
export function getQCard(
  session: ApiSession,
  subjectType: QCardSubjectType,
  subjectId: string,
) {
  return call(session, "GET", cardPath(subjectType, subjectId), QCardDtoSchema);
}

/** Claim or change the handle; claiming the current one changes nothing. */
export function claimHandle(
  session: ApiSession,
  subjectType: QCardSubjectType,
  subjectId: string,
  handle: string,
) {
  return call(
    session,
    "PUT",
    `${cardPath(subjectType, subjectId)}${Q_CARD_HANDLE_SEGMENT}`,
    QCardDtoSchema,
    { body: { handle } },
  );
}

export function updateQCard(
  session: ApiSession,
  subjectType: QCardSubjectType,
  subjectId: string,
  input: UpdateQCardRequest,
) {
  return call(
    session,
    "PATCH",
    cardPath(subjectType, subjectId),
    QCardDtoSchema,
    { body: input },
  );
}

/**
 * The public read behind `/@handle`. The session is optional: with a
 * valid one, a Capital Q participant also sees network-visible fields.
 */
export function getPublicHandle(
  session: Omit<ApiSession, "accessToken"> & { readonly accessToken?: string },
  handle: string,
) {
  return call(
    { ...session, accessToken: session.accessToken ?? "" },
    "GET",
    `${PUBLIC_HANDLES_PATH}/${encodeURIComponent(handle)}`,
    PublicHandleResponseSchema,
  );
}

/** The QR hop: where a card's short code points (and it is counted). */
export function resolveCardCode(
  session: Omit<ApiSession, "accessToken">,
  code: string,
) {
  return call(
    { ...session, accessToken: "" },
    "GET",
    `${PUBLIC_CARD_CODES_PATH}/${encodeURIComponent(code)}`,
    PublicCardCodeDtoSchema,
  );
}
