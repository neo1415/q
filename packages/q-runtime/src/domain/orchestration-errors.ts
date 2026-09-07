import type { QRunStatus } from "@capital-q/contracts";

/**
 * Orchestration-boundary errors. Raised by the runtime's orchestration
 * service and by any QOrchestrator adapter before a graph is touched; the
 * messages are plain sentences a client may see, and none names a
 * framework, a node, a version string or a status word.
 */

/** The run was already picked up by orchestration; a second start is refused. */
export class QRunAlreadyStartedError extends Error {
  constructor() {
    super("This Q request is already being worked on.");
    this.name = "QRunAlreadyStartedError";
  }
}

/** Resume asked for a run that is not paused. */
export class QRunNotResumableError extends Error {
  readonly status: QRunStatus;

  constructor(status: QRunStatus) {
    super("This Q request isn't waiting to be resumed.");
    this.name = "QRunNotResumableError";
    this.status = status;
  }
}

/**
 * The run was orchestrated by a version this build cannot safely continue.
 * Refused rather than guessed: a graph change that alters resume semantics
 * gets a new version, and an old suspended run waits for a build that
 * still understands it.
 */
export class QOrchestrationVersionError extends Error {
  /** Internal diagnostic only; never sent to a client. */
  readonly orchestrationVersion: string | null;

  constructor(orchestrationVersion: string | null) {
    super("This Q request can't be continued by the current version of Q.");
    this.name = "QOrchestrationVersionError";
    this.orchestrationVersion = orchestrationVersion;
  }
}
