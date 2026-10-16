import { ICON_SIZE, Info } from "@capital-q/ui/icons";

import { useT } from "@/features/i18n/language";

/**
 * ADR 0042 (founder decision 2026-10-03): until a malware scanner is
 * attached, files are processed and shared without a virus scan. Every
 * place such a file can be downloaded says so, in words, beside it.
 */
export const NOT_SCANNED_TEXT = "Not virus-scanned yet";

export function NotScannedNote() {
  // Rendered only inside client components (downloads, the data room).
  const t = useT();
  return (
    <span
      className="cq-caption inline-flex items-center gap-1 text-(--cq-text-secondary)"
      data-not-scanned
    >
      <Info size={ICON_SIZE.compact} aria-hidden="true" />
      {t(NOT_SCANNED_TEXT)}
    </span>
  );
}
