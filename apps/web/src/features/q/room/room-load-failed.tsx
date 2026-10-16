"use client";
import { useT } from "@/features/i18n/language";

/**
 * Q room W6 (R9): what a room surface shows when its read failed twice.
 * Plain words and one button; the surface keeps its shape around it.
 */
export function RoomLoadFailed({
  onRetry,
  className,
}: {
  readonly onRetry: () => void;
  readonly className?: string | undefined;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      className={`flex flex-col items-start gap-2 ${className ?? ""}`}
      data-q-room-failed
    >
      <p className="cq-body-sm text-(--cq-text-secondary)">
        {t("Couldn't load — try again.")}
      </p>
      <button
        type="button"
        className="cq-stage-quiet min-h-11"
        onClick={onRetry}
        data-q-room-retry
      >
        {t("Try again")}
      </button>
    </div>
  );
}
