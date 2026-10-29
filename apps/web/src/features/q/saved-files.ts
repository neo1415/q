"use client";

import { useEffect, useState } from "react";
import { z } from "zod";

import { artifactTypeLabel } from "./artifact-type";
import type { BoardFile } from "./board-timeline";

/**
 * The Board's Files from the server (XLSX-002, live 2026-10-28: after a
 * reload the Board said "Nothing on the Board yet" while the spreadsheet
 * made a minute earlier was saved). Files are the person's own saved
 * documents, listed through the same narrow route the document-ready
 * card reads (`/api/q-artifact/recent`, their organisation's newest, read
 * as them), not only what this tab's memory saw being made.
 */

const RecentSchema = z.object({
  items: z
    .array(
      z.object({
        artifactId: z.string(),
        type: z.string(),
        status: z.string(),
        title: z.string(),
        updatedAt: z.string(),
      }),
    )
    .max(50),
});

export type SavedFile = BoardFile & { readonly type: string };

/** The person's saved, ready documents; null when they could not be read. */
export async function listSavedFiles(): Promise<readonly SavedFile[] | null> {
  try {
    const response = await fetch("/api/q-artifact/recent", {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const parsed = RecentSchema.safeParse(await response.json());
    if (!parsed.success) return null;
    return parsed.data.items
      .filter((item) => item.status === "READY")
      .map((item) => ({
        artifactId: item.artifactId,
        title: item.title,
        type: item.type,
        detail: `${artifactTypeLabel(item.type)}, saved`,
      }));
  } catch {
    return null;
  }
}

/**
 * What this tab saw made first (its words say how it came about), then
 * every other saved file, each once.
 */
export function boardFiles(
  made: readonly BoardFile[],
  saved: readonly BoardFile[],
): readonly BoardFile[] {
  const seen = new Set<string>();
  const out: BoardFile[] = [];
  for (const file of [...made, ...saved]) {
    if (seen.has(file.artifactId)) continue;
    seen.add(file.artifactId);
    out.push(file);
  }
  return out;
}

/** Saved files, read when the Board mounts (and when `refresh` changes). */
export function useSavedFiles(refresh: number = 0): readonly SavedFile[] {
  const [files, setFiles] = useState<readonly SavedFile[]>([]);
  useEffect(() => {
    let alive = true;
    void listSavedFiles().then((listed) => {
      if (alive && listed !== null) setFiles(listed);
    });
    return () => {
      alive = false;
    };
  }, [refresh]);
  return files;
}
