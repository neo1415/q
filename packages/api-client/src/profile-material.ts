import {
  COMPANIES_PATH,
  COMPANY_DATA_ROOM_REQUESTS_PATH,
  COMPANY_DATA_ROOM_SEGMENT,
  COMPANY_DECK_OPEN_SEGMENT,
  COMPANY_DECK_SEGMENT,
  CompanyDeckViewSchema,
  DATA_ROOM_DOCUMENT_LEVEL_PATH,
  DATA_ROOM_REQUEST_DECISION_PATH,
  DECK_EXTRACTION_CONFIRM_PATH,
  DECK_READ_AGAIN_PATH,
  DECK_SECTION_REVIEW_PATH,
  DataRoomLevelResultSchema,
  DataRoomOpenDtoSchema,
  DataRoomRequestResultSchema,
  DataRoomViewSchema,
  DeckExtractionConfirmResultSchema,
  DeckReadAgainResultSchema,
  DeckSectionReviewResultSchema,
  FounderPersonDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  type DecideDataRoomRequest,
  type DeckSectionCode,
  type DeckSectionReviewAction,
  type RequestDataRoomAccessRequest,
  type SetDataRoomLevelRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * The profile's Data room, Pitch deck and founder pages (overnight plan
 * A1-A7). Reads are the API's per-reader projections; every change is a
 * declared app action's own route (ADR 0040).
 */

const company = (companyId: string) =>
  `${COMPANIES_PATH}/${encodeURIComponent(companyId)}`;

export function getCompanyDataRoom(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    `${company(companyId)}${COMPANY_DATA_ROOM_SEGMENT}`,
    DataRoomViewSchema,
  );
}

export function openDataRoomDocument(
  session: ApiSession,
  companyId: string,
  documentId: string,
) {
  return call(
    session,
    "GET",
    `${company(companyId)}${COMPANY_DATA_ROOM_SEGMENT}/documents/${encodeURIComponent(documentId)}/open`,
    DataRoomOpenDtoSchema,
  );
}

export function getCompanyDeck(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    `${company(companyId)}${COMPANY_DECK_SEGMENT}`,
    CompanyDeckViewSchema,
  );
}

export function openCompanyDeck(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    `${company(companyId)}${COMPANY_DECK_OPEN_SEGMENT}`,
    DataRoomOpenDtoSchema,
  );
}

export function getCompanyFounder(
  session: ApiSession,
  companyId: string,
  position: number,
) {
  return call(
    session,
    "GET",
    `${company(companyId)}/founders/${String(position)}`,
    FounderPersonDtoSchema,
  );
}

export function setDataRoomLevel(
  session: ApiSession,
  documentId: string,
  request: SetDataRoomLevelRequest,
) {
  return call(
    session,
    "POST",
    DATA_ROOM_DOCUMENT_LEVEL_PATH.replace(
      ":documentId",
      encodeURIComponent(documentId),
    ),
    DataRoomLevelResultSchema,
    { body: request },
  );
}

/** The investor asks; one key per press. */
export function requestDataRoomAccess(
  session: ApiSession,
  companyId: string,
  request: RequestDataRoomAccessRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    COMPANY_DATA_ROOM_REQUESTS_PATH.replace(
      ":companyId",
      encodeURIComponent(companyId),
    ),
    DataRoomRequestResultSchema,
    { body: request, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}

export function decideDataRoomRequest(
  session: ApiSession,
  requestId: string,
  request: DecideDataRoomRequest,
) {
  return call(
    session,
    "POST",
    DATA_ROOM_REQUEST_DECISION_PATH.replace(
      ":requestId",
      encodeURIComponent(requestId),
    ),
    DataRoomRequestResultSchema,
    { body: request },
  );
}

export function confirmDeckReading(
  session: ApiSession,
  companyId: string,
  documentId: string,
  extractionId: string,
) {
  return call(
    session,
    "POST",
    DECK_EXTRACTION_CONFIRM_PATH.replace(
      ":documentId",
      encodeURIComponent(documentId),
    ).replace(":extractionId", encodeURIComponent(extractionId)),
    DeckExtractionConfirmResultSchema,
    { body: { companyId } },
  );
}

/** F26: the founder reviews one section of the reading on screen. */
export function reviewDeckSection(
  session: ApiSession,
  input: {
    readonly companyId: string;
    readonly documentId: string;
    readonly extractionId: string;
    readonly section: DeckSectionCode;
    readonly action: DeckSectionReviewAction;
    readonly correction: string | null;
  },
) {
  return call(
    session,
    "POST",
    DECK_SECTION_REVIEW_PATH.replace(
      ":documentId",
      encodeURIComponent(input.documentId),
    )
      .replace(":extractionId", encodeURIComponent(input.extractionId))
      .replace(":section", encodeURIComponent(input.section)),
    DeckSectionReviewResultSchema,
    {
      body: {
        companyId: input.companyId,
        action: input.action,
        correction: input.correction,
      },
    },
  );
}

/** F26: the founder asks Q to read the current deck version again. */
export function readDeckAgain(
  session: ApiSession,
  companyId: string,
  documentId: string,
  extractionId: string,
) {
  return call(
    session,
    "POST",
    DECK_READ_AGAIN_PATH.replace(
      ":documentId",
      encodeURIComponent(documentId),
    ).replace(":extractionId", encodeURIComponent(extractionId)),
    DeckReadAgainResultSchema,
    { body: { companyId } },
  );
}
