import { createHash } from "node:crypto";

import {
  hashOnboardingRequest,
  validateOnboardingManifest,
  type OnboardingDefinitionManifest,
} from "@capital-q/onboarding";

/**
 * Renders a validated manifest as the SQL a production reference-data
 * migration carries. The rows are exactly what the runtime publisher would
 * insert (same defaults, same JSON, same manifest hash), so a later
 * `publisher.publish(manifest)` against a migrated database is an idempotent
 * no-op rather than a conflict. Identifiers are UUIDv5 over the journey and
 * version, so every environment shares the same ids.
 */

const CAPITAL_Q_ONBOARDING_NAMESPACE = "5f0b9d2e-3c0a-4b8e-9f6d-2a7c1e4d8b10";

function uuidV5(namespace: string, name: string): string {
  const bytes = Buffer.concat([
    Buffer.from(namespace.replace(/-/g, ""), "hex"),
    Buffer.from(name, "utf8"),
  ]);
  const hash = createHash("sha1").update(bytes).digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function onboardingDefinitionIds(
  journeyType: string,
  version: number,
): {
  readonly definitionId: string;
  readonly versionId: string;
  readonly stepId: (stepKey: string) => string;
} {
  const definitionId = uuidV5(
    CAPITAL_Q_ONBOARDING_NAMESPACE,
    `definition:${journeyType}`,
  );
  const versionId = uuidV5(
    CAPITAL_Q_ONBOARDING_NAMESPACE,
    `version:${journeyType}:${String(version)}`,
  );
  return {
    definitionId,
    versionId,
    stepId: (stepKey) =>
      uuidV5(
        CAPITAL_Q_ONBOARDING_NAMESPACE,
        `step:${journeyType}:${String(version)}:${stepKey}`,
      ),
  };
}

/** Dollar-quoted literal: JSON and copy may contain apostrophes and backslashes. */
function literal(value: string): string {
  if (value.includes("$cq$")) {
    throw new Error("value contains the dollar-quote tag");
  }
  return `$cq$${value}$cq$`;
}

export function renderOnboardingDefinitionMigration(
  raw: OnboardingDefinitionManifest,
  options: { readonly packet: string },
): string {
  const manifest = validateOnboardingManifest(raw);
  const manifestHash = hashOnboardingRequest(manifest);
  const ids = onboardingDefinitionIds(manifest.journeyType, manifest.version);
  const lines: string[] = [];
  lines.push(
    `-- ${options.packet} · ${manifest.name} v${String(manifest.version)} (journey "${manifest.journeyType}")`,
    `-- GENERATED from packages/founder-onboarding/src/definition by renderOnboardingDefinitionMigration.`,
    `-- Do not edit by hand: a change to the journey is a new definition version.`,
    `-- Reference data published through the same rows the runtime publisher writes;`,
    `-- publishing the same manifest again is an idempotent no-op (manifest hash below).`,
    ``,
    `insert into onboarding.definitions (id, journey_type, name)`,
    `values ('${ids.definitionId}', ${literal(manifest.journeyType)}, ${literal(manifest.name)})`,
    `on conflict (journey_type) do nothing;`,
    ``,
    `insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)`,
    `select '${ids.versionId}', d.id, ${String(manifest.version)},`,
    `       ${literal(JSON.stringify(manifest.schema))}::jsonb,`,
    `       '${manifestHash}'`,
    `  from onboarding.definitions d`,
    ` where d.journey_type = ${literal(manifest.journeyType)};`,
    ``,
    `insert into onboarding.steps`,
    `  (id, definition_version_id, step_key, sequence_order, step_type, required, configuration, branching_expression, writes_to)`,
    `values`,
  );
  const rows = manifest.steps.map((step) => {
    const { stepType, ...configuration } = step.configuration;
    const branching =
      step.branching === null
        ? "null"
        : `${literal(JSON.stringify(step.branching))}::jsonb`;
    return `  ('${ids.stepId(step.stepKey)}', '${ids.versionId}', ${literal(step.stepKey)}, ${String(step.sequenceOrder)}, ${literal(stepType)}, ${step.required ? "true" : "false"},\n   ${literal(JSON.stringify(configuration))}::jsonb,\n   ${branching},\n   ${literal(JSON.stringify(step.writesTo))}::jsonb)`;
  });
  lines.push(rows.join(",\n") + ";", ``);
  lines.push(
    `-- Publication freezes the version and its steps (trigger-enforced).`,
    `update onboarding.definition_versions set published_at = now() where id = '${ids.versionId}';`,
    ``,
    `-- New sessions pin to this version; existing sessions keep theirs.`,
    `update onboarding.definitions`,
    `   set current_version = ${String(manifest.version)}`,
    ` where journey_type = ${literal(manifest.journeyType)}`,
    `   and (current_version is null or current_version < ${String(manifest.version)});`,
    ``,
  );
  return lines.join("\n");
}
