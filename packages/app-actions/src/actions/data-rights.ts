import { z } from "zod";

import { defineAppAction, portMissing, type AnyAppAction } from "../define.js";
import type { DataExportRequestOutcome } from "../ports.js";

/**
 * Decision 107: "download my data". The person asks Q and Q starts the
 * same request the Your data page makes (the same service, the same rate
 * limit, the same background build); the download itself is collected on
 * that page through a short-lived link, never handed over in chat.
 *
 * Deleting the account is deliberately NOT an action: it needs the
 * person's own fresh re-authentication and typed confirmation on the page.
 * Q explains it and points to Settings > Privacy > Your data.
 */

const Request = z
  .object({ idempotencyKey: z.string().min(8).max(200) })
  .strict();

const REQUEST_EXPORT = defineAppAction<
  z.infer<typeof Request>,
  DataExportRequestOutcome,
  Record<string, never>
>({
  name: "person.data.export.request",
  short: "download my data",
  area: "records",
  classification: "INSTANT",
  does: "Starts a download of everything Capital Q keeps as theirs (a ZIP they collect from Settings, under Privacy). Never deletes anything.",
  input: Request,
  output: z.custom<DataExportRequestOutcome>(),
  // Their own data only: the service reads the person from the actor.
  authorize: () => Promise.resolve({ ok: true as const }),
  run: (ports, context, input) =>
    (ports.dataExports ?? portMissing("dataExports")).request({
      userId: context.actor.userId,
      idempotencyKey: input.idempotencyKey,
    }),
  targets: () => [],
  card: () => ({ summary: "Download my data", preview: "" }),
  done: (out) =>
    out === "RATE_LIMITED"
      ? "You've asked for your data three times today. Try again tomorrow."
      : out === "NOT_AVAILABLE"
        ? "A download isn't available for this account."
        : "Your download is being prepared. You'll get a notice when it's ready; collect it from Settings, under Privacy, Your data.",
  succeeded: (out) => out === "REQUESTED" || out === "ALREADY_REQUESTED",
  tool: {
    name: "request_my_data_download",
    description:
      'When the person asks for a copy or download of their own data ("download my data", "export everything you have on me"), start it. It builds a ZIP they collect from Settings > Privacy > Your data. Never for anyone else\'s data. If they ask to delete their account, do not use this: explain that deleting is done on that same page, after they confirm it is them, with a 14-day grace period.',
    input: z.object({}).strict(),
    references: {},
    purposes: ["ACTION_PREPARATION"],
    eval: {
      say: [
        "Download all my data.",
        "Can I get an export of everything you hold about me?",
      ],
    },
    toCanonical: (_tool, context) =>
      Promise.resolve({
        idempotencyKey: `q:${context.idempotencyKey}`
          .slice(0, 200)
          .replace(/[^A-Za-z0-9:_-]/g, "-"),
      }),
  },
});

export const DATA_RIGHTS_ACTIONS: readonly AnyAppAction[] = [REQUEST_EXPORT];
