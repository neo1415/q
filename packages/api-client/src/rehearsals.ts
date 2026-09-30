import {
  Q_REHEARSALS_PATH,
  qInvestorRehearsalsPath,
  qRehearsalFinishPath,
  qRehearsalPath,
  qRehearsalTurnsPath,
  QRehearsalDtoSchema,
  QRehearsalListDtoSchema,
  type StartRehearsalRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** The founder starts a rehearsal with one investor. A Q API session. */
export function startRehearsal(
  session: ApiSession,
  body: StartRehearsalRequest,
) {
  return call(session, "POST", Q_REHEARSALS_PATH, QRehearsalDtoSchema, {
    body,
  });
}

/** The founder's own rehearsals with one investor, newest first. */
export function listInvestorRehearsals(
  session: ApiSession,
  investorOrganisationId: string,
) {
  return call(
    session,
    "GET",
    qInvestorRehearsalsPath(investorOrganisationId),
    QRehearsalListDtoSchema,
  );
}

export function getRehearsal(session: ApiSession, rehearsalId: string) {
  return call(session, "GET", qRehearsalPath(rehearsalId), QRehearsalDtoSchema);
}

/** The founder answers; the investor Q plays replies. */
export function sayInRehearsal(
  session: ApiSession,
  rehearsalId: string,
  text: string,
) {
  return call(
    session,
    "POST",
    qRehearsalTurnsPath(rehearsalId),
    QRehearsalDtoSchema,
    { body: { text } },
  );
}

/** The founder ends the rehearsal; Q coaches them. */
export function finishRehearsal(session: ApiSession, rehearsalId: string) {
  return call(
    session,
    "POST",
    qRehearsalFinishPath(rehearsalId),
    QRehearsalDtoSchema,
  );
}
