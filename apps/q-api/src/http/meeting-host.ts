import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  MEETING_HOST_WEBHOOK_PATH,
  type MeetingHostRuntime,
} from "../composition/meeting-host-runtime.js";

/**
 * Recall's real-time events for a call Q hosts (MEET-HOST, ADR 0037).
 *
 * No session: Recall calls it. Each meeting's bot was given its own URL
 * carrying an HMAC only this server can make; anything without a valid
 * one is refused and never read. The body is the call's data -- names and
 * caption lines -- and is never logged. The answer is quick and always
 * the same, so Recall does not retry a slow call.
 */

const QuerySchema = z
  .object({
    meeting: z.string().uuid(),
    token: z.string().min(20).max(200),
  })
  .passthrough();

export function registerMeetingHostRoutes(
  app: FastifyInstance,
  dependencies: { readonly host: MeetingHostRuntime },
): void {
  app.post(
    MEETING_HOST_WEBHOOK_PATH,
    {
      bodyLimit: 256_000,
      // The call's words never go to request logs.
      logLevel: "warn",
    },
    async (request, reply) => {
      const query = QuerySchema.safeParse(request.query);
      if (
        !query.success ||
        !dependencies.host.verify(query.data.meeting, query.data.token)
      ) {
        return reply.code(401).send();
      }
      const meetingId = query.data.meeting;
      // Handled in order per call, after the answer.
      void dependencies.host
        .receive(meetingId, request.body)
        .catch(() => undefined);
      return reply.code(204).send();
    },
  );
}
