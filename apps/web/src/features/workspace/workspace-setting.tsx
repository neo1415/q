"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { SRow } from "@/features/settings/account-layout";
import { WordSwitch } from "@/features/settings/account-kit";
import { useT } from "@/features/i18n/language";

import { useWorkspaceMode } from "./workspace-context";
import { setWorkspacePreferenceAction } from "./workspace-actions";

/**
 * "Q Workspace (preview)" (W1.1): Q and the page side by side. Shown only
 * while the server offers it (`CQ_WORKSPACE_MODE` labs or on); with the
 * server switch off this row does not exist.
 */
export function WorkspaceRow() {
  const t = useT();
  const router = useRouter();
  const mode = useWorkspaceMode();
  const [on, setOn] = useState(mode.enabled);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  if (!mode.available) return null;
  return (
    <SRow
      id="workspace"
      title={t("Q Workspace (preview)")}
      description={
        <>
          {t(
            "Q and your pages side by side. Q can open the page you are talking about.",
          )}
          {failed ? (
            <span role="alert" className="mt-1 block text-(--cq-text-primary)">
              {t("That didn't save. Try again.")}
            </span>
          ) : null}
        </>
      }
    >
      <WordSwitch
        on={on}
        disabled={pending}
        label={t("Q Workspace (preview)")}
        onWord={t("On")}
        offWord={t("Off")}
        data-workspace-toggle
        onChange={(next) => {
          setFailed(false);
          setOn(next);
          startTransition(async () => {
            const saved = await setWorkspacePreferenceAction(next);
            if (!saved.ok) {
              setOn(!next);
              setFailed(true);
              return;
            }
            router.refresh();
          });
        }}
      />
    </SRow>
  );
}
