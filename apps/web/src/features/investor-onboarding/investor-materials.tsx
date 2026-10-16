"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "@capital-q/ui/button";
import { Select } from "@capital-q/ui/select";
import { InlineNotice } from "@capital-q/ui/states";

import type { MaterialFileView } from "../onboarding-kit/materials";
import {
  investorMaterialCompleteAction,
  investorMaterialListAction,
  investorMaterialTargetAction,
} from "./investor-material-actions";
import { useT } from "@/features/i18n/language";

/**
 * Optional investor materials in setup (owner directive 2026-10-16): a fund
 * deck, an investment thesis or an LP letter. Never required, never a gate:
 * setup completes without them. They are the firm's own documents, private
 * to the firm, and Q may read them to help with the mandate. Nothing read
 * from them is saved to the mandate without the person's confirmation.
 *
 * Offered only once the journey has a firm to file them under; before
 * that, one line says why.
 */

export const INVESTOR_MATERIAL_KINDS = [
  { value: "FUND_DECK", label: "Fund deck" },
  { value: "INVESTMENT_THESIS", label: "Investment thesis" },
  { value: "LP_LETTER", label: "LP letter" },
] as const;

const MAX_BYTES = 25_000_000;
const ACCEPTED = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
];
const ACCEPTED_EXTENSIONS = ".pdf,.pptx,.ppt,.docx,.doc,.txt";

export type InvestorMaterialPorts = {
  readonly list: typeof investorMaterialListAction;
  readonly target: typeof investorMaterialTargetAction;
  readonly complete: typeof investorMaterialCompleteAction;
  readonly put: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: File },
  ) => Promise<{ readonly ok: boolean }>;
};

const DEFAULT_PORTS: InvestorMaterialPorts = {
  list: investorMaterialListAction,
  target: investorMaterialTargetAction,
  complete: investorMaterialCompleteAction,
  put: (url, init) => fetch(url, init),
};

export function InvestorMaterials({
  firmReady,
  ports = DEFAULT_PORTS,
}: {
  /** The journey has bound its firm; documents have somewhere to belong. */
  readonly firmReady: boolean;
  readonly ports?: InvestorMaterialPorts | undefined;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const kindId = useId();
  const [kind, setKind] = useState<string>(INVESTOR_MATERIAL_KINDS[0].value);
  const [files, setFiles] = useState<readonly MaterialFileView[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const listed = await ports.list();
    if (listed.ok) setFiles(listed.value);
  }, [ports]);

  useEffect(() => {
    if (!firmReady) return;
    let live = true;
    void ports.list().then((listed) => {
      if (live && listed.ok) setFiles(listed.value);
    });
    return () => {
      live = false;
    };
  }, [firmReady, ports]);
  async function upload(file: File): Promise<void> {
    if (file.size > MAX_BYTES) {
      setProblem(
        `${file.name} is larger than 25MB. Try a smaller version, or carry on without it.`,
      );
      return;
    }
    if (!ACCEPTED.includes(file.type)) {
      setProblem(
        `We can't read ${file.name} yet. PDF, PowerPoint, Word and plain text work today.`,
      );
      return;
    }
    // One key per file: a retry after a lost response gets the same
    // upload back, never a second document.
    const key = crypto.randomUUID();
    const target = await ports.target({
      documentType: kind,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      idempotencyKey: key,
    });
    if (!target.ok) {
      setProblem(target.message);
      return;
    }
    const put = await ports.put(target.value.url, {
      method: target.value.method,
      headers: { ...target.value.headers },
      body: file,
    });
    if (!put.ok) {
      setProblem("We couldn't upload that file. Try again.");
      return;
    }
    const done = await ports.complete(target.value.uploadSessionId, key);
    if (!done.ok) {
      setProblem(done.message);
      return;
    }
    await refresh();
  }

  if (!firmReady) {
    return (
      <p
        className="cq-body-sm text-(--cq-text-secondary)"
        data-investor-materials="waiting"
      >
        {t(
          "Once your firm is named you can add a fund deck, thesis or LP letter here. Optional.",
        )}
      </p>
    );
  }

  return (
    <details className="group flex flex-col gap-4" data-investor-materials>
      <summary className="cq-body flex min-h-11 cursor-pointer items-center font-medium text-(--cq-text-primary)">
        Add a fund deck, thesis or LP letter (optional)
      </summary>
      <div className="flex flex-col gap-4 pt-2">
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {t(
            "Private to your firm. Q can read them to help with your mandate, and asks before anything it reads is saved.",
          )}
        </p>
        <Select
          id={kindId}
          label={t("What is this?")}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          disabled={busy}
          options={[...INVESTOR_MATERIAL_KINDS]}
        />
        <div>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {t("Choose a file")}
          </Button>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            accept={ACCEPTED_EXTENSIONS}
            tabIndex={-1}
            aria-hidden="true"
            data-investor-materials-input
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file === undefined) return;
              setProblem(null);
              setBusy(true);
              void upload(file).finally(() => setBusy(false));
            }}
          />
        </div>
        {problem === null ? null : (
          <InlineNotice tone="warning">{problem}</InlineNotice>
        )}
        {files.length > 0 ? (
          <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
                data-investor-material={file.id}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="cq-body truncate text-(--cq-text-primary)">
                    {file.filename}
                  </span>
                  <span className="cq-caption text-(--cq-text-tertiary)">
                    {file.kindLabel}
                  </span>
                </span>
                <span
                  className="cq-body-sm text-(--cq-text-secondary)"
                  aria-live="polite"
                >
                  {file.stateLabel}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
