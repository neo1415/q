"use client";

import { Download, Lock } from "@capital-q/ui/icons";
import { ICON_SIZE } from "@capital-q/ui/icons";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import type { OpenedFile } from "./material-actions";

/**
 * The reader's name over every page of a view-only file (A3/A4). It deters
 * and attributes; it does not prevent a screenshot, and nothing here claims
 * it does. Pointer events pass through to the document underneath.
 */
export function Watermark({ words }: { readonly words: string }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex flex-col justify-around overflow-hidden select-none"
      data-watermark
    >
      {[0, 1, 2, 3].map((row) => (
        <p
          key={row}
          className="cq-caption -rotate-12 text-center whitespace-nowrap text-(--cq-text-tertiary) opacity-40"
        >
          {words} &nbsp; · &nbsp; {words}
        </p>
      ))}
    </div>
  );
}

/** One opened file, inline, in a sheet: the bytes go browser <-> storage. */
export function FileViewer({
  title,
  file,
  onClose,
}: {
  readonly title: string;
  readonly file: OpenedFile | null;
  readonly onClose: () => void;
}) {
  return (
    <SheetRoot
      open={file !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      {file === null ? null : (
        <SheetContent
          title={title}
          side="full"
          description={file.downloadable ? undefined : "View only"}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-(--cq-border-subtle) bg-(--cq-surface)">
              <iframe
                src={
                  file.downloadable
                    ? file.url
                    : `${file.url}#toolbar=0&navpanes=0`
                }
                title={title}
                className="h-full min-h-[60dvh] w-full"
                referrerPolicy="no-referrer"
              />
              {file.watermark === null ? null : (
                <Watermark words={file.watermark} />
              )}
            </div>
            <p className="cq-caption flex items-center gap-1.5 text-(--cq-text-secondary)">
              {file.downloadable ? (
                <a
                  href={file.url}
                  download
                  className="inline-flex min-h-11 items-center gap-1.5 underline underline-offset-4"
                >
                  <Download size={ICON_SIZE.compact} aria-hidden="true" />{" "}
                  Download
                </a>
              ) : (
                <>
                  <Lock size={ICON_SIZE.compact} aria-hidden="true" />
                  View only. Your name is shown on every page.
                </>
              )}
            </p>
          </div>
        </SheetContent>
      )}
    </SheetRoot>
  );
}
