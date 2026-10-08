"use client";

import { useCallback, useEffect, useState } from "react";

import {
  DATA_ROOM_GRANT_DAYS,
  DATA_ROOM_GRANT_DEFAULT_DAYS,
  DOCUMENT_ACCESS_LEVEL_WORDS,
  DOCUMENT_SCOPE_CHOICES,
  DOCUMENT_SCOPES_NOT_OFFERED,
  type AccessCandidate,
  type DataRoomLevel,
  type DocumentAccessDto,
  type DocumentAccessLevel,
  type FolderAccessDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { setLevelAction } from "@/features/company/material/material-actions";

import {
  loadDocumentAccessAction,
  loadFolderAccessAction,
  revokeAccessAction,
  setFolderLevelAction,
  shareDocumentAction,
  shareFolderAction,
} from "./request-actions";
import { shortDate } from "./requests-model";

/**
 * The access editor (founder documents, 2026-10-08): who can see one
 * document, or a folder, in plain words. The eight canonical scopes are all
 * named; four are offered for a company document (each one data-room
 * level, its scope derived) and four say why not. Below: each investor
 * with access, at what level and until when, with Revoke; adding one; and
 * the history. Every change is the API's own action, audited there.
 */

export type AccessTarget =
  | {
      readonly kind: "DOCUMENT";
      readonly documentId: string;
      readonly title: string;
    }
  | {
      readonly kind: "FOLDER";
      readonly folderCode: string;
      readonly label: string;
    };

const selectClass =
  "cq-body-sm min-h-11 w-full rounded-md border border-(--cq-border) bg-(--cq-surface) px-3 text-(--cq-text-primary)";

const HISTORY_WORDS = {
  SHARED: "shared with",
  REVOKED: "revoked for",
  EXPIRED: "ended for",
} as const;

function AddInvestor({
  candidates,
  label,
  onShare,
  busy,
}: {
  readonly candidates: readonly AccessCandidate[];
  readonly label: string;
  readonly busy: boolean;
  readonly onShare: (input: {
    readonly relationshipId: string;
    readonly accessLevel: DocumentAccessLevel;
    readonly days: number;
  }) => void;
}) {
  const [relationshipId, setRelationshipId] = useState("");
  const [accessLevel, setAccessLevel] = useState<DocumentAccessLevel>("view");
  const [days, setDays] = useState<number>(DATA_ROOM_GRANT_DEFAULT_DAYS);
  if (candidates.length === 0) {
    return (
      <p className="cq-caption text-(--cq-text-tertiary)">
        You can share with investors you&apos;re in touch with. None yet.
      </p>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="cq-caption flex flex-col gap-1 text-(--cq-text-secondary) sm:col-span-2">
        Add an investor
        <select
          value={relationshipId}
          onChange={(event) => setRelationshipId(event.target.value)}
          className={selectClass}
          data-access-candidate
        >
          <option value="">Choose an investor</option>
          {candidates.map((candidate) => (
            <option
              key={candidate.relationshipId}
              value={candidate.relationshipId}
            >
              {candidate.investorOrganisationName}
            </option>
          ))}
        </select>
      </label>
      <label className="cq-caption flex flex-col gap-1 text-(--cq-text-secondary)">
        They can
        <select
          value={accessLevel}
          onChange={(event) =>
            setAccessLevel(event.target.value as DocumentAccessLevel)
          }
          className={selectClass}
        >
          <option value="view">{DOCUMENT_ACCESS_LEVEL_WORDS.view}</option>
          <option value="view_download">
            {DOCUMENT_ACCESS_LEVEL_WORDS.view_download}
          </option>
        </select>
      </label>
      <label className="cq-caption flex flex-col gap-1 text-(--cq-text-secondary)">
        For
        <select
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
          className={selectClass}
        >
          {DATA_ROOM_GRANT_DAYS.map((n) => (
            <option key={n} value={n}>
              {n} days
            </option>
          ))}
        </select>
      </label>
      <div className="sm:col-span-2">
        <button
          type="button"
          disabled={busy || relationshipId === ""}
          onClick={() => onShare({ relationshipId, accessLevel, days })}
          className={buttonClassName("primary", "regular", "min-h-11")}
          data-access-share
        >
          {label}
        </button>
      </div>
    </div>
  );
}

function ScopeChoices({
  current,
  busy,
  onChoose,
}: {
  readonly current: DataRoomLevel | null;
  readonly busy: boolean;
  readonly onChoose: (level: DataRoomLevel) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="cq-title-sm mb-2 text-(--cq-text-primary)">
        Who can see it
      </legend>
      {DOCUMENT_SCOPE_CHOICES.map((choice) => {
        const on = current === choice.level;
        return (
          <label
            key={choice.level}
            className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 ${on ? "border-(--cq-accent) bg-(--cq-accent-soft)" : "border-(--cq-border-subtle)"}`}
            data-scope-choice={choice.level}
          >
            <input
              type="radio"
              name="who-can-see"
              checked={on}
              disabled={busy}
              onChange={() => onChoose(choice.level)}
              className="mt-1 size-4 accent-(--cq-accent)"
            />
            <span className="flex flex-col">
              <span className="cq-body text-(--cq-text-primary)">
                {choice.words}
              </span>
              <span className="cq-caption text-(--cq-text-secondary)">
                {choice.detail}
              </span>
            </span>
          </label>
        );
      })}
      <details className="cq-caption text-(--cq-text-secondary)">
        <summary className="min-h-11 cursor-pointer py-2">
          {DOCUMENT_SCOPES_NOT_OFFERED.length} more aren&apos;t offered for
          company documents
        </summary>
        <ul className="flex flex-col gap-1 pb-2">
          {DOCUMENT_SCOPES_NOT_OFFERED.map((scope) => (
            <li key={scope.scope}>
              <span className="text-(--cq-text-primary)">{scope.words}</span>:{" "}
              {scope.reason}
            </li>
          ))}
        </ul>
      </details>
    </fieldset>
  );
}

function DocumentAccess({
  companyId,
  access,
  reload,
  say,
}: {
  readonly companyId: string;
  readonly access: DocumentAccessDto;
  readonly reload: () => Promise<void>;
  readonly say: (words: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (
    work: () => Promise<{ ok: boolean; message?: string }>,
    words: string,
  ) => {
    setBusy(true);
    const out = await work();
    setBusy(false);
    say(out.ok ? words : (out.message ?? "That didn't go through."));
    await reload();
  };
  return (
    <div className="flex flex-col gap-5" data-document-access-sheet>
      <ScopeChoices
        current={access.level}
        busy={busy}
        onChoose={(level) =>
          void run(
            () =>
              setLevelAction({
                companyId,
                documentId: access.documentId,
                level,
                version: access.version,
              }),
            "Saved.",
          )
        }
      />
      <section className="flex flex-col gap-2">
        <h3 className="cq-title-sm text-(--cq-text-primary)">
          People with access
        </h3>
        {access.grants.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            No investor has it shared with them now.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
            {access.grants.map((grant) => (
              <li
                key={grant.policyId}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
                data-access-grant={grant.policyId}
              >
                <span className="flex flex-col">
                  <span className="cq-body text-(--cq-text-primary)">
                    {grant.investorOrganisationName ?? "An investor"}
                  </span>
                  <span className="cq-caption text-(--cq-text-secondary)">
                    {DOCUMENT_ACCESS_LEVEL_WORDS[grant.accessLevel]}
                    {grant.expiresAt === null
                      ? " · no end date"
                      : ` · until ${shortDate(grant.expiresAt)}`}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => revokeAccessAction(grant.policyId),
                      `${grant.investorOrganisationName ?? "They"} can't open it any more.`,
                    )
                  }
                  className={buttonClassName(
                    "secondary",
                    "compact",
                    "min-h-11",
                  )}
                  data-access-revoke
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
        <AddInvestor
          candidates={access.candidates}
          label="Share"
          busy={busy}
          onShare={(input) =>
            void run(
              () => shareDocumentAction(access.documentId, input),
              "Shared. They've been told.",
            )
          }
        />
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="cq-title-sm text-(--cq-text-primary)">History</h3>
        {access.history.length === 0 ? (
          <p className="cq-caption text-(--cq-text-tertiary)">
            Never shared with an investor.
          </p>
        ) : (
          <ul className="flex flex-col gap-1" data-access-history>
            {access.history.slice(0, 20).map((entry, index) => (
              <li
                key={`${entry.at}:${String(index)}`}
                className="cq-caption text-(--cq-text-secondary)"
              >
                {shortDate(entry.at)} · {HISTORY_WORDS[entry.what]}{" "}
                {entry.investorOrganisationName ?? "an investor"},{" "}
                {DOCUMENT_ACCESS_LEVEL_WORDS[entry.accessLevel].toLowerCase()}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FolderAccess({
  companyId,
  access,
  reload,
  say,
}: {
  readonly companyId: string;
  readonly access: FolderAccessDto;
  readonly reload: () => Promise<void>;
  readonly say: (words: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const levels = new Set(access.documents.map((document) => document.level));
  const current =
    levels.size === 1 ? (access.documents[0]?.level ?? null) : null;
  const run = async (
    work: () => Promise<{ ok: boolean; message?: string }>,
    words: string,
  ) => {
    setBusy(true);
    const out = await work();
    setBusy(false);
    say(out.ok ? words : (out.message ?? "That didn't go through."));
    await reload();
  };
  return (
    <div className="flex flex-col gap-5" data-folder-access-sheet>
      {current === null ? (
        <p className="cq-caption text-(--cq-text-secondary)">
          Its documents are set differently. Choosing one below sets all{" "}
          {access.documents.length}.
        </p>
      ) : null}
      <ScopeChoices
        current={current}
        busy={busy}
        onChoose={(level) =>
          void run(
            () => setFolderLevelAction(companyId, access.folderCode, level),
            "Saved for every document in the folder.",
          )
        }
      />
      <section className="flex flex-col gap-2">
        <h3 className="cq-title-sm text-(--cq-text-primary)">
          Investors with access
        </h3>
        {access.investors.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            No investor has any of it shared with them now.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
            {access.investors.map((investor) => (
              <li key={investor.relationshipId} className="py-2">
                <span className="cq-body text-(--cq-text-primary)">
                  {investor.investorOrganisationName ?? "An investor"}
                </span>{" "}
                <span className="cq-caption text-(--cq-text-secondary)">
                  · {investor.documents} of {access.documents.length} documents
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="cq-caption text-(--cq-text-tertiary)">
          To take one document back, open its Access.
        </p>
        <AddInvestor
          candidates={access.candidates}
          label="Share the folder"
          busy={busy}
          onShare={(input) =>
            void run(
              () => shareFolderAction(companyId, access.folderCode, input),
              "Shared. They've been told.",
            )
          }
        />
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="cq-title-sm text-(--cq-text-primary)">In this folder</h3>
        <ul className="flex flex-col gap-1">
          {access.documents.map((document) => (
            <li
              key={document.documentId}
              className="cq-caption text-(--cq-text-secondary)"
            >
              {document.title} ·{" "}
              {DOCUMENT_SCOPE_CHOICES.find((c) => c.level === document.level)
                ?.words ?? "Only my team"}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function AccessSheet({
  companyId,
  target,
  onClose,
}: {
  readonly companyId: string;
  readonly target: AccessTarget | null;
  readonly onClose: () => void;
}) {
  const [documentAccess, setDocumentAccess] =
    useState<DocumentAccessDto | null>(null);
  const [folderAccess, setFolderAccess] = useState<FolderAccessDto | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (target === null) return;
    if (target.kind === "DOCUMENT") {
      const out = await loadDocumentAccessAction(target.documentId);
      if (out.ok) setDocumentAccess(out.value);
      else setMessage(out.message);
    } else {
      const out = await loadFolderAccessAction(companyId, target.folderCode);
      if (out.ok) setFolderAccess(out.value);
      else setMessage(out.message);
    }
  }, [companyId, target]);

  useEffect(() => {
    if (target === null) return;
    void load();
  }, [target, load]);

  const close = () => {
    setDocumentAccess(null);
    setFolderAccess(null);
    setMessage(null);
    onClose();
  };

  return (
    <SheetRoot
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {target === null ? null : (
        <SheetContent
          side="side"
          title={target.kind === "DOCUMENT" ? target.title : target.label}
          description={
            target.kind === "DOCUMENT"
              ? "Who can see this document"
              : "Who can see this folder"
          }
        >
          {message === null ? null : (
            <p
              role="status"
              className="cq-body-sm mb-3 text-(--cq-text-secondary)"
            >
              {message}
            </p>
          )}
          {target.kind === "DOCUMENT" ? (
            documentAccess === null ? (
              <p className="cq-body-sm text-(--cq-text-tertiary)">Loading…</p>
            ) : (
              <DocumentAccess
                companyId={companyId}
                access={documentAccess}
                reload={load}
                say={setMessage}
              />
            )
          ) : folderAccess === null ? (
            <p className="cq-body-sm text-(--cq-text-tertiary)">Loading…</p>
          ) : (
            <FolderAccess
              companyId={companyId}
              access={folderAccess}
              reload={load}
              say={setMessage}
            />
          )}
        </SheetContent>
      )}
    </SheetRoot>
  );
}
