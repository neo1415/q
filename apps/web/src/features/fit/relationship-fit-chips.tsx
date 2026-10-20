"use client";

import {
  FIT_BAND_LABELS,
  FIT_CONFIDENCE_LABELS,
  FIT_PARAMETER_LABELS,
  type FitProfileDto,
} from "@capital-q/contracts";

import { FitGlyph } from "./fit-glyph";
import { chipParameters } from "./fit-words";
import { useT } from "@/features/i18n/language";

/**
 * Fit on a relationship card (brief B3; match.html "relationships"): the
 * band and confidence in words, up to three strong parameters, and the
 * first unknown, each chip a glyph and a word. `null` (no mandate) says
 * so quietly rather than showing nothing at all.
 */
export function RelationshipFitChips({
  profile,
}: {
  readonly profile: FitProfileDto | null;
}) {
  const t = useT();
  const chip =
    "inline-flex items-center gap-[5px] whitespace-nowrap rounded-full border border-(--cq-border-subtle) px-2 py-[3px] text-[12.5px] text-(--cq-text-secondary)";
  if (profile === null) {
    return (
      <span
        className="flex flex-wrap items-center gap-1.5"
        data-fit-chips="none"
      >
        <span className={chip}>
          <FitGlyph kind="UNKNOWN" size={13} />
          Fit not set up
        </span>
      </span>
    );
  }
  const { strong, unknown } = chipParameters(profile);
  return (
    <span
      className="flex flex-wrap items-center gap-1.5"
      data-fit-chips={profile.band}
    >
      <span className={`${chip} font-medium text-(--cq-text-primary)`}>
        {FIT_BAND_LABELS[profile.band]} ·{" "}
        {FIT_CONFIDENCE_LABELS[profile.confidence].toLowerCase()}
      </span>
      {strong.map((p) => (
        <span key={p.parameter} className={chip}>
          <FitGlyph kind="STRONG" size={13} />
          {t(FIT_PARAMETER_LABELS[p.parameter])}
        </span>
      ))}
      {unknown === null ? null : (
        <span className={chip}>
          <FitGlyph kind="UNKNOWN" size={13} />
          {FIT_PARAMETER_LABELS[unknown.parameter]} unknown
        </span>
      )}
    </span>
  );
}

/**
 * The same facts as one quiet line, for a dense list row (redesign
 * 2026-10-15: four chips a row read as badge spam). The band and
 * confidence lead; what matches and the first unknown follow in words.
 */
export function RelationshipFitLine({
  profile,
}: {
  readonly profile: FitProfileDto | null;
}) {
  const t = useT();
  if (profile === null) {
    return (
      <p className="cq-caption text-(--cq-text-tertiary)" data-fit-line="none">
        Fit not set up
      </p>
    );
  }
  const { strong, unknown } = chipParameters(profile);
  const matches =
    strong.length === 0
      ? null
      : `matches ${strong
          .map((p) => FIT_PARAMETER_LABELS[p.parameter].toLowerCase())
          .join(", ")}`;
  const gap =
    unknown === null
      ? null
      : `${FIT_PARAMETER_LABELS[unknown.parameter].toLowerCase()} unknown`;
  return (
    <p
      className="cq-caption truncate text-(--cq-text-secondary)"
      data-fit-line={profile.band}
    >
      <span className="font-medium text-(--cq-text-primary)">
        {t(FIT_BAND_LABELS[profile.band])}
      </span>
      {` · ${FIT_CONFIDENCE_LABELS[profile.confidence].toLowerCase()}`}
      {[matches, gap]
        .filter((part): part is string => part !== null)
        .map((part) => ` · ${part}`)
        .join("")}
    </p>
  );
}
