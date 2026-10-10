import {
  readFileSync,
  existsSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { composer, openQ } from "../support/q.js";
import type { ScriptRule } from "../support/script.js";
import {
  FAKE_URL,
  RUN_PATH,
  STACK_GPT_LIVE,
  STACK_SEARCH,
} from "../support/stack.js";

/**
 * V2: shared pieces of the Qatar acceptance suite (welcome follow-ups, the
 * Qatar Five, an unknown and an ambiguous person, voice navigation).
 *
 * EVERY number this suite prints is LOCAL+MOCK: a loopback stack, a scripted
 * model (scripts/recovery/fake-vendors.mjs), a scripted search index, a fake
 * WebRTC peer. It times our own code, never a vendor, never the hosted app.
 */
export const LOCAL_MOCK = "LOCAL+MOCK";

export function measure(label: string, ms: number): void {
  const line = `MEASURE[${LOCAL_MOCK}] ${label} ${String(Math.round(ms))}ms`;
  console.log(line);
  test.info().annotations.push({ type: "measure", description: line });
}

/** The stack must be the one this suite is written for; say so instead of failing mysteriously. */
export function requireQatarStack(): void {
  if (STACK_GPT_LIVE === false || STACK_SEARCH === false) {
    throw new Error(
      "The running stack is not the Qatar stack. Restart q-api with: CQ_RECOVERY_GPT_LIVE=1 CQ_RECOVERY_SEARCH=1 bash scripts/recovery/local-stack.sh start q-api  (then: local-stack.sh seed-research)",
    );
  }
}

// --- the five prepared entities, read from the seed itself -------------------

type SeedFact = {
  readonly claim: string;
  readonly source_ids: readonly string[];
  readonly soft_wording?: string;
};
type SeedEntity = {
  readonly demo_id: string;
  readonly name: string;
  readonly entity_kind: "PERSON" | "ORGANIZATION" | "GOVERNMENT_AGENCY";
  readonly aliases: readonly string[];
  readonly facts: readonly SeedFact[];
};
type Seed = {
  readonly entities: readonly SeedEntity[];
  readonly sources: Record<string, { readonly url: string }>;
};

const SEED_PATH = resolve(
  import.meta.dirname,
  "../../../scripts/seed/research/qatar-five.v1.json",
);
const seed = JSON.parse(readFileSync(SEED_PATH, "utf8")) as Seed;

export type QatarEntity = {
  readonly key: string;
  /** What the founder types first. */
  readonly canonical: string;
  /** A Nigerian-English / misheard rendering the names module must resolve. */
  readonly rendering: string;
  readonly kind: "PERSON" | "ORGANIZATION" | "GOVERNMENT_AGENCY";
  readonly demoId: string;
  /** Matches the card's name (the seed's own display name). */
  readonly nameRe: RegExp;
  /** Hosts of the entity's own sources in the seed. */
  readonly hosts: readonly string[];
  /**
   * The first thing this entity's scripted rehearsal opens on
   * (apps/q-api/src/composition/external-scenarios.ts openingThemes[0]).
   */
  readonly opening: string;
  /** Plain words a follow-up asks about. */
  readonly followUp: string;
};

const hostsOf = (demoId: string): string[] => {
  const entity = seed.entities.find((e) => e.demo_id === demoId);
  if (entity === undefined) throw new Error(`seed has no ${demoId}`);
  const ids = new Set(entity.facts.flatMap((f) => f.source_ids));
  return [
    ...new Set(
      [...ids]
        .map((id) => seed.sources[id]?.url)
        .filter((u): u is string => u !== undefined)
        .map((u) => new URL(u).hostname.replace(/^www\./u, "")),
    ),
  ];
};

export const QATAR_FIVE: readonly QatarEntity[] = [
  {
    key: "shadi",
    canonical: "Shadi Qishta",
    rendering: "Shady Kishta",
    kind: "PERSON",
    demoId: "qa-demo-shadi-qishta",
    nameRe: /Shadi Qishta/iu,
    hosts: hostsOf("qa-demo-shadi-qishta"),
    opening: "who actually pays for this and whether they can keep paying",
    followUp: "what do they usually press founders on",
  },
  {
    key: "qinvest",
    canonical: "QInvest",
    rendering: "Q-Invest",
    kind: "ORGANIZATION",
    demoId: "qa-demo-qinvest",
    nameRe: /QInvest/iu,
    hosts: hostsOf("qa-demo-qinvest"),
    opening:
      "the exact financing structure on the table and whether it is Sharia-compliant",
    followUp: "what kind of financing do they do",
  },
  {
    key: "muhannad",
    canonical: "Muhannad Taslaq",
    rendering: "Mohannad Taslak",
    kind: "PERSON",
    demoId: "qa-demo-muhannad-taslaq",
    nameRe: /Muhannad Taslaq/iu,
    hosts: hostsOf("qa-demo-muhannad-taslaq"),
    opening: "whether the founder is fully committed to this one venture",
    followUp: "what is their role",
  },
  {
    key: "investqatar",
    canonical: "Invest Qatar",
    rendering: "Invest in Qatar",
    kind: "GOVERNMENT_AGENCY",
    demoId: "qa-demo-invest-qatar",
    nameRe: /Invest Qatar/iu,
    hosts: hostsOf("qa-demo-invest-qatar"),
    opening:
      "what brings the business to Qatar and how it would enter the market",
    followUp: "is it an investor or an agency",
  },
  {
    key: "alrayan",
    canonical: "AlRayan Investment",
    rendering: "Al Rayan Investments",
    kind: "ORGANIZATION",
    demoId: "qa-demo-alrayan",
    nameRe: /Al ?Rayan Investment/iu,
    hosts: hostsOf("qa-demo-alrayan"),
    opening:
      "the capital requirement and how it is structured under Sharia principles",
    followUp: "who owns it",
  },
];

// --- the fake vendors: model requests and search calls ----------------------

export type FakeRequest = {
  readonly n: number;
  readonly at: string;
  readonly vendor: string;
  readonly path: string;
  readonly rule?: string | null;
  readonly q?: string;
  readonly tools?: readonly string[];
  readonly answeredTools?: readonly string[];
  readonly instructions?: string | null;
  readonly delegation?: unknown;
  readonly lastUser?: string;
  readonly input?: string;
};

export async function fakeMark(): Promise<number> {
  const response = await fetch(`${FAKE_URL}/__fake/requests?since=999999999`);
  return ((await response.json()) as { next: number }).next;
}

export async function fakeSince(mark: number): Promise<FakeRequest[]> {
  const response = await fetch(
    `${FAKE_URL}/__fake/requests?since=${String(mark)}`,
  );
  return ((await response.json()) as { requests: FakeRequest[] }).requests;
}

/** Search calls (and page reads) the people search made since a mark. */
export async function searchCallsSince(mark: number): Promise<FakeRequest[]> {
  return (await fakeSince(mark)).filter((r) => r.vendor === "search");
}

/** Model rounds (Responses API) since a mark. */
export async function modelCallsSince(mark: number): Promise<FakeRequest[]> {
  return (await fakeSince(mark)).filter((r) => r.path === "/v1/responses");
}

export type SearchRule = {
  readonly name: string;
  /** Regex over the query. */
  readonly q: string;
  readonly delayMs?: number;
  readonly organic: readonly {
    readonly link: string;
    readonly title: string;
    readonly snippet: string;
    readonly page?: string;
  }[];
};

export async function scriptSearch(
  rules: readonly SearchRule[],
): Promise<void> {
  const response = await fetch(`${FAKE_URL}/__fake/search`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rules }),
  });
  if (!response.ok) throw new Error("fake vendor refused the search script");
}

export async function clearSearch(): Promise<void> {
  await fetch(`${FAKE_URL}/__fake/search`, { method: "DELETE" });
}

/** Waits until the fake has seen no new request for `quietMs` (background work done). */
export async function quiet(quietMs = 2_500, maxMs = 30_000): Promise<number> {
  const started = Date.now();
  let mark = await fakeMark();
  let since = Date.now();
  while (Date.now() - started < maxMs) {
    await new Promise((r) => setTimeout(r, 400));
    const next = await fakeMark();
    if (next !== mark) {
      mark = next;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) return mark;
  }
  return mark;
}

// --- q-api's own log (pino NDJSON) ------------------------------------------

const Q_API_LOG = resolve(RUN_PATH, "q-api.log");

export function logMark(): number {
  return existsSync(Q_API_LOG) ? statSync(Q_API_LOG).size : 0;
}

export type LogLine = Record<string, unknown> & { readonly msg?: string };

export function logSince(mark: number, msg?: string): LogLine[] {
  if (!existsSync(Q_API_LOG)) return [];
  const size = statSync(Q_API_LOG).size;
  if (size <= mark) return [];
  const fd = openSync(Q_API_LOG, "r");
  try {
    const buffer = Buffer.alloc(size - mark);
    readSync(fd, buffer, 0, buffer.length, mark);
    return buffer
      .toString("utf8")
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line) as LogLine;
        } catch {
          return null;
        }
      })
      .filter(
        (l): l is LogLine => l !== null && (msg === undefined || l.msg === msg),
      );
  } finally {
    closeSync(fd);
  }
}

/** Waits for at least `count` log lines of a message since a mark. */
export async function waitForLog(
  mark: number,
  msg: string,
  count = 1,
  timeoutMs = 60_000,
): Promise<LogLine[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const lines = logSince(mark, msg);
    if (lines.length >= count || Date.now() > deadline) return lines;
    await new Promise((r) => setTimeout(r, 300));
  }
}

// --- scripted readings -------------------------------------------------------

export const escape = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** The skim reads a person ask: the fast lane then answers by code, no model writing. */
export function skimPerson(
  words: string,
  person: {
    readonly name: string;
    readonly kind?: "PERSON" | "ORGANIZATION" | "GOVERNMENT_AGENCY";
    readonly city?: string | null;
    readonly country?: string | null;
    readonly organization?: string | null;
    readonly role?: string | null;
    readonly freshSearch?: boolean;
  },
): ScriptRule {
  return {
    name: "skim-person",
    when: { task: "TURN_SKIM", user: escape(words) },
    reply: {
      json: {
        kind: "PERSON_SEARCH",
        confidence: "HIGH",
        count: null,
        discover: null,
        person: {
          name: person.name,
          kind: person.kind ?? "PERSON",
          city: person.city ?? null,
          country: person.country ?? null,
          organization: person.organization ?? null,
          role: person.role ?? null,
          freshSearch: person.freshSearch ?? false,
        },
      },
    },
  };
}

// --- talking to Q on the page ------------------------------------------------

/** Types to Q and returns the wall-clock moment Enter was pressed. */
export async function sendTimed(page: Page, text: string): Promise<number> {
  await openQ(page);
  await composer(page).fill(text);
  const started = Date.now();
  await composer(page).press("Enter");
  return started;
}

export function cards(page: Page) {
  return page.locator("[data-ac-card]");
}

/**
 * The identity card for a name: resolves with the ms from `startedAt`, the
 * card's key (the external person's id) and its visible text.
 */
export async function identityCard(
  page: Page,
  nameRe: RegExp,
  startedAt: number,
  timeout = 60_000,
): Promise<{
  readonly ms: number;
  readonly key: string;
  readonly text: string;
}> {
  const card = cards(page).filter({ hasText: nameRe }).first();
  await expect(card, `an identity card named ${String(nameRe)}`).toBeVisible({
    timeout,
  });
  const ms = Date.now() - startedAt;
  const key = (await card.getAttribute("data-ac-card")) ?? "";
  return { ms, key, text: (await card.innerText()).replace(/\s+/gu, " ") };
}

/** External links on the page (the answer's sources and the card's profile). */
export async function externalLinks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>("a[href^='http']")]
      .map((a) => a.href)
      .filter((href) => new URL(href).origin !== location.origin),
  );
}

/** Q's latest line in the thread (dock paragraph or Chat row). */
export async function latestQText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const rows = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-q-answer], [data-q-turn-role='Q'], [role=dialog] p",
      ),
    ];
    return (rows.at(-1)?.innerText ?? "").replace(/\s+/gu, " ").trim();
  });
}

/** Everything the Q thread shows (for 'the answer says X' checks). */
export async function threadText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root: HTMLElement =
      document.querySelector<HTMLElement>("[role=dialog]") ?? document.body;
    return root.innerText.replace(/\s+/gu, " ");
  });
}

// --- numbers -----------------------------------------------------------------

export function percentile(
  values: readonly number[],
  p: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
    ] ?? null
  );
}

export function summary(values: readonly number[]): string {
  const p50 = percentile(values, 50);
  const p95 = percentile(values, 95);
  return `n=${String(values.length)} p50=${p50 === null ? "n/a" : `${String(Math.round(p50))}ms`} p95=${p95 === null ? "n/a" : `${String(Math.round(p95))}ms`}`;
}
