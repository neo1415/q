import { z } from "zod";

import type {
  EmailProvider,
  InboundMetadata,
  MailboxAccess,
} from "../email-provider.js";
import {
  errorForStatus,
  GoogleProviderError,
  readJson,
  send,
  type GoogleHttp,
  type GoogleHttpRequest,
} from "./http.js";

/**
 * The Gmail adapter for the EmailProvider port (BIZ-007), over the REST
 * API with the setup contract's scopes: `gmail.send` to send, and
 * `gmail.metadata` for history and headers (never a body). No SDK.
 */

export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

const HistoryIdSchema = z.union([z.string(), z.number()]).transform(String);

const SentSchema = z.object({ id: z.string(), threadId: z.string() });
const ProfileSchema = z.object({ historyId: HistoryIdSchema });
const HistorySchema = z.object({
  historyId: HistoryIdSchema,
  nextPageToken: z.string().optional(),
  history: z
    .array(
      z.object({
        messagesAdded: z
          .array(z.object({ message: z.object({ id: z.string() }) }))
          .optional(),
      }),
    )
    .optional(),
});
const MetadataSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
  internalDate: z.string().optional(),
  payload: z
    .object({
      headers: z
        .array(z.object({ name: z.string(), value: z.string() }))
        .optional(),
    })
    .optional(),
});
const WatchSchema = z.object({
  historyId: HistoryIdSchema,
  expiration: z.union([z.string(), z.number()]).transform(Number),
});

/** Bound on history pages per sync, so a flood cannot pin a worker. */
const MAX_HISTORY_PAGES = 10;

function bearer(access: MailboxAccess): Record<string, string> {
  return {
    authorization: `Bearer ${access.accessToken.reveal()}`,
    accept: "application/json",
  };
}

async function call<T>(
  http: GoogleHttp,
  url: string,
  request: GoogleHttpRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await send(http, url, request);
  if (response.status < 200 || response.status > 299) {
    throw errorForStatus(response.status);
  }
  const parsed = schema.safeParse(await readJson(response));
  if (!parsed.success) {
    throw new GoogleProviderError("MALFORMED_RESPONSE", response.status);
  }
  return parsed.data;
}

const METADATA_HEADERS = [
  "From",
  "To",
  "Subject",
  "Message-ID",
  "In-Reply-To",
  "References",
] as const;

export function createGmailEmailProvider(http: GoogleHttp): EmailProvider {
  return {
    send: async (access, raw) => {
      const sent = await call(
        http,
        `${GMAIL_API}/messages/send`,
        {
          method: "POST",
          headers: { ...bearer(access), "content-type": "application/json" },
          body: JSON.stringify({ raw }),
        },
        SentSchema,
      );
      return { providerMessageId: sent.id, providerThreadId: sent.threadId };
    },
    currentHistoryId: async (access) =>
      (
        await call(
          http,
          `${GMAIL_API}/profile`,
          { method: "GET", headers: bearer(access) },
          ProfileSchema,
        )
      ).historyId,
    addedSince: async (access, startHistoryId) => {
      const ids: string[] = [];
      let pageToken: string | undefined;
      let historyId = startHistoryId;
      for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
        const query = new URLSearchParams({
          startHistoryId,
          historyTypes: "messageAdded",
          maxResults: "100",
          ...(pageToken === undefined ? {} : { pageToken }),
        });
        const result = await call(
          http,
          `${GMAIL_API}/history?${query.toString()}`,
          { method: "GET", headers: bearer(access) },
          HistorySchema,
        );
        historyId = result.historyId;
        for (const entry of result.history ?? []) {
          for (const added of entry.messagesAdded ?? []) {
            ids.push(added.message.id);
          }
        }
        pageToken = result.nextPageToken;
        if (pageToken === undefined) break;
      }
      return { messageIds: [...new Set(ids)], historyId };
    },
    readMetadata: async (
      access,
      providerMessageId,
    ): Promise<InboundMetadata> => {
      const query = new URLSearchParams([
        ["format", "metadata"],
        ...METADATA_HEADERS.map((name): [string, string] => [
          "metadataHeaders",
          name,
        ]),
      ]);
      const message = await call(
        http,
        `${GMAIL_API}/messages/${encodeURIComponent(providerMessageId)}?${query.toString()}`,
        { method: "GET", headers: bearer(access) },
        MetadataSchema,
      );
      const header = (name: string) =>
        message.payload?.headers?.find(
          (h) => h.name.toLowerCase() === name.toLowerCase(),
        )?.value;
      const internal = Number(message.internalDate);
      return {
        providerMessageId: message.id,
        providerThreadId: message.threadId,
        labelIds: message.labelIds ?? [],
        from: header("From"),
        to: header("To"),
        subject: header("Subject"),
        messageId: header("Message-ID"),
        inReplyTo: header("In-Reply-To"),
        references: header("References"),
        receivedAt: Number.isFinite(internal) ? new Date(internal) : new Date(),
      };
    },
    watch: async (access, topic) => {
      const watched = await call(
        http,
        `${GMAIL_API}/watch`,
        {
          method: "POST",
          headers: { ...bearer(access), "content-type": "application/json" },
          body: JSON.stringify({ topicName: topic, labelIds: ["INBOX"] }),
        },
        WatchSchema,
      );
      return {
        historyId: watched.historyId,
        expiresAt: new Date(watched.expiration),
      };
    },
  };
}
