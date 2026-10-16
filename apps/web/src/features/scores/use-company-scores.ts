"use client";

import { useEffect, useMemo, useState } from "react";

import {
  FIT_IDS_MAX,
  type CompanyScoresDto,
  type FitCompanyDto,
} from "@capital-q/contracts";

import { fitProfilesAction } from "@/features/fit/fit-actions";

/**
 * Investability and Suitability for any list of company cards (owner
 * 2026-10-16: Discover, Explore, CRM, search, comparisons).
 *
 * One read per page, not per card: ids asked for in the same tick are
 * batched into one `/v1/fit/companies` call (up to 50), through the reader's
 * own session (server action). The Q API answers only for companies this
 * reader may see; anything else is simply absent, and a card without
 * scores is still a card. Results are kept briefly so scrolling back does
 * not ask again. No score is ever computed here.
 */

export type ScoresPort = (
  companyIds: readonly string[],
) => Promise<readonly FitCompanyDto[] | null>;

const TTL_MS = 60_000;

type Entry = { readonly at: number; readonly scores: CompanyScoresDto | null };

const cache = new Map<string, Entry>();
const waiting = new Map<
  string,
  ((scores: CompanyScoresDto | null) => void)[]
>();
let pending: Set<string> | null = null;

function flush(port: ScoresPort): void {
  const ids = [...(pending ?? [])];
  pending = null;
  for (let i = 0; i < ids.length; i += FIT_IDS_MAX) {
    const chunk = ids.slice(i, i + FIT_IDS_MAX);
    void port(chunk)
      .catch(() => null)
      .then((items) => {
        const byId = new Map(
          (items ?? []).map((item) => [item.companyId, item.scores ?? null]),
        );
        const at = Date.now();
        for (const id of chunk) {
          const scores = byId.get(id) ?? null;
          cache.set(id, { at, scores });
          for (const resolve of waiting.get(id) ?? []) resolve(scores);
          waiting.delete(id);
        }
      });
  }
}

function request(
  id: string,
  port: ScoresPort,
): Promise<CompanyScoresDto | null> {
  const hit = cache.get(id);
  if (hit !== undefined && Date.now() - hit.at < TTL_MS) {
    return Promise.resolve(hit.scores);
  }
  return new Promise((resolve) => {
    const list = waiting.get(id);
    if (list !== undefined) {
      list.push(resolve);
      return;
    }
    waiting.set(id, [resolve]);
    if (pending === null) {
      pending = new Set();
      queueMicrotask(() => flush(port));
    }
    pending.add(id);
  });
}

/** Test seam: forget everything read. */
export function resetCompanyScoresCache(): void {
  cache.clear();
  waiting.clear();
  pending = null;
}

export function useCompanyScores(
  companyIds: readonly string[],
  options: {
    readonly initial?: ReadonlyMap<string, CompanyScoresDto> | undefined;
    readonly port?: ScoresPort | undefined;
  } = {},
): ReadonlyMap<string, CompanyScoresDto> {
  const { initial, port = fitProfilesAction } = options;
  const key = [...new Set(companyIds)].sort().join(",");
  const ids = useMemo(() => (key === "" ? [] : key.split(",")), [key]);
  const [scores, setScores] = useState<ReadonlyMap<string, CompanyScoresDto>>(
    initial ?? new Map(),
  );
  useEffect(() => {
    if (initial !== undefined || ids.length === 0) return;
    let live = true;
    void Promise.all(ids.map((id) => request(id, port))).then((found) => {
      if (!live) return;
      const out = new Map<string, CompanyScoresDto>();
      found.forEach((s, index) => {
        const id = ids[index];
        if (s !== null && id !== undefined) out.set(id, s);
      });
      setScores(out);
    });
    return () => {
      live = false;
    };
  }, [ids, initial, port]);
  return scores;
}
