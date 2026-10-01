import {
  Q_REHEARSAL_PARTNERS_PATH,
  Q_REHEARSALS_PATH,
  qInvestorRehearsalsPath,
  qRehearsalFinishPath,
  qRehearsalMeetingPath,
  qRehearsalPath,
  qRehearsalPersonaPath,
  qRehearsalScreenPath,
  qRehearsalTurnsPath,
  QRehearsalDtoSchema,
  QRehearsalListDtoSchema,
  QRehearsalMeetingDtoSchema,
  QRehearsalPartnersDtoSchema,
  QRehearsalPersonaDtoSchema,
  type RehearsalCounterpartKind,
  type RehearsalTurnRequest,
  type StartRehearsalRequest,
} from "@capital-q/contracts";
import { z } from "zod";

import { call, type ApiSession } from "./request.js";

/**
 * Rehearsals (C12, generalised by REHEARSE 2026-10-01): the person's own
 * rehearsals with someone they are connected to. A Q API session.
 */
export function startRehearsal(
  session: ApiSession,
  body: StartRehearsalRequest,
) {
  return call(session, "POST", Q_REHEARSALS_PATH, QRehearsalDtoSchema, {
    body,
  });
}

/** Their own rehearsals, newest first. */
export function listRehearsals(session: ApiSession) {
  return call(session, "GET", Q_REHEARSALS_PATH, QRehearsalListDtoSchema);
}

/** Who they can rehearse with, and their upcoming calls. */
export function getRehearsalPartners(session: ApiSession) {
  return call(
    session,
    "GET",
    Q_REHEARSAL_PARTNERS_PATH,
    QRehearsalPartnersDtoSchema,
  );
}

/** Q's reading of the person it will play, built or refreshed on demand. */
export function getRehearsalPersona(
  session: ApiSession,
  kind: RehearsalCounterpartKind,
  counterpartId: string,
) {
  return call(
    session,
    "GET",
    qRehearsalPersonaPath(kind, counterpartId),
    QRehearsalPersonaDtoSchema,
  );
}

/** Which person one of their own booked calls is with. */
export function getRehearsalMeeting(session: ApiSession, meetingId: string) {
  return call(
    session,
    "GET",
    qRehearsalMeetingPath(meetingId),
    QRehearsalMeetingDtoSchema,
  );
}

/** C12: their rehearsals with one investor. */
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

/** They speak (or raise a hand); the person Q plays replies. */
export function sayInRehearsal(
  session: ApiSession,
  rehearsalId: string,
  body: RehearsalTurnRequest | string,
) {
  return call(
    session,
    "POST",
    qRehearsalTurnsPath(rehearsalId),
    QRehearsalDtoSchema,
    { body: typeof body === "string" ? { text: body } : body },
  );
}

/** One frame of the screen they share; held for the next turn only. */
export function sendRehearsalScreen(
  session: ApiSession,
  rehearsalId: string,
  image: string | null,
  kind: "SCREEN" | "CAMERA" = "SCREEN",
) {
  return call(
    session,
    "POST",
    qRehearsalScreenPath(rehearsalId),
    z.object({ accepted: z.literal(true) }).strict(),
    { body: image === null ? { kind } : { kind, image } },
  );
}

/** They end the rehearsal; Q reviews it. */
export function finishRehearsal(session: ApiSession, rehearsalId: string) {
  return call(
    session,
    "POST",
    qRehearsalFinishPath(rehearsalId),
    QRehearsalDtoSchema,
  );
}
