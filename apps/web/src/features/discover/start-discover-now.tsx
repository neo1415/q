"use client";

import { useState } from "react";

import { Button } from "@capital-q/ui/button";
import { useT } from "@/features/i18n/language";

import { startDiscoverWithMandateSoFarAction } from "./feed/mandate-actions";

/**
 * Owner 2026-10-28: an unfinished mandate still opens Discover. One tap,
 * theirs, switches it on with what they have told Q so far; the rest can
 * be finished any time and keeps refining the same mandate.
 */
export function StartDiscoverNow() {
  const t = useT();
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <span className="flex flex-col gap-2">
      <Button
        disabled={working}
        onClick={() => {
          setWorking(true);
          setProblem(null);
          void startDiscoverWithMandateSoFarAction().then((result) => {
            if (result.ok) {
              // The slate is built on the server: load Discover afresh.
              window.location.reload();
              return;
            }
            setWorking(false);
            setProblem(result.message);
          });
        }}
        data-start-discover
      >
        {working ? t("Switching on Discover…") : t("Show me companies now")}
      </Button>
      {problem === null ? null : (
        <span role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {t(problem)}
        </span>
      )}
    </span>
  );
}
