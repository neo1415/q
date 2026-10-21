"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type {
  DataRoomOwnerView,
  DocumentAccessDto,
  FolderAccessDto,
  RequestInboxItem,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import {
  Check,
  Eye,
  FileText,
  Folder,
  ICON_SIZE,
  Lock,
  Upload,
} from "@capital-q/ui/icons";

import {
  WorkSheet,
  WorkTag,
  workButton,
  type WorkTagTone,
} from "@/features/work/work-kit";
import { useT } from "@/features/i18n/language";

import { AccessSheet, type AccessTarget } from "./access-sheet";
import {
  FOLDER_SHARE,
  LEVEL_TONE,
  LEVEL_WORDS,
  accessWords,
  folderCards,
  folderPeople,
  sharedWords,
  type FolderCard,
  type FolderPerson,
} from "./data-room-folders-model";
import {
  loadDocumentAccessAction,
  loadFolderAccessAction,
  revokeAccessAction,
  shareFolderAction,
} from "./request-actions";
import { initials, requestedMarks } from "./requests-model";

/**
 * The Data room tab on Documents (chosen design 2026-10-21, option 3,
 * "Data-room folders", warm charcoal): the room as investors see it, one
 * card per folder saying in words who can open it. A folder opens in a
 * sheet: its documents, each with who can see it (and the access editor),
 * and every investor with access, to withdraw in one tap, or who asked or
 * is connected, to share with. Every change is the API's own action,
 * audited there; the sheet reads the folder again after each one.
 */

function AccessIcon({ tone }: { readonly tone: WorkTagTone }) {
  return tone === "stone" ? (
    <Lock aria-hidden="true" />
  ) : (
    <Eye aria-hidden="true" />
  );
}

function FolderAccessTag({ card }: { readonly card: FolderCard }) {
  const t = useT();
  const tone: WorkTagTone =
    card.access.kind === "LEVEL"
      ? LEVEL_TONE[card.access.level]
      : card.access.kind === "MIXED"
        ? "stone"
        : "dash";
  return (
    <WorkTag
      tone={tone}
      icon={card.access.kind === "EMPTY" ? undefined : <AccessIcon tone={tone} />}
      className="mt-auto whitespace-normal"
    >
      {t(accessWords(card.access))}
    </WorkTag>
  );
}

type Loaded = {
  readonly folder: FolderAccessDto;
  readonly access: readonly DocumentAccessDto[];
};

function PersonRow({
  person,
  total,
  busy,
  onWithdraw,
  onShare,
}: {
  readonly person: FolderPerson;
  readonly total: number;
  readonly busy: boolean;
  readonly onWithdraw: (person: FolderPerson) => void;
  readonly onShare: (person: FolderPerson) => void;
}) {
  const t = useT();
  const state =
    person.kind === "SHARED"
      ? sharedWords(person, total)
      : person.kind === "ASKED"
        ? "Asked, not shared yet"
        : person.kind === "CONNECTED"
          ? "Connected, not shared"
          : "Asked to connect: accept first";
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-(--cq-border-subtle) px-4 py-3 first:border-t-0"
      data-folder-person={person.kind}
    >
      <span
        aria-hidden="true"
        className="grid size-7 flex-none place-items-center rounded-(--cq-radius-md) bg-(--cq-surface-strong) text-[11px] font-semibold text-(--cq-text-primary)"
      >
        {initials(person.name)}
      </span>
      <div className="min-w-0 flex-[1_1_calc(100%-44px)] sm:flex-1">
        <b className="block truncate text-sm font-medium text-(--cq-text-primary)">
          {person.name}
        </b>
      </div>
      <span className="ms-10 text-xs text-(--cq-text-tertiary) sm:ms-0">
        {t(state)}
      </span>
      {person.kind === "SHARED" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onWithdraw(person)}
          className={workButton("quiet", "ms-auto", "small")}
          data-withdraw
        >
          {t("Withdraw")}
        </button>
      ) : person.kind === "AWAITING" ? (
        <Link
          href="/company/interest"
          className={workButton("quiet", "ms-auto", "small")}
        >
          {t("Review interest")}
        </Link>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => onShare(person)}
          className={workButton("secondary", "ms-auto", "small")}
          data-share
        >
          {t("Share")}
        </button>
      )}
    </div>
  );
}

export function DataRoomTab({
  companyId,
  view,
  items,
}: {
  readonly companyId: string;
  /** Null when the room could not be read. */
  readonly view: DataRoomOwnerView | null;
  readonly items: readonly RequestInboxItem[];
}) {
  const t = useT();
  const router = useRouter();
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [target, setTarget] = useState<AccessTarget | null>(null);
  const marks = requestedMarks(items);

  const cards = view === null ? [] : folderCards(view);
  const card = cards.find((entry) => entry.code === openCode) ?? null;

  const load = useCallback(
    async (code: string, documentIds: readonly string[]) => {
      const [folder, ...access] = await Promise.all([
        loadFolderAccessAction(companyId, code),
        ...documentIds
          .slice(0, 40)
          .map((documentId) => loadDocumentAccessAction(documentId)),
      ]);
      if (folder === undefined || !folder.ok) {
        setLoadError("Who can open it couldn't load. Try again.");
        return;
      }
      setLoadError(null);
      setLoaded({
        folder: folder.value,
        access: access.flatMap((result) => (result.ok ? [result.value] : [])),
      });
    },
    [companyId],
  );

  const ids = card?.documents.map((document) => document.documentId) ?? [];
  const idsKey = ids.join(",");
  useEffect(() => {
    if (openCode === null) return;
    void load(openCode, idsKey === "" ? [] : idsKey.split(","));
  }, [openCode, idsKey, load]);

  if (view === null) {
    return (
      <p className="cq-body text-(--cq-text-secondary)" role="status">
        {t("The data room couldn't load. Try again in a moment.")}
      </p>
    );
  }

  const people =
    loaded === null || card === null
      ? []
      : folderPeople({
          folderDocumentIds: ids,
          access: loaded.access,
          requests: view.requests,
          candidates: loaded.folder.candidates,
          awaiting: loaded.folder.awaitingConnection,
        });

  const withdraw = (person: FolderPerson) => {
    if (person.kind !== "SHARED" || openCode === null) return;
    setBusy(true);
    setSaid(null);
    void Promise.all(person.policyIds.map((id) => revokeAccessAction(id))).then(
      async (results) => {
        const failed = results.some((result) => !result.ok);
        setSaid(
          failed
            ? "Some access couldn't be withdrawn. Try again."
            : `Withdrawn. ${person.name} can no longer open this folder.`,
        );
        await load(openCode, ids);
        setBusy(false);
        router.refresh();
      },
    );
  };

  const share = (person: FolderPerson) => {
    if (openCode === null) return;
    setBusy(true);
    setSaid(null);
    void shareFolderAction(companyId, openCode, {
      relationshipId: person.relationshipId,
      ...FOLDER_SHARE,
    }).then(async (result) => {
      setSaid(
        result.ok
          ? `Shared with ${person.name}: view only, for 30 days.`
          : result.message,
      );
      await load(openCode, ids);
      setBusy(false);
      router.refresh();
    });
  };

  return (
    <div className="cq-charcoal flex flex-col" data-data-room-folders>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="m-0 min-w-0 flex-[1_1_100%] text-xs text-(--cq-text-tertiary) sm:flex-1">
          {t(
            "Your data room, as investors see it. Each folder says who can open it.",
          )}
        </p>
        <Link
          href="/documents"
          className={workButton("primary", "max-sm:w-full")}
          data-add-documents
        >
          <Upload size={ICON_SIZE.compact} aria-hidden="true" />
          {t("Add documents")}
        </Link>
      </div>

      {cards.length === 0 ? (
        <p className="m-0 text-sm text-(--cq-text-secondary)">
          {t("Nothing here yet. Upload anything; you decide who sees it.")}
        </p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 md:grid-cols-3 md:gap-3.5">
          {cards.map((entry) => (
            <li key={entry.code}>
              <button
                type="button"
                onClick={() => {
                  setLoaded(null);
                  setSaid(null);
                  setOpenCode(entry.code);
                }}
                className="cq-crm-press cq-crm-lift flex h-full min-h-[140px] w-full flex-col items-start gap-1.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-3.5 text-start hover:border-(--cq-border) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) md:min-h-[150px] md:p-[18px]"
                data-folder={entry.code}
              >
                <span className="mb-1 grid size-11 place-items-center rounded-(--cq-radius-lg) bg-(--cq-accent-soft) text-(--cq-accent)">
                  <Folder size={ICON_SIZE.prominent} aria-hidden="true" />
                </span>
                <b className="text-base text-(--cq-text-primary)">
                  {t(entry.label)}
                </b>
                <span className="text-xs text-(--cq-text-tertiary)">
                  {t(
                    entry.documents.length === 1
                      ? "1 document"
                      : `${String(entry.documents.length)} documents`,
                  )}
                </span>
                <FolderAccessTag card={entry} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <WorkSheet
        open={card !== null}
        onOpenChange={(next) => {
          if (!next) setOpenCode(null);
        }}
        tone="charcoal"
        title={card === null ? "" : t(card.label)}
        icon={
          <Folder
            size={ICON_SIZE.regular}
            aria-hidden="true"
            className="text-(--cq-text-secondary)"
          />
        }
        data-folder-sheet={card?.code ?? ""}
      >
        {card === null ? null : (
          <>
            <span className="text-xs text-(--cq-text-tertiary)">
              {t("In this folder")}
            </span>
            {card.documents.length === 0 ? (
              <p className="m-0 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) px-4 py-3 text-sm text-(--cq-text-secondary)">
                {t("Nothing filed here yet.")}
              </p>
            ) : (
              <div className="overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle)">
                {card.documents.map((document) => {
                  const asked = marks.get(document.documentId) ?? [];
                  return (
                    <div
                      key={document.documentId}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-(--cq-border-subtle) px-4 py-3 first:border-t-0"
                      data-folder-document={document.documentId}
                    >
                      <FileText
                        size={ICON_SIZE.regular}
                        aria-hidden="true"
                        className="flex-none text-(--cq-text-secondary)"
                      />
                      <div className="min-w-0 flex-[1_1_calc(100%-30px)] sm:flex-1">
                        <b className="block truncate text-sm font-medium text-(--cq-text-primary)">
                          {document.title}
                        </b>
                        <span className="text-xs text-(--cq-text-tertiary)">
                          {t(
                            [
                              document.kind,
                              document.pageCount === null
                                ? null
                                : `${String(document.pageCount)} pages`,
                              `in ${card.label}`,
                            ]
                              .filter((part): part is string => part !== null)
                              .join(", "),
                          )}
                          {asked.length === 0
                            ? ""
                            : t(
                                ` · asked for by ${asked.map((mark) => mark.who).join(", ")}`,
                              )}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setTarget({
                            kind: "DOCUMENT",
                            documentId: document.documentId,
                            title: document.title,
                          })
                        }
                        aria-label={t(`Who can see ${document.title}`)}
                        className="ms-[30px] rounded-full focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) sm:ms-0"
                        data-document-access={document.documentId}
                      >
                        <WorkTag
                          tone={LEVEL_TONE[document.level]}
                          icon={<AccessIcon tone={LEVEL_TONE[document.level]} />}
                        >
                          {t(LEVEL_WORDS[document.level])}
                        </WorkTag>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {card.missing.length === 0 ? null : (
              <p className="m-0 text-xs text-(--cq-text-tertiary)">
                {t(
                  `Usually here for your stage, not filed yet: ${card.missing.join(", ")}.`,
                )}
              </p>
            )}

            <span className="text-xs text-(--cq-text-tertiary)">
              {t("Who can open it")}
            </span>
            {loadError !== null ? (
              <p role="alert" className="m-0 text-sm text-(--cq-text-secondary)">
                {t(loadError)}
              </p>
            ) : loaded === null ? (
              <div
                className="flex flex-col gap-2"
                aria-busy="true"
                aria-label={t("Loading who can open it")}
              >
                {[0, 1].map((row) => (
                  <span
                    key={row}
                    className="block h-12 animate-pulse rounded-(--cq-radius-md) bg-(--cq-surface-subtle) motion-reduce:animate-none"
                  />
                ))}
              </div>
            ) : people.length === 0 ? (
              <p className="m-0 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) px-4 py-3 text-sm text-(--cq-text-secondary)">
                {card.access.kind === "LEVEL" && card.access.level === "PUBLIC"
                  ? t(
                      "Investors who can find your company can open it. No one has been given extra access.",
                    )
                  : t(
                      "No investor can open it. Once you're connected with one, you can share it here.",
                    )}
              </p>
            ) : (
              <div className="overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle)">
                {people.map((person) => (
                  <PersonRow
                    key={person.relationshipId}
                    person={person}
                    total={card.documents.length}
                    busy={busy}
                    onWithdraw={withdraw}
                    onShare={share}
                  />
                ))}
              </div>
            )}
            {said === null ? null : (
              <p
                role="status"
                className={cx(
                  "cq-crm-swap m-0 flex items-center gap-2 rounded-(--cq-radius-md) px-3 py-2.5 text-sm",
                  said.startsWith("Withdrawn") || said.startsWith("Shared")
                    ? "bg-(--cq-positive-soft) text-(--cq-positive)"
                    : "bg-(--cq-surface-subtle) text-(--cq-text-primary)",
                )}
              >
                <Check size={ICON_SIZE.compact} aria-hidden="true" />
                {t(said)}
              </p>
            )}
            <button
              type="button"
              onClick={() =>
                setTarget({
                  kind: "FOLDER",
                  folderCode: card.code,
                  label: card.label,
                })
              }
              className={workButton("quiet", "self-start", "small")}
              data-folder-access-editor
            >
              {t("Change who can see this folder")}
            </button>
          </>
        )}
      </WorkSheet>

      <AccessSheet
        companyId={companyId}
        target={target}
        onClose={() => {
          setTarget(null);
          if (openCode !== null) void load(openCode, ids);
          router.refresh();
        }}
      />
    </div>
  );
}
