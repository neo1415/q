import { ApiProblemError } from "@capital-q/api-client";
import type { QCardDto, QCardSubjectType } from "@capital-q/contracts";

export type QCardActionResult =
  | { readonly ok: true; readonly card: QCardDto }
  | { readonly ok: false; readonly message: string };

/** " Reference: req_…." so a report can be traced; empty when unknown. */
function reference(error: ApiProblemError): string {
  return error.requestId === undefined ? "" : ` Reference: ${error.requestId}.`;
}

/**
 * The API's refusal, in words the person can act on. A refused handle
 * always carries its own reason (shape, reserved, taken), so that reason
 * is shown as given. A 409 or 422 without one is not a handle refusal and
 * is never reported as "That handle isn't available" (live 2026-10-23: a
 * request the API rejected for its own reasons read as a taken handle).
 * A 403 depends on whose card: a person's is theirs alone, an
 * organisation's needs an administrator.
 */
export function translateQCardError(
  error: unknown,
  subjectType?: QCardSubjectType,
): QCardActionResult {
  if (error instanceof ApiProblemError) {
    if (error.status === 409 && error.code === "VERSION_CONFLICT") {
      return {
        ok: false,
        message:
          "The card changed since this page was opened. Reload and try again.",
      };
    }
    if (error.status === 409 || error.status === 422) {
      const detail = error.problem?.detail;
      return {
        ok: false,
        message:
          detail !== undefined && detail.trim() !== ""
            ? detail
            : `Capital Q couldn't accept that change. Nothing was saved.${reference(error)}`,
      };
    }
    if (error.status === 403) {
      return {
        ok: false,
        message:
          subjectType === "PERSON"
            ? "You can only make or change your own Q Card."
            : "Only an administrator of your organisation can change its handle or card.",
      };
    }
    if (error.status === 401) {
      return {
        ok: false,
        message: "Your session ended. Sign in again to continue.",
      };
    }
    if (error.status === 404) {
      return { ok: false, message: "This profile isn't available to you." };
    }
    return {
      ok: false,
      message: `Capital Q couldn't save that just now. Try again.${reference(error)}`,
    };
  }
  return {
    ok: false,
    message: "Capital Q couldn't save that just now. Try again.",
  };
}
