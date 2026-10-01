"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { z } from "zod";

import { qArtifactExportFormats } from "@capital-q/contracts";
import { buttonClassName, IconButton } from "@capital-q/ui/button";
import { DialogRoot, DialogViewerContent } from "@capital-q/ui/dialog";
import {
  CircleAlert,
  FileText,
  ICON_SIZE,
  ICON_STROKE,
  Presentation,
  X,
} from "@capital-q/ui/icons";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { useDockAvoid } from "@/features/q-dock/dock-avoid";
import { ArtifactDownloads } from "@/features/q/artifact-download";
import { artifactTypeLabel } from "@/features/q/artifact-type";
import { ArtifactViewer } from "@/features/q/artifact-viewer";

import {
  announceDocument,
  dismissDocument,
  openDocumentViewer,
  readyChanges,
  useReadyDocuments,
  useViewingDocument,
  useWatchSignal,
  watching,
  type KnownDocuments,
  type ListedDocument,
  type ReadyDocument,
} from "./document-ready";

/**
 * The document-ready card, on every page (DOCS spec §3 F2; founder
 * directive 2026-10-01: "a download/open card pops up anywhere on screen
 * like a notification").
 *
 * The one owner: mounted once in the app shell, it watches the person's
 * own newest documents and shows a card when one becomes ready or gets a
 * new version, with Open (the viewer, in place) and the downloads. It
 * checks often while something is being prepared and slowly otherwise,
 * and only while the tab is visible. Nothing here decides what anybody
 * may read: the list and every file come through the session's own
 * narrow routes.
 */

const RESTING_MS = 30_000;
const WATCHING_MS = 4_000;
/** How long a card stays when nobody is looking at it. */
const AUTO_DISMISS_MS = 12_000;

const RecentSchema = z.object({
  items: z
    .array(
      z.object({
        artifactId: z.string(),
        type: z.string(),
        status: z.string(),
        title: z.string(),
        currentVersion: z.number().int(),
        updatedAt: z.string(),
      }),
    )
    .max(20),
});

async function listRecent(): Promise<readonly ListedDocument[] | null> {
  try {
    const response = await fetch("/api/q-artifact/recent", {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const parsed = RecentSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.items : null;
  } catch {
    return null;
  }
}

/** Polls the person's newest documents and announces what changed. */
export function useDocumentWatch(connected: boolean): void {
  const signal = useWatchSignal();
  const known = useRef<KnownDocuments>(new Map());
  const openedAt = useRef<number>(0);
  useEffect(() => {
    if (openedAt.current === 0) openedAt.current = Date.now();
  }, []);

  useEffect(() => {
    if (!connected) return;
    let alive = true;
    let timer: number | undefined;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const items = await listRecent();
      if (!alive || items === null) return;
      const changes = readyChanges(known.current, items, openedAt.current);
      known.current = changes.known;
      for (const ready of changes.announce) announceDocument(ready);
    };
    const schedule = () => {
      const anyPreparing = [...known.current.values()].some(
        (entry) => entry.status === "PREPARING",
      );
      timer = window.setTimeout(
        () => {
          void check().finally(() => {
            if (alive) schedule();
          });
        },
        watching() || anyPreparing ? WATCHING_MS : RESTING_MS,
      );
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check().finally(() => {
      if (alive) schedule();
    });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // `signal` restarts the loop at the fast pace when watching begins.
  }, [connected, signal]);
}

function ReadyCard({
  document: ready,
  onOpen,
}: {
  readonly document: ReadyDocument;
  readonly onOpen: (artifactId: string) => void;
}) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => {
      dismissDocument(ready.artifactId);
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [held, ready.artifactId, ready.version]);

  const failed = ready.status === "FAILED";
  const Icon = failed
    ? CircleAlert
    : ready.type === "PITCH_DECK"
      ? Presentation
      : FileText;
  const what = artifactTypeLabel(ready.type);
  const state = failed
    ? "Q couldn't finish this one"
    : ready.version > 1
      ? `Version ${String(ready.version)} ready`
      : "Ready";

  return (
    <section
      role="status"
      aria-live="polite"
      aria-label={`${what}: ${ready.title}. ${state}.`}
      data-document-ready={ready.artifactId}
      data-document-ready-status={ready.status}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          setHeld(false);
        }
      }}
      className="cq-document-ready pointer-events-auto flex w-full flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4 shadow-(--cq-shadow-overlay)"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-md bg-(--cq-surface-subtle) text-(--cq-text-secondary)"
        >
          <Icon size={ICON_SIZE.regular} strokeWidth={ICON_STROKE} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="cq-caption text-(--cq-text-tertiary)">
            {what} · {state}
          </p>
          <p className="cq-body-sm line-clamp-2 font-medium text-(--cq-text-primary)">
            {ready.title}
          </p>
        </div>
        <IconButton
          aria-label="Dismiss"
          variant="quiet"
          onClick={() => dismissDocument(ready.artifactId)}
          data-document-ready-dismiss
        >
          <X size={ICON_SIZE.compact} strokeWidth={ICON_STROKE} aria-hidden />
        </IconButton>
      </div>
      {failed ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonClassName("primary", "regular")}
            onClick={() => onOpen(ready.artifactId)}
            data-document-ready-open
          >
            Open
          </button>
          <ArtifactDownloads
            artifactId={ready.artifactId}
            formats={qArtifactExportFormats(ready.type)}
            version={ready.version}
          />
        </div>
      )}
    </section>
  );
}

export function DocumentReadyCenter({
  connected,
}: {
  readonly connected: boolean;
}) {
  useDocumentWatch(connected);
  const ready = useReadyDocuments();
  const open = useViewingDocument();
  const setOpen = openDocumentViewer;
  const pathname = usePathname();
  const { askAbout } = useGlobalQ();
  const stack = useRef<HTMLDivElement | null>(null);
  useDockAvoid(stack, ready.length > 0);

  return (
    <>
      {ready.length === 0 ? null : (
        <div
          ref={stack}
          data-document-ready-stack
          className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--cq-bottom-nav-height)+var(--cq-safe-bottom)+8px)] z-(--cq-z-toast) mx-auto flex max-w-sm flex-col gap-2 lg:right-6 lg:bottom-6 lg:left-auto lg:mx-0 lg:w-96"
        >
          {ready.map((document) => (
            <ReadyCard
              key={`${document.artifactId}:${String(document.version)}`}
              document={document}
              onOpen={(artifactId) => {
                dismissDocument(artifactId);
                setOpen(artifactId);
              }}
            />
          ))}
        </div>
      )}
      <DialogRoot
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      >
        {open === null ? null : (
          <DialogViewerContent
            title="Document"
            onSwipeDismiss={() => setOpen(null)}
          >
            <ArtifactViewer
              artifactId={open}
              onClose={() => setOpen(null)}
              // On the Q page the page is the conversation; elsewhere the
              // edit goes to Q beside the page.
              {...(pathname === "/home"
                ? {}
                : {
                    onEditWithQ: (title: string) => {
                      setOpen(null);
                      askAbout(
                        `Edit "${title}" with me — what would you change first?`,
                      );
                    },
                  })}
            />
          </DialogViewerContent>
        )}
      </DialogRoot>
    </>
  );
}
