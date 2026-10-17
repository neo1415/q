"use client";

import { useState, type ReactNode } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { Download, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { PdfPage, usePdfDocument } from "@/features/q/room/pdf-page";
import { useT } from "@/features/i18n/language";

/**
 * A document read inside Capital Q (owner 2026-10-17: "everything happens
 * within the app"). Opening a report, an edition or a transcript shows it
 * here, full screen, with "Save a copy" as the explicit secondary act for
 * someone who wants the file. A PDF is drawn page by page with PDF.js from
 * the same URL the download already used (a signed storage link, or the
 * app's existing authorised report route): nothing new carries the bytes,
 * and the server authorises the read exactly as it did for the download.
 */

export type ReaderDocument =
  | {
      readonly kind: "pdf";
      readonly title: string;
      readonly url: string;
      /** Where "Save a copy" points; the read URL when absent. */
      readonly saveUrl?: string | undefined;
    }
  | {
      readonly kind: "text";
      readonly title: string;
      readonly text: string;
      readonly fileName: string;
    };

/** No page asks for the words of each page; the reader only shows them. */
const ignoreText = () => undefined;

function PdfBody({
  url,
  title,
}: {
  readonly url: string;
  readonly title: string;
}) {
  const t = useT();
  const { state, retry } = usePdfDocument(url);
  if (state.kind === "loading") {
    return (
      <p className="cq-body-sm py-6 text-(--cq-text-secondary)" role="status">
        {t("Opening the document")}
      </p>
    );
  }
  if (state.kind === "unreachable") {
    return (
      <div className="flex flex-col items-start gap-3 py-6" role="status">
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {t("The document couldn't load.")}
        </p>
        <button
          type="button"
          className={buttonClassName("secondary")}
          onClick={retry}
        >
          {t("Try again")}
        </button>
      </div>
    );
  }
  if (state.kind === "failed") {
    return (
      <p className="cq-body-sm py-6 text-(--cq-text-secondary)" role="status">
        {t("This file can't be shown here. Save a copy to open it.")}
      </p>
    );
  }
  const pages = Array.from(
    { length: state.document.numPages },
    (_, index) => index + 1,
  );
  return (
    <ol className="flex flex-col gap-4 py-2" aria-label={title}>
      {pages.map((page) => (
        <li
          key={page}
          className="border border-(--cq-border-subtle) bg-(--cq-surface)"
        >
          <PdfPage
            document={state.document}
            page={page}
            title={title}
            onText={ignoreText}
          />
        </li>
      ))}
    </ol>
  );
}

/** Text saved as a file, from the browser: nothing leaves for a server. */
function saveText(text: string, fileName: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

function SaveCopy({ document: shown }: { readonly document: ReaderDocument }) {
  const t = useT();
  const label = (
    <>
      <Download
        aria-hidden="true"
        size={ICON_SIZE.compact}
        strokeWidth={ICON_STROKE}
      />
      {t("Save a copy")}
    </>
  );
  const className = buttonClassName("quiet");
  return shown.kind === "pdf" ? (
    <a
      href={shown.saveUrl ?? shown.url}
      download
      className={className}
      data-reader-save
    >
      {label}
    </a>
  ) : (
    <button
      type="button"
      className={className}
      onClick={() => saveText(shown.text, shown.fileName)}
      data-reader-save
    >
      {label}
    </button>
  );
}

export function InAppReader({
  document: shown,
  onClose,
}: {
  readonly document: ReaderDocument | null;
  readonly onClose: () => void;
}) {
  const t = useT();
  return (
    <SheetRoot
      open={shown !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      {shown === null ? null : (
        <SheetContent title={shown.title} side="full">
          <div className="mx-auto flex w-full max-w-4xl flex-col" data-reader>
            <div className="sticky top-0 z-(--cq-z-sticky) flex flex-wrap items-center justify-between gap-2 border-b border-(--cq-border-subtle) bg-(--cq-surface-raised) py-2">
              <p className="cq-caption text-(--cq-text-secondary)">
                {t("Reading in Capital Q.")}
              </p>
              <SaveCopy document={shown} />
            </div>
            {shown.kind === "pdf" ? (
              <PdfBody url={shown.url} title={shown.title} />
            ) : (
              <pre
                className="cq-body-sm py-4 font-sans whitespace-pre-wrap text-(--cq-text-primary)"
                data-reader-text
              >
                {shown.text}
              </pre>
            )}
          </div>
        </SheetContent>
      )}
    </SheetRoot>
  );
}

/**
 * The open-in-app control for a server-rendered page: a button that opens
 * the PDF at `url` in the reader. Its children say what it opens.
 */
export function OpenPdfButton({
  title,
  url,
  children,
  className,
  dataAttribute,
}: {
  readonly title: string;
  readonly url: string;
  readonly children: ReactNode;
  readonly className: string;
  /** A data attribute name for tests and tours, e.g. "data-daily-pdf". */
  readonly dataAttribute?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const data = dataAttribute === undefined ? {} : { [dataAttribute]: "" };
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        {...data}
      >
        {children}
      </button>
      <InAppReader
        document={open ? { kind: "pdf", title, url } : null}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
