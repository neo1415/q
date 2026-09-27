"use client";

import { useState } from "react";

import type { QArtifactExportFormat } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  ChevronDown,
  Download,
  ICON_SIZE,
  ICON_STROKE,
} from "@capital-q/ui/icons";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from "@capital-q/ui/menu";
import { InlineNotice } from "@capital-q/ui/states";

/**
 * Downloading what Q composed (BIZ-001).
 *
 * One control for the card and the viewer, so both offer the same files
 * for the same artifact: a PDF for every type, and PowerPoint where the
 * artifact is a deck (R36: one download control, never a row of them).
 *
 * A single file is a real link to the one narrow server route (the Q API's token is
 * in an HttpOnly cookie, so no script here can call the Q API), and a
 * click fetches the file instead of navigating to it. A plain link that
 * failed used to open a page of JSON — a dead end in a new tab. Fetched,
 * a failure becomes the route's own sentence beside the button, the
 * person stays where they were, and pressing it again is the retry. The
 * href stays for what a link is good at: "save link as", and a browser
 * with scripts off.
 */

export type ArtifactFileFormat = "slides" | QArtifactExportFormat;

/**
 * Where the browser asks for a drawing or a file of this artifact.
 *
 * The version travels with the request: somebody looking at V1 downloads
 * V1. Without one, the current version.
 */
export function artifactFileUrl(
  artifactId: string,
  format: ArtifactFileFormat,
  version: number | null,
): string {
  const query = version === null ? "" : `?version=${String(version)}`;
  return `/api/q-artifact/${encodeURIComponent(artifactId)}/${format}${query}`;
}

const LABELS: Readonly<Record<QArtifactExportFormat, string>> = {
  pdf: "PDF",
  pptx: "PowerPoint",
};

/** What the menu says, so nobody has to guess what a PowerPoint is saved as. */
const MENU_LABELS: Readonly<Record<QArtifactExportFormat, string>> = {
  pdf: "PDF document",
  pptx: "PowerPoint (.pptx)",
};

/** The name the server put on the file, or a plain one. */
function fileNameFrom(
  response: Response,
  format: QArtifactExportFormat,
): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return match?.[1] ?? `document.${format}`;
}

async function failureMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string" &&
      body.message.length > 0
    ) {
      return body.message;
    }
  } catch {
    // Not JSON: the status line is all there is.
  }
  return "I couldn't prepare that file. Try again.";
}

/** Hand bytes to the browser's own download, under the server's file name. */
function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next task, after the browser has taken the file.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * One file: one button that says which file. Several: one Download menu,
 * so a card carries a single download control however many formats exist.
 */
export function ArtifactDownloads({
  artifactId,
  formats,
  version,
  layer = "page",
}: {
  readonly artifactId: string;
  readonly formats: readonly QArtifactExportFormat[];
  /** The version on screen; null for whatever is current. */
  readonly version: number | null;
  /** `modal` inside the viewer, so the menu opens above it. */
  readonly layer?: "page" | "modal" | undefined;
}) {
  const [busy, setBusy] = useState<QArtifactExportFormat | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const download = async (format: QArtifactExportFormat) => {
    if (busy !== null) return;
    setBusy(format);
    setFailure(null);
    try {
      const response = await fetch(
        artifactFileUrl(artifactId, format, version),
      );
      if (!response.ok) {
        setFailure(await failureMessage(response));
        return;
      }
      saveFile(await response.blob(), fileNameFrom(response, format));
    } catch {
      setFailure("I lost the connection to Q. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const icon = (
    <Download
      aria-hidden="true"
      size={ICON_SIZE.compact}
      strokeWidth={ICON_STROKE}
    />
  );
  const only = formats.length === 1 ? formats[0] : undefined;

  return (
    <>
      {only !== undefined ? (
        <a
          className={buttonClassName("secondary", "regular")}
          href={artifactFileUrl(artifactId, only, version)}
          aria-busy={busy === only}
          aria-disabled={busy !== null}
          onClick={(event) => {
            // Modified clicks keep what a link does (open in a new tab,
            // save as); a plain click fetches, so a failure is a sentence
            // here rather than a page of JSON somewhere else.
            if (
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey ||
              event.button !== 0
            ) {
              return;
            }
            event.preventDefault();
            void download(only);
          }}
          data-q-artifact-download={only}
        >
          {icon}
          {busy === only ? (
            "Preparing…"
          ) : (
            // The space outside the hidden word is what separates the two
            // in the accessible name ("Download PDF"); at the start of the
            // visible line it collapses away.
            <span>
              <span className="sr-only">Download</span> {LABELS[only]}
            </span>
          )}
        </a>
      ) : (
        <MenuRoot>
          <MenuTrigger>
            <button
              type="button"
              className={buttonClassName("secondary", "regular")}
              aria-busy={busy !== null}
              data-q-artifact-download-menu
            >
              {icon}
              {busy === null ? "Download" : "Preparing…"}
              <ChevronDown
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
              />
            </button>
          </MenuTrigger>
          <MenuContent align="end" layer={layer}>
            {formats.map((format) => (
              <MenuItem
                key={format}
                disabled={busy !== null}
                onClick={() => {
                  void download(format);
                }}
              >
                <span data-q-artifact-download={format}>
                  {MENU_LABELS[format]}
                </span>
              </MenuItem>
            ))}
          </MenuContent>
        </MenuRoot>
      )}
      {failure === null ? null : (
        <InlineNotice
          tone="warning"
          title="That file didn't download"
          className="basis-full"
        >
          <span data-q-artifact-download-failure>{failure}</span>
        </InlineNotice>
      )}
    </>
  );
}
