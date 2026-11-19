"use client";

import { useId, useState, useTransition } from "react";

import {
  RELATIONSHIP_SIDE_PRIORITIES,
  RELATIONSHIP_SIDE_STAGES,
  type RelationshipSideDetails,
  type RelationshipSideDetailsRead,
  type RelationshipSidePriority,
  type RelationshipSideStage,
  type UpdateRelationshipSideDetailsRequest,
} from "@capital-q/contracts";
import { Input } from "@capital-q/ui/input";
import { Select } from "@capital-q/ui/select";
import { InlineNotice } from "@capital-q/ui/states";

import { useT } from "@/features/i18n/language";

import { crmButton } from "./crm-kit";
import {
  groupedAmount,
  PRIORITY_WORDS,
  SIDE_STAGE_WORDS,
} from "./pipeline-import-model";
import {
  readSideDetailsAction,
  updateSideDetailsAction,
  type ImportActionResult,
} from "./pipeline-import-actions";
import type { Read } from "./record-workspace";

/**
 * The side's own pipeline fields on one relationship (decision 106, CRM
 * import gaps): their own stage, deal owner, source and introducer, the
 * cheque or ticket they expect and its priority. Only their side reads
 * them; the counterpart never does, and they never move the shared state.
 * Saving is server-confirmed and names the revision it was made from, so
 * a colleague's newer save is never silently overwritten.
 */

/** Currencies offered first; the field keeps any ISO code it already has. */
const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "NGN",
  "KES",
  "ZAR",
  "GHS",
  "EGP",
  "AED",
  "SAR",
  "CAD",
  "AUD",
  "INR",
] as const;

export type SideDetailsOps = {
  readonly save: (input: {
    readonly relationshipId: string;
    readonly request: UpdateRelationshipSideDetailsRequest;
  }) => Promise<ImportActionResult<RelationshipSideDetails>>;
  readonly reload: (
    relationshipId: string,
  ) => Promise<ImportActionResult<RelationshipSideDetailsRead>>;
};

const SERVER_OPS: SideDetailsOps = {
  save: (input) => updateSideDetailsAction(input),
  reload: (relationshipId) => readSideDetailsAction(relationshipId),
};

type Draft = {
  stage: RelationshipSideStage | "";
  owner: string;
  source: string;
  introducerName: string;
  introducerEmail: string;
  amount: string;
  currency: string;
  priority: RelationshipSidePriority | "";
};

function draftOf(details: RelationshipSideDetails): Draft {
  return {
    stage: details.stage ?? "",
    owner: details.owner?.membershipId ?? "",
    source: details.source ?? "",
    introducerName: details.introducerName ?? "",
    introducerEmail: details.introducerEmail ?? "",
    amount: details.expected?.amount ?? "",
    currency: details.expected?.currency ?? "USD",
    priority: details.priority ?? "",
  };
}

const text = (value: string) => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * The request for what changed, and only that. Null: the amount is not a
 * plain number (said before anything is sent).
 */
export function sideDetailsRequest(
  before: RelationshipSideDetails,
  draft: Draft,
): UpdateRelationshipSideDetailsRequest | null {
  const was = draftOf(before);
  const request: {
    -readonly [
      K in keyof UpdateRelationshipSideDetailsRequest
    ]: UpdateRelationshipSideDetailsRequest[K];
  } = { revision: before.revision };
  if (draft.stage !== was.stage) {
    request.stage = draft.stage === "" ? null : draft.stage;
    // A stage chosen here replaces the imported words for it.
    request.stageLabel = null;
  }
  if (draft.owner !== was.owner)
    request.ownerMembershipId = draft.owner === "" ? null : draft.owner;
  if (text(draft.source) !== text(was.source))
    request.source = text(draft.source);
  if (text(draft.introducerName) !== text(was.introducerName))
    request.introducerName = text(draft.introducerName);
  if (text(draft.introducerEmail) !== text(was.introducerEmail))
    request.introducerEmail = text(draft.introducerEmail);
  const amount = draft.amount.replace(/[\s,]/g, "");
  if (
    amount !== was.amount ||
    (amount !== "" && draft.currency !== was.currency)
  ) {
    if (amount === "") {
      request.expected = null;
    } else if (
      !/^(0|[1-9]\d{0,14})(\.\d{1,2})?$/.test(amount) ||
      !/[1-9]/.test(amount)
    ) {
      return null;
    } else {
      request.expected = { amount, currency: draft.currency };
    }
  }
  if (draft.priority !== was.priority)
    request.priority = draft.priority === "" ? null : draft.priority;
  return request;
}

export { groupedAmount };

export function RelationshipSideDetailsCard({
  relationshipId,
  side,
  read,
  ops = SERVER_OPS,
}: {
  readonly relationshipId: string;
  readonly side: "INVESTOR" | "COMPANY";
  readonly read: Read<RelationshipSideDetailsRead>;
  readonly ops?: SideDetailsOps | undefined;
}) {
  const t = useT();
  const id = useId();
  const [state, setState] = useState<RelationshipSideDetailsRead | null>(
    read.kind === "READ" ? read.value : null,
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSaving] = useTransition();

  if (state === null) {
    return (
      <p
        className="cq-body-sm text-(--cq-text-secondary)"
        data-state="unavailable"
      >
        {t(
          "Your pipeline fields couldn't be read just now. They are unchanged.",
        )}
      </p>
    );
  }
  const details = state.details;
  const expectedWord =
    side === "INVESTOR" ? "Expected ticket" : "Expected cheque";

  const rows: readonly (readonly [string, string | null])[] = [
    [
      "Your stage",
      details.stage !== null
        ? t(SIDE_STAGE_WORDS[details.stage])
        : details.stageLabel,
    ],
    ["Deal owner", details.owner?.name ?? null],
    ["Source", details.source],
    [
      "Introduced by",
      [details.introducerName, details.introducerEmail]
        .filter((part) => part !== null)
        .join(" · ") || null,
    ],
    [
      expectedWord,
      details.expected === null
        ? null
        : `${details.expected.currency} ${groupedAmount(details.expected.amount)}`,
    ],
    [
      "Priority",
      details.priority === null ? null : t(PRIORITY_WORDS[details.priority]),
    ],
  ];

  function startEdit() {
    setError(null);
    setSaved(false);
    setDraft(draftOf(details));
    setEditing(true);
  }

  function save() {
    if (draft === null) return;
    const request = sideDetailsRequest(details, draft);
    if (request === null) {
      setError("Write the amount as a number, like 250000 or 1500000.50.");
      return;
    }
    if (Object.keys(request).length === 1) {
      setEditing(false);
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await ops.save({ relationshipId, request });
      if (result.ok) {
        setState((current) =>
          current === null ? current : { ...current, details: result.value },
        );
        setEditing(false);
        setSaved(true);
        return;
      }
      setError(result.message);
      if (result.conflict === true) {
        const fresh = await ops.reload(relationshipId);
        if (fresh.ok) {
          setState(fresh.value);
          setDraft(draftOf(fresh.value.details));
        }
      }
    });
  }

  if (!editing || draft === null) {
    return (
      <div className="flex flex-col gap-3" data-side-details>
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="cq-body-sm text-(--cq-text-secondary)">
                {t(label)}
              </dt>
              <dd
                className={
                  value === null
                    ? "cq-body-sm text-(--cq-text-tertiary)"
                    : "cq-body-sm break-words text-(--cq-text-primary)"
                }
              >
                {value ?? t("Not set")}
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex items-center justify-between gap-3">
          <span
            className="cq-caption text-(--cq-text-tertiary)"
            aria-live="polite"
          >
            {saved ? t("Saved.") : null}
          </span>
          <button
            type="button"
            className={crmButton("secondary")}
            onClick={startEdit}
            data-side-details-edit
          >
            {t("Edit")}
          </button>
        </div>
      </div>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) =>
      current === null ? current : { ...current, [key]: value },
    );
  const currencies = CURRENCIES.includes(
    draft.currency as (typeof CURRENCIES)[number],
  )
    ? CURRENCIES
    : [draft.currency, ...CURRENCIES];

  return (
    <form
      data-q-editing
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      data-side-details-form
    >
      <Select
        id={`${id}-stage`}
        label={t("Your stage")}
        value={draft.stage}
        onChange={(event) => set("stage", event.target.value as Draft["stage"])}
        options={[
          {
            value: "",
            label:
              details.stage === null && details.stageLabel !== null
                ? details.stageLabel
                : t("Not set"),
          },
          ...RELATIONSHIP_SIDE_STAGES.map((stage) => ({
            value: stage,
            label: t(SIDE_STAGE_WORDS[stage]),
          })),
        ]}
      />
      <Select
        id={`${id}-owner`}
        label={t("Deal owner")}
        value={draft.owner}
        onChange={(event) => set("owner", event.target.value)}
        options={[
          { value: "", label: t("Not set") },
          ...state.members.map((member) => ({
            value: member.membershipId,
            label: member.name,
          })),
        ]}
      />
      <Input
        id={`${id}-source`}
        label={t("Source")}
        description={t("Where it came from, like a warm intro or an event.")}
        value={draft.source}
        maxLength={200}
        onChange={(event) => set("source", event.target.value)}
      />
      <Input
        id={`${id}-introducer`}
        label={t("Introduced by")}
        value={draft.introducerName}
        maxLength={200}
        autoComplete="off"
        onChange={(event) => set("introducerName", event.target.value)}
      />
      <Input
        id={`${id}-introducer-email`}
        label={t("Introducer's email")}
        type="email"
        value={draft.introducerEmail}
        maxLength={254}
        autoComplete="off"
        onChange={(event) => set("introducerEmail", event.target.value)}
      />
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
        <Input
          id={`${id}-amount`}
          label={t(expectedWord)}
          inputMode="decimal"
          value={draft.amount}
          maxLength={24}
          onChange={(event) => set("amount", event.target.value)}
        />
        <Select
          id={`${id}-currency`}
          label={t("Currency")}
          value={draft.currency}
          onChange={(event) => set("currency", event.target.value)}
          options={currencies.map((code) => ({ value: code, label: code }))}
        />
      </div>
      <Select
        id={`${id}-priority`}
        label={t("Priority")}
        value={draft.priority}
        onChange={(event) =>
          set("priority", event.target.value as Draft["priority"])
        }
        options={[
          { value: "", label: t("Not set") },
          ...RELATIONSHIP_SIDE_PRIORITIES.map((priority) => ({
            value: priority,
            label: t(PRIORITY_WORDS[priority]),
          })),
        ]}
      />
      {error === null ? null : (
        <InlineNotice tone="danger">{t(error)}</InlineNotice>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className={crmButton("quiet")}
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
          disabled={saving}
        >
          {t("Cancel")}
        </button>
        <button
          type="submit"
          className={crmButton("primary")}
          disabled={saving}
          data-side-details-save
        >
          {saving ? t("Saving…") : t("Save")}
        </button>
      </div>
    </form>
  );
}
