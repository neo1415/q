"use server";

import {
  ApiProblemError,
  fillQArtifactPlaceholder,
  getQArtifact,
  getQArtifactProgress,
} from "@capital-q/api-client";
import { z } from "zod";

import { qApiSession } from "@/features/q/context";

/**
 * Q room W5 (R8): the deck surface's reads and its one write, on the
 * server as the person (the session never reaches the browser). The Q API
 * resolves the document as them; an id grants nothing.
 */

export type DeckState =
  | {
      readonly ok: true;
      readonly status: "PREPARING" | "READY" | "FAILED";
      readonly title: string;
      readonly type: string;
      readonly version: number | null;
      /** The company it is about (their own), for the upload path. */
      readonly companyId: string | null;
      /** While it is being made: the stage, in plain words. */
      readonly progress: string | null;
    }
  | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();

export async function readDeckAction(raw: string): Promise<DeckState> {
  const artifactId = Id.safeParse(raw);
  const session = await qApiSession();
  if (!artifactId.success || session === null) {
    return { ok: false, message: "This document isn't available here." };
  }
  try {
    const detail = await getQArtifact(session, artifactId.data);
    const artifact = detail.artifact;
    const progress =
      artifact.status === "PREPARING"
        ? await getQArtifactProgress(session, artifactId.data)
            .then((read) => read.line)
            .catch(() => null)
        : null;
    return {
      ok: true,
      status: artifact.status,
      title: artifact.title,
      type: artifact.type,
      version: detail.current?.version ?? null,
      companyId:
        artifact.subject?.kind === "COMPANY"
          ? artifact.subject.companyId
          : null,
      progress,
    };
  } catch {
    return { ok: false, message: "This document isn't available here." };
  }
}

export type FillResult =
  | { readonly ok: true; readonly version: number }
  | {
      readonly ok: false;
      /** The picture is still being checked: try again shortly. */
      readonly retry: boolean;
      readonly message: string;
    };

const FillInput = z
  .object({
    artifactId: Id,
    version: z.number().int().min(1),
    slide: z.number().int().min(1).max(24),
    documentId: Id,
  })
  .strict();

export async function fillDeckPlaceholderAction(
  raw: unknown,
): Promise<FillResult> {
  const input = FillInput.safeParse(raw);
  const session = await qApiSession();
  if (!input.success || session === null) {
    return { ok: false, retry: false, message: "That couldn't be placed." };
  }
  try {
    const filled = await fillQArtifactPlaceholder(
      session,
      input.data.artifactId,
      {
        version: input.data.version,
        slide: input.data.slide,
        documentId: input.data.documentId,
      },
    );
    return { ok: true, version: filled.version };
  } catch (error) {
    if (error instanceof ApiProblemError) {
      if (error.code === "UPLOAD_NOT_READY") {
        return {
          ok: false,
          retry: true,
          message: "Checking your picture…",
        };
      }
      if (error.code === "CHANGED_SINCE") {
        return {
          ok: false,
          retry: false,
          message:
            "The deck changed since you opened it. Drop the picture again.",
        };
      }
      if (error.code === "NOT_A_PICTURE") {
        return {
          ok: false,
          retry: false,
          message: "Only PNG or JPEG pictures can go on a slide.",
        };
      }
    }
    return { ok: false, retry: false, message: "That couldn't be placed." };
  }
}
