import { z } from "zod";

import {
  DocumentDownloadAudienceDtoSchema,
  DocumentDownloadAudienceSchema,
  ResourceVersionSchema,
  UuidSchema,
  type CorrelationId,
  type DocumentDownloadAudience,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { defineAppAction } from "../define.js";

/**
 * Who may download a pitch deck (ADR 0041; founder decision 2026-10-02),
 * as one choice, the pitch's own vocabulary: only their organisation (the
 * default) or investors who can find the company. For the person on the
 * documents screen it is their own click; for Q it is CONSEQUENTIAL (it
 * widens disclosure), so Q prepares it and the person approves exactly it.
 *
 * The port is structural so this package keeps its dependencies: each
 * composition adapts the Evidence service (which authorises, audits and
 * emits) to it.
 */

/** The document as this action needs it; the Evidence service's record. */
export type DeckRecord = {
  readonly id: string;
  readonly title: string;
  readonly documentType: string;
  readonly downloadAudience: DocumentDownloadAudience;
  readonly version: number;
};

export type DeckAudiencePort = {
  /** The actor's own organisation's document, or a not-found throw. */
  readonly getDocument: (query: {
    readonly actor: ActorContext;
    readonly documentId: string;
  }) => Promise<DeckRecord>;
  readonly setDocumentDownloadAudience: (command: {
    readonly actor: ActorContext;
    readonly documentId: string;
    readonly audience: DocumentDownloadAudience;
    readonly expectedVersion: number;
    readonly correlationId: CorrelationId;
  }) => Promise<DeckRecord>;
};

export const DeckAudienceInputSchema = z
  .object({
    documentId: UuidSchema,
    audience: DocumentDownloadAudienceSchema,
    /** The version the screen saw; Q acts on the current one. */
    expectedVersion: ResourceVersionSchema.optional(),
  })
  .strict();
export type DeckAudienceInput = z.infer<typeof DeckAudienceInputSchema>;

const WORDS: Readonly<Record<DocumentDownloadAudience, string>> = {
  ORGANISATION: "only your organisation",
  INVESTORS: "investors who can find your company",
};

/** The route's answer: the choice as it now stands, never a file or URL. */
export const DeckAudienceResponseSchema = DocumentDownloadAudienceDtoSchema;

const ToolInputSchema = z
  .object({
    deck: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe(
        'Which of their documents: the pitch deck\'s title as they said it, or "my deck" when they have one.',
      ),
    audience: DocumentDownloadAudienceSchema.describe(
      "Who can download it: ORGANISATION (only their organisation) or INVESTORS (investors who can find the company, the same investors who can watch its pitch).",
    ),
  })
  .strict();

async function ownDeck(
  port: DeckAudiencePort | undefined,
  actor: ActorContext,
  documentId: string,
): Promise<DeckRecord | null> {
  if (port === undefined) return null;
  const document = await port
    .getDocument({ actor, documentId })
    .catch(() => null);
  return document?.documentType === "PITCH_DECK" ? document : null;
}

export const SET_DECK_AUDIENCE = defineAppAction<
  DeckAudienceInput,
  DeckRecord,
  z.infer<typeof ToolInputSchema>
>({
  name: "document.deck_audience.set",
  short: "set deck download audience",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Sets who can download the company's pitch deck: only their organisation, or investors who can find the company.",
  input: DeckAudienceInputSchema,
  output: z.custom<DeckRecord>(),
  authorize: async (ports, context, input) =>
    (await ownDeck(ports.deckAudience, context.actor, input.documentId)) ===
    null
      ? { ok: false, reason: "That isn't one of your company's pitch decks." }
      : { ok: true },
  run: async (ports, context, input) => {
    const port = ports.deckAudience;
    const deck = await ownDeck(port, context.actor, input.documentId);
    if (port === undefined || deck === null) {
      throw new Error("DECK_NOT_AVAILABLE");
    }
    return port.setDocumentDownloadAudience({
      actor: context.actor,
      documentId: deck.id,
      audience: input.audience,
      expectedVersion: input.expectedVersion ?? deck.version,
      correlationId: context.correlationId,
    });
  },
  targets: () => [],
  card: (input) => ({
    summary:
      input.audience === "INVESTORS"
        ? "Let investors who can find your company download your pitch deck"
        : "Make your pitch deck downloadable by your organisation only",
    preview:
      input.audience === "INVESTORS"
        ? "Once approved, every investor who can watch your pitch can download the deck from your profile. You can change it back at any time."
        : "Investors will no longer be able to download it from your profile. Anything you sent in a conversation stays there.",
  }),
  done: (out) =>
    `Done. "${out.title}" can now be downloaded by ${WORDS[out.downloadAudience]}.`,
  http: {
    method: "POST",
    path: "/v1/documents/:documentId/download-audience",
    fromRequest: (params, body) => ({
      ...(typeof body === "object" && body !== null ? body : {}),
      documentId: params["documentId"],
    }),
    respond: (out) =>
      DeckAudienceResponseSchema.parse({
        documentId: out.id,
        downloadAudience: out.downloadAudience,
        version: out.version,
      }),
  },
  tool: {
    name: "set_deck_audience",
    description:
      "Sets who can download the person's own pitch deck -- only their organisation, or investors who can find their company (the same investors who can watch its pitch) -- exactly as the documents page's choice does. Prepared for their approval: nothing changes until they approve exactly it.",
    input: ToolInputSchema,
    references: { deck: "UPLOAD" },
    // Offered when the person asks for a change (and on a general turn);
    // an own-company question's tools are already at MODEL_TOOLS_MAX.
    scopes: ["COMPANY_PROFILE"],
    purposes: ["ACTION_PREPARATION", "GENERAL_QUESTION"],
    eval: {
      say: [
        "Let investors download my deck {name}.",
        "Make {name} private to my organisation again.",
      ],
      names: "UPLOAD",
    },
    toCanonical: (input) =>
      Promise.resolve({ documentId: input.deck, audience: input.audience }),
  },
});
