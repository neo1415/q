import type {
  QMemoryItemDto,
  QPreferenceLearningDto,
} from "@capital-q/contracts";

import { QSection } from "@/features/q/q-section";

import { AccountToastProvider } from "./account-kit";
import { AccountColumn, AccountHead } from "./account-layout";
import { PreferenceLearningSwitch } from "./preference-learning";
import { QMemoryList } from "./q-memory-list";

/**
 * What Q remembers about the person (ADR 0012; chosen design "Grouped,
 * forget in place", 2026-10-21). The route reads it under their own
 * session; /dev/account-review hands in fixtures. Null items: the read
 * failed, said as such rather than as an empty memory.
 */
export function MemoryView({
  t,
  items,
  learning,
  review,
}: {
  readonly t: (english: string) => string;
  readonly items: readonly QMemoryItemDto[] | null;
  readonly learning: QPreferenceLearningDto | null;
  /** Design review only: see QMemoryList. */
  readonly review?:
    { readonly forgotten?: string; readonly correcting?: string } | undefined;
}) {
  return (
    <AccountToastProvider>
      <AccountColumn>
        <QSection id="memory" kind="MEMORY" label={t("what Q remembers")}>
          <AccountHead
            title={t("What Q remembers")}
            back={{ href: "/settings", label: t("Settings") }}
            sub={t(
              "What Q keeps about you and how you work. Correct anything, or tell Q to forget it.",
            )}
          />
          <PreferenceLearningSwitch initial={learning} />
          {items === null ? (
            <p
              className="mt-4 text-[15px] text-(--cq-text-secondary)"
              data-state="unavailable"
            >
              {t("Q's memory couldn't be read just now. Reload in a moment.")}
            </p>
          ) : (
            <QMemoryList items={items} review={review} />
          )}
        </QSection>
      </AccountColumn>
    </AccountToastProvider>
  );
}
