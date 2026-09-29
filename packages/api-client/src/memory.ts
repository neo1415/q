import {
  Q_MEMORY_FORGET_PATH,
  Q_MEMORY_PATH,
  QMemoryListDtoSchema,
} from "@capital-q/contracts";

import { readProblemResponse } from "./problem.js";
import { call, type ApiSession } from "./request.js";

/** What Q remembers about the caller (ADR 0012). A Q API session. */
export function listQMemory(session: ApiSession) {
  return call(session, "GET", Q_MEMORY_PATH, QMemoryListDtoSchema);
}

/** `204`: Q forgets one thing it remembered about the caller. */
export async function forgetQMemory(
  session: ApiSession,
  memoryItemId: string,
): Promise<void> {
  const doFetch = session.fetch ?? fetch;
  const response = await doFetch(
    `${session.baseUrl.replace(/\/$/, "")}${Q_MEMORY_FORGET_PATH.replace(
      ":memoryItemId",
      encodeURIComponent(memoryItemId),
    )}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${session.accessToken}`,
      },
      cache: "no-store",
    },
  );
  if (!response.ok) throw await readProblemResponse(response);
}
