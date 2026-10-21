"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import type {
  ProfileFinding,
  ProfileFindingKey,
  ProfileFindingSubjectType,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Check } from "@capital-q/ui/icons";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { formatDay } from "@/components/date-format";
import { QRing } from "@/features/relationships/crm-kit";
import { accountButton, Pending } from "@/features/settings/account-kit";
import { useT } from "@/features/i18n/language";

import {
  saveCompanyFieldAction,
  saveInvestorFieldAction,
  savePersonFieldAction,
  type ProfileSaveResult,
} from "./profile-actions";
import { ProfileSectionShell } from "./editable-section";
import type { FindingsState } from "./profile-enrichment";

/**
 * What Q found in public (chosen design "One page, edit in place",
 * 2026-10-21; BIZ-002, ADR-001 D2): Q's reading of public pages, each with
 * its source and "Not verified", never the profile's value until the
 * person approves it. Approving writes exactly that statement into the
 * field it belongs to, through the same per-field write path as Edit, at
 * the version this page read (the approval binds to that one change).
 * A finding with no field of its own is something to ask Q about. Dismiss
 * hides it on this device.
 */

const FINDING_LABELS: Readonly<Record<ProfileFindingKey, string>> = {
  "presence.self_description": "How it describes itself",
  "presence.what_they_do": "What it does",
  "presence.location": "Where it is",
  "presence.milestone": "A milestone",
};

type Target = {
  readonly field: string;
  readonly label: string;
};

/** The profile field a finding fills, when it has one. */
export function findingTarget(
  subjectType: ProfileFindingSubjectType,
  key: ProfileFindingKey,
): Target | null {
  switch (subjectType) {
    case "COMPANY":
      return key === "presence.self_description"
        ? { field: "shortDescription", label: "One-line description" }
        : key === "presence.what_they_do"
          ? { field: "primaryDescription", label: "What the company does" }
          : null;
    case "INVESTOR_ORGANISATION":
      return key === "presence.self_description" ||
        key === "presence.what_they_do"
        ? { field: "publicDescription", label: "In your words" }
        : null;
    case "PERSON":
      return key === "presence.self_description"
        ? { field: "headline", label: "Headline" }
        : null;
  }
}

export type FoundSubject = {
  readonly subjectType: ProfileFindingSubjectType;
  readonly subjectId: string;
  /** How the subject is named in a question to Q ("Kivu Freight", "me"). */
  readonly label: string;
  readonly hasWebsite: boolean;
  /** The record's version this page read; null when it can't be written here. */
  readonly version: number | null;
  readonly findings: FindingsState;
};

const DISMISSED_KEY = "cq.profile.dismissed-findings";

/** The stored list as a string: a stable snapshot for the external store. */
function readDismissedRaw(): string {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function parseDismissed(raw: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string").slice(-200)
      : [];
  } catch {
    return [];
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function save(
  subject: FoundSubject,
  field: string,
  value: string,
  version: number,
): Promise<ProfileSaveResult> {
  switch (subject.subjectType) {
    case "PERSON":
      return savePersonFieldAction(field, value, version);
    case "COMPANY":
      return saveCompanyFieldAction(subject.subjectId, field, value, version);
    case "INVESTOR_ORGANISATION":
      return saveInvestorFieldAction(subject.subjectId, field, value, version);
  }
}

export function FoundSection({
  subjects,
  visibility,
}: {
  readonly subjects: readonly FoundSubject[];
  readonly visibility?: ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const { askNow } = useGlobalQ();
  // Dismissed on this device before, and dismissed now.
  const stored = useSyncExternalStore(
    subscribeToStorage,
    readDismissedRaw,
    () => "[]",
  );
  const [local, setLocal] = useState<readonly string[]>([]);
  const dismissed = [...parseDismissed(stored), ...local];
  const [approved, setApproved] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{
    readonly id: string;
    readonly message: string;
  } | null>(null);
  const [versions, setVersions] = useState<Readonly<Record<string, number>>>(
    {},
  );

  const primary = subjects[0];
  const loading = subjects.some((s) => s.findings.status === "LOADING");
  const unavailable =
    !loading && subjects.every((s) => s.findings.status === "UNAVAILABLE");
  const rows = subjects.flatMap((subject) =>
    subject.findings.status === "READ"
      ? subject.findings.findings.map((finding) => ({ subject, finding }))
      : [],
  );
  const lookDraft =
    primary === undefined
      ? "Look for public information about me."
      : `Look for public information about ${primary.label} and tell me what you find.`;

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setLocal((current) => [...current, id]);
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Private mode: it stays dismissed until the page is left.
    }
  };

  const approve = (subject: FoundSubject, finding: ProfileFinding) => {
    const target = findingTarget(subject.subjectType, finding.key);
    const version = versions[subject.subjectId] ?? subject.version;
    if (target === null || version === null) return;
    setBusy(finding.id);
    setProblem(null);
    void save(subject, target.field, finding.statement, version).then(
      (result) => {
        setBusy(null);
        if (!result.ok) {
          setProblem({
            id: finding.id,
            message:
              result.reason === "INVALID"
                ? "That doesn't fit this field as it is. Ask Q to shape it."
                : result.message,
          });
          return;
        }
        setVersions((current) => ({
          ...current,
          [subject.subjectId]: result.version,
        }));
        setApproved((current) => [...current, finding.id]);
        router.refresh();
      },
    );
  };

  const shown = rows.filter(
    ({ finding }) =>
      !dismissed.includes(finding.id) || approved.includes(finding.id),
  );

  return (
    <ProfileSectionShell
      id="found"
      title={t("What Q found in public")}
      variant="brief"
      visibility={visibility}
    >
      {loading ? (
        <p
          className="m-0 flex items-center gap-2 text-sm text-(--cq-text-secondary)"
          aria-busy="true"
        >
          <QRing className="text-(--cq-accent)" />
          {t("Reading what Q found…")}
        </p>
      ) : shown.length === 0 ? (
        <>
          <p className="m-0 max-w-[68ch] text-sm text-(--cq-text-secondary)">
            {unavailable
              ? t(
                  "What Q found couldn't be read just now. Try again in a moment.",
                )
              : primary?.hasWebsite === true
                ? t(
                    "Nothing found yet. Your name and website are on record; ask Q to look and what it finds shows here.",
                  )
                : t(
                    "Nothing found yet. Add your website and Q can look; what it finds shows here.",
                  )}
          </p>
          <button
            type="button"
            className={accountButton("secondary", "regular", "mt-1 self-start")}
            onClick={() => askNow(lookDraft)}
            data-signals-look
          >
            <QRing />
            {t("Look for public information about me")}
          </button>
        </>
      ) : (
        <>
          <p className="m-0 mb-0.5 text-sm text-(--cq-text-secondary)">
            {t("Nothing changes on your profile until you approve it.")}
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {shown.map(({ subject, finding }) => {
              const target = findingTarget(subject.subjectType, finding.key);
              const done = approved.includes(finding.id);
              const gone = dismissed.includes(finding.id) && !done;
              const source = finding.sources[0];
              const read =
                source?.retrievedAt === null || source === undefined
                  ? null
                  : formatDay(source.retrievedAt);
              return (
                <li
                  key={finding.id}
                  data-finding={finding.key}
                  className={cx(
                    "grid grid-cols-1 items-center gap-3 rounded-[10px] border px-3.5 py-3 transition-[opacity,background-color,border-color] duration-(--cq-motion-base) sm:grid-cols-[minmax(0,1fr)_auto]",
                    done
                      ? "border-solid border-(--cq-positive) bg-(--cq-positive-soft)"
                      : "border-dashed border-(--cq-accent)/50 bg-(--cq-accent-soft)",
                    gone ? "opacity-50" : null,
                  )}
                >
                  <span className="min-w-0">
                    <b className="block text-sm text-(--cq-text-primary)">
                      {t(target?.label ?? FINDING_LABELS[finding.key])}: “
                      {finding.statement}”
                    </b>
                    <span className="text-[12.5px] text-(--cq-text-secondary)">
                      {[
                        source === undefined ? null : hostOf(source.url),
                        read === null ? null : `read ${read}`,
                      ]
                        .filter((part) => part !== null)
                        .join(", ")}
                      {source === undefined ? "" : ". "}
                      {finding.truthClass === "VERIFIED"
                        ? t("Verified.")
                        : t("Not verified.")}
                    </span>
                    {problem?.id === finding.id ? (
                      <span
                        role="alert"
                        className="mt-1 block text-[12.5px] text-(--cq-text-primary)"
                      >
                        {t(problem.message)}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {done ? (
                      <span className="cq-crm-swap inline-flex items-center gap-1.5 text-[13px] font-medium text-(--cq-text-primary)">
                        <span className="cq-crm-tick-in grid size-5 place-items-center rounded-full bg-(--cq-positive) text-(--cq-text-inverse)">
                          <Check
                            size={12}
                            strokeWidth={2.4}
                            aria-hidden="true"
                          />
                        </span>
                        {t("Added to your profile")}
                      </span>
                    ) : gone ? (
                      <span className="cq-crm-swap text-xs text-(--cq-text-tertiary)">
                        {t("Dismissed")}
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={accountButton("quiet", "sm")}
                          onClick={() => dismiss(finding.id)}
                          data-finding-dismiss
                        >
                          {t("Dismiss")}
                        </button>
                        {target !== null && subject.version !== null ? (
                          <button
                            type="button"
                            className={accountButton("secondary", "sm")}
                            disabled={busy !== null}
                            aria-busy={busy === finding.id}
                            onClick={() => approve(subject, finding)}
                            data-finding-approve
                          >
                            {busy === finding.id ? (
                              <Pending>{t("Saving…")}</Pending>
                            ) : (
                              t("Approve this change")
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={accountButton("secondary", "sm")}
                            onClick={() =>
                              askNow(
                                `You found on ${source === undefined ? "a public page" : hostOf(source.url)} about ${subject.label}: "${finding.statement}". Is that right, and should any of it go on my profile?`,
                              )
                            }
                          >
                            {t("Ask Q about this")}
                          </button>
                        )}
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </ProfileSectionShell>
  );
}
