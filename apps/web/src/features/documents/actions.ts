"use server";

import { z } from "zod";

import {
  ApiProblemError,
  confirmQBrandKit,
  createQAnswerExport,
  getQBrandKit,
  setQBrandKit,
  suggestQBrandKit,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";
import {
  CreateQAnswerExportRequestSchema,
  QDeckColourSchema,
  QFontPairingSchema,
  Q_BRAND_LOGO_MAX_BYTES,
  type QArtifactSummary,
  type QBrandKit,
  type QBrandKitState,
} from "@capital-q/contracts";

import { getSessionAccessToken } from "@/auth/session";

/**
 * The document studio from the page (DOCS spec §3 F4, F5): the brand kit
 * (read, set their own values, ask Q to read their website, confirm or
 * decline a suggestion) and one Q answer filed as a PDF.
 *
 * Authority is the session cookie, forwarded server to server; nothing a
 * browser sends names an organisation. Each result is a plain sentence
 * the person can act on.
 */

export type DocumentActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const fail = (message: string): DocumentActionResult<never> => ({
  ok: false,
  message,
});

async function session(): Promise<ApiSession | null> {
  const { qApiBaseUrl } = loadWebServerConfig();
  const accessToken = await getSessionAccessToken();
  if (qApiBaseUrl === undefined || accessToken === null) return null;
  return { baseUrl: qApiBaseUrl, accessToken };
}

async function run<T>(
  work: (session: ApiSession) => Promise<T>,
  sentences: Readonly<Record<string, string>> = {},
): Promise<DocumentActionResult<T>> {
  const current = await session();
  if (current === null) {
    return fail("Your session ended. Sign in again to continue.");
  }
  try {
    return { ok: true, value: await work(current) };
  } catch (error) {
    if (error instanceof ApiProblemError) {
      const sentence = sentences[error.code];
      if (sentence !== undefined) return fail(sentence);
      if (error.status === 401 || error.status === 403) {
        return fail("Your session ended. Sign in again to continue.");
      }
      if (error.status < 500 && error.problem?.detail !== undefined) {
        return fail(error.problem.detail);
      }
    }
    return fail("That didn't go through. Try again.");
  }
}

export async function readBrandKitAction(): Promise<
  DocumentActionResult<QBrandKitState>
> {
  return run((current) => getQBrandKit(current));
}

const SetBrandSchema = z
  .object({
    primary: QDeckColourSchema,
    secondary: QDeckColourSchema.optional(),
    background: QDeckColourSchema.optional(),
    ink: QDeckColourSchema.optional(),
    pairing: QFontPairingSchema.optional(),
    /** base64 of a PNG or JPEG the person picked. */
    logoBase64: z
      .string()
      .max(Math.ceil((Q_BRAND_LOGO_MAX_BYTES * 4) / 3) + 8)
      .optional(),
    removeLogo: z.boolean().optional(),
  })
  .strict();

export async function setBrandKitAction(
  raw: unknown,
): Promise<DocumentActionResult<QBrandKit>> {
  const input = SetBrandSchema.safeParse(raw);
  if (!input.success) {
    return fail("Check the colours: each is a hex value like #1f4f7a.");
  }
  const { primary, secondary, background, ink, pairing, ...logo } = input.data;
  return run(
    (current) =>
      setQBrandKit(current, {
        palette: {
          primary,
          ...(secondary === undefined ? {} : { secondary }),
          ...(background === undefined ? {} : { background }),
          ...(ink === undefined ? {} : { ink }),
        },
        ...(pairing === undefined ? {} : { pairing }),
        ...logo,
      }),
    {
      LOGO_INVALID: "The logo must be a PNG or JPEG of at most 512 KB.",
      NO_ORGANISATION:
        "A brand belongs to a company or firm. Finish your setup first.",
    },
  );
}

export async function suggestBrandKitAction(): Promise<
  DocumentActionResult<QBrandKit>
> {
  return run((current) => suggestQBrandKit(current), {
    NO_WEBSITE:
      "Your company has no website on record. Add your colours or a logo instead.",
    UNREADABLE:
      "Your website didn't give colours or a logo Q could use. Add them here instead.",
    NO_ORGANISATION:
      "A brand belongs to a company or firm. Finish your setup first.",
  });
}

const AnswerSchema = z
  .object({
    version: z.number().int().min(1).max(100_000),
    decision: z.enum(["CONFIRM", "DECLINE"]),
  })
  .strict();

export async function answerBrandSuggestionAction(
  raw: unknown,
): Promise<DocumentActionResult<QBrandKit>> {
  const input = AnswerSchema.safeParse(raw);
  if (!input.success) return fail("That suggestion can't be answered.");
  return run((current) => confirmQBrandKit(current, input.data), {
    ALREADY_ANSWERED: "That suggestion was already answered.",
  });
}

/** One Q answer, exactly as written, filed as a PDF document. */
export async function exportAnswerAction(
  raw: unknown,
): Promise<DocumentActionResult<QArtifactSummary>> {
  const input = CreateQAnswerExportRequestSchema.safeParse(raw);
  if (!input.success) return fail("That answer can't be filed.");
  return run(
    async (current) =>
      (await createQAnswerExport(current, input.data)).artifact,
    {
      NOTHING_TO_FILE: "That answer has no words to put in a PDF.",
      NO_ORGANISATION:
        "Documents belong to a company or firm. Finish your setup first.",
    },
  );
}
