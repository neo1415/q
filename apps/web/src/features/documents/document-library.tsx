"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { DialogContent, DialogRoot } from "@capital-q/ui/dialog";
import {
  CircleAlert,
  ICON_SIZE,
  ICON_STROKE,
  LayoutGrid,
  List,
  MoreHorizontal,
  Search,
  Upload,
  X,
} from "@capital-q/ui/icons";
import { Input } from "@capital-q/ui/input";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "@capital-q/ui/menu";
import { Select } from "@capital-q/ui/select";

import { useGlobalQ } from "@/components/app-shell/global-q";
import {
  materialUploadCompleteAction,
  materialUploadTargetAction,
} from "@/features/onboarding-kit/material-actions";
import { artifactFileUrl } from "@/features/q/artifact-download";

import { DECK_AUDIENCE_OPTIONS, deckAudienceDescription } from "./deck-sharing";
import { setDeckAudienceAction } from "./deck-sharing-actions";
import { openDocumentViewer } from "./document-ready";
import {
  archiveDocumentAction,
  documentFileAction,
  loadLibraryPageAction,
  renameDocumentAction,
} from "./library-actions";
import {
  documentTypeForFile,
  LIBRARY_FILTERS,
  matches,
  mergePage,
  Q_READ_LABEL,
  sizeLabel,
  sortItems,
  updatedLabel,
  visibleUpTo,
  type LibraryFilter,
  type LibraryItem,
  type LibraryPage,
  type LibrarySort,
} from "./library-model";

/**
 * The documents page (P3, lead 2026-10-04): everything Q made and
 * everything they uploaded, in one place, as a grid of pages or a list,
 * searchable, filterable and sortable, a page at a time by cursor. Each
 * document carries who can see it and whether Q has read it, and its
 * actions sit in one menu. Files dropped anywhere on the page upload
 * straight to private storage, with progress.
 */

type View = "grid" | "list";
const VIEW_KEY = "cq.documents.view";

const VIEW_EVENT = "cq-documents-view";
let sessionView: View | null = null;

function rememberedView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return sessionView ?? "grid";
  }
}

function storeView(next: View): void {
  try {
    window.localStorage.setItem(VIEW_KEY, next);
  } catch {
    // A private window keeps the choice for this visit only.
    sessionView = next;
  }
  window.dispatchEvent(new Event(VIEW_EVENT));
}

function subscribeView(onChange: () => void): () => void {
  window.addEventListener(VIEW_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(VIEW_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

type Upload = {
  readonly id: string;
  readonly name: string;
  readonly progress: number;
  readonly error: string | null;
};

/** The bytes, browser to the signed target, with progress (XHR reports it). */
function putWithProgress(
  target: {
    readonly url: string;
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
  },
  file: File,
  onProgress: (fraction: number) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    });
    request.addEventListener("load", () =>
      resolve(request.status >= 200 && request.status < 300),
    );
    request.addEventListener("error", () => resolve(false));
    request.open(target.method, target.url);
    for (const [name, value] of Object.entries(target.headers)) {
      request.setRequestHeader(name, value);
    }
    request.send(file);
  });
}

/** A first page drawn from what is known: the title on a sheet of paper. */
function PagePreview({ item }: { readonly item: LibraryItem }) {
  return (
    <div className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-(--cq-surface-subtle)">
      <div
        aria-hidden="true"
        className={
          item.isDeck
            ? "flex aspect-video w-[78%] flex-col gap-1.5 rounded-[3px] bg-(--cq-surface-raised) px-[8%] py-[7%] shadow-(--cq-shadow-sm)"
            : "flex aspect-[1/1.3] w-[56%] flex-col gap-1.5 rounded-[3px] bg-(--cq-surface-raised) px-[10%] py-[12%] shadow-(--cq-shadow-sm)"
        }
      >
        <span className="line-clamp-3 font-(family-name:--cq-font-editorial) text-[13px] leading-tight text-(--cq-text-primary)">
          {item.title}
        </span>
        <span className="mt-1 h-[3px] w-full rounded-full bg-(--cq-border-subtle)" />
        <span className="h-[3px] w-4/5 rounded-full bg-(--cq-border-subtle)" />
        {item.isDeck ? null : (
          <span className="h-[3px] w-3/5 rounded-full bg-(--cq-border-subtle)" />
        )}
      </div>
      {item.state === "PREPARING" ? (
        <span className="absolute bottom-2 left-2 rounded-sm bg-(--cq-surface-raised) px-2 py-0.5 cq-caption text-(--cq-text-secondary)">
          Q is writing this
        </span>
      ) : null}
      {item.state === "FAILED" ? (
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-sm bg-(--cq-surface-raised) px-2 py-0.5 cq-caption text-(--cq-danger)">
          <CircleAlert size={14} aria-hidden="true" /> Couldn&apos;t be finished
        </span>
      ) : null}
    </div>
  );
}

function metaOf(item: LibraryItem): string {
  const parts = [
    item.source === "Q"
      ? `Made by Q, version ${String(item.version)}`
      : item.typeLabel,
    sizeLabel(item.sizeBytes),
    updatedLabel(item.updatedAt),
  ].filter((part): part is string => part !== null);
  return parts.join(", ");
}

function QRead({ item }: { readonly item: LibraryItem }) {
  if (item.qRead === null) return null;
  const read = item.qRead === "READ";
  return (
    <span
      className={
        read
          ? "inline-flex items-center gap-1.5 cq-caption text-(--cq-accent)"
          : "inline-flex items-center gap-1.5 cq-caption text-(--cq-text-tertiary)"
      }
      data-q-read={item.qRead}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {Q_READ_LABEL[item.qRead]}
    </span>
  );
}

type Actions = {
  readonly open: (item: LibraryItem) => void;
  readonly share: (item: LibraryItem) => void;
  readonly download: (item: LibraryItem) => void;
  readonly rename: (item: LibraryItem) => void;
  readonly ask: (item: LibraryItem) => void;
  readonly remove: (item: LibraryItem) => void;
};

function ItemMenu({
  item,
  actions,
}: {
  readonly item: LibraryItem;
  readonly actions: Actions;
}) {
  const ready = item.state === "READY";
  const upload = item.source === "UPLOAD";
  return (
    <MenuRoot>
      <MenuTrigger>
        <button
          type="button"
          aria-label={`Actions for ${item.title}`}
          className="grid size-11 place-items-center rounded-md text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) lg:size-9"
          data-document-menu
        >
          <MoreHorizontal size={ICON_SIZE.regular} strokeWidth={ICON_STROKE} />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem disabled={!ready} onClick={() => actions.open(item)}>
          Open
        </MenuItem>
        <MenuItem onClick={() => actions.share(item)}>Share…</MenuItem>
        <MenuItem disabled={!ready} onClick={() => actions.download(item)}>
          Download
        </MenuItem>
        {upload ? (
          <MenuItem onClick={() => actions.rename(item)}>Rename…</MenuItem>
        ) : null}
        <MenuItem onClick={() => actions.ask(item)}>Ask Q about it</MenuItem>
        {upload ? (
          <>
            <MenuSeparator />
            <MenuItem tone="danger" onClick={() => actions.remove(item)}>
              Delete
            </MenuItem>
          </>
        ) : null}
      </MenuContent>
    </MenuRoot>
  );
}

function Card({
  item,
  actions,
}: {
  readonly item: LibraryItem;
  readonly actions: Actions;
}) {
  return (
    <li
      className="group relative flex flex-col gap-2.5"
      data-document-row={item.id}
      data-document-status={item.state}
    >
      <button
        type="button"
        className="rounded-lg text-left transition-transform duration-(--cq-motion-fast) active:scale-[0.98] disabled:active:scale-100"
        onClick={() => actions.open(item)}
        disabled={item.state !== "READY"}
        aria-label={`Open ${item.title}`}
        data-document-open
      >
        <PagePreview item={item} />
      </button>
      <div className="absolute right-1.5 top-1.5 rounded-md bg-(--cq-surface-raised) shadow-(--cq-shadow-xs)">
        <ItemMenu item={item} actions={actions} />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="cq-body line-clamp-2 font-medium text-(--cq-text-primary)">
          {item.title}
        </p>
        <p className="cq-caption text-(--cq-text-tertiary)">{metaOf(item)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="cq-caption text-(--cq-text-secondary)">
          {item.sharing}
        </span>
        <QRead item={item} />
      </div>
    </li>
  );
}

function Row({
  item,
  actions,
}: {
  readonly item: LibraryItem;
  readonly actions: Actions;
}) {
  return (
    <li
      className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-(--cq-border-subtle) py-2 md:grid-cols-[minmax(0,1fr)_9rem_6rem_7rem_11rem_auto]"
      data-document-row={item.id}
      data-document-status={item.state}
    >
      <button
        type="button"
        className="flex min-h-11 min-w-0 items-center gap-3 text-left"
        onClick={() => actions.open(item)}
        disabled={item.state !== "READY"}
        data-document-open
      >
        <span
          aria-hidden="true"
          className={
            item.isDeck
              ? "h-6 w-10 shrink-0 rounded-[3px] border border-(--cq-border-subtle) bg-(--cq-surface-raised)"
              : "h-10 w-8 shrink-0 rounded-[3px] border border-(--cq-border-subtle) bg-(--cq-surface-raised)"
          }
        />
        <span className="flex min-w-0 flex-col">
          <span className="cq-body truncate font-medium text-(--cq-text-primary)">
            {item.title}
          </span>
          <span className="cq-caption truncate text-(--cq-text-tertiary) md:hidden">
            {metaOf(item)}
          </span>
        </span>
      </button>
      <span className="hidden cq-body-sm text-(--cq-text-secondary) md:block">
        {item.source === "Q" ? "Made by Q" : item.typeLabel}
      </span>
      <span className="hidden cq-body-sm text-(--cq-text-tertiary) md:block">
        {sizeLabel(item.sizeBytes) ?? ""}
      </span>
      <span className="hidden cq-body-sm text-(--cq-text-tertiary) md:block">
        {updatedLabel(item.updatedAt)}
      </span>
      <span className="hidden flex-col md:flex">
        <span className="cq-caption text-(--cq-text-secondary)">
          {item.sharing}
        </span>
        <QRead item={item} />
      </span>
      <ItemMenu item={item} actions={actions} />
    </li>
  );
}

export function DocumentLibrary({
  initial,
  companyId,
  openOnArrival = null,
}: {
  /** Null when the first page could not be read. */
  readonly initial: LibraryPage | null;
  /** Their company, when uploads can belong to one. */
  readonly companyId: string | null;
  readonly openOnArrival?: string | null;
}) {
  const { askAbout } = useGlobalQ();
  const searchId = useId();
  const sortId = useId();
  const renameId = useId();
  const fileInput = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<readonly LibraryItem[]>(
    initial?.items ?? [],
  );
  const [cursors, setCursors] = useState<LibraryPage["cursors"]>(
    initial?.cursors ?? { q: null, uploads: null },
  );
  const [failed, setFailed] = useState(initial === null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<LibraryFilter>("ALL");
  const [sort, setSort] = useState<LibrarySort>("RECENT");
  const [query, setQuery] = useState("");
  const [uploads, setUploads] = useState<readonly Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{
    readonly text: string;
    readonly undo?: () => void;
  } | null>(null);
  const [renaming, setRenaming] = useState<LibraryItem | null>(null);
  const [sharing, setSharing] = useState<LibraryItem | null>(null);

  // Per device, read after hydration (the server always draws the grid).
  const view = useSyncExternalStore(
    subscribeView,
    rememberedView,
    (): View => "grid",
  );
  const chooseView = storeView;

  // A document Q was asked to open (`?open=<id>`), only when it is one of
  // theirs, listed and ready.
  useEffect(() => {
    if (openOnArrival === null) return;
    const found = items.find(
      (item) =>
        item.source === "Q" &&
        item.id.toLowerCase() === openOnArrival.toLowerCase() &&
        item.state === "READY",
    );
    if (found !== undefined) openDocumentViewer(found.id);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const more = cursors.q !== null || cursors.uploads !== null;

  const loadMore = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    const page = await loadLibraryPageAction({
      ...(cursors.q === null ? { q: null } : { q: cursors.q }),
      ...(cursors.uploads === null
        ? { uploads: null }
        : { uploads: cursors.uploads }),
    });
    setLoading(false);
    if (!page.ok) {
      setNotice({ text: page.message });
      return;
    }
    setItems((current) => mergePage(current, page.value.items));
    setCursors(page.value.cursors);
  }, [cursors, loading]);

  const reload = useCallback(async () => {
    setLoading(true);
    const page = await loadLibraryPageAction({});
    setLoading(false);
    if (!page.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setItems(page.value.items);
    setCursors(page.value.cursors);
  }, []);

  const shown = useMemo(
    () =>
      sortItems(
        visibleUpTo(items, cursors).filter((item) =>
          matches(item, filter, query),
        ),
        sort,
      ),
    [items, cursors, filter, query, sort],
  );

  // --- Uploading ------------------------------------------------------------

  const upload = async (file: File) => {
    if (companyId === null) return;
    const id = `${file.name}:${String(Date.now())}:${String(Math.random())}`;
    const patch = (change: Partial<Upload>) =>
      setUploads((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, ...change } : entry,
        ),
      );
    setUploads((current) => [
      ...current,
      { id, name: file.name, progress: 0, error: null },
    ]);
    const target = await materialUploadTargetAction({
      companyId,
      documentType: documentTypeForFile(file.name),
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    });
    if (!target.ok) {
      patch({ error: target.message });
      return;
    }
    const stored = await putWithProgress(target.value, file, (progress) =>
      patch({ progress }),
    );
    if (!stored) {
      patch({ error: "The upload stopped. Try again." });
      return;
    }
    const completed = await materialUploadCompleteAction(
      target.value.uploadSessionId,
    );
    if (!completed.ok) {
      patch({ error: completed.message });
      return;
    }
    setUploads((current) => current.filter((entry) => entry.id !== id));
    await reload();
  };
  const uploadAll = (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) void upload(file);
  };

  // --- Actions --------------------------------------------------------------

  const actions: Actions = {
    open: (item) => {
      if (item.source === "Q") {
        openDocumentViewer(item.id);
        return;
      }
      // A new tab opened now, filled when the signed link arrives, so a
      // popup blocker never eats the click.
      const tab = window.open("", "_blank");
      void documentFileAction(item.id).then((link) => {
        if (link.ok && tab !== null) tab.location.href = link.value.url;
        else {
          tab?.close();
          if (!link.ok) setNotice({ text: link.message });
        }
      });
    },
    download: (item) => {
      if (item.source === "Q") {
        window.location.href = artifactFileUrl(item.id, "pdf", null);
        return;
      }
      void documentFileAction(item.id).then((link) => {
        if (link.ok) window.location.href = link.value.url;
        else setNotice({ text: link.message });
      });
    },
    share: (item) => {
      if (item.source === "UPLOAD" && item.isDeck) {
        setSharing(item);
        return;
      }
      askAbout(`Share "${item.title}" with `);
    },
    rename: (item) => setRenaming(item),
    ask: (item) => askAbout(`About "${item.title}": `),
    remove: (item) => {
      setItems((current) => current.filter((entry) => entry.key !== item.key));
      void archiveDocumentAction({ documentId: item.id, archived: true }).then(
        (result) => {
          if (!result.ok) {
            setItems((current) => mergePage(current, [item]));
            setNotice({ text: result.message });
            return;
          }
          setNotice({
            text: `Deleted "${item.title}".`,
            undo: () => {
              setNotice(null);
              void archiveDocumentAction({
                documentId: item.id,
                archived: false,
              }).then(() => void reload());
            },
          });
        },
      );
    },
  };

  const filtered = filter !== "ALL" || query.trim().length > 0;

  return (
    <section
      aria-labelledby="documents-list"
      className="relative flex flex-col gap-4"
      onDragOver={(event) => {
        if (companyId === null) return;
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        setDragging(false);
      }}
      onDrop={(event) => {
        if (companyId === null) return;
        event.preventDefault();
        setDragging(false);
        uploadAll(event.dataTransfer.files);
      }}
      data-documents-library
    >
      <h2 id="documents-list" className="sr-only">
        Your documents
      </h2>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor={searchId}
            className="flex h-11 min-w-0 flex-1 basis-60 items-center gap-2 rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 focus-within:border-(--cq-accent) lg:h-10"
          >
            <Search
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
              aria-hidden="true"
              className="text-(--cq-text-tertiary)"
            />
            <span className="sr-only">Search documents</span>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documents"
              className="min-w-0 flex-1 bg-transparent cq-body-sm text-(--cq-text-primary) outline-none placeholder:text-(--cq-text-tertiary)"
              data-documents-search
            />
          </label>
          <div className="flex items-center gap-2">
            <Select
              id={sortId}
              label="Sort"
              labelHidden
              value={sort}
              onChange={(event) => setSort(event.target.value as LibrarySort)}
              options={[
                { value: "RECENT", label: "Recent" },
                { value: "NAME", label: "Name" },
                { value: "TYPE", label: "Type" },
              ]}
              data-documents-sort
            />
            <div
              role="group"
              aria-label="View"
              className="inline-flex shrink-0 overflow-hidden rounded-md border border-(--cq-border)"
            >
              {(
                [
                  ["grid", LayoutGrid, "Grid"],
                  ["list", List, "List"],
                ] as const
              ).map(([value, Icon, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={view === value}
                  aria-label={label}
                  onClick={() => chooseView(value)}
                  className={
                    view === value
                      ? "grid size-11 place-items-center bg-(--cq-surface-strong) text-(--cq-text-primary) lg:size-10"
                      : "grid size-11 place-items-center text-(--cq-text-tertiary) hover:bg-(--cq-surface-subtle) lg:size-10"
                  }
                  data-documents-view={value}
                >
                  <Icon size={ICON_SIZE.regular} strokeWidth={ICON_STROKE} />
                </button>
              ))}
            </div>
            {companyId === null ? null : (
              <button
                type="button"
                className={buttonClassName("primary", "regular")}
                onClick={() => fileInput.current?.click()}
                data-documents-upload
              >
                <Upload
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                  aria-hidden="true"
                />
                Upload
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                uploadAll(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
        </div>
        <div
          role="group"
          aria-label="Show"
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
        >
          {LIBRARY_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={
                filter === option.value
                  ? "min-h-11 shrink-0 rounded-full bg-(--cq-text-primary) px-3.5 cq-body-sm text-(--cq-canvas) lg:min-h-8"
                  : "min-h-11 shrink-0 rounded-full border border-(--cq-border-subtle) px-3.5 cq-body-sm text-(--cq-text-secondary) hover:border-(--cq-border-strong) lg:min-h-8"
              }
              data-documents-filter={option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {uploads.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Uploading">
          {uploads.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-3 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface) px-3.5 py-2.5"
              data-documents-uploading
            >
              <span className="cq-body-sm min-w-0 flex-1 truncate text-(--cq-text-primary) sm:flex-none sm:basis-64">
                {entry.name}
              </span>
              {entry.error === null ? (
                <>
                  <span
                    role="progressbar"
                    aria-label={`Uploading ${entry.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(entry.progress * 100)}
                    className="hidden h-1 flex-1 overflow-hidden rounded-full bg-(--cq-surface-strong) sm:block"
                  >
                    <span
                      className="block h-full origin-left rounded-full bg-(--cq-accent) transition-transform duration-(--cq-motion-fast)"
                      style={{ transform: `scaleX(${String(entry.progress)})` }}
                    />
                  </span>
                  <span className="cq-caption tabular-nums text-(--cq-text-tertiary)">
                    {Math.round(entry.progress * 100)}%
                  </span>
                </>
              ) : (
                <span className="cq-caption flex-1 text-(--cq-danger)">
                  {entry.error}
                </span>
              )}
              {entry.error === null ? null : (
                <button
                  type="button"
                  aria-label={`Dismiss ${entry.name}`}
                  className="grid size-9 place-items-center rounded-md text-(--cq-text-tertiary) hover:bg-(--cq-surface-subtle)"
                  onClick={() =>
                    setUploads((current) =>
                      current.filter((u) => u.id !== entry.id),
                    )
                  }
                >
                  <X size={ICON_SIZE.compact} strokeWidth={ICON_STROKE} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {failed ? (
        <div
          className="flex flex-col items-start gap-3 py-8"
          data-state="unavailable"
        >
          <p className="cq-body font-medium text-(--cq-text-primary)">
            Your documents didn&apos;t load
          </p>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Who can see them hasn&apos;t changed.
          </p>
          <button
            type="button"
            className={buttonClassName("secondary")}
            onClick={() => void reload()}
          >
            Try again
          </button>
        </div>
      ) : items.length === 0 && !more ? (
        <div
          className="flex flex-col items-start gap-3 py-8"
          data-state="empty"
        >
          <p className="cq-body font-medium text-(--cq-text-primary)">
            No documents yet
          </p>
          <p className="cq-body-sm max-w-prose text-(--cq-text-secondary)">
            {companyId === null
              ? "Q's decks, briefs and reports land here."
              : "Drop a deck, model or contract here. Q reads it and tells you what's missing."}
          </p>
          <div className="flex flex-wrap gap-2">
            {companyId === null ? null : (
              <button
                type="button"
                className={buttonClassName("primary")}
                onClick={() => fileInput.current?.click()}
              >
                Upload
              </button>
            )}
            <button
              type="button"
              className={buttonClassName("secondary")}
              onClick={() => askAbout("Make me a pitch deck.")}
              data-documents-ask
            >
              Ask Q for a deck
            </button>
          </div>
        </div>
      ) : shown.length === 0 && filtered ? (
        <div
          className="flex flex-col items-start gap-3 py-8"
          data-state="no-match"
        >
          <p className="cq-body font-medium text-(--cq-text-primary)">
            {query.trim().length > 0
              ? `No matches for "${query.trim()}"`
              : "Nothing here yet"}
          </p>
          <button
            type="button"
            className={buttonClassName("secondary")}
            onClick={() => {
              setQuery("");
              setFilter("ALL");
            }}
          >
            Show everything
          </button>
        </div>
      ) : view === "grid" ? (
        <ul
          className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4"
          data-documents-list
          data-view="grid"
        >
          {shown.map((item) => (
            <Card key={item.key} item={item} actions={actions} />
          ))}
        </ul>
      ) : (
        <ul
          className="flex flex-col border-t border-(--cq-border-subtle)"
          data-documents-list
          data-view="list"
        >
          {shown.map((item) => (
            <Row key={item.key} item={item} actions={actions} />
          ))}
        </ul>
      )}

      {loading && items.length === 0 ? (
        <ul
          aria-hidden="true"
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
        >
          {[0, 1, 2, 3].map((n) => (
            <li
              key={n}
              className="aspect-[4/3] animate-pulse rounded-lg bg-(--cq-surface-subtle) motion-reduce:animate-none"
            />
          ))}
        </ul>
      ) : null}

      {more && !failed ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            className={buttonClassName("secondary")}
            onClick={() => void loadMore()}
            aria-busy={loading}
            disabled={loading}
            data-documents-more
          >
            {loading ? "Loading…" : "Show more"}
          </button>
        </div>
      ) : null}

      {dragging ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-(--cq-z-sticky) grid place-items-center rounded-xl border-2 border-dashed border-(--cq-accent) bg-(--cq-accent-soft)/90 cq-body font-medium text-(--cq-accent)"
        >
          Drop to upload
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="min-h-6">
        {notice === null ? null : (
          <span className="inline-flex items-center gap-3 cq-body-sm text-(--cq-text-secondary)">
            {notice.text}
            {notice.undo === undefined ? null : (
              <button
                type="button"
                className={buttonClassName("quiet", "compact")}
                onClick={notice.undo}
                data-documents-undo
              >
                Undo
              </button>
            )}
          </span>
        )}
      </p>

      <DialogRoot
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        {renaming === null ? null : (
          <DialogContent title="Rename">
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const named = new FormData(event.currentTarget).get("title");
                const title = typeof named === "string" ? named.trim() : "";
                const item = renaming;
                if (title.length === 0) return;
                setRenaming(null);
                setItems((current) =>
                  current.map((entry) =>
                    entry.key === item.key ? { ...entry, title } : entry,
                  ),
                );
                void renameDocumentAction({
                  documentId: item.id,
                  title,
                  expectedVersion: item.version,
                }).then((result) => {
                  if (result.ok) {
                    setItems((current) =>
                      current.map((entry) =>
                        entry.key === item.key
                          ? {
                              ...entry,
                              title: result.value.title,
                              version: result.value.version,
                            }
                          : entry,
                      ),
                    );
                  } else {
                    setItems((current) => mergePage(current, [item]));
                    setNotice({ text: result.message });
                  }
                });
              }}
            >
              <Input
                id={renameId}
                name="title"
                label="Name"
                defaultValue={renaming.title}
                maxLength={200}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className={buttonClassName("secondary")}
                  onClick={() => setRenaming(null)}
                >
                  Cancel
                </button>
                <button type="submit" className={buttonClassName("primary")}>
                  Save name
                </button>
              </div>
            </form>
          </DialogContent>
        )}
      </DialogRoot>

      <DialogRoot
        open={sharing !== null}
        onOpenChange={(open) => {
          if (!open) setSharing(null);
        }}
      >
        {sharing === null ? null : (
          <DeckShareDialog
            item={sharing}
            onDone={(audience, version) => {
              const item = sharing;
              setSharing(null);
              setItems((current) =>
                current.map((entry) =>
                  entry.key === item.key
                    ? {
                        ...entry,
                        version,
                        downloadAudience: audience,
                        shared: audience === "INVESTORS",
                        sharing:
                          audience === "INVESTORS"
                            ? "Investors can download"
                            : "Only your team",
                      }
                    : entry,
                ),
              );
            }}
            onCancel={() => setSharing(null)}
          />
        )}
      </DialogRoot>
    </section>
  );
}

function DeckShareDialog({
  item,
  onDone,
  onCancel,
}: {
  readonly item: LibraryItem;
  readonly onDone: (
    audience: "ORGANISATION" | "INVESTORS",
    version: number,
  ) => void;
  readonly onCancel: () => void;
}) {
  const id = useId();
  const [audience, setAudience] = useState(
    item.downloadAudience ?? "ORGANISATION",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <DialogContent title={`Share "${item.title}"`}>
      <div className="flex flex-col gap-4">
        <Select
          id={id}
          label="Who can download it"
          description={deckAudienceDescription(audience)}
          value={audience}
          onChange={(event) =>
            setAudience(
              event.target.value === "INVESTORS" ? "INVESTORS" : "ORGANISATION",
            )
          }
          options={DECK_AUDIENCE_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
        {error === null ? null : (
          <p className="cq-body-sm text-(--cq-danger)">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={buttonClassName("secondary")}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={buttonClassName("primary")}
            disabled={busy || audience === item.downloadAudience}
            onClick={() => {
              setBusy(true);
              void setDeckAudienceAction({
                documentId: item.id,
                audience,
                expectedVersion: item.version,
              }).then((result) => {
                setBusy(false);
                if (result.ok)
                  onDone(result.value.downloadAudience, result.value.version);
                else setError(result.message);
              });
            }}
          >
            Save
          </button>
        </div>
      </div>
    </DialogContent>
  );
}
