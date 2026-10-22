"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import type {
  DataRoomInvestorView,
  DataRoomLevel,
  DataRoomOwnerDocument,
  DataRoomOwnerView,
  DataRoomPreviewDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import {
  ChevronDown,
  CircleHelp,
  Clock,
  Eye,
  FileText,
  Folder,
  ICON_SIZE,
  ICON_STROKE,
  Lock,
  Upload,
  Users,
} from "@capital-q/ui/icons";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import {
  dataRoomPreviewAction,
  setLevelAction,
  setOutlineAction,
} from "./material-actions";
import "./own-room.css";
import { useT } from "@/features/i18n/language";
import { GateNote, useGate } from "@/features/organisation/capabilities";
import { CAP } from "@/features/organisation/role-words";

/**
 * The founder's own data room, "See it as an investor would" (design
 * ownroom-2, 2026-10-21; warm charcoal). Their folders, each document with
 * who can see it, and beside them the room exactly as a chosen investor
 * sees it.
 *
 * That view is never worked out in the browser. The API projects the room
 * for the chosen relationship with the same code an investor's own read
 * uses (their real per-document grants, their requests, whether the
 * founder accepted their interest), and refuses anyone but the owner. A
 * change of access is saved, then the view is read again, so what is shown
 * is what that investor gets.
 */

const icon = {
  size: ICON_SIZE.compact,
  strokeWidth: ICON_STROKE,
  "aria-hidden": true,
} as const;

/** Who is looking, as the founder thinks of them. */
export type Lens = "CONNECTED" | "NOT_YET" | "REQUESTED";

const LENSES: readonly (readonly [Lens, string])[] = [
  ["CONNECTED", "A connected investor"],
  ["NOT_YET", "Not yet connected"],
  ["REQUESTED", "Requested a document"],
];

/** A document's level in the founder's words, with the icon that goes with it. */
export function accessWords(
  document: Pick<DataRoomOwnerDocument, "level" | "sharedWith">,
): string {
  switch (document.level) {
    case "PRIVATE":
      return "Only your team";
    case "PUBLIC":
      return "Investors you accept";
    case "ON_REQUEST":
      return "On request";
    case "SHARED_ONLY":
      return document.sharedWith > 0
        ? `Shared with ${String(document.sharedWith)} investor${document.sharedWith === 1 ? "" : "s"}`
        : "Only those you share with";
  }
}

function AccessIcon({ level }: { readonly level: DataRoomLevel }) {
  return level === "PRIVATE" ? (
    <Lock {...icon} />
  ) : level === "PUBLIC" ? (
    <Users {...icon} />
  ) : level === "ON_REQUEST" ? (
    <CircleHelp {...icon} />
  ) : (
    <Clock {...icon} />
  );
}

const CHOICES: readonly (readonly [DataRoomLevel, string, string])[] = [
  ["PRIVATE", "Only your team", "Investors don't see it, or that it exists."],
  [
    "PUBLIC",
    "Investors you accept",
    "Every investor whose interest you accepted can open it, view only.",
  ],
  [
    "ON_REQUEST",
    "On request",
    "Investors see the title and can ask; you decide each time.",
  ],
];
const SHARED_ONLY_CHOICE = [
  "SHARED_ONLY",
  "Only those you share with",
  "Nobody sees it, not even its title, unless you share it with them.",
] as const;

/** "PDF, 13 pages": what the file is, as far as it is known. */
export function fileMeta(
  document: Pick<DataRoomOwnerDocument, "kind" | "pageCount">,
): string {
  return [
    document.kind,
    document.pageCount === null
      ? null
      : `${String(document.pageCount)} page${document.pageCount === 1 ? "" : "s"}`,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
}

/**
 * Whose view each lens shows. Connected: the investors whose interest the
 * founder accepted. Requested: investors who asked for a document, newest
 * first. Not yet: nobody in particular.
 */
export function lensCandidates(
  lens: Lens,
  preview: Pick<DataRoomPreviewDto, "investors"> | null,
  requests: DataRoomOwnerView["requests"],
): readonly { readonly relationshipId: string; readonly name: string }[] {
  if (lens === "NOT_YET") return [];
  if (lens === "CONNECTED") {
    return (preview?.investors ?? [])
      .filter((investor) => investor.connection === "CONNECTED")
      .map((investor) => ({
        relationshipId: investor.relationshipId,
        name: investor.investorOrganisationName,
      }));
  }
  const seen = new Set<string>();
  const out: { relationshipId: string; name: string }[] = [];
  for (const request of [...requests].sort((a, b) =>
    b.requestedAt.localeCompare(a.requestedAt),
  )) {
    if (seen.has(request.relationshipId)) continue;
    seen.add(request.relationshipId);
    out.push({
      relationshipId: request.relationshipId,
      name:
        request.requesterOrganisationName ??
        request.requesterName ??
        "An investor",
    });
  }
  return out;
}

/**
 * Design review only (/dev/gateq-review): the lens it opens on and the
 * API's answers, given by relationship id ("none": not yet connected), so
 * nothing is read and no setting is saved.
 */
export type OwnRoomDemo = {
  readonly lens: Lens;
  readonly previews: Readonly<Record<string, DataRoomPreviewDto>>;
};

export function OwnRoom({
  companyId,
  view,
  demo,
}: {
  readonly companyId: string;
  readonly view: DataRoomOwnerView;
  readonly demo?: OwnRoomDemo | undefined;
}) {
  const t = useT();
  const [documents, setDocuments] = useState(view.documents);
  const [source, setSource] = useState(view);
  if (source !== view) {
    // A fresh read from the server replaces the optimistic one.
    setSource(view);
    setDocuments(view.documents);
  }
  const [outline, setOutline] = useState(view.outlineBeforeConnection ?? false);
  const [lens, setLens] = useState<Lens>(demo?.lens ?? "NOT_YET");
  const [chosen, setChosen] = useState<Readonly<Record<Lens, string | null>>>({
    CONNECTED: null,
    NOT_YET: null,
    REQUESTED: null,
  });
  const [preview, setPreview] = useState<DataRoomPreviewDto | null>(
    () => demo?.previews["none"] ?? null,
  );
  const [failed, setFailed] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<DataRoomOwnerDocument | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const seq = useRef(0);
  const loadedOnce = useRef(demo !== undefined);
  // Who sees each document is an admin's decision (disclosure.manage); a
  // member sees the room as it is. The API authorises every change again.
  const manage = useGate(CAP.DISCLOSURE_MANAGE);

  const candidates = lensCandidates(lens, preview, view.requests);
  const target =
    lens === "NOT_YET"
      ? null
      : (candidates.find((c) => c.relationshipId === chosen[lens]) ??
        candidates[0] ??
        null);

  const load = (relationshipId: string | null) => {
    if (demo !== undefined) {
      setPreview(demo.previews[relationshipId ?? "none"] ?? null);
      return;
    }
    const mine = seq.current + 1;
    seq.current = mine;
    startLoading(async () => {
      const result = await dataRoomPreviewAction({ companyId, relationshipId });
      // Only the latest choice is shown, never an older answer over it.
      if (mine !== seq.current) return;
      if (result.ok) {
        loadedOnce.current = true;
        setPreview(result.value);
        setFailed(null);
      } else setFailed(result.message);
    });
  };

  // The view follows who is chosen; it is read again after every change.
  const targetId = target?.relationshipId ?? null;
  const wanted = lens === "NOT_YET" ? null : targetId;
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    // A lens with nobody to show needs no read beyond the first (which
    // also names the investors there are).
    if (lens !== "NOT_YET" && wanted === null && loadedOnce.current) return;
    loadRef.current(wanted);
  }, [lens, wanted, revision]);

  const folders = useMemo(
    () =>
      view.folders
        .map((folder) => ({
          folder,
          documents: documents.filter((d) => d.folderCode === folder.code),
        }))
        .filter((entry) => entry.documents.length > 0),
    [view.folders, documents],
  );

  const saveLevel = (document: DataRoomOwnerDocument, level: DataRoomLevel) => {
    if (document.level === level) {
      setEditing(null);
      return;
    }
    const before = documents;
    setDocuments((current) =>
      current.map((d) =>
        d.documentId === document.documentId ? { ...d, level } : d,
      ),
    );
    setEditing(null);
    if (demo !== undefined) return;
    startSaving(async () => {
      const result = await setLevelAction({
        companyId,
        documentId: document.documentId,
        level,
        version: document.version,
      });
      if (!result.ok) {
        setDocuments(before);
        setMessage(result.message);
        return;
      }
      setDocuments((current) =>
        current.map((d) =>
          d.documentId === document.documentId
            ? { ...d, version: d.version + 1 }
            : d,
        ),
      );
      setMessage(
        `Saved. ${accessWords({ level, sharedWith: document.sharedWith })} from now on.`,
      );
      setRevision((n) => n + 1);
    });
  };

  const toggleOutline = () => {
    const next = !outline;
    setOutline(next);
    if (demo !== undefined) return;
    startSaving(async () => {
      const result = await setOutlineAction({
        companyId,
        outlineBeforeConnection: next,
      });
      if (!result.ok) {
        setOutline(!next);
        setMessage(result.message);
        return;
      }
      setRevision((n) => n + 1);
    });
  };

  return (
    <section
      className="cq-charcoal cq-ownroom"
      aria-labelledby="ownroom-title"
      data-data-room="owner-lens"
    >
      <div className="cq-ownroom-bar">
        <h2 id="ownroom-title" className="sr-only">
          {t("Data room")}
        </h2>
        <Link
          href="/documents"
          className={buttonClassName(
            "secondary",
            "compact",
            "hidden sm:inline-flex",
          )}
        >
          <Upload {...icon} />
          {t("Upload files")}
        </Link>
      </div>
      <div className="cq-ownroom-lens2">
        <div className="min-w-0">
          {folders.length === 0 ? (
            <div className="cq-ownroom-empty">
              <p className="cq-body text-(--cq-text-primary)">
                {t(
                  "Nothing here yet. Upload anything; you decide who sees it.",
                )}
              </p>
              <Link
                href="/documents"
                className={buttonClassName("primary", "compact", "self-start")}
              >
                <Upload {...icon} />
                {t("Upload files")}
              </Link>
            </div>
          ) : (
            folders.map(({ folder, documents: inFolder }) => (
              <section
                key={folder.code}
                className="cq-ownroom-fold"
                aria-label={folder.label}
              >
                <div className="cq-ownroom-fh">
                  <Folder {...icon} />
                  <span>{t(folder.label)}</span>
                  <span className="cq-ownroom-count">
                    {t(
                      `${String(inFolder.length)} ${inFolder.length === 1 ? "document" : "documents"}`,
                    )}
                  </span>
                </div>
                {inFolder.map((document) => (
                  <div
                    key={document.documentId}
                    className="cq-ownroom-drow"
                    data-owner-document={document.level}
                  >
                    <FileText {...icon} size={18} />
                    <span className="min-w-0">
                      <b>{document.title}</b>
                      {fileMeta(document) === "" ? null : (
                        <span className="cq-ownroom-meta">
                          {t(fileMeta(document))}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="cq-ownroom-acc"
                      disabled={saving || !manage.allowed}
                      title={
                        manage.reason === null ? undefined : t(manage.reason)
                      }
                      aria-label={t(
                        `Who can see ${document.title}: ${accessWords(document)}`,
                      )}
                      onClick={() => setEditing(document)}
                    >
                      <AccessIcon level={document.level} />
                      {t(accessWords(document))}
                      <ChevronDown {...icon} />
                    </button>
                  </div>
                ))}
              </section>
            ))
          )}
          <GateNote gate={manage} className="mt-3" />
          {message === null ? null : (
            <p
              role="status"
              className="cq-body-sm mt-3 text-(--cq-text-secondary)"
            >
              {t(message)}
            </p>
          )}
        </div>

        <aside
          className="flex min-w-0 flex-col gap-3.5"
          aria-label={t("See it as an investor would")}
        >
          <div
            className="cq-ownroom-seg"
            role="group"
            aria-label={t("Who is looking")}
          >
            {LENSES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={lens === key}
                onClick={() => setLens(key)}
              >
                {t(label)}
              </button>
            ))}
          </div>
          {candidates.length > 1 && target !== null ? (
            <label className="cq-caption flex flex-col gap-1 text-(--cq-text-secondary)">
              {t("Which investor")}
              <select
                className="cq-ownroom-select"
                value={target.relationshipId}
                onChange={(event) =>
                  setChosen((now) => ({ ...now, [lens]: event.target.value }))
                }
              >
                {candidates.map((candidate) => (
                  <option
                    key={candidate.relationshipId}
                    value={candidate.relationshipId}
                  >
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <LensView
            lens={lens}
            target={target}
            preview={
              preview !== null &&
              (lens === "NOT_YET"
                ? preview.as.relationshipId === null
                : preview.as.relationshipId === targetId)
                ? preview
                : null
            }
            loading={loading}
            failed={failed}
            onRetry={() => setRevision((n) => n + 1)}
          />
          <div className="cq-ownroom-srow">
            <span className="min-w-0 flex-1">
              <b>{t("Show folder names")}</b>
              <span>{t("To investors not yet connected.")}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={outline}
              aria-label={t("Folder names")}
              className="cq-ownroom-sw"
              disabled={saving || !manage.allowed}
              onClick={toggleOutline}
            >
              <i aria-hidden />
              <span>{outline ? t("On") : t("Off")}</span>
            </button>
          </div>
        </aside>
      </div>

      <SheetRoot
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
      >
        {editing === null ? null : (
          <SheetContent
            title={t("Who can see this")}
            description={editing.title}
            side="side"
            className="cq-charcoal"
          >
            <AccessSheet
              document={editing}
              onSave={(level) => saveLevel(editing, level)}
            />
          </SheetContent>
        )}
      </SheetRoot>
    </section>
  );
}

function AccessSheet({
  document,
  onSave,
}: {
  readonly document: DataRoomOwnerDocument;
  readonly onSave: (level: DataRoomLevel) => void;
}) {
  const t = useT();
  const [level, setLevel] = useState<DataRoomLevel>(document.level);
  const choices =
    document.level === "SHARED_ONLY"
      ? [...CHOICES, SHARED_ONLY_CHOICE]
      : CHOICES;
  return (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <div role="radiogroup" aria-label={t("Who can see this")}>
        {choices.map(([value, label, hint]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={level === value}
            className="cq-ownroom-ropt"
            onClick={() => setLevel(value)}
          >
            <span className="cq-ownroom-rdot" aria-hidden />
            <span>
              <b>{t(label)}</b>
              <small>{t(hint)}</small>
            </span>
          </button>
        ))}
      </div>
      <Button variant="primary" onClick={() => onSave(level)}>
        {t("Save")}
      </Button>
      <p className="cq-caption text-(--cq-text-tertiary)">
        {t("View only. Their name is shown on every page they open.")}
      </p>
    </div>
  );
}

const LENS_WHO: Readonly<Record<Lens, string>> = {
  CONNECTED: "a connected investor",
  NOT_YET: "not yet connected",
  REQUESTED: "requested a document",
};

function LensView({
  lens,
  target,
  preview,
  loading,
  failed,
  onRetry,
}: {
  readonly lens: Lens;
  readonly target: { readonly name: string } | null;
  readonly preview: DataRoomPreviewDto | null;
  readonly loading: boolean;
  readonly failed: string | null;
  readonly onRetry: () => void;
}) {
  const t = useT();
  if (lens !== "NOT_YET" && target === null) {
    return (
      <div className="cq-ownroom-ivw">
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {lens === "CONNECTED"
            ? t(
                "No investor is connected yet. When you accept an investor's interest, you can see here exactly what they would.",
              )
            : t(
                "No investor has asked for a document yet. When one does, you can see here exactly what they would.",
              )}
        </p>
      </div>
    );
  }
  const who =
    lens === "NOT_YET"
      ? "Any investor who can find you"
      : lens === "CONNECTED"
        ? `${target?.name ?? ""}, interest accepted`
        : (target?.name ?? "");
  return (
    <div
      className="cq-ownroom-ivw"
      aria-busy={loading}
      aria-live="polite"
      data-lens={lens}
    >
      <p className="cq-ownroom-as">
        {t(`As ${LENS_WHO[lens]} sees it: ${who}`)}
      </p>
      {preview === null ? (
        failed !== null ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {t(failed)}{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={onRetry}
            >
              {t("Try again")}
            </button>
          </p>
        ) : (
          <div className="flex flex-col gap-2" aria-hidden>
            {[1, 2, 3].map((n) => (
              <span key={n} className="cq-ownroom-sk" />
            ))}
          </div>
        )
      ) : (
        <InvestorRows view={preview.view} />
      )}
      <span className="cq-ownroom-note">
        {t(
          "Documents marked Only your team never appear here, not even as a title.",
        )}
      </span>
    </div>
  );
}

function InvestorRows({ view }: { readonly view: DataRoomInvestorView }) {
  const t = useT();
  if (view.access === "LOCKED") {
    const outline = view.locked?.outline ?? null;
    if (outline === null || outline.length === 0) {
      return (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {view.locked?.reason === "INTEREST_PENDING"
            ? t(
                "Their interest is waiting for you. Your data room opens once you accept it.",
              )
            : t("Your data room opens once you accept their interest.")}
        </p>
      );
    }
    return (
      <div>
        {outline.map((folder) => (
          <div key={folder.code} className="cq-ownroom-fh2">
            <span className="inline-flex items-center gap-1.5">
              <Folder {...icon} />
              {t(folder.label)}
            </span>
            <span className="cq-ownroom-lockd">
              <Lock {...icon} />
              {t(`${String(folder.documents)} hidden`)}
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (view.documents.length === 0) {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)">
        {t("Nothing in your room is open or listed to them yet.")}
      </p>
    );
  }
  return (
    <div>
      {view.documents.map((document) => (
        <div
          key={document.documentId}
          className="cq-ownroom-fh2"
          data-access={document.access}
        >
          <span className="min-w-0">{document.title}</span>
          {document.access === "OPEN" ? (
            <span className="cq-ownroom-open">
              <Eye {...icon} />
              {t("Can open")}
            </span>
          ) : document.access === "REQUESTED" ? (
            <span className="cq-ownroom-lockd">
              <Clock {...icon} />
              {t("Asked, waiting for you")}
            </span>
          ) : (
            <span className="cq-ownroom-lockd">
              <Lock {...icon} />
              {t("Can request")}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
