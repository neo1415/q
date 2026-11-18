"use client";

import {
  AnimatePresence,
  motion,
  Reorder,
  useDragControls,
  useReducedMotion,
} from "motion/react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  publicSiteBlocks,
  resolveSitePlaceholders,
  SiteBlocksSchema,
  siteLawyerNoteCount,
  sitePlaceholdersIn,
  SITE_PLACEHOLDERS,
  type AdminSitePageDetailDto,
  type SiteBlock,
  type SiteBlockType,
  type SiteLeafBlock,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { DialogContent, DialogRoot } from "@capital-q/ui/dialog";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { useStepUpGuard } from "@/features/admin/console-ui";
import { useT } from "@/features/i18n/language";
import { useDirty } from "@/features/workspace/workspace-screen";

import { SitePageView } from "../site-page-view";
import {
  BLOCK_LABEL,
  cloneBlock,
  newBlock,
  newLeafBlock,
  PAGE_KIND_LABEL,
  PALETTE,
} from "./block-catalogue";
import { LeafBlockEditor } from "./block-editors";
import {
  loadSiteVersionAction,
  publishSitePageAction,
  restoreSiteVersionAction,
  saveSiteDraftAction,
  unpublishSitePageAction,
  type ContentResult,
} from "./content-actions";
import { InlineText } from "./rich-text-editable";

/**
 * The site content editor (decision 107): a page as a column of blocks you
 * edit in place, drag to reorder (or move with the keyboard), add from a
 * palette by click or drag, preview at desktop and phone widths, and
 * publish with version history and restore.
 *
 * Drafts save themselves a second after the last change; publishing turns
 * the saved draft into a new immutable version. The server re-validates
 * every block, every write needs the console's step-up, and nothing here
 * decides who may do what.
 */

export type ContentEditorActions = {
  readonly save: typeof saveSiteDraftAction;
  readonly publish: typeof publishSitePageAction;
  readonly unpublish: typeof unpublishSitePageAction;
  readonly restore: typeof restoreSiteVersionAction;
  readonly loadVersion: typeof loadSiteVersionAction;
  readonly upload: (file: File) => Promise<string | null>;
};

const SERVER_ACTIONS: Omit<ContentEditorActions, "upload"> = {
  save: saveSiteDraftAction,
  publish: publishSitePageAction,
  unpublish: unpublishSitePageAction,
  restore: restoreSiteVersionAction,
  loadVersion: loadSiteVersionAction,
};

type SaveState =
  | { readonly kind: "saved"; readonly at: string }
  | { readonly kind: "pending" }
  | { readonly kind: "saving" }
  | { readonly kind: "invalid" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "conflict" };

type View = "edit" | "desktop" | "phone";

const AUTOSAVE_MS = 900;

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dateTimeOf(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Icon({
  path,
  className = "size-4",
}: {
  readonly path: string;
  readonly className?: string;
}) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ICONS = {
  grip: "M6 3.5h.01M10 3.5h.01M6 8h.01M10 8h.01M6 12.5h.01M10 12.5h.01",
  up: "M8 12.5v-9M4.5 7L8 3.5 11.5 7",
  down: "M8 3.5v9M4.5 9L8 12.5 11.5 9",
  copy: "M5.5 5.5V3.5a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1h-2M2.5 6.5a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1h-6a1 1 0 01-1-1z",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5",
  plus: "M8 3.5v9M3.5 8h9",
  back: "M10 3.5L5.5 8 10 12.5",
  history: "M3 8a5 5 0 105-5 5 5 0 00-4 2M3 3v2.5h2.5M8 5.5V8l2 1.5",
};

const iconButton =
  "cq-cms-press inline-flex size-9 items-center justify-center rounded-(--cq-radius-sm) text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) disabled:opacity-40";

/** Block-type settings that are not words. */
function BlockSettings({
  block,
  onChange,
}: {
  readonly block: SiteBlock;
  readonly onChange: (next: SiteBlock) => void;
}) {
  const select =
    "cq-label h-9 rounded-(--cq-radius-sm) border border-(--cq-border-subtle) bg-(--cq-surface) px-2 text-(--cq-text-primary)";
  if (block.type === "heading") {
    return (
      <select
        aria-label="Heading size"
        className={select}
        value={block.level}
        onChange={(event) =>
          onChange({ ...block, level: Number(event.target.value) as 1 | 2 | 3 })
        }
      >
        <option value={1}>Large</option>
        <option value={2}>Medium</option>
        <option value={3}>Small</option>
      </select>
    );
  }
  if (block.type === "callout") {
    return (
      <select
        aria-label="Callout tone"
        className={select}
        value={block.tone}
        onChange={(event) =>
          onChange({
            ...block,
            tone: event.target.value as "info" | "note" | "warning",
          })
        }
      >
        <option value="note">Note</option>
        <option value="info">Information</option>
        <option value="warning">Warning</option>
      </select>
    );
  }
  if (block.type === "button") {
    return (
      <select
        aria-label="Button style"
        className={select}
        value={block.variant}
        onChange={(event) =>
          onChange({
            ...block,
            variant: event.target.value as "primary" | "secondary",
          })
        }
      >
        <option value="primary">Primary</option>
        <option value="secondary">Secondary</option>
      </select>
    );
  }
  return null;
}

function ColumnsEditor({
  block,
  onChange,
  onUpload,
  imageSrc,
}: {
  readonly block: Extract<SiteBlock, { type: "columns" }>;
  readonly onChange: (next: SiteBlock) => void;
  readonly onUpload: (file: File) => Promise<string | null>;
  readonly imageSrc: (documentId: string) => string;
}) {
  const side = (which: "left" | "right") => {
    const list = block[which];
    const set = (next: SiteLeafBlock[]) =>
      onChange({ ...block, [which]: next });
    return (
      <div className="flex flex-col gap-3 rounded-(--cq-radius-md) border border-dashed border-(--cq-border-subtle) p-3">
        <span className="cq-caption text-(--cq-text-tertiary)">
          {which === "left" ? "Left column" : "Right column"}
        </span>
        {list.map((inner, index) => (
          <div key={inner.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="cq-caption text-(--cq-text-tertiary)">
                {BLOCK_LABEL[inner.type]}
              </span>
              <span className="flex">
                <button
                  type="button"
                  className={iconButton}
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => {
                    const next = [...list];
                    const [moved] = next.splice(index, 1);
                    if (moved !== undefined) next.splice(index - 1, 0, moved);
                    set(next);
                  }}
                >
                  <Icon path={ICONS.up} />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  aria-label="Remove from column"
                  onClick={() => set(list.filter((_, i) => i !== index))}
                >
                  <Icon path={ICONS.trash} />
                </button>
              </span>
            </div>
            <LeafBlockEditor
              block={inner}
              onChange={(next) =>
                set(list.map((b, i) => (i === index ? next : b)))
              }
              onUpload={onUpload}
              imageSrc={imageSrc}
            />
          </div>
        ))}
        <select
          aria-label={`Add to the ${which} column`}
          className="cq-label h-9 self-start rounded-(--cq-radius-sm) border border-(--cq-border-subtle) bg-(--cq-surface) px-2 text-(--cq-text-secondary)"
          value=""
          onChange={(event) => {
            const type = event.target.value as Exclude<
              SiteBlockType,
              "columns"
            >;
            if (event.target.value !== "") set([...list, newLeafBlock(type)]);
          }}
        >
          <option value="">Add a block…</option>
          {PALETTE.filter((entry) => entry.type !== "columns").map((entry) => (
            <option key={entry.type} value={entry.type}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>
    );
  };
  return (
    <div className="grid gap-3 @3xl:grid-cols-2">
      {side("left")}
      {side("right")}
    </div>
  );
}

function CanvasBlock({
  block,
  index,
  count,
  selected,
  onSelect,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
  onUpload,
  imageSrc,
  onKeyboardMove,
}: {
  readonly block: SiteBlock;
  readonly index: number;
  readonly count: number;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onChange: (next: SiteBlock) => void;
  readonly onMove: (to: number) => void;
  readonly onDuplicate: () => void;
  readonly onRemove: () => void;
  readonly onUpload: (file: File) => Promise<string | null>;
  readonly imageSrc: (documentId: string) => string;
  readonly onKeyboardMove: (direction: -1 | 1) => void;
}) {
  const controls = useDragControls();
  const reduce = useReducedMotion();
  const [dragging, setDragging] = useState(false);
  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      onKeyboardMove(event.key === "ArrowUp" ? -1 : 1);
    }
  };
  return (
    <Reorder.Item
      as="li"
      value={block}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
      data-block-id={block.id}
      data-block-type={block.type}
      layout="position"
      transition={
        reduce === true
          ? { duration: 0 }
          : { type: "spring", duration: 0.28, bounce: 0.1 }
      }
      className="relative list-none"
      style={{ zIndex: dragging ? 2 : undefined }}
    >
      <div
        className={`cq-cms-block group relative rounded-(--cq-radius-lg) bg-(--cq-surface) px-4 pt-2 pb-4 @2xl:ps-12 ${
          dragging ? "shadow-(--cq-shadow-overlay)" : ""
        }`}
        data-selected={selected}
        onFocusCapture={onSelect}
        onPointerDown={onSelect}
      >
        <div className="flex min-h-10 items-center gap-1">
          <button
            type="button"
            className={`cq-cms-handle ${iconButton} touch-none cursor-grab active:cursor-grabbing @2xl:absolute @2xl:start-2 @2xl:top-2`}
            aria-label={`Move ${BLOCK_LABEL[block.type]} block, position ${String(index + 1)} of ${String(count)}. Drag, or use the arrow keys.`}
            aria-roledescription="sortable"
            data-drag-handle=""
            onPointerDown={(event) => {
              event.preventDefault();
              controls.start(event);
            }}
            onKeyDown={onHandleKey}
          >
            <Icon path={ICONS.grip} className="size-4" />
          </button>
          <span className="cq-caption text-(--cq-text-tertiary)">
            {BLOCK_LABEL[block.type]}
          </span>
          <span className="cq-cms-handle ms-auto flex items-center gap-0.5">
            <BlockSettings block={block} onChange={onChange} />
            <button
              type="button"
              className={iconButton}
              aria-label="Move up"
              disabled={index === 0}
              onClick={() => onMove(index - 1)}
            >
              <Icon path={ICONS.up} />
            </button>
            <button
              type="button"
              className={iconButton}
              aria-label="Move down"
              disabled={index === count - 1}
              onClick={() => onMove(index + 1)}
            >
              <Icon path={ICONS.down} />
            </button>
            <button
              type="button"
              className={iconButton}
              aria-label="Duplicate"
              onClick={onDuplicate}
            >
              <Icon path={ICONS.copy} />
            </button>
            <button
              type="button"
              className={iconButton}
              aria-label="Remove block"
              onClick={onRemove}
            >
              <Icon path={ICONS.trash} />
            </button>
          </span>
        </div>
        {block.type === "columns" ? (
          <ColumnsEditor
            block={block}
            onChange={onChange}
            onUpload={onUpload}
            imageSrc={imageSrc}
          />
        ) : (
          <LeafBlockEditor
            block={block}
            onChange={(next) => onChange(next)}
            onUpload={onUpload}
            imageSrc={imageSrc}
          />
        )}
      </div>
    </Reorder.Item>
  );
}

function DropZone({
  onDropType,
  label,
}: {
  readonly onDropType: (type: SiteBlockType) => void;
  readonly label: string;
}) {
  const [over, setOver] = useState(false);
  const accepts = (event: DragEvent) =>
    event.dataTransfer.types.includes("application/x-cq-block");
  return (
    <li
      aria-hidden="true"
      data-dropzone={label}
      className="cq-cms-dropzone list-none"
      data-over={over}
      onDragOver={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        const type = event.dataTransfer.getData("application/x-cq-block");
        const entry = PALETTE.find((candidate) => candidate.type === type);
        if (entry === undefined) return;
        event.preventDefault();
        onDropType(entry.type);
      }}
    />
  );
}

function Palette({
  kind,
  onAdd,
}: {
  readonly kind: AdminSitePageDetailDto["page"]["kind"];
  readonly onAdd: (type: SiteBlockType) => void;
}) {
  const entries = useMemo(
    () =>
      [...PALETTE].sort(
        (a, b) =>
          Number(b.suits.includes(kind)) - Number(a.suits.includes(kind)),
      ),
    [kind],
  );
  return (
    <ul className="flex flex-col gap-1" aria-label="Blocks">
      {entries.map((entry) => (
        <li key={entry.type}>
          <button
            type="button"
            draggable
            data-palette={entry.type}
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-cq-block", entry.type);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onAdd(entry.type)}
            className="cq-cms-press group flex w-full items-start gap-3 rounded-(--cq-radius-md) border border-transparent px-3 py-2.5 text-start hover:border-(--cq-border-subtle) hover:bg-(--cq-surface) active:cursor-grabbing"
          >
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-(--cq-radius-sm) border border-(--cq-border-subtle) bg-(--cq-surface) text-(--cq-text-secondary) group-hover:text-(--cq-text-primary)"
            >
              <Icon path={ICONS.plus} className="size-3.5" />
            </span>
            <span className="flex flex-col">
              <span className="cq-body-sm font-medium text-(--cq-text-primary)">
                {entry.label}
              </span>
              <span className="cq-caption text-(--cq-text-tertiary)">
                {entry.hint}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A page at 1280 px scaled into the space, so desktop breakpoints hold. */
function DesktopFrame({ children }: { readonly children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (o === null || i === null) return;
    const measure = () => {
      setScale(Math.min(1, o.clientWidth / 1280));
      setHeight(i.scrollHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(o);
    observer.observe(i);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={outer}
      className="w-full overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-canvas)"
      style={{ height: height * scale }}
    >
      <div
        ref={inner}
        data-preview="desktop"
        style={{
          width: 1280,
          transform: `scale(${String(scale)})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function PhoneFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mx-auto w-[406px] max-w-full rounded-[2.25rem] border border-(--cq-border) bg-(--cq-surface-sunken) p-2 shadow-(--cq-shadow-sm)">
      <div
        data-preview="phone"
        className="h-[760px] w-full overflow-y-auto rounded-[1.75rem] bg-(--cq-canvas)"
        style={{ maxWidth: 390 }}
      >
        {children}
      </div>
    </div>
  );
}

export function ContentEditor({
  detail,
  slug,
  actions: injected,
  imageSrc = (id) => `/admin/content/image/${encodeURIComponent(id)}`,
}: {
  readonly detail: AdminSitePageDetailDto;
  readonly slug: string;
  /** The dev harness passes its own; the console uses the server actions. */
  readonly actions?: Partial<ContentEditorActions> | undefined;
  readonly imageSrc?: (documentId: string) => string;
}) {
  const t = useT();
  const router = useRouter();
  const guard = useStepUpGuard();
  const reduce = useReducedMotion();
  const actions = useMemo<ContentEditorActions>(
    () => ({
      ...SERVER_ACTIONS,
      upload: () => Promise.resolve(null),
      ...injected,
    }),
    [injected],
  );

  const [blocks, setBlocks] = useState<SiteBlock[]>(detail.draft.blocks);
  const [title, setTitle] = useState(detail.draft.title);
  const [summary, setSummary] = useState(detail.draft.summary);
  const [save, setSave] = useState<SaveState>({
    kind: "saved",
    at: detail.draft.updatedAt,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("edit");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [previewVersion, setPreviewVersion] = useState<{
    n: number;
    blocks: SiteBlock[];
    title: string;
  } | null>(null);

  const revision = useRef(detail.draft.revision);
  const [savedSinceLoad, setSavedSinceLoad] = useState(false);
  const generation = useRef(0);
  const savedGeneration = useRef(0);

  useDirty(save.kind !== "saved");

  const change = useCallback((next: SiteBlock[]) => {
    generation.current += 1;
    setBlocks(next);
    setSave({ kind: "pending" });
  }, []);

  const guarded = useCallback(
    async <T,>(
      work: () => Promise<ContentResult<T>>,
    ): Promise<ContentResult<T>> => {
      if (guard === null) return work();
      const box: { last: ContentResult<T> | null } = { last: null };
      const outcome = await guard(async () => {
        const value = await work();
        box.last = value;
        return value.ok
          ? { ok: true }
          : {
              ok: false,
              message: value.message,
              ...(value.stepUp === true ? { stepUp: true as const } : {}),
            };
      });
      return (
        box.last ?? { ok: false, message: outcome.ok ? "" : outcome.message }
      );
    },
    [guard],
  );

  const blocksRef = useRef(blocks);
  const titleRef = useRef(title);
  const summaryRef = useRef(summary);
  // The latest words for a save that a timer or a button starts.
  useLayoutEffect(() => {
    blocksRef.current = blocks;
    titleRef.current = title;
    summaryRef.current = summary;
  });

  const running = useRef<Promise<void> | null>(null);
  const flushOnce = useCallback(async () => {
    if (savedGeneration.current === generation.current) return;
    const valid = SiteBlocksSchema.safeParse(blocksRef.current);
    if (!valid.success || titleRef.current.trim() === "") {
      setSave({ kind: "invalid" });
      return;
    }
    const target = generation.current;
    setSave({ kind: "saving" });
    const result = await guarded(() =>
      actions.save(slug, {
        title: titleRef.current,
        summary: summaryRef.current,
        blocks: valid.data,
        expectedRevision: revision.current,
      }),
    );
    if (result.ok) {
      revision.current = result.value.revision;
      setSavedSinceLoad(true);
      savedGeneration.current = target;
      setSave(
        target === generation.current
          ? { kind: "saved", at: result.value.updatedAt }
          : { kind: "pending" },
      );
    } else if (result.conflict === true) {
      setSave({ kind: "conflict" });
    } else {
      setSave({ kind: "failed", message: result.message });
    }
  }, [actions, guarded, slug]);

  /** Saves now; waits for a save already on its way, then saves what came after. */
  const flush = useCallback(async () => {
    while (running.current !== null) await running.current;
    const work = flushOnce();
    running.current = work;
    try {
      await work;
    } finally {
      running.current = null;
    }
  }, [flushOnce]);

  // Autosave: a second after the last change, and again if more came in
  // while a save was on its way.
  useEffect(() => {
    if (save.kind !== "pending") return;
    const timer = window.setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [save, flush, blocks, title, summary]);

  const editTitle = (next: string) => {
    generation.current += 1;
    setTitle(next);
    setSave({ kind: "pending" });
  };
  const editSummary = (next: string) => {
    generation.current += 1;
    setSummary(next);
    setSave({ kind: "pending" });
  };

  const insertAt = (index: number, type: SiteBlockType) => {
    const block = newBlock(type);
    const next = [...blocks];
    next.splice(index, 0, block);
    change(next);
    setSelected(block.id);
    setPaletteOpen(false);
    setAnnounce(`${BLOCK_LABEL[type]} added at position ${String(index + 1)}.`);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-block-id="${block.id}"] textarea, [data-block-id="${block.id}"] [contenteditable]`,
        )
        ?.focus();
    });
  };
  const addAfterSelection = (type: SiteBlockType) => {
    const at =
      selected === null
        ? blocks.length
        : blocks.findIndex((b) => b.id === selected) + 1;
    insertAt(at <= 0 ? blocks.length : at, type);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length || from === to) return;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    change(next);
    setAnnounce(
      `${BLOCK_LABEL[moved.type]} moved to position ${String(to + 1)} of ${String(next.length)}.`,
    );
    // Keep the keyboard on the block it moved.
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          `[data-block-id="${moved.id}"] [data-drag-handle]`,
        )
        ?.focus();
    });
  };

  const lawyerNotes = siteLawyerNoteCount(blocks);
  const placeholders = useMemo(
    () => sitePlaceholdersIn(JSON.stringify([title, summary, blocks])),
    [title, summary, blocks],
  );
  const previewPage = {
    kind: detail.page.kind,
    title: resolveSitePlaceholders(
      previewVersion?.title ?? title,
      detail.settings,
    ),
    summary: resolveSitePlaceholders(summary, detail.settings),
    effectiveDate: detail.effectiveDate,
    blocks: publicSiteBlocks(previewVersion?.blocks ?? blocks, detail.settings),
  };
  const publicHref =
    slug === "pricing"
      ? "/pricing"
      : slug === "faq"
        ? "/faq"
        : slug.startsWith("landing-")
          ? "/"
          : `/legal/${slug}`;

  const saveLabel =
    save.kind === "saved"
      ? `Saved ${timeOf(save.at)}`
      : save.kind === "saving"
        ? "Saving…"
        : save.kind === "pending"
          ? "Unsaved changes"
          : save.kind === "invalid"
            ? "Fix the marked fields to save"
            : save.kind === "conflict"
              ? "Changed in another window"
              : "Couldn't save";

  const status = detail.page.status;
  const statusLabel =
    status === "PUBLISHED"
      ? detail.page.unpublishedChanges ||
        save.kind !== "saved" ||
        savedSinceLoad
        ? "Live, with draft changes"
        : "Live"
      : status === "DRAFT_PENDING_LEGAL_REVIEW"
        ? "Draft, waiting for legal review"
        : status === "UNPUBLISHED"
          ? "Taken down"
          : "Draft";

  return (
    <div className="flex flex-col gap-5" data-content-editor={slug}>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      {/* Top bar */}
      <div className="sticky top-0 z-(--cq-z-sticky) -mx-4 flex flex-col gap-3 border-b border-(--cq-border-subtle) bg-(--cq-canvas) px-4 py-3 sm:mx-0 sm:rounded-(--cq-radius-lg) sm:border sm:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="cq-caption text-(--cq-text-tertiary)">
              {PAGE_KIND_LABEL[detail.page.kind]}{" "}
              <span aria-hidden="true">/</span> {slug}
            </span>
            <InlineText
              value={title}
              onChange={editTitle}
              placeholder="Page title"
              label="Page title"
              className="cq-title-md truncate"
            />
          </div>
          <span
            className={`cq-label inline-flex min-h-8 items-center gap-1.5 rounded-(--cq-radius-full) px-3 ${
              status === "PUBLISHED"
                ? "bg-(--cq-positive-soft) text-(--cq-text-primary)"
                : status === "DRAFT_PENDING_LEGAL_REVIEW"
                  ? "bg-(--cq-warning-soft) text-(--cq-text-primary)"
                  : "bg-(--cq-surface-subtle) text-(--cq-text-secondary)"
            }`}
          >
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${status === "PUBLISHED" ? "bg-(--cq-positive)" : status === "DRAFT_PENDING_LEGAL_REVIEW" ? "bg-(--cq-warning)" : "bg-(--cq-text-tertiary)"}`}
            />
            {statusLabel}
          </span>
          <span
            role="status"
            data-save-state={save.kind}
            className={`cq-caption min-w-28 ${save.kind === "failed" || save.kind === "conflict" || save.kind === "invalid" ? "text-(--cq-danger)" : "text-(--cq-text-tertiary)"}`}
          >
            {saveLabel}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="radiogroup"
            aria-label={t("View")}
            className="inline-flex rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface-subtle) p-0.5"
          >
            {(
              [
                ["edit", "Edit"],
                ["desktop", "Desktop"],
                ["phone", "Phone"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={view === value}
                onClick={() => {
                  setView(value);
                  if (value === "edit") setPreviewVersion(null);
                }}
                className={`cq-label relative min-h-9 rounded-(--cq-radius-sm) px-3 transition-colors duration-(--cq-motion-fast) ${
                  view === value
                    ? "text-(--cq-text-primary)"
                    : "text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
                }`}
              >
                {view === value ? (
                  <motion.span
                    layoutId="cq-cms-view"
                    aria-hidden="true"
                    className="absolute inset-0 rounded-(--cq-radius-sm) bg-(--cq-surface) shadow-(--cq-shadow-xs)"
                    transition={
                      reduce === true
                        ? { duration: 0 }
                        : { type: "spring", duration: 0.28, bounce: 0.1 }
                    }
                  />
                ) : null}
                <span className="relative">{label}</span>
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <Button
            variant="quiet"
            size="compact"
            onClick={() => setHistoryOpen(true)}
          >
            <Icon path={ICONS.history} />
            {t("History")}
          </Button>
          {status === "PUBLISHED" ? (
            <a
              href={publicHref}
              target="_blank"
              rel="noreferrer"
              className="cq-label inline-flex min-h-11 items-center rounded-(--cq-radius-md) px-3 text-(--cq-text-secondary) hover:text-(--cq-text-primary) lg:min-h-8"
            >
              {t("View live")}
            </a>
          ) : null}
          <Button
            variant="primary"
            size="compact"
            disabled={save.kind === "invalid" || save.kind === "conflict"}
            onClick={() => {
              void flush().then(() => setPublishOpen(true));
            }}
          >
            {t("Publish")}
          </Button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {notice === null ? null : (
          <motion.p
            key={notice.text}
            role={notice.ok ? "status" : "alert"}
            initial={
              reduce === true
                ? false
                : { opacity: 0, transform: "translateY(-4px)" }
            }
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className={`cq-body-sm rounded-(--cq-radius-md) px-4 py-3 ${notice.ok ? "bg-(--cq-positive-soft)" : "bg-(--cq-danger-soft)"} text-(--cq-text-primary)`}
          >
            {notice.text}
          </motion.p>
        )}
      </AnimatePresence>

      {save.kind === "conflict" ? (
        <div
          role="alert"
          className="cq-body-sm flex flex-wrap items-center gap-3 rounded-(--cq-radius-md) bg-(--cq-warning-soft) px-4 py-3 text-(--cq-text-primary)"
        >
          This page was saved from another window, so this one stopped saving to
          keep both safe.
          <Button size="compact" onClick={() => window.location.reload()}>
            Reload the latest draft
          </Button>
        </div>
      ) : null}

      {view === "edit" ? (
        <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="hidden self-start lg:sticky lg:top-40 lg:block">
            <p className="cq-label mb-2 px-3 text-(--cq-text-primary)">
              Add a block
            </p>
            <p className="cq-caption mb-3 px-3 text-(--cq-text-tertiary)">
              Click to add after the selected block, or drag onto the page.
            </p>
            <Palette kind={detail.page.kind} onAdd={addAfterSelection} />
          </aside>
          <div className="@container flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-(--cq-radius-lg) bg-(--cq-surface-sunken) p-2 sm:p-4">
              <div className="rounded-(--cq-radius-lg) bg-(--cq-surface) px-4 py-4 @2xl:ps-12">
                <InlineText
                  value={summary}
                  onChange={editSummary}
                  placeholder="A sentence or two under the title, and for search results"
                  label="Summary"
                  className="cq-body text-(--cq-text-secondary)"
                />
              </div>
              <Reorder.Group
                as="ol"
                axis="y"
                values={blocks}
                onReorder={change}
                className="flex flex-col gap-2"
                aria-label="Page blocks"
              >
                <DropZone label="0" onDropType={(type) => insertAt(0, type)} />
                {blocks.map((block, index) => (
                  <CanvasBlockWithZone
                    key={block.id}
                    block={block}
                    index={index}
                    count={blocks.length}
                    selected={selected === block.id}
                    onSelect={() => setSelected(block.id)}
                    onChange={(next) =>
                      change(blocks.map((b) => (b.id === block.id ? next : b)))
                    }
                    onMove={(to) => move(index, to)}
                    onKeyboardMove={(direction) =>
                      move(index, index + direction)
                    }
                    onDuplicate={() => {
                      const copy = cloneBlock(block);
                      const next = [...blocks];
                      next.splice(index + 1, 0, copy);
                      change(next);
                      setAnnounce(`${BLOCK_LABEL[block.type]} duplicated.`);
                    }}
                    onRemove={() => {
                      change(blocks.filter((b) => b.id !== block.id));
                      setAnnounce(`${BLOCK_LABEL[block.type]} removed.`);
                    }}
                    onUpload={actions.upload}
                    imageSrc={imageSrc}
                    onDropType={(type) => insertAt(index + 1, type)}
                  />
                ))}
              </Reorder.Group>
              {blocks.length === 0 ? (
                <p className="cq-body-sm px-4 py-10 text-center text-(--cq-text-tertiary)">
                  This page is empty. Add a block to start.
                </p>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => setPaletteOpen(true)}
                className="lg:hidden"
              >
                <Icon path={ICONS.plus} />
                Add a block
              </Button>
            </div>
            <aside className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) px-4 py-4">
              {placeholders.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p className="cq-label text-(--cq-text-primary)">
                    Filled in from Site settings
                  </p>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {placeholders.map((key) => {
                      const field = SITE_PLACEHOLDERS[key].field;
                      const value = detail.settings[field];
                      return (
                        <li
                          key={key}
                          className="cq-caption text-(--cq-text-secondary)"
                        >
                          <code className="cq-cms-placeholder-token">{`{{${key}}}`}</code>{" "}
                          {value === null || value === "" ? (
                            <span className="text-(--cq-danger)">
                              not set yet
                            </span>
                          ) : (
                            value
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              {lawyerNotes > 0 ? (
                <p className="cq-caption text-(--cq-text-secondary)">
                  {lawyerNotes === 1
                    ? "1 lawyer note is open."
                    : `${String(lawyerNotes)} lawyer notes are open.`}{" "}
                  They are for the reviewing lawyer and never appear on the
                  site.
                </p>
              ) : null}
              <p className="cq-caption text-(--cq-text-tertiary)">
                Keyboard: focus a block&apos;s handle and press the up or down
                arrow to move it.
              </p>
            </aside>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {previewVersion === null ? null : (
            <div className="cq-body-sm flex flex-wrap items-center gap-3 rounded-(--cq-radius-md) bg-(--cq-surface-subtle) px-4 py-3">
              Previewing version {previewVersion.n}.
              <Button
                size="compact"
                variant="quiet"
                onClick={() => setPreviewVersion(null)}
              >
                Back to the draft
              </Button>
            </div>
          )}
          <p className="cq-caption text-(--cq-text-tertiary)">
            What a visitor sees: placeholders filled in, lawyer notes left out.
          </p>
          {view === "desktop" ? (
            <DesktopFrame>
              <SitePageView page={previewPage} options={{ imageSrc }} />
            </DesktopFrame>
          ) : (
            <PhoneFrame>
              <SitePageView page={previewPage} options={{ imageSrc }} compact />
            </PhoneFrame>
          )}
        </div>
      )}

      <SheetRoot open={paletteOpen} onOpenChange={setPaletteOpen}>
        <SheetContent title="Add a block" side="bottom">
          <Palette kind={detail.page.kind} onAdd={addAfterSelection} />
        </SheetContent>
      </SheetRoot>

      <HistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        detail={detail}
        onPreview={async (n) => {
          const result = await actions.loadVersion(slug, n);
          if (result.ok) {
            setPreviewVersion({
              n,
              blocks: result.value.blocks,
              title: result.value.title,
            });
            setView("desktop");
            setHistoryOpen(false);
          } else setNotice({ ok: false, text: result.message });
        }}
        onRestore={async (n) => {
          await flush();
          const result = await guarded(() =>
            actions.restore(slug, {
              versionNumber: n,
              expectedRevision: revision.current,
            }),
          );
          setNotice({
            ok: result.ok,
            text: result.ok
              ? `Version ${String(n)} is in the draft. Publish to make it live.`
              : result.message,
          });
          if (result.ok) {
            setHistoryOpen(false);
            // The draft is now that version: load it fresh.
            window.location.reload();
          }
        }}
        onUnpublish={async (reason) => {
          const result = await guarded(() => actions.unpublish(slug, reason));
          setNotice({
            ok: result.ok,
            text: result.ok
              ? "Taken down. Its versions are kept."
              : result.message,
          });
          if (result.ok) {
            setHistoryOpen(false);
            router.refresh();
          }
        }}
      />

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        legal={detail.page.kind === "legal"}
        lawyerNotes={lawyerNotes}
        unsetPlaceholders={placeholders.filter((key) => {
          const value = detail.settings[SITE_PLACEHOLDERS[key].field];
          return value === null || value === "";
        })}
        onPublish={async ({ reason, confirmLegalReview }) => {
          await flush();
          const result = await guarded(() =>
            actions.publish(slug, {
              expectedRevision: revision.current,
              reason,
              confirmLegalReview,
            }),
          );
          if (result.ok) {
            setPublishOpen(false);
            setNotice({
              ok: true,
              text: `Published as version ${String(result.value.versionNumber)}. It is live now.`,
            });
            router.refresh();
          } else {
            setNotice({ ok: false, text: result.message });
            if (result.conflict === true) setSave({ kind: "conflict" });
          }
          return result.ok;
        }}
      />
    </div>
  );
}

function CanvasBlockWithZone(
  props: Parameters<typeof CanvasBlock>[0] & {
    readonly onDropType: (type: SiteBlockType) => void;
  },
) {
  const { onDropType, ...rest } = props;
  return (
    <>
      <CanvasBlock {...rest} />
      <DropZone label={String(props.index + 1)} onDropType={onDropType} />
    </>
  );
}

function HistorySheet({
  open,
  onOpenChange,
  detail,
  onPreview,
  onRestore,
  onUnpublish,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly detail: AdminSitePageDetailDto;
  readonly onPreview: (n: number) => Promise<void>;
  readonly onRestore: (n: number) => Promise<void>;
  readonly onUnpublish: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    await work();
    setBusy(null);
  };
  const ACTION: Record<string, string> = {
    PUBLISH: "Published",
    UNPUBLISH: "Taken down",
    RESTORE_TO_DRAFT: "Restored to the draft",
  };
  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="Versions and history"
        description="Every published version is kept. Restoring copies a version into the draft; nothing goes live until you publish."
        side="side"
      >
        <div className="flex flex-col gap-6">
          <ol className="flex flex-col gap-2" aria-label="Versions">
            {detail.versions.map((version) => (
              <li
                key={version.versionNumber}
                data-version={version.versionNumber}
                className="flex flex-col gap-2 rounded-(--cq-radius-md) border border-(--cq-border-subtle) px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="cq-body-sm font-medium text-(--cq-text-primary)">
                    Version {version.versionNumber}
                  </span>
                  {version.live ? (
                    <span className="cq-caption rounded-(--cq-radius-full) bg-(--cq-positive-soft) px-2 py-0.5 text-(--cq-text-primary)">
                      Live
                    </span>
                  ) : null}
                  <span className="cq-caption ms-auto text-(--cq-text-tertiary)">
                    {dateTimeOf(version.createdAt)}
                  </span>
                </div>
                <p className="cq-caption text-(--cq-text-secondary)">
                  {version.source === "SEED"
                    ? "Imported from the default content"
                    : version.source === "RESTORE"
                      ? `Restored from version ${String(version.restoredFrom ?? "")}${version.authorName === null ? "" : ` by ${version.authorName}`}`
                      : `Edited${version.authorName === null ? "" : ` by ${version.authorName}`}`}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="compact"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(`p${String(version.versionNumber)}`, () =>
                        onPreview(version.versionNumber),
                      )
                    }
                  >
                    Preview
                  </Button>
                  <Button
                    size="compact"
                    variant="quiet"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(`r${String(version.versionNumber)}`, () =>
                        onRestore(version.versionNumber),
                      )
                    }
                  >
                    Restore to draft
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          {detail.history.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="cq-label text-(--cq-text-primary)">History</p>
              <ol className="flex flex-col gap-1.5">
                {detail.history.map((event, index) => (
                  <li
                    key={index}
                    className="cq-caption text-(--cq-text-secondary)"
                  >
                    {ACTION[event.action] ?? event.action}
                    {event.versionNumber === null
                      ? ""
                      : ` version ${String(event.versionNumber)}`}
                    {event.actorName === null
                      ? " by the default import"
                      : ` by ${event.actorName}`}
                    , {dateTimeOf(event.at)}
                    {event.reason === null ? "" : `: ${event.reason}`}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {detail.page.status === "PUBLISHED" ? (
            <form
              data-q-editing=""
              className="flex flex-col gap-2 border-t border-(--cq-border-subtle) pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                void run("unpublish", () => onUnpublish(reason));
              }}
            >
              <label className="flex flex-col gap-1">
                <span className="cq-label text-(--cq-text-primary)">
                  Take this page down
                </span>
                <span className="cq-caption text-(--cq-text-tertiary)">
                  Visitors see that it is being prepared. Versions are kept. Say
                  why; it goes in the audit log.
                </span>
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="cq-body-sm h-10 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) px-3"
                />
              </label>
              <Button
                type="submit"
                variant="secondary"
                size="compact"
                disabled={reason.trim().length < 3 || busy !== null}
              >
                Take down
              </Button>
            </form>
          ) : null}
        </div>
      </SheetContent>
    </SheetRoot>
  );
}

function PublishDialog({
  open,
  onOpenChange,
  legal,
  lawyerNotes,
  unsetPlaceholders,
  onPublish,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly legal: boolean;
  readonly lawyerNotes: number;
  readonly unsetPlaceholders: readonly string[];
  readonly onPublish: (input: {
    reason: string;
    confirmLegalReview: boolean;
  }) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={legal ? "Publish this legal page" : "Publish this page"}
        description="The saved draft becomes a new version and goes live straight away. Earlier versions are kept and can be restored."
        actions={
          <>
            <Button variant="quiet" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pending || (legal && !confirmed)}
              onClick={() =>
                void (async () => {
                  setPending(true);
                  const ok = await onPublish({
                    reason,
                    confirmLegalReview: legal && confirmed,
                  });
                  setPending(false);
                  if (ok) {
                    setReason("");
                    setConfirmed(false);
                  }
                })()
              }
            >
              {pending ? "Publishing…" : "Publish"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {unsetPlaceholders.length > 0 ? (
            <p className="cq-body-sm rounded-(--cq-radius-md) bg-(--cq-warning-soft) px-3 py-2 text-(--cq-text-primary)">
              Not set yet in Site settings:{" "}
              {unsetPlaceholders.map((key) => `{{${key}}}`).join(", ")}.
              Visitors will see a bracketed label in their place.
            </p>
          ) : null}
          {legal ? (
            <label className="cq-body-sm flex items-start gap-3 text-(--cq-text-primary)">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-(--cq-accent)"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                A lawyer has reviewed and approved this exact text.
                {lawyerNotes > 0 ? (
                  <span className="mt-1 block text-(--cq-text-secondary)">
                    {lawyerNotes === 1
                      ? "1 lawyer note is"
                      : `${String(lawyerNotes)} lawyer notes are`}{" "}
                    still open. They stay hidden from visitors.
                  </span>
                ) : null}
              </span>
            </label>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="cq-label text-(--cq-text-primary)">
              What changed {legal ? "" : "(optional)"}
            </span>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Shown in the history and the audit log"
              className="cq-body-sm h-10 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) px-3"
            />
          </label>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
