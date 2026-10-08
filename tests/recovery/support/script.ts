import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { FAKE_URL } from "./stack";

/**
 * Drives scripts/recovery/fake-vendors.mjs: what the "model" decides in a
 * test. The product is then checked for carrying that decision out. The
 * model's judgment is not under test here; Q's plumbing, authority,
 * rendering and honesty are.
 */
export type ScriptReply =
  | { readonly json: unknown; readonly delayMs?: number }
  | { readonly text: string; readonly delayMs?: number }
  | {
      readonly toolCalls: readonly {
        readonly name: string;
        readonly arguments: Record<string, unknown>;
      }[];
      readonly text?: string;
      readonly delayMs?: number;
    }
  | { readonly status: number; readonly body?: unknown }
  | { readonly hang: true };

export type ScriptRule = {
  readonly name: string;
  readonly when?: {
    /** The prompt template, by name: "TURN_READER", "COMPANY_ANALYST", ... */
    readonly task?: string;
    /** Regex over the whole user message (template plus the person's words). */
    readonly user?: string;
    readonly instructions?: string;
    readonly tool?: string;
    readonly afterTool?: string | null;
  };
  readonly reply: ScriptReply;
};

const BASELINE = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../fixtures/q-script.json"), "utf8"),
) as { rules: ScriptRule[] };

/** Q's structured answer, the minimum the answer schema accepts. */
export function answer(
  text: string,
  extra: Record<string, unknown> = {},
  delayMs?: number,
): ScriptReply {
  return {
    json: {
      answer: text,
      responseShape: "CONCISE",
      insufficientEvidence: false,
      ...extra,
    },
    ...(delayMs === undefined ? {} : { delayMs }),
  };
}

/** The turn reader's verdict for one utterance. */
export function reading(kind: string, extra: Record<string, unknown> = {}): ScriptRule {
  return {
    name: `reader-${kind}`,
    when: { task: "TURN_READER" },
    reply: {
      json: {
        kind,
        confidence: "HIGH",
        transcript: "CLEAR",
        question: null,
        aboutNamedOther: false,
        ...extra,
      },
    },
  };
}

export async function useScript(rules: readonly ScriptRule[]): Promise<void> {
  const response = await fetch(`${FAKE_URL}/__fake/script`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rules: [...rules, ...BASELINE.rules] }),
  });
  if (!response.ok) throw new Error("fake vendor refused the script");
}

export async function resetScript(): Promise<void> {
  await fetch(`${FAKE_URL}/__fake/script`, { method: "DELETE" });
}

export type VendorRequest = {
  readonly n: number;
  readonly vendor: string;
  readonly path: string;
  readonly rule: string | null;
  readonly tools?: readonly string[];
  readonly lastUser?: string;
  readonly input?: string;
};

/** Requests the fake vendor received since a mark (`vendorMark()`). */
export async function vendorRequestsSince(mark: number): Promise<VendorRequest[]> {
  const response = await fetch(`${FAKE_URL}/__fake/requests?since=${String(mark)}`);
  const body = (await response.json()) as { requests: VendorRequest[] };
  return body.requests;
}

/**
 * Waits until the vendor has had no request for `quietMs`: a finished run
 * keeps working in the background (memory extraction, follow-ups), and a
 * test that attributes requests to the NEXT person's turn must not count
 * those. Bounded; returns the mark at quiet.
 */
export async function vendorSettled(quietMs = 3_000, maxMs = 60_000): Promise<number> {
  const started = Date.now();
  let mark = await vendorMark();
  let since = Date.now();
  while (Date.now() - started < maxMs) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const next = await vendorMark();
    if (next !== mark) {
      mark = next;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) {
      return mark;
    }
  }
  throw new Error("the vendor never went quiet: background model work did not settle");
}

export async function vendorMark(): Promise<number> {
  const response = await fetch(`${FAKE_URL}/__fake/requests?since=999999999`);
  const body = (await response.json()) as { next: number };
  return body.next;
}
