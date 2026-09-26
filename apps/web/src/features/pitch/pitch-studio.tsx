"use client";

import { useCallback, useEffect, useState } from "react";

import type { CompanyDto } from "@capital-q/contracts";

import { PageSection } from "@/components/app-shell/page-container";

import { loadPitchOverviewAction } from "./pitch-actions";
import { PitchLibrary } from "./pitch-library";
import { PitchUpload } from "./pitch-upload";

/**
 * "Pitch & media" (VID): the current pitch with its upload, replace and
 * publish controls, and beneath it every version the company has had.
 *
 * The two halves read the same server record and tell each other when it
 * moved: an upload or a decision above re-reads the history; withdrawing
 * the current pitch below remounts the upload so it starts from what the
 * server now says rather than from what it last showed.
 */
export function PitchStudio({ companyId }: { readonly companyId: string }) {
  const [company, setCompany] = useState<CompanyDto | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [uploadKey, setUploadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void loadPitchOverviewAction(companyId).then((result) => {
      if (!cancelled && result.ok) setCompany(result.value.company);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const onRecordChanged = useCallback(
    () => setHistoryKey((value) => value + 1),
    [],
  );
  const onCurrentChanged = useCallback(
    () => setUploadKey((value) => value + 1),
    [],
  );

  return (
    <div className="flex flex-col gap-10">
      <PitchUpload
        key={uploadKey}
        companyId={companyId}
        onRecordChanged={onRecordChanged}
      />
      <PageSection
        id="pitch-history"
        title="All versions"
        description="Every pitch you have uploaded, newest first. Only the current one can be published."
      >
        <PitchLibrary
          companyId={companyId}
          company={company}
          refreshKey={historyKey}
          onCurrentChanged={onCurrentChanged}
        />
      </PageSection>
    </div>
  );
}
