import { randomUUID } from "node:crypto";

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import type { JsonSchema7Type } from "@langchain/core/utils/json_schema";

import type { QToolExecutionContext, QToolPort } from "@capital-q/q-runtime";
import type { QToolRegistry } from "@capital-q/q-tools";

/**
 * The Tool Registry, as LangChain tools.
 *
 * The orchestrator is a LangGraph graph, and a graph node that wants a
 * tool wants it in LangChain's shape. This projects what the registry
 * offers a context into that shape and nothing more: the name and
 * description a model sees, the JSON Schema the registry already
 * computed, and a function that hands the call to the execution
 * pipeline. Validation, authorisation and execution happen there, not
 * here; a LangChain tool has no authority a Q tool proposal lacks.
 *
 * The result is the pipeline's bounded outcome as JSON: typed data on
 * success, a stable code and a safe sentence otherwise. Never a thrown
 * error carrying a message from domain code.
 */
export type LangChainToolsOptions = {
  readonly registry: QToolRegistry;
  readonly tools: QToolPort;
  readonly context: QToolExecutionContext;
};

export function toLangChainTools(
  options: LangChainToolsOptions,
): readonly StructuredToolInterface[] {
  const { registry, tools, context } = options;
  return registry.eligible(context).map((record) => {
    // The registry's projection is already JSON Schema; handing it over
    // as such (rather than the Zod object) keeps one schema per tool.
    const schema = record.modelDefinition.inputJsonSchema as JsonSchema7Type;
    return tool(
      async (input, config) => {
        // Untrusted, like a model's proposal: the pipeline parses it.
        const args: unknown = input;
        const signal: unknown = config.signal;
        const outcome = await tools.execute(
          {
            callId: randomUUID(),
            name: record.definition.providerName,
            arguments: args,
          },
          signal instanceof AbortSignal ? { ...context, signal } : context,
        );
        return JSON.stringify(outcome.result);
      },
      {
        name: record.definition.providerName,
        description: record.definition.description,
        schema,
      },
    );
  });
}
