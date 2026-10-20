import type { LedgerCommitmentDto } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";

/**
 * Where one commitment stands, as a five-step ladder (design 2026-10-20):
 * Soft, Firm, Confirmed (both sides), Sent and Received. Each step is a
 * word under a bar, so the colour only repeats it. Received is only ever
 * the company's own confirmation. An amount not recorded has no step.
 */
export const LADDER = [
  "Soft",
  "Firm",
  "Confirmed",
  "Sent",
  "Received",
] as const;

/** The step a commitment reached; null: no amount recorded, so no step. */
export function ladderStep(
  item: Pick<LedgerCommitmentDto, "status" | "level"> | null,
): number | null {
  if (item === null) return null;
  switch (item.status) {
    case "RECEIVED":
      return 4;
    case "TRANSFER_SENT":
      return 3;
    case "CONFIRMED":
      return 2;
    case "STATED":
    case "DETECTED":
      return item.level === "SOFT" ? 0 : 1;
  }
}

export function CommitmentLadder({
  step,
  words,
}: {
  /** From `ladderStep`; null when the amount is not recorded. */
  readonly step: number | null;
  /** The words, translated by the caller (server or client). */
  readonly words: (english: string) => string;
}) {
  const label =
    step === null ? words("Amount not recorded") : words(LADDER[step] ?? "");
  return (
    <div
      className="grid grid-cols-5 gap-1"
      role="img"
      aria-label={label}
      data-ladder={step === null ? "unknown" : String(step)}
    >
      {LADDER.map((entry, index) => {
        const done =
          step !== null && (index < step || (step === 4 && index === 4));
        const now = step !== null && step !== 4 && index === step;
        return (
          <span
            key={entry}
            className={cx(
              "flex min-w-0 flex-col gap-1 text-[11px]",
              now
                ? "font-semibold text-(--cq-text-primary)"
                : "text-(--cq-text-tertiary)",
            )}
          >
            <i
              aria-hidden="true"
              className={cx(
                "block h-1.5 rounded-full transition-colors duration-300",
                done
                  ? "bg-(--cq-positive)"
                  : now
                    ? "bg-(--cq-accent)"
                    : "bg-(--cq-surface-strong)",
              )}
            />
            <span className="truncate">{words(entry)}</span>
          </span>
        );
      })}
    </div>
  );
}
