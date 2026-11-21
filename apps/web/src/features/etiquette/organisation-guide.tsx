"use client";

import { useState, useTransition } from "react";

import {
  PERSONAL_ETIQUETTE_TEXT_MAX,
  type OrganisationEtiquetteGuideDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { useT } from "@/features/i18n/language";
import { QMarkdown } from "@/features/q/markdown";

import { saveOrganisationGuideAction } from "./etiquette-actions";
import { EMPTY_DRAFT, GuideInput, type GuideDraft } from "./guide-input";

/**
 * Owner decision 112: the organisation's own guide ("How Q speaks for
 * us"). Every member reads the version in force and its history; owners
 * and admins write a new version (each save is a version; none is ever
 * rewritten). `canChange` is the API's own answer, and the API refuses a
 * save from anyone else regardless of what this draws.
 */

const PLACEHOLDER = `For example:
- We write to investors formally, and sign "The Harbour team".
- Never promise a timeline we haven't agreed internally.
- Use "we", never "I", when Q writes for the firm.`;

function savedOn(at: string): string {
  return new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function OrganisationGuide({
  initial,
  canManage,
}: {
  readonly initial: OrganisationEtiquetteGuideDto;
  /** The page's read of the person's role; the API decides again. */
  readonly canManage: boolean;
}) {
  const t = useT();
  const [ours, setOurs] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<GuideDraft>(EMPTY_DRAFT);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const guide = ours.guide;
  const mayEdit = canManage && ours.canChange;

  const startEditing = () => {
    setDraft(
      guide === null
        ? EMPTY_DRAFT
        : {
            sourceKind: guide.sourceKind,
            fileName: guide.fileName,
            mediaType: guide.mediaType,
            text: guide.text,
          },
    );
    setMessage(null);
    setEditing(true);
  };

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await saveOrganisationGuideAction(draft);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setOurs(result.ours);
      setEditing(false);
      setMessage(
        t(
          "Saved as a new version. Q follows it from its next message for the organisation.",
        ),
      );
    });
  };

  return (
    <div className="flex flex-col gap-4" data-org-guide>
      <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
        {t(
          "How the organisation comes across when Q writes or speaks for its members. It wins over Capital Q's house guide; a person's own guide wins over it. It shapes Q's wording only.",
        )}
      </p>

      {editing ? (
        <div className="flex flex-col gap-3">
          <GuideInput
            label={t("The organisation's guide")}
            placeholder={PLACEHOLDER}
            maxCharacters={PERSONAL_ETIQUETTE_TEXT_MAX}
            draft={draft}
            onChange={setDraft}
            disabled={pending}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={save}
              disabled={pending || draft.text.trim().length === 0}
            >
              {pending ? t("Saving…") : t("Save a new version")}
            </Button>
            <Button
              variant="quiet"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              {t("Cancel")}
            </Button>
          </div>
        </div>
      ) : guide === null ? (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
            {t("No organisation guide yet: Q follows the house guide.")}
          </p>
          {mayEdit ? (
            <Button onClick={startEditing}>
              {t("Write the organisation's guide")}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="m-0 cq-caption text-(--cq-text-tertiary)">
            {t("Version")} {guide.version} · {savedOn(guide.savedAt)}
            {guide.fileName === null ? "" : ` · ${guide.fileName}`}
          </p>
          <div className="cq-body-sm max-h-64 overflow-y-auto rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-subtle) p-3 text-(--cq-text-primary)">
            <QMarkdown text={guide.text} />
          </div>
          {mayEdit ? (
            <div>
              <Button onClick={startEditing} disabled={pending}>
                {t("Write a new version")}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {ours.versions.length > 1 ? (
        <details className="cq-body-sm text-(--cq-text-secondary)">
          <summary className="cursor-pointer">{t("Earlier versions")}</summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
            {ours.versions.slice(1).map((one) => (
              <li key={one.version} data-org-guide-version={one.version}>
                {t("Version")} {one.version} · {savedOn(one.savedAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {message === null ? null : (
        <p role="status" className="m-0 cq-caption text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </div>
  );
}
