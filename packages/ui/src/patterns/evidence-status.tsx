import type { ComponentType } from "react";

import {
  CircleAlert,
  FileText,
  ICON_SIZE,
  ICON_STROKE,
  Info,
  MessageSquare,
  Sparkle,
} from "../icons/index.js";
import { cx } from "../primitives/class-names.js";

/**
 * Where a piece of understanding comes from and how settled it is. These are
 * presentation labels over the ADR-001 axes (truth class, evidence status,
 * lifecycle) -- kept as distinct kinds rather than one `isVerified` boolean,
 * so "from your deck" and "you told Q" and "Q inferred" never collapse into
 * one truth state. Callers supply whichever kind their data justifies.
 */

export const EVIDENCE_KINDS = [
  "from_document",
  "from_founder",
  "inferred",
  "needs_confirmation",
  "needs_evidence",
  "uncertain",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

const presentation: Record<
  EvidenceKind,
  {
    readonly label: string;
    readonly Icon: ComponentType<{
      readonly size?: number;
      readonly strokeWidth?: number;
      readonly className?: string;
      readonly "aria-hidden"?: boolean | "true";
    }>;
    readonly tone: string;
  }
> = {
  from_document: {
    label: "From your materials",
    Icon: FileText,
    tone: "text-(--cq-text-secondary)",
  },
  from_founder: {
    label: "You told Q",
    Icon: MessageSquare,
    tone: "text-(--cq-text-secondary)",
  },
  inferred: { label: "Q inferred", Icon: Sparkle, tone: "text-(--cq-accent)" },
  needs_confirmation: {
    label: "Needs your confirmation",
    Icon: Info,
    tone: "text-(--cq-accent)",
  },
  needs_evidence: {
    label: "Needs evidence",
    Icon: CircleAlert,
    tone: "text-(--cq-warning)",
  },
  uncertain: {
    label: "Uncertain",
    Icon: CircleAlert,
    tone: "text-(--cq-text-tertiary)",
  },
};

export function evidenceKindLabel(kind: EvidenceKind): string {
  return presentation[kind].label;
}

export function EvidenceStatus({
  kind,
  detail,
  className,
}: {
  readonly kind: EvidenceKind;
  /** Optional specific source, e.g. "pitch deck, page 4". */
  readonly detail?: string | undefined;
  readonly className?: string | undefined;
}) {
  const { label, Icon, tone } = presentation[kind];
  return (
    <span
      data-evidence={kind}
      className={cx(
        "inline-flex items-center gap-1 cq-caption font-medium",
        tone,
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        size={ICON_SIZE.compact - 2}
        strokeWidth={ICON_STROKE}
      />
      <span>
        {label}
        {detail !== undefined ? (
          <span className="font-normal"> · {detail}</span>
        ) : null}
      </span>
    </span>
  );
}
