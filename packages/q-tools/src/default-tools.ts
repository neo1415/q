import type { Logger } from "@capital-q/observability";
import type { QToolPort } from "@capital-q/q-runtime";

import type { AnyQToolDefinition } from "./definition.js";
import { createQToolExecutor } from "./executor.js";
import type { QToolPorts } from "./ports.js";
import { createQToolRegistry, type QToolRegistry } from "./registry.js";
import { createGetCapitalObjectiveTool } from "./tools/get-capital-objective.js";
import { createGetCompanyTool } from "./tools/get-company.js";
import { createGetInvestorMandateTool } from "./tools/get-investor-mandate.js";
import { createSearchCompaniesTool } from "./tools/search-companies.js";

/** The V1 catalogue: four SAFE_READ tools, all over public query ports. */
export function createDefaultQTools(
  ports: QToolPorts,
): readonly AnyQToolDefinition[] {
  return [
    createGetCompanyTool(ports),
    createGetCapitalObjectiveTool(ports),
    createGetInvestorMandateTool(ports),
    createSearchCompaniesTool(ports),
  ];
}

export type QToolsComposition = {
  readonly registry: QToolRegistry;
  readonly port: QToolPort;
};

/** Registry plus executor over the default catalogue; what apps compose. */
export function createQTools(options: {
  readonly ports: QToolPorts;
  readonly logger?: Logger | undefined;
  readonly definitions?: readonly AnyQToolDefinition[] | undefined;
}): QToolsComposition {
  const registry = createQToolRegistry(
    options.definitions ?? createDefaultQTools(options.ports),
  );
  return {
    registry,
    port: createQToolExecutor({ registry, logger: options.logger }),
  };
}
