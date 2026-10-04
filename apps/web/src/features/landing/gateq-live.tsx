"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  DEMO_POLICY,
  EMPTY_ANSWERS,
  runDemo,
  type DemoAnswers,
} from "./gateq-demo";
import {
  GATE_START,
  GateQView,
  type GateQuestionId,
  type GateRow,
} from "./gateq-view";
import { prefersReducedMotion } from "./scene";

/** The check fills in live once, then hands control to the visitor. */
export const AUTOPLAY: readonly (readonly [GateQuestionId, string])[] = [
  ["stage", "seed"],
  ["sector", "payments"],
  ["country", ""],
  ["amount", "1200000"],
];

type Answers = Partial<Record<GateQuestionId, string>>;

/** The visitor's choices as the engine's demo answers. */
export function demoAnswersFor(answers: Answers): DemoAnswers {
  return {
    ...EMPTY_ANSWERS,
    stage: answers.stage ?? "",
    sector: answers.sector ?? "",
    country: answers.country ?? "",
    amount: answers.amount ?? "",
    currency: "USD",
  };
}

export function rowsFor(answers: Answers | null): GateRow[] {
  const result = answers === null ? null : runDemo(demoAnswersFor(answers));
  return DEMO_POLICY.criteria.map((c) => ({
    key: c.id,
    label: c.label,
    requiredness: c.requiredness === "REQUIRED" ? "Required" : "Preferred",
    status:
      result?.criteria.find((r) => r.criterionId === c.id)?.status ?? null,
  }));
}

/** The verdict in the page's words, from the engine's per-criterion result. */
export function verdictFor(rows: readonly GateRow[]): {
  verdict: string;
  sub: string;
} {
  const misses = rows
    .filter((r) => r.status === "NO_MATCH" && r.requiredness === "Required")
    .map((r) => r.label.toLowerCase());
  const unknown = rows.filter((r) => r.status === "UNKNOWN").length;
  if (misses.length > 0) {
    return {
      verdict: "Outside this investor's policy.",
      sub: `Their published policy doesn't cover your ${misses.join(" and ")}. That's about fit, not quality.`,
    };
  }
  if (unknown > 0) {
    return {
      verdict: "Nothing rules you out yet.",
      sub: `${unknown === 1 ? "One requirement is" : `${unknown} requirements are`} still unknown. Unknown means the question is open, not a no.`,
    };
  }
  return {
    verdict: "You fit what they publish.",
    sub: "Every requirement they publish is matched. The next step is yours.",
  };
}

export function GateQLive() {
  const [answers, setAnswers] = useState<Answers | null>(null);
  const autoplay = useRef(true);
  const hostRef = useRef<HTMLSpanElement>(null);

  const rows = useMemo(() => rowsFor(answers), [answers]);
  const { verdict, sub } = answers === null ? GATE_START : verdictFor(rows);

  const pick = (q: GateQuestionId, value: string) =>
    setAnswers((prev) => ({ ...(prev ?? {}), [q]: value }));

  useEffect(() => {
    const gate = hostRef.current?.closest(".gate");
    // No observer (an old browser): the check simply waits for the visitor.
    if (!gate || typeof IntersectionObserver === "undefined") return;
    const timers: number[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        if (prefersReducedMotion()) {
          AUTOPLAY.forEach(([q, v]) => pick(q, v));
          return;
        }
        AUTOPLAY.forEach(([q, v], i) =>
          timers.push(
            window.setTimeout(
              () => {
                if (autoplay.current) pick(q, v);
              },
              600 + i * 750,
            ),
          ),
        );
      },
      { threshold: 0.4 },
    );
    observer.observe(gate);
    return () => {
      observer.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  return (
    <>
      <span ref={hostRef} hidden />
      <GateQView
        answers={answers ?? {}}
        rows={rows}
        verdict={verdict}
        sub={sub}
        onPick={(q, v) => {
          autoplay.current = false;
          pick(q, v);
        }}
      />
    </>
  );
}
