/**
 * A single invalid or missing configuration variable.
 *
 * `variable` is an environment variable name. `reason` describes what was
 * expected. Neither ever carries the supplied value.
 */
export type ConfigurationIssue = {
  readonly variable: string;
  readonly reason: string;
};

/**
 * Thrown when a service cannot build valid configuration.
 *
 * The message names the offending variables and what was expected. It must
 * never contain environment values, secret material, or a dump of
 * `process.env` -- a configuration failure is frequently the first thing
 * written to a log or an error tracker (doc 15, 82; doc 23, 140).
 */
export class ConfigurationError extends Error {
  readonly service: string;
  readonly issues: readonly ConfigurationIssue[];

  constructor(service: string, issues: readonly ConfigurationIssue[]) {
    const detail = issues
      .map((issue) => `- ${issue.variable}: ${issue.reason}`)
      .join("\n");

    super(`Invalid configuration for ${service}:\n${detail}`);

    this.name = "ConfigurationError";
    this.service = service;
    this.issues = issues;
  }
}
