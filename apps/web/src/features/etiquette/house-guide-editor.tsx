"use client";

import { useId, useState } from "react";

import {
  PLATFORM_ETIQUETTE_TEXT_MAX,
  type AdminEtiquetteGuideDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { ResultLine, useConsoleAction } from "@/features/admin/console-ui";

import {
  activateHouseGuideAction,
  recordHouseGuideAction,
} from "./etiquette-actions";
import { EMPTY_DRAFT, GuideInput, type GuideDraft } from "./guide-input";

/**
 * The console's house guide (ADR 0050): what Q follows for everyone when it
 * writes or speaks for a person. Upload a PDF or Word file or paste text;
 * each save is a new version and is in force at once. Any recorded version,
 * or Capital Q's built-in guide, can be put back in force. Saving and
 * switching go through the console's step-up guard; the API decides.
 */

function when(at: string): string {
  return new Date(at).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HouseGuideEditor({
  guide,
}: {
  readonly guide: AdminEtiquetteGuideDto;
}) {
  const titleId = useId();
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<GuideDraft>(EMPTY_DRAFT);
  const { perform, pending, result } = useConsoleAction();
  const builtInActive = guide.activeVersionId === null;

  const save = () =>
    perform(
      () =>
        recordHouseGuideAction({
          title: title.trim() === "" ? (draft.fileName ?? "") : title,
          ...draft,
        }),
      () => {
        setTitle("");
        setDraft(EMPTY_DRAFT);
      },
    );

  return (
    <div className="flex flex-col gap-4">
      <section className="cq-panel flex flex-col gap-3 p-5">
        <h2 className="cq-title-sm text-(--cq-text-primary)">In force now</h2>
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {builtInActive
            ? "Capital Q's built-in guide."
            : `"${guide.activeTitle}"`}
          {guide.updatedAt === null ? "" : ` Since ${when(guide.updatedAt)}.`}{" "}
          Each person can add their own guide in Settings, which wins on style.
          No guide can change what Q may do, what needs approval, or what Q may
          say is true.
        </p>
        <details className="group">
          <summary className="cq-body-sm min-h-11 cursor-pointer content-center font-medium text-(--cq-text-primary)">
            Read it
          </summary>
          <div className="cq-body-sm mt-2 max-h-96 overflow-y-auto rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-subtle) p-3 whitespace-pre-wrap text-(--cq-text-primary)">
            {guide.activeText}
          </div>
        </details>
      </section>

      <section className="cq-panel flex flex-col gap-3 p-5">
        <h2 className="cq-title-sm text-(--cq-text-primary)">
          Upload a new version
        </h2>
        <div className="flex flex-col gap-2">
          <label
            htmlFor={titleId}
            className="cq-body-sm text-(--cq-text-secondary)"
          >
            Title
          </label>
          <input
            id={titleId}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            disabled={pending}
            placeholder="How we talk to investors and founders"
            className="cq-body min-h-11 w-full rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) px-3 text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
          />
        </div>
        <GuideInput
          label="The guide"
          placeholder="Paste the guide, or upload a PDF or Word file."
          maxCharacters={PLATFORM_ETIQUETTE_TEXT_MAX}
          draft={draft}
          onChange={setDraft}
          disabled={pending}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={save}
            disabled={
              pending ||
              draft.text.trim().length === 0 ||
              (title.trim() === "" && draft.fileName === null)
            }
          >
            {pending ? "Saving…" : "Save and use it"}
          </Button>
          <ResultLine result={result} />
        </div>
      </section>

      <section className="cq-panel flex flex-col gap-3 p-5">
        <h2 className="cq-title-sm text-(--cq-text-primary)">Versions</h2>
        <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
          <li className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 flex-col">
              <span className="cq-body text-(--cq-text-primary)">
                {guide.builtIn.title} (built in)
              </span>
              <span className="cq-caption text-(--cq-text-tertiary)">
                Capital Q&apos;s own · {guide.builtIn.version}
              </span>
            </div>
            {builtInActive ? (
              <span className="cq-caption text-(--cq-text-secondary)">
                In force
              </span>
            ) : (
              <Button
                size="compact"
                disabled={pending}
                onClick={() => perform(() => activateHouseGuideAction(null))}
              >
                Use this
              </Button>
            )}
          </li>
          {guide.versions.map((version) => (
            <li
              key={version.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="cq-body break-words text-(--cq-text-primary)">
                  {version.title}
                </span>
                <span className="cq-caption text-(--cq-text-tertiary)">
                  Version {version.version} · {version.createdBy ?? "an admin"}{" "}
                  · {when(version.createdAt)} ·{" "}
                  {version.characters.toLocaleString("en-GB")} characters
                  {version.fileName === null ? "" : ` · ${version.fileName}`}
                </span>
              </div>
              {version.id === guide.activeVersionId ? (
                <span className="cq-caption text-(--cq-text-secondary)">
                  In force
                </span>
              ) : (
                <Button
                  size="compact"
                  disabled={pending}
                  onClick={() =>
                    perform(() => activateHouseGuideAction(version.id))
                  }
                >
                  Use this
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
