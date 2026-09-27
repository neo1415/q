"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type {
  AudiencePreviewDto,
  VisibilityAudience,
  VisibilityStateDto,
} from "@capital-q/contracts";
import { instrumentLabel } from "@capital-q/founder-onboarding";
import { Button } from "@capital-q/ui/button";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
import { formatAmountForDisplay } from "@capital-q/ui/money-input";
import { Select } from "@capital-q/ui/select";
import { InlineNotice, Skeleton } from "@capital-q/ui/states";

import { countryLabel, stageLabel } from "./declared-labels";
import {
  loadAudiencePreviewAction,
  loadVisibilityStateAction,
  revokeShareAction,
  shareRaiseAction,
} from "./visibility-actions";
import { formatLongDay } from "@/components/date-format";

/**
 * The visibility control centre (CQ-BIZ-003; business research §6.2).
 *
 * Three parts, each the server's answer: the company previewed as each
 * audience sees it (the same disclosure evaluator every real read uses,
 * never a client-side mock), who can see each thing and what may change
 * it, and the active shares with named investors, each revocable. The
 * preview is read-only: it is not "view as" and impersonates nobody.
 */

const AUDIENCES: readonly {
  readonly value: VisibilityAudience;
  readonly label: string;
  readonly means: string;
}[] = [
  {
    value: "PUBLIC",
    label: "Public",
    means: "Anyone with a link, signed in or not.",
  },
  {
    value: "NETWORK",
    label: "Capital Q network",
    means:
      "Any organisation on Capital Q that has no relationship with you and nothing shared with it.",
  },
  {
    value: "INVESTOR",
    label: "A specific investor",
    means: "One investor organisation you have a relationship with.",
  },
  {
    value: "ONLY_US",
    label: "Only us",
    means: "People in your own organisation.",
  },
];

// The objective stores canonical codes ("priced_equity"); the shared
// label reads either spelling.
const INSTRUMENT_LABELS = {
  get: (code: string) => instrumentLabel(code),
};

const OBJECT_WORDS: Readonly<
  Record<
    VisibilityStateDto["objects"][number]["object"],
    { readonly name: string; readonly scopeWords: (scope: string) => string }
  >
> = {
  COMPANY_PROFILE: {
    name: "Company profile",
    scopeWords: (scope) =>
      scope === "network_visible"
        ? "Visible to organisations on Capital Q."
        : scope === "public_external"
          ? "Public to anyone with a link."
          : "Private to your organisation.",
  },
  CAPITAL_OBJECTIVE: {
    name: "Your raise",
    scopeWords: () =>
      "Private to your company. You can share it with an investor you have a relationship with; it is never shown to the network or the public.",
  },
};

export function VisibilityCentre({
  companyId,
  refreshKey,
}: {
  readonly companyId: string;
  /** Changes whenever the page changed who can see the profile. */
  readonly refreshKey: string;
}) {
  const [state, setState] = useState<VisibilityStateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await loadVisibilityStateAction(companyId);
    if (result.ok) {
      setState(result.value);
      setError(null);
    } else {
      setError(result.message);
    }
  }, [companyId]);

  // Read on mount and whenever the page changed who can see the profile.
  useEffect(() => {
    let cancelled = false;
    void loadVisibilityStateAction(companyId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setState(result.value);
        setError(null);
      } else {
        setError(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, refreshKey]);

  if (state === null) {
    return error === null ? (
      <div aria-busy="true" aria-label="Loading who can see what">
        <Skeleton lines={4} />
      </div>
    ) : (
      <InlineNotice tone="danger" title="Visibility couldn't load">
        {error}
      </InlineNotice>
    );
  }

  return (
    <div
      className="flex max-w-(--cq-layout-reading) flex-col gap-10"
      data-visibility-centre
    >
      {notice !== null ? (
        <InlineNotice tone="positive" title="Done">
          {notice}
        </InlineNotice>
      ) : null}
      {error !== null ? (
        <InlineNotice tone="danger" title="That didn't go through">
          {error}
        </InlineNotice>
      ) : null}
      <WhoSeesWhat
        companyId={companyId}
        state={state}
        onChanged={async (message) => {
          // The list is re-read before the notice, so "done" never sits
          // beside a ledger that still says otherwise.
          await load();
          setNotice(message);
          setError(null);
        }}
        onError={setError}
      />
      <AudiencePreview
        companyId={companyId}
        relationships={state.relationships}
        refreshKey={`${refreshKey}:${state.shares.map((s) => s.policyId).join(",")}`}
      />
    </div>
  );
}

function WhoSeesWhat({
  companyId,
  state,
  onChanged,
  onError,
}: {
  readonly companyId: string;
  readonly state: VisibilityStateDto;
  readonly onChanged: (message: string) => Promise<void>;
  readonly onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [recipient, setRecipient] = useState("");
  // One key per intended share, reused if the same share is retried.
  const key = useRef<string | null>(null);
  const raise = state.objects.find((o) => o.object === "CAPITAL_OBJECTIVE");
  const sharedWith = new Set(state.shares.map((s) => s.relationshipId));
  const candidates = state.relationships.filter(
    (r) => !sharedWith.has(r.relationshipId),
  );

  const share = async () => {
    if (recipient === "") return;
    key.current ??= `share:${crypto.randomUUID()}`;
    setBusy(true);
    try {
      const result = await shareRaiseAction(companyId, recipient, key.current);
      if (!result.ok) {
        onError(result.message);
        return;
      }
      key.current = null;
      const name =
        state.relationships.find((r) => r.relationshipId === recipient)?.name ??
        "that investor";
      setRecipient("");
      await onChanged(
        result.value.outcome === "REDUNDANT"
          ? `${name} could already see your raise.`
          : `${name} can now see your raise: target, instrument, stage and close date. Nothing else was shared.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (policyId: string, name: string) => {
    setBusy(true);
    try {
      const result = await revokeShareAction(companyId, policyId);
      if (!result.ok) {
        onError(result.message);
        return;
      }
      await onChanged(
        `${name} can no longer see your raise. Future access is removed; what they already saw can't be recalled.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="who-sees-what" className="flex flex-col gap-4">
      <h2 id="who-sees-what" className="cq-title-md text-(--cq-text-primary)">
        Who can see what
      </h2>
      <ul className="cq-panel-rows flex max-w-(--cq-layout-reading) flex-col border-y border-(--cq-border-subtle)">
        {state.objects.map((object) => (
          <li
            key={object.object}
            className="flex flex-col gap-1.5 py-3"
            data-visibility-object={object.object}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="cq-label text-(--cq-text-primary)">
                {OBJECT_WORDS[object.object].name}
              </span>
              <ContextIndicator scope={object.scope} compact />
            </div>
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {OBJECT_WORDS[object.object].scopeWords(object.scope)}
              {object.object === "COMPANY_PROFILE"
                ? " Change it with the switch above."
                : null}
            </p>
          </li>
        ))}
        <li
          className="flex flex-col gap-1.5 py-3"
          data-visibility-object="PRIVATE"
        >
          <span className="cq-label text-(--cq-text-primary)">
            Everything else
          </span>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Your setup answers, documents, what Q read from them, your
            conversations with Q and the use of funds. Private to your
            organisation, whatever you choose here.
          </p>
        </li>
      </ul>

      {raise === undefined ? (
        <p className="cq-status-line">
          No raise to share yet. Once you set a capital objective, you can share
          it with an investor you have a relationship with.
        </p>
      ) : (
        <div className="flex max-w-(--cq-layout-reading) flex-col gap-3">
          <h3 className="cq-label text-(--cq-text-primary)">
            Shared with investors
          </h3>
          {state.shares.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Nothing is shared with a specific investor.
            </p>
          ) : (
            <ul
              aria-label="Active shares"
              className="flex flex-col border-y border-(--cq-border-subtle)"
            >
              {state.shares.map((share) => {
                const name = share.recipientName ?? "An investor organisation";
                return (
                  <li
                    key={share.policyId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                    data-share={share.policyId}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="cq-body text-(--cq-text-primary)">
                        {name}
                      </span>
                      <span className="cq-caption text-(--cq-text-secondary)">
                        Your raise · can view
                        {share.expiresAt === null
                          ? " · until you revoke it"
                          : ` · until ${share.expiresAt.slice(0, 10)}`}
                      </span>
                    </span>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void revoke(share.policyId, name)}
                    >
                      Revoke
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {state.shares.length > 0 ? (
            <p className="cq-caption text-(--cq-text-tertiary)">
              Revoking removes future access. What was already seen can&apos;t
              be recalled.
            </p>
          ) : null}
          {candidates.length === 0 ? (
            <p className="cq-caption text-(--cq-text-tertiary)">
              {state.relationships.length === 0
                ? "You can share once an investor organisation has expressed interest in your company."
                : "Shared with every investor you have a relationship with."}
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-56 flex-1">
                <Select
                  id="share-raise-with"
                  label="Share your raise with"
                  placeholder="Choose an investor"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  options={candidates.map((r) => ({
                    value: r.relationshipId,
                    label: r.name,
                  }))}
                />
              </div>
              <Button
                variant="secondary"
                disabled={busy || recipient === ""}
                onClick={() => void share()}
              >
                Share
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AudiencePreview({
  companyId,
  relationships,
  refreshKey,
}: {
  readonly companyId: string;
  readonly relationships: VisibilityStateDto["relationships"];
  readonly refreshKey: string;
}) {
  const [audience, setAudience] = useState<VisibilityAudience>("NETWORK");
  const [relationshipId, setRelationshipId] = useState<string>(
    relationships[0]?.relationshipId ?? "",
  );
  const [preview, setPreview] = useState<AudiencePreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const needsInvestor = audience === "INVESTOR";
  const ready = !needsInvestor || relationshipId !== "";

  useEffect(() => {
    let cancelled = false;
    // Nothing to ask until an investor is chosen; the panel says so.
    if (!ready) return;
    void loadAudiencePreviewAction(
      companyId,
      audience,
      needsInvestor ? relationshipId : undefined,
    ).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setPreview(result.value);
        setError(null);
      } else {
        setError(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, audience, relationshipId, needsInvestor, ready, refreshKey]);

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + AUDIENCES.length) % AUDIENCES.length;
    const target = AUDIENCES[next];
    if (target === undefined) return;
    setAudience(target.value);
    tabs.current[next]?.focus();
  };

  const current = AUDIENCES.find((a) => a.value === audience);

  return (
    <section aria-labelledby="audience-preview" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2
          id="audience-preview"
          className="cq-title-md text-(--cq-text-primary)"
        >
          Preview as
        </h2>
        <p className="cq-status-line">
          Exactly what each audience is shown, decided by the same rules as
          every real view. Read-only.
        </p>
      </div>
      <div
        role="tablist"
        aria-label="Audience"
        className="flex max-w-(--cq-layout-reading) flex-wrap gap-1 border-b border-(--cq-border-subtle)"
      >
        {AUDIENCES.map((option, index) => {
          const selected = option.value === audience;
          return (
            <button
              key={option.value}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`audience-tab-${option.value}`}
              aria-selected={selected}
              aria-controls="audience-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setAudience(option.value)}
              onKeyDown={(event) => onKey(event, index)}
              className={
                selected
                  ? "cq-label -mb-px min-h-11 border-b-2 border-(--cq-text-primary) px-3 text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
                  : "cq-label -mb-px min-h-11 border-b-2 border-transparent px-3 text-(--cq-text-secondary) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div
        id="audience-panel"
        role="tabpanel"
        aria-labelledby={`audience-tab-${audience}`}
        className="flex max-w-(--cq-layout-reading) flex-col gap-4"
        data-audience={audience}
      >
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {current?.means}
        </p>
        {needsInvestor ? (
          relationships.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              No investor has a relationship with you yet, so there is no one to
              preview as.
            </p>
          ) : (
            <Select
              id="preview-as-investor"
              label="Investor"
              value={relationshipId}
              onChange={(event) => setRelationshipId(event.target.value)}
              options={relationships.map((r) => ({
                value: r.relationshipId,
                label: r.name,
              }))}
            />
          )
        ) : null}
        {error !== null ? (
          <InlineNotice tone="danger" title="That preview couldn't load">
            {error}
          </InlineNotice>
        ) : !ready ? null : preview === null ||
          // Never show one audience's preview under another's tab while
          // the right one loads.
          preview.audience !== audience ||
          (needsInvestor && preview.relationshipId !== relationshipId) ? (
          <Skeleton lines={3} />
        ) : (
          <PreviewBody preview={preview} />
        )}
      </div>
    </section>
  );
}

function PreviewBody({ preview }: { readonly preview: AudiencePreviewDto }) {
  const { profile, capitalObjective } = preview;
  if (profile === null && capitalObjective === null) {
    return (
      <p className="cq-body text-(--cq-text-primary)" data-sees="nothing">
        This audience sees nothing of your company. Q will not mention it to
        them.
      </p>
    );
  }
  const rows: readonly (readonly [string, string | null])[] =
    profile === null
      ? []
      : [
          ["Company", profile.canonicalName],
          ["Legal name", profile.legalName],
          ["Website", profile.websiteUrl],
          [
            "Based in",
            [
              profile.headquartersCity,
              countryLabel(profile.headquartersCountry),
            ]
              .filter((part): part is string => part !== null)
              .join(", ") || null,
          ],
          ["Stage", stageLabel(profile.currentStageCode)],
          [
            "Founded",
            profile.foundedDate == null
              ? profile.foundedDate
              : formatLongDay(profile.foundedDate),
          ],
          ["In short", profile.shortDescription],
          ["Description", profile.primaryDescription],
        ];
  return (
    <div className="flex flex-col gap-4">
      {profile === null ? (
        <p
          className="cq-body-sm text-(--cq-text-secondary)"
          data-sees="no-profile"
        >
          Your company profile is not shown to this audience.
        </p>
      ) : (
        <dl className="cq-panel cq-panel-rows" data-sees="profile">
          {rows.map(([label, value]) => (
            <PreviewRow key={label} label={label} value={value} />
          ))}
        </dl>
      )}
      {capitalObjective === null ? (
        <p
          className="cq-body-sm text-(--cq-text-secondary)"
          data-sees="no-raise"
        >
          Your raise is not shown to this audience.
        </p>
      ) : (
        <dl className="cq-panel cq-panel-rows" data-sees="raise">
          <PreviewRow
            label="Raising"
            value={`${capitalObjective.target.currency} ${formatAmountForDisplay(capitalObjective.target.amount)}`}
          />
          <PreviewRow
            label="Instrument"
            value={
              capitalObjective.instrumentCode === null
                ? null
                : (INSTRUMENT_LABELS.get(capitalObjective.instrumentCode) ??
                  capitalObjective.instrumentCode.replace(/_/g, " "))
            }
          />
          <PreviewRow
            label="Stage"
            value={stageLabel(capitalObjective.targetStage)}
          />
          <PreviewRow
            label="Target close"
            value={capitalObjective.targetCloseDate}
          />
        </dl>
      )}
    </div>
  );
}

function PreviewRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <div className="flex flex-col gap-0.5 px-5 py-3 sm:flex-row sm:gap-4">
      <dt className="cq-label shrink-0 text-(--cq-text-secondary) sm:w-32">
        {label}
      </dt>
      <dd className="cq-body text-(--cq-text-primary)">
        {value === null || value.length === 0 ? (
          <span className="text-(--cq-text-tertiary)">Not stated</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
