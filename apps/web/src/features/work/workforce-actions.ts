"use server";

import { z } from "zod";

import {
  getWorkforceJob,
  getWorkforceOverview,
  listWorkforceJobs,
} from "@capital-q/api-client";
import type {
  WorkforceJobDetailDto,
  WorkforceOverviewDto,
} from "@capital-q/contracts";

import { qApiSession } from "@/features/q/context";

/**
 * Q's team on the Work page (founder brief J5), read on the server so the
 * session token never reaches the browser. Read-only: approving a draft is
 * the Approval Engine's own action, through its card's approval id.
 */

export type WorkforceView = {
  readonly overview: WorkforceOverviewDto;
  readonly jobs: readonly WorkforceJobDetailDto[];
  /** The next page of older jobs (cursor pagination); null: no more. */
  readonly nextCursor?: string | null | undefined;
};

/** How many recent jobs the page reads in full, per page. */
const SHOWN = 6;

const Cursor = z.string().min(1).max(200);

export async function loadWorkforceAction(): Promise<WorkforceView | null> {
  const session = await qApiSession();
  if (session === null) return null;
  try {
    const [overview, list] = await Promise.all([
      getWorkforceOverview(session),
      listWorkforceJobs(session, { limit: SHOWN }),
    ]);
    const details = await Promise.all(
      list.items.map((job) =>
        getWorkforceJob(session, job.id).catch(() => null),
      ),
    );
    return {
      overview,
      jobs: details.filter((one) => one !== null),
      nextCursor: list.nextCursor,
    };
  } catch {
    return null;
  }
}

/**
 * Older jobs, a page at a time (Zino, 2026-10-08: "a very long list with
 * no pagination"). The cursor is the server's own; it is input here.
 */
export async function moreWorkforceJobsAction(rawCursor: string): Promise<{
  readonly jobs: readonly WorkforceJobDetailDto[];
  readonly nextCursor: string | null;
} | null> {
  const cursor = Cursor.safeParse(rawCursor);
  if (!cursor.success) return null;
  const session = await qApiSession();
  if (session === null) return null;
  try {
    const list = await listWorkforceJobs(session, {
      cursor: cursor.data,
      limit: SHOWN,
    });
    const details = await Promise.all(
      list.items.map((job) =>
        getWorkforceJob(session, job.id).catch(() => null),
      ),
    );
    return {
      jobs: details.filter((one) => one !== null),
      nextCursor: list.nextCursor,
    };
  } catch {
    return null;
  }
}
