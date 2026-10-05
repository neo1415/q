import type { CriterionStatus } from "@capital-q/gateq/engine";

import { DEMO_INVESTOR_LABEL, DEMO_INVESTOR_NAME } from "./gateq-demo";
import { SIGN_UP_HREF } from "./landing-content";

/**
 * The "Try GateQ" check, as markup only: the server paints it unanswered
 * (so the section is complete before any script), and the live island
 * paints the same markup with the engine's answer. No hooks, no handlers
 * unless the island passes them.
 */

export type GateQuestionId = "stage" | "sector" | "country" | "amount";

export const GATE_QUESTIONS: readonly {
  readonly id: GateQuestionId;
  readonly label: string;
  readonly options: readonly (readonly [value: string, label: string])[];
}[] = [
  {
    id: "stage",
    label: "Stage",
    options: [
      ["pre_seed", "Pre-seed"],
      ["seed", "Seed"],
      ["series_a", "Series A"],
    ],
  },
  {
    id: "sector",
    label: "Sector",
    options: [
      ["payments", "Payments"],
      ["climate", "Climate"],
      ["health", "Health"],
      ["betting", "Online betting"],
    ],
  },
  {
    id: "country",
    label: "Headquarters",
    options: [
      ["NG", "Nigeria"],
      ["KE", "Kenya"],
      ["GB", "United Kingdom"],
      ["US", "United States"],
    ],
  },
  {
    id: "amount",
    label: "Round size",
    options: [
      ["200000", "$200k"],
      ["1200000", "$1.2M"],
      ["5000000", "$5M"],
    ],
  },
];

/** A row of the result: the engine's criterion, in the page's words. */
export type GateRow = {
  readonly key: string;
  readonly label: string;
  readonly requiredness: "Required" | "Preferred";
  readonly status: CriterionStatus | null;
};

const WORD: Readonly<Record<CriterionStatus, string>> = {
  MATCH: "Matched",
  UNKNOWN: "Unknown",
  NO_MATCH: "Outside policy",
};
const DATA_S: Readonly<Record<CriterionStatus, string>> = {
  MATCH: "match",
  UNKNOWN: "unknown",
  NO_MATCH: "miss",
};

export const GATE_START = {
  verdict: "Answer a question to begin.",
  sub: "The same answers always give the same result.",
} as const;

export function GateQView({
  answers,
  rows,
  verdict,
  sub,
  onPick,
}: {
  /** Per question: undefined is untouched, "" is skipped. */
  readonly answers: Partial<Record<GateQuestionId, string>>;
  readonly rows: readonly GateRow[];
  readonly verdict: string;
  readonly sub: string;
  readonly onPick?: ((q: GateQuestionId, value: string) => void) | undefined;
}) {
  return (
    <>
      <div className="gate-q">
        <div className="inv">
          <span className="av" aria-hidden="true">
            DR
          </span>
          <div>
            <b>{DEMO_INVESTOR_NAME}</b>
            <span className="small">
              {DEMO_INVESTOR_LABEL}. Pre-seed and seed, fintech or climate,
              Africa or the UK.
            </span>
          </div>
        </div>
        <div>
          {GATE_QUESTIONS.map((q) => (
            <div className="qgroup" style={{ marginBottom: 18 }} key={q.id}>
              <span className="ql" id={`ql-${q.id}`}>
                {q.label}
              </span>
              <div className="opts" role="group" aria-labelledby={`ql-${q.id}`}>
                {[...q.options, ["", "Skip"] as const].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={value === "" ? "opt skip" : "opt"}
                    aria-pressed={answers[q.id] === value}
                    data-q={q.id}
                    data-v={value}
                    onClick={onPick ? () => onPick(q.id, value) : undefined}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="small">
          Runs in your browser. Nothing you choose is sent or saved, and no AI
          model is involved.
        </p>
      </div>
      <div className="gate-r" aria-live="polite">
        <p className="verdict">{verdict}</p>
        <p className="verdict-sub">{sub}</p>
        <ul className="crit">
          {rows.map((r) => (
            <li key={r.key} data-s={r.status === null ? "" : DATA_S[r.status]}>
              <span className="sym" aria-hidden="true">
                <svg className="i-ok">
                  <use href="#i-check" />
                </svg>
                <svg className="i-q">
                  <use href="#i-q" />
                </svg>
                <svg className="i-x">
                  <use href="#i-x" />
                </svg>
              </span>
              <span className="lab">
                {r.label}
                <small>{r.requiredness}</small>
              </span>
              <span className="word">
                <span>
                  {r.status === null ? "Not yet answered" : WORD[r.status]}
                </span>
                <span className="ghost" aria-hidden="true">
                  Not yet answered
                </span>
              </span>
            </li>
          ))}
        </ul>
        <div className="gate-foot">
          <span className="small">
            Inside Capital Q, the same check runs for every investor you
            approach.
          </span>
          <a className="btn btn-quiet" href={SIGN_UP_HREF}>
            Get your own Q
          </a>
        </div>
      </div>
    </>
  );
}
