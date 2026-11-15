/**
 * A counterpart notice that could not be written. The business action it
 * follows has already happened and stays successful, but the failure is
 * never silent (live audit 2026-11-15 D1: data-room notices were refused
 * by the database's link check and swallowed, so none was written for five
 * weeks). The app logs it as one structured line.
 *
 * Only what is safe to log: the notice's kind and the error's class, SQL
 * state and constraint. Never the error's message or detail, which can
 * carry the failing row (names, titles).
 */
export type NoticeFailure = {
  /** Which notice, e.g. "DATA_ROOM_SHARED". */
  readonly notice: string;
  readonly errorName: string;
  /** The SQL state when the database refused it (23514: a check). */
  readonly errorCode: string | null;
  readonly constraint: string | null;
};

export type NoticeFailureReporter = (failure: NoticeFailure) => void;

const field = (error: unknown, key: string): string | null => {
  if (typeof error !== "object" || error === null) return null;
  const value: unknown = Reflect.get(error, key);
  return typeof value === "string" ? value.slice(0, 120) : null;
};

/** The loggable part of a notice failure. */
export function noticeFailureOf(notice: string, error: unknown): NoticeFailure {
  return {
    notice,
    errorName: error instanceof Error ? error.name.slice(0, 80) : typeof error,
    errorCode: field(error, "code"),
    constraint: field(error, "constraint_name") ?? field(error, "constraint"),
  };
}

/** Reports a failed notice; a reporter that throws never fails the action. */
export function reportNoticeFailure(
  reporter: NoticeFailureReporter | undefined,
  notice: string,
  error: unknown,
): void {
  if (reporter === undefined) return;
  try {
    reporter(noticeFailureOf(notice, error));
  } catch {
    // Reporting is best effort; the action already succeeded.
  }
}
