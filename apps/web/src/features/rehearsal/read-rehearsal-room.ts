import "server-only";

import {
  ApiProblemError,
  getRehearsal,
  getRehearsalVideo,
  type ApiSession,
} from "@capital-q/api-client";

/** Authorized recovery reads only: no canonical start, provider allocation or finish. */
export async function readRehearsalRoom(
  session: ApiSession,
  rehearsalId: string,
) {
  const rehearsal = await getRehearsal(session, rehearsalId);
  const video = await getRehearsalVideo(session, rehearsalId).catch(
    (error: unknown) => {
      // A transport/auth/server error must not silently switch a live call
      // into voice or allow its review to appear before physical termination.
      if (
        error instanceof ApiProblemError &&
        error.status === 404 &&
        error.code === "RESOURCE_NOT_FOUND"
      )
        return null;
      throw error;
    },
  );
  return { rehearsal, video };
}
