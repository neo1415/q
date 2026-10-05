"use server";

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
};

/** How many recent jobs the page reads in full. */
const SHOWN = 6;

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
    };
  } catch {
    return null;
  }
}
