import {
  AccessChangeResultSchema,
  AnswerQuestionResultSchema,
  COMPANIES_PATH,
  COMPANY_QUESTIONS_SEGMENT,
  COMPANY_REQUESTS_SEGMENT,
  DOCUMENT_ACCESS_PATH,
  DOCUMENT_GRANT_REVOKE_PATH,
  DOCUMENT_GRANTS_PATH,
  DOCUMENT_REQUEST_DECLINE_PATH,
  DOCUMENT_REQUEST_FULFIL_PATH,
  DocumentAccessDtoSchema,
  DocumentRequestResultSchema,
  FOLDER_ACCESS_PATH,
  FOLDER_GRANTS_PATH,
  FOLDER_LEVEL_PATH,
  FolderAccessDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  InvestorQuestionsDtoSchema,
  QUESTION_ANSWER_PATH,
  RequestInboxDtoSchema,
  type AnswerQuestion,
  type DataRoomLevel,
  type DeclineDocumentRequest,
  type FulfilDocumentRequest,
  type GrantDocumentAccess,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * Founder documents (2026-10-08): the requests inbox, the access editor and
 * answers to investors' questions. Reads are the API's per-reader
 * projections; every change is a declared app action's own route.
 */

const company = (companyId: string) =>
  `${COMPANIES_PATH}/${encodeURIComponent(companyId)}`;
const fill = (path: string, values: Readonly<Record<string, string>>) =>
  Object.entries(values).reduce(
    (out, [key, value]) => out.replace(`:${key}`, encodeURIComponent(value)),
    path,
  );

export function getRequestInbox(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    `${company(companyId)}${COMPANY_REQUESTS_SEGMENT}`,
    RequestInboxDtoSchema,
  );
}

export function getInvestorQuestions(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    `${company(companyId)}${COMPANY_QUESTIONS_SEGMENT}`,
    InvestorQuestionsDtoSchema,
  );
}

export function getDocumentAccess(session: ApiSession, documentId: string) {
  return call(
    session,
    "GET",
    fill(DOCUMENT_ACCESS_PATH, { documentId }),
    DocumentAccessDtoSchema,
  );
}

export function getFolderAccess(
  session: ApiSession,
  companyId: string,
  folderCode: string,
) {
  return call(
    session,
    "GET",
    fill(FOLDER_ACCESS_PATH, { companyId, folderCode }),
    FolderAccessDtoSchema,
  );
}

export function fulfilDocumentRequest(
  session: ApiSession,
  requestId: string,
  body: FulfilDocumentRequest,
) {
  return call(
    session,
    "POST",
    fill(DOCUMENT_REQUEST_FULFIL_PATH, { requestId }),
    DocumentRequestResultSchema,
    { body },
  );
}

export function declineDocumentRequest(
  session: ApiSession,
  requestId: string,
  body: DeclineDocumentRequest,
) {
  return call(
    session,
    "POST",
    fill(DOCUMENT_REQUEST_DECLINE_PATH, { requestId }),
    DocumentRequestResultSchema,
    { body },
  );
}

export function shareDocumentAccess(
  session: ApiSession,
  documentId: string,
  body: GrantDocumentAccess,
) {
  return call(
    session,
    "POST",
    fill(DOCUMENT_GRANTS_PATH, { documentId }),
    AccessChangeResultSchema,
    { body },
  );
}

export function shareFolderAccess(
  session: ApiSession,
  companyId: string,
  folderCode: string,
  body: GrantDocumentAccess,
) {
  return call(
    session,
    "POST",
    fill(FOLDER_GRANTS_PATH, { companyId, folderCode }),
    AccessChangeResultSchema,
    { body },
  );
}

export function setFolderLevel(
  session: ApiSession,
  companyId: string,
  folderCode: string,
  level: DataRoomLevel,
) {
  return call(
    session,
    "POST",
    fill(FOLDER_LEVEL_PATH, { companyId, folderCode }),
    AccessChangeResultSchema,
    { body: { level } },
  );
}

export function revokeDocumentAccess(session: ApiSession, policyId: string) {
  return call(
    session,
    "POST",
    fill(DOCUMENT_GRANT_REVOKE_PATH, { policyId }),
    AccessChangeResultSchema,
  );
}

export function answerInvestorQuestion(
  session: ApiSession,
  questionId: string,
  body: AnswerQuestion,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    fill(QUESTION_ANSWER_PATH, { questionId }),
    AnswerQuestionResultSchema,
    { body, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}
