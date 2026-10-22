"use server";

import { ApiProblemError, getOrganisationActivity } from "@capital-q/api-client";
import {
  ActivityQuerySchema,
  type ActivityPageDto,
} from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * The activity feed's next page or a new filter, read under the person's
 * own session. The browser's filters are input only: the API resolves the
 * organisation, checks organisation.activity.view, and refuses a person
 * from outside it.
 */
export type ActivityActionResult =
  | { readonly ok: true; readonly value: ActivityPageDto }
  | {
      readonly ok: false;
      readonly denied: boolean;
      readonly message: string;
    };

export async function activityAction(
  input: unknown,
): Promise<ActivityActionResult> {
  const parsed = ActivityQuerySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      denied: false,
      message: "Those filters didn't make sense. Clear them and try again.",
    };
  }
  const session = await apiSession();
  if (session === null) {
    return {
      ok: false,
      denied: false,
      message: "Please sign in again to continue.",
    };
  }
  try {
    return {
      ok: true,
      value: await getOrganisationActivity(session, parsed.data),
    };
  } catch (error: unknown) {
    if (error instanceof ApiProblemError && error.status === 403) {
      return {
        ok: false,
        denied: true,
        message: "Only admins and owners see this.",
      };
    }
    return {
      ok: false,
      denied: false,
      message: "Activity couldn't load. Nothing changed; try again.",
    };
  }
}
