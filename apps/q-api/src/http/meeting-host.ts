import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { RecallStatusWebhook } from "../composition/recall-bots.js";
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
  dependencies: {
    readonly host?: MeetingHostRuntime | undefined;
    /**
     * meet-47: Recall's account-level status webhook (bot ended, transcript
     * ready) is delivered to the same path, Svix-signed and without a
     * meeting token, so a late transcript is settled the moment it exists.
     */
    readonly status?: RecallStatusWebhook | undefined;
  },
): void {
  const { host, status } = dependencies;
  // The raw bytes are kept: Recall's status signature covers them exactly.
  void app.register((scope, _options, done) => {
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: 256_000 },
      (_request, body, parsed) => {
        parsed(null, body);
      },
    );
    scope.post(
      MEETING_HOST_WEBHOOK_PATH,
      {
        bodyLimit: 256_000,
        // The call's words never go to request logs.
        logLevel: "warn",
      },
      async (request, reply) => {
        const raw = Buffer.isBuffer(request.body)
          ? request.body
          : Buffer.alloc(0);
        const query = QuerySchema.safeParse(request.query);
        if (query.success) {
          if (
            host === undefined ||
            !host.verify(query.data.meeting, query.data.token)
          ) {
            return reply.code(401).send();
          }
          const meetingId = query.data.meeting;
          const body = parseJson(raw);
          // Handled in order per call, after the answer.
          void host.receive(meetingId, body).catch(() => undefined);
          return reply.code(204).send();
        }
        if (status === undefined || !status.verify(request.headers, raw)) {
          return reply.code(401).send();
        }
        void status.receive(parseJson(raw)).catch(() => undefined);
        return reply.code(204).send();
      },
    );
    done();
  });
}

function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}
