"use client";

import { requestBreakGlassAction } from "./console-actions";
import { ReasonAction } from "./console-ui";

export function RunBreakGlass({ runId }: { readonly runId: string }) {
  return (
    <ReasonAction
      label="Ask to read Q's words"
      title="Ask to read this run's words?"
      description="A run's words are private. A second admin must approve; access lasts 30 minutes and every read is logged."
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
