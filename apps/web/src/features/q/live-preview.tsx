"use client";

import type {
  QArtifactPreview,
  QArtifactPreviewSubject,
} from "@capital-q/contracts";

import { EntityAvatar } from "@/features/entity/entity-avatar";

/**
 * Artifacts live (owner 2026-10-20): the card for what Q is saying, up the
 * moment Q names it.
 *
 * Drawn from the stream's preview: the subjects the answer's words have
 * named so far, as the run's own authorised reads returned them. Each
 * frame shows only what is already known, the name and its picture (the
 * logo or photo, falling back to initials), and holds a quiet placeholder
 * where the answer's findings will land. Nothing here is a finding: no
 * score, no reason, no number until the answer's blocks replace it.
 *
 * The frames sit where the answer's own cards will sit (one, a row, or a
 * table's columns), so the hand-over to the real set does not rearrange
 * the screen. The shimmer stops under reduced motion.
 */

function subjectIds(one: QArtifactPreviewSubject): {
  readonly companyId?: string;
  readonly investorOrganisationId?: string;
} {
  // The server previews only companies and investors; any other subject
  // has no picture route and shows its initials.
  if (one.subject.kind === "COMPANY") {
    return { companyId: one.subject.companyId };
  }
  if (one.subject.kind === "INVESTOR_ORGANISATION") {
    return { investorOrganisationId: one.subject.investorOrganisationId };
  }
  return {};
}

export function previewKey(one: QArtifactPreviewSubject): string {
  const ids = subjectIds(one);
  return ids.companyId ?? ids.investorOrganisationId ?? one.name;
}

function Avatar({
  one,
  size,
}: {
  readonly one: QArtifactPreviewSubject;
  readonly size: number;
}) {
  const ids = subjectIds(one);
  return (
    <EntityAvatar
      kind={ids.investorOrganisationId === undefined ? "company" : "investor"}
      name={one.name}
      size={size}
      decorative
      fallback="initials"
      siteLogo
      {...ids}
    />
  );
}

function Bar({ width }: { readonly width: string }) {
  return (
    <span
      aria-hidden="true"
      className="block h-3 rounded-full bg-(--cq-surface-subtle) motion-safe:animate-pulse"
      style={{ width }}
    />
  );
}

function PreviewCard({ one }: { readonly one: QArtifactPreviewSubject }) {
  return (
    <li
      className="flex min-w-0 flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
      data-q-preview-card={previewKey(one)}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Avatar one={one} size={40} />
        <span className="cq-title-sm min-w-0 truncate text-(--cq-text-primary)">
          {one.name}
        </span>
      </div>
      <Bar width="85%" />
      <Bar width="60%" />
    </li>
  );
}

/** Rows a comparison usually carries; placeholders only, never labels. */
const TABLE_ROWS = 4;

function PreviewTable({
  subjects,
}: {
  readonly subjects: readonly QArtifactPreviewSubject[];
}) {
  return (
    <div
      className="relative w-full overflow-x-auto rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised)"
      data-q-preview-table
    >
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th scope="col" className="w-1/4 p-3">
              <span className="sr-only">Measure</span>
            </th>
            {subjects.map((one) => (
              <th
                key={previewKey(one)}
                scope="col"
                className="p-3 text-start"
                data-q-preview-column={previewKey(one)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar one={one} size={32} />
                  <span className="cq-label min-w-0 truncate text-(--cq-text-primary)">
                    {one.name}
                  </span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody aria-hidden="true">
          {Array.from({ length: TABLE_ROWS }, (_, row) => (
            <tr key={row} className="border-t border-(--cq-border-subtle)">
              <td className="p-3">
                <Bar width="70%" />
              </td>
              {subjects.map((one) => (
                <td key={previewKey(one)} className="p-3">
                  <Bar width={row % 2 === 0 ? "80%" : "55%"} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LivePreview({
  preview,
}: {
  readonly preview: QArtifactPreview;
}) {
  const { subjects } = preview;
  const names = subjects.map((one) => one.name).join(", ");
  return (
    <section
      className="flex w-full flex-col gap-3"
      aria-busy="true"
      aria-label={names}
      data-q-preview={preview.messageId}
      data-q-preview-layout={preview.layout ?? "CARD"}
    >
      {preview.layout === "TABLE" && subjects.length >= 2 ? (
        <PreviewTable subjects={subjects} />
      ) : (
        <ul
          className={`m-0 grid w-full list-none gap-3 p-0 ${
            subjects.length === 1
              ? "grid-cols-1"
              : subjects.length === 2
                ? "grid-cols-1 sm:grid-cols-2"
                : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          }`}
        >
          {subjects.map((one) => (
            <PreviewCard key={previewKey(one)} one={one} />
          ))}
        </ul>
      )}
    </section>
  );
}
