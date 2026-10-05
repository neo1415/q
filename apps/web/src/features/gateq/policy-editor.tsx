"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import type { z } from "zod";

import type {
  GatewayDraftCriterionSchema,
  PolicyProposalDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import {
  ICON_SIZE,
  ICON_STROKE,
  Trash2,
  Upload,
  X,
} from "@capital-q/ui/icons";

import { QSwarm } from "@/features/q-swarm/q-swarm";

import { extractPolicyAction, publishPolicyAction } from "./gateway-actions";

/**
 * The investor's side of "Q sets it up for you" (P7). Paste or upload the
 * mandate; Q's reader proposes rules; the investor edits or drops each one
 * and publishes. Nothing Q proposed is a rule until that press: material
 * extracted facts need confirmation, and the confirmation is the publish.
 */

type Draft = z.infer<typeof GatewayDraftCriterionSchema>;

type Proposal = PolicyProposalDto & { readonly key: string };

const DIMENSION_WORDS: Readonly<Record<PolicyProposalDto["dimension"], string>> =
  {
    STAGE: "stage",
    GEOGRAPHY: "where they're based",
    SECTOR: "sector",
    CHEQUE: "cheque size",
  };

const MAX_FILE_BYTES = 200_000;

/** The list a value chip edits, for the criterion types that have one. */
function valuesOf(config: Proposal["config"]): readonly string[] | null {
  switch (config.type) {
    case "STAGE":
      return config.allowedStageCodes;
    case "GEOGRAPHY":
      return config.allowedCountries;
    case "TAXONOMY":
      return config.allowedNodeIds;
    case "EXCLUDED_TAXONOMY":
      return config.excludedNodeIds;
    default:
      return null;
  }
}

function withoutValue(proposal: Proposal, index: number): Proposal | null {
  const drop = <T,>(list: readonly T[]) => list.filter((_, i) => i !== index);
  const valueLabels = drop(proposal.valueLabels);
  const { config } = proposal;
  let next: Proposal["config"];
  switch (config.type) {
    case "STAGE":
      next = { ...config, allowedStageCodes: drop(config.allowedStageCodes) };
      break;
    case "GEOGRAPHY":
      next = { ...config, allowedCountries: drop(config.allowedCountries) };
      break;
    case "TAXONOMY":
      next = { ...config, allowedNodeIds: drop(config.allowedNodeIds) };
      break;
    case "EXCLUDED_TAXONOMY":
      next = { ...config, excludedNodeIds: drop(config.excludedNodeIds) };
      break;
    default:
      return proposal;
  }
  const remaining = valuesOf(next);
  // A rule with nothing left in it would match nothing: drop the rule.
  if (remaining !== null && remaining.length === 0) return null;
  return { ...proposal, config: next, valueLabels };
}

function amount(text: string): string | null {
  const digits = text.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
  return digits === "" ? null : digits.slice(0, 16);
}

export function PolicyEditor({
  hasRules,
}: {
  /** Whether a published version already has rules (wording only). */
  readonly hasRules: boolean;
}) {
  const router = useRouter();
  const textId = useId();
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [source, setSource] = useState<"PASTED_TEXT" | "UPLOADED_FILE">(
    "PASTED_TEXT",
  );
  const [proposals, setProposals] = useState<readonly Proposal[] | null>(null);
  const [notFound, setNotFound] = useState<readonly string[]>([]);
  const [excludedPlaces, setExcludedPlaces] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [pending, startTransition] = useTransition();
  const requestKey = useRef<string | null>(null);

  const read = () =>
    startTransition(async () => {
      setMessage(null);
      setPublished(false);
      // One key per distinct text: a double press is one reading.
      requestKey.current ??= `mandate-${crypto.randomUUID()}`;
      const result = await extractPolicyAction({
        text,
        sourceKind: source,
        clientRequestId: requestKey.current,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setProposals(
        result.extraction.proposals.map((proposal, index) => ({
          ...proposal,
          key: `${proposal.dimension}-${index}`,
        })),
      );
      setNotFound(result.extraction.notFound);
      setExcludedPlaces(result.extraction.excludedPlaces);
    });

  const update = (key: string, change: (p: Proposal) => Proposal | null) =>
    setProposals((current) =>
      current === null
        ? current
        : current.flatMap((proposal) => {
            if (proposal.key !== key) return [proposal];
            const next = change(proposal);
            return next === null ? [] : [next];
          }),
    );

  const publish = () =>
    startTransition(async () => {
      if (proposals === null) return;
      setMessage(null);
      const criteria: Draft[] = proposals.map((proposal, index) => ({
        position: index + 1,
        requiredness: proposal.requiredness,
        label: proposal.label.trim() === "" ? "Rule" : proposal.label.trim(),
        config: proposal.config,
      }));
      const result = await publishPolicyAction(criteria);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setPublished(true);
      setProposals(null);
      setText("");
      requestKey.current = null;
      router.refresh();
    });

  const onFile = async (chosen: File | undefined) => {
    if (chosen === undefined) return;
    if (chosen.size > MAX_FILE_BYTES) {
      setMessage("That file is too large. Paste the mandate text instead.");
      return;
    }
    const isText =
      chosen.type.startsWith("text/") || /\.(txt|md)$/i.test(chosen.name);
    if (!isText) {
      setMessage(
        "Q reads text and Markdown files here. For a PDF, paste its text.",
      );
      return;
    }
    setText((await chosen.text()).slice(0, 20_000));
    setSource("UPLOADED_FILE");
    requestKey.current = null;
    setMessage(null);
  };

  return (
    <div className="flex flex-col gap-5">
      {proposals === null ? (
        <div className="flex flex-col gap-3">
          <label
            htmlFor={textId}
            className="cq-body-sm text-(--cq-text-secondary)"
          >
            {hasRules
              ? "Paste an updated mandate and Q drafts new rules. Your current rules stay until you publish."
              : "Paste your mandate or thesis. Q drafts the rules founders are checked against; you confirm each one."}
          </label>
          <textarea
            id={textId}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setSource("PASTED_TEXT");
              requestKey.current = null;
            }}
            rows={7}
            maxLength={20_000}
            placeholder="We invest $250k to $1.5m in pre-seed to Series A fintech in West Africa and Kenya. We don't invest in online betting."
            className="cq-body w-full resize-y rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) p-3 text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={read}
              disabled={pending || text.trim() === ""}
            >
              {pending ? "Q is reading…" : "Draft rules with Q"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => file.current?.click()}
              disabled={pending}
            >
              <Upload
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
                aria-hidden="true"
              />
              Upload a file
            </Button>
            <input
              ref={file}
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => void onFile(event.target.files?.[0])}
            />
            {pending ? <QSwarm state="THINKING" pixels={28} /> : null}
          </div>
          <p className="cq-caption text-(--cq-text-tertiary)">
            Your mandate stays private. Founders see only the name of each
            rule, never its values or your text.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <QSwarm state="NEEDS_APPROVAL" pixels={40} />
            <div className="flex flex-col gap-1">
              <h3 className="cq-title-sm text-(--cq-text-primary)">
                {proposals.length === 0
                  ? "Q couldn't find rules in that text"
                  : `Q drafted ${proposals.length} rule${proposals.length === 1 ? "" : "s"}. Check each one.`}
              </h3>
              <p className="cq-body-sm text-(--cq-text-secondary)">
                Nothing is live until you publish. Remove anything Q read
                wrong.
              </p>
            </div>
          </div>

          <ul className="flex flex-col gap-3">
            {proposals.map((proposal) => {
              const values = valuesOf(proposal.config);
              return (
                <li
                  key={proposal.key}
                  className="flex flex-col gap-3 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={proposal.label}
                      onChange={(event) =>
                        update(proposal.key, (p) => ({
                          ...p,
                          label: event.target.value.slice(0, 120),
                        }))
                      }
                      aria-label={`Name founders see for the ${DIMENSION_WORDS[proposal.dimension]} rule`}
                      className="cq-label min-h-11 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-(--cq-text-primary) hover:border-(--cq-border-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
                    />
                    <div
                      role="group"
                      aria-label="How strict"
                      className="flex rounded-lg border border-(--cq-border-subtle) p-0.5"
                    >
                      {(["REQUIRED", "PREFERRED"] as const).map((level) => (
                        <button
                          key={level}
                          type="button"
                          aria-pressed={proposal.requiredness === level}
                          onClick={() =>
                            update(proposal.key, (p) => ({
                              ...p,
                              requiredness: level,
                            }))
                          }
                          className="cq-caption min-h-10 rounded-md px-3 text-(--cq-text-secondary) aria-pressed:bg-(--cq-surface-strong) aria-pressed:text-(--cq-text-primary)"
                        >
                          {level === "REQUIRED" ? "Required" : "Preferred"}
                        </button>
                      ))}
                    </div>
                    <Button
                      variant="quiet"
                      size="compact"
                      aria-label={`Remove the ${proposal.label} rule`}
                      onClick={() => update(proposal.key, () => null)}
                    >
                      <Trash2
                        size={ICON_SIZE.compact}
                        strokeWidth={ICON_STROKE}
                        aria-hidden="true"
                      />
                    </Button>
                  </div>

                  {values !== null ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {proposal.valueLabels.map((value, index) => (
                        <li
                          key={`${value}-${index}`}
                          className="cq-caption flex items-center gap-1 rounded-full bg-(--cq-surface-subtle) py-0.5 pr-0.5 pl-2.5 text-(--cq-text-primary)"
                        >
                          {proposal.config.type === "EXCLUDED_TAXONOMY"
                            ? `Not ${value}`
                            : value}
                          <button
                            type="button"
                            aria-label={`Remove ${value}`}
                            onClick={() =>
                              update(proposal.key, (p) =>
                                withoutValue(p, index),
                              )
                            }
                            className="flex size-7 items-center justify-center rounded-full text-(--cq-text-secondary) hover:bg-(--cq-surface-strong)"
                          >
                            <X
                              size={ICON_SIZE.compact}
                              strokeWidth={ICON_STROKE}
                              aria-hidden="true"
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : proposal.config.type === "CHEQUE_COMPATIBILITY" ? (
                    <ChequeFields
                      config={proposal.config}
                      onChange={(config) =>
                        update(proposal.key, (p) => ({ ...p, config }))
                      }
                    />
                  ) : null}

                  {proposal.quote === "" ? null : (
                    <p className="cq-caption text-(--cq-text-tertiary)">
                      From your mandate: &ldquo;{proposal.quote}&rdquo;
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {notFound.length === 0 && excludedPlaces.length === 0 ? null : (
            <div className="cq-body-sm flex flex-col gap-1 text-(--cq-text-secondary)">
              {notFound.length === 0 ? null : (
                <p>
                  Not in your mandate, so no rule:{" "}
                  {notFound
                    .map(
                      (d) =>
                        DIMENSION_WORDS[d as PolicyProposalDto["dimension"]] ??
                        d,
                    )
                    .join(", ")}
                  .
                </p>
              )}
              {excludedPlaces.length === 0 ? null : (
                <p>
                  You mentioned not investing in {excludedPlaces.join(", ")}.
                  Places are only ever an allow-list here, so Q left that out.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={publish} disabled={pending}>
              {pending
                ? "Publishing…"
                : proposals.length === 0
                  ? "Publish with no rules (open to all)"
                  : "Publish these rules"}
            </Button>
            <Button
              variant="quiet"
              onClick={() => setProposals(null)}
              disabled={pending}
            >
              Back to the text
            </Button>
          </div>
        </div>
      )}
      {published ? (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          Published. Founders are now checked against these rules.
        </p>
      ) : null}
      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

function ChequeFields({
  config,
  onChange,
}: {
  readonly config: Extract<
    Proposal["config"],
    { type: "CHEQUE_COMPATIBILITY" }
  >;
  readonly onChange: (config: Proposal["config"]) => void;
}) {
  const field =
    "cq-body-sm min-h-11 w-32 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface) px-3 text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="cq-caption text-(--cq-text-secondary)">
        {config.currency}
      </span>
      <input
        inputMode="numeric"
        aria-label="Smallest cheque"
        value={config.minCheque}
        onChange={(event) =>
          onChange({ ...config, minCheque: amount(event.target.value) ?? "0" })
        }
        className={field}
      />
      <span className="cq-caption text-(--cq-text-secondary)">to</span>
      <input
        inputMode="numeric"
        aria-label="Largest cheque (empty for no ceiling)"
        value={config.maxCheque ?? ""}
        onChange={(event) =>
          onChange({ ...config, maxCheque: amount(event.target.value) })
        }
        className={field}
      />
    </div>
  );
}
