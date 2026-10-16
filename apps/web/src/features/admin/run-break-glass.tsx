"use client";

import { requestBreakGlassAction } from "./console-actions";
import { ReasonAction } from "./console-ui";
import { useT } from "@/features/i18n/language";

export function RunBreakGlass({ runId }: { readonly runId: string }) {
  const t = useT();

  return (
    <ReasonAction
      label={t("Ask to read Q's words")}
      title={t("Ask to read this run's words?")}
      description={t(
        "A run's words are private. A second admin must approve; access lasts 30 minutes and every read is logged.",
      )}
      confirm="Send request"
      minLength={20}
      reasonLabel="Why you need to read them"
      run={(reason) =>
        requestBreakGlassAction({
          targetType: "Q_RUN",
          targetId: runId,
          reason,
        })
      }
    />
  );
}
