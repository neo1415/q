import { createHash } from "node:crypto";

import type { z } from "zod";

import type { ModelTextTaskClass } from "@capital-q/contracts";

/**
 * Prompt definitions (doc 12 §26; doc 23 §127-129; CQ-Q-006 §16-§24).
 *
 * A prompt is a versioned, immutable software artifact: an id, an integer
 * version, a trusted instruction template with EXPLICIT variables, a Zod
 * schema for those variables, an output specification, and provenance.
 * Prompts belong to Q, not to a provider: no template names a vendor, and
 * the same definition renders identically whichever model the gateway
 * routes to.
 *
 * Templates use `{{name}}` tokens only for variables the schema declares.
 * There is no arbitrary substitution, no eval, no include. Variables the
 * definition marks UNTRUSTED (a person's words, a document, a transcript,
 * a tool result) are rendered inside explicit content fences so the model
 * can tell data from instruction — a boundary, not a security control:
 * the Context Firewall and tool authorization stay deterministic.
 */

export const PROMPT_IDS = [
  "Q_SYSTEM",
  "FOUNDER_ONBOARDING_EXTRACTION",
  "CLAIM_EXTRACTION",
  "INVESTOR_MANDATE_SYNTHESIS",
  "COMPANY_ANALYST",
  "FIT_EXPLANATION",
] as const;
export type PromptId = (typeof PROMPT_IDS)[number];

export const PROMPT_SLUGS: Readonly<Record<PromptId, string>> = {
  Q_SYSTEM: "q-system",
  FOUNDER_ONBOARDING_EXTRACTION: "founder-onboarding-extraction",
  CLAIM_EXTRACTION: "claim-extraction",
  INVESTOR_MANDATE_SYNTHESIS: "investor-mandate-synthesis",
  COMPANY_ANALYST: "company-analyst",
  FIT_EXPLANATION: "fit-explanation",
};

export type PromptKind = "CHARTER" | "TASK";
export type PromptStatus = "ACTIVE" | "DEPRECATED";

/** `q-system/v1`, `company-analyst/v2`. Durable; never "latest". */
export type PromptVersionId = `${string}/v${number}`;

export function promptVersionId(
  id: PromptId,
  version: number,
): PromptVersionId {
  return `${PROMPT_SLUGS[id]}/v${version}`;
}

export type PromptVariableSpec<V> = {
  readonly schema: z.ZodType<V>;
  /** Variables whose content is DATA from outside the trusted boundary. */
  readonly untrusted: readonly string[];
};

export type PromptOutputSpec<O> =
  | { readonly kind: "TEXT" }
  | {
      readonly kind: "STRUCTURED";
      readonly schemaName: string;
      readonly schemaVersion: number;
      readonly schema: z.ZodType<O>;
    };

export type PromptDefinition<V = unknown, O = unknown> = {
  readonly id: PromptId;
  readonly version: number;
  readonly status: PromptStatus;
  readonly kind: PromptKind;
  /** The gateway task class a task prompt runs under; absent for the charter. */
  readonly taskClass?: ModelTextTaskClass | undefined;
  readonly owner: "q-core";
  readonly changeDescription: string;
  /** ISO date the version took effect. */
  readonly effectiveFrom: string;
  readonly variables: PromptVariableSpec<V>;
  readonly output: PromptOutputSpec<O>;
  /** Trusted instruction text with `{{variable}}` tokens. */
  readonly template: string;
};

export const UNTRUSTED_OPEN = "<<<UNTRUSTED_CONTENT";
export const UNTRUSTED_CLOSE = "<<<END_UNTRUSTED_CONTENT>>>";

const TOKEN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

export class PromptRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptRenderError";
  }
}

/** The declared tokens of a template, for tests and registry validation. */
export function templateVariables(template: string): readonly string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(TOKEN)) {
    const name = match[1];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return [...names];
}

function neutraliseFences(text: string): string {
  // Content cannot close or reopen a fence: the markers themselves are data.
  return text
    .split(UNTRUSTED_CLOSE)
    .join("<<<END_UNTRUSTED_CONTENT (literal)>>>")
    .split(UNTRUSTED_OPEN)
    .join("<<<UNTRUSTED_CONTENT (literal)");
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "(not provided)";
  }
  if (typeof value === "string") {
    return value.length === 0 ? "(not provided)" : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

export function fenceUntrusted(source: string, value: unknown): string {
  return [
    `${UNTRUSTED_OPEN} source="${source}">>>`,
    neutraliseFences(formatValue(value)),
    UNTRUSTED_CLOSE,
  ].join("\n");
}

/**
 * Render a definition with validated variables. Every token must be a
 * declared variable; every untrusted variable is fenced; nothing else is
 * interpolated.
 */
export function renderTemplate<V>(
  definition: PromptDefinition<V, unknown>,
  input: unknown,
): string {
  const parsed = definition.variables.schema.safeParse(input);
  if (!parsed.success) {
    throw new PromptRenderError(
      `variables for ${promptVersionId(definition.id, definition.version)} are invalid`,
    );
  }
  const variables = parsed.data as Record<string, unknown>;
  const untrusted = new Set(definition.variables.untrusted);
  const rendered = definition.template.replace(
    TOKEN,
    (_match, name: string) => {
      if (!Object.hasOwn(variables, name)) {
        throw new PromptRenderError(
          `template ${promptVersionId(definition.id, definition.version)} references undeclared variable "${name}"`,
        );
      }
      const value = variables[name];
      return untrusted.has(name)
        ? fenceUntrusted(name, value)
        : formatValue(value);
    },
  );
  if (
    /\{\{/.test(
      rendered.replace(UNTRUSTED_OPEN, "").replace(UNTRUSTED_CLOSE, ""),
    )
  ) {
    // A stray token after rendering means the template is malformed, not
    // that content should be interpreted; refuse rather than guess.
    const remaining = rendered.match(TOKEN);
    if (remaining !== null) {
      throw new PromptRenderError(
        `template ${promptVersionId(definition.id, definition.version)} left an unrendered token`,
      );
    }
  }
  return rendered;
}

/** Stable identity of a definition's content: template, output schema identity, version. */
export function promptContentHash(
  definition: PromptDefinition<unknown, unknown>,
): string {
  const output =
    definition.output.kind === "STRUCTURED"
      ? `${definition.output.schemaName}/v${definition.output.schemaVersion}`
      : "text";
  return createHash("sha256")
    .update(promptVersionId(definition.id, definition.version))
    .update("\n")
    .update(output)
    .update("\n")
    .update(definition.template)
    .digest("hex");
}
