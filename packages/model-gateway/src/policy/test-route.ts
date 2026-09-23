import type { ModelCatalogPort } from "../ports.js";
import type { ModelCatalogSnapshot } from "../catalog.js";

/**
 * A server-side route to one provider, for diagnosis only
 * (QX-004 core gate).
 *
 * Gemini spent a day answering "this model is currently experiencing high
 * demand" and Groq's free tier spent it rate-limited. With both
 * unreliable, every failing journey looked identical — a degraded turn
 * and an empty session — and there was no way to tell a Capital Q defect
 * from a vendor outage. This exists so the acceptance suite can run
 * against something that answers, and for no other reason.
 *
 * What it does: puts one provider's models at the front of every routing
 * policy's preferred list. What it does not do is change any policy's
 * ceilings, any model's ceiling, the Context Firewall, or what a request
 * is allowed to carry. A model still has to be eligible on its own terms;
 * this only changes the order they are tried in, and only for a
 * deployment that asked.
 *
 * It refuses to exist anywhere it could touch a real person:
 *
 *   - `local` or `test` only, never staging, preview or production;
 *   - the synthetic-demo attestation must already be permitted, which
 *     itself requires a loopback database;
 *   - it is read from the server's environment, so no browser and no
 *     request can ask for it.
 *
 * Refusal is loud. A deployment that thinks it is diagnosing and is
 * actually serving somebody is a configuration fault, not a preference.
 */
export class TestRoutingRefusedError extends Error {
  constructor(reason: string) {
    super(`test model routing refused: ${reason}`);
    this.name = "TestRoutingRefusedError";
  }
}

export type TestRoutingOptions = {
  /** The provider code to put first, from the server's own environment. */
  readonly providerCode: string | undefined;
  readonly environment: string | undefined;
  /** Whether the synthetic-demo allowance was built and permitted. */
  readonly syntheticDemoPermitted: boolean;
};

const DIAGNOSABLE_ENVIRONMENTS: ReadonlySet<string> = new Set([
  "local",
  "test",
]);

/**
 * Wrap a catalogue so one provider is tried first, or return it unchanged.
 *
 * Returns the port it was given when no provider was named, which is the
 * ordinary case and the production one.
 */
export function withTestRouting(
  catalog: ModelCatalogPort,
  options: TestRoutingOptions,
): ModelCatalogPort {
  const providerCode = options.providerCode?.trim();
  if (providerCode === undefined || providerCode.length === 0) {
    return catalog;
  }
  if (!DIAGNOSABLE_ENVIRONMENTS.has(options.environment ?? "")) {
    throw new TestRoutingRefusedError(
      `environment must be local or test (got ${options.environment ?? "unset"})`,
    );
  }
  if (!options.syntheticDemoPermitted) {
    throw new TestRoutingRefusedError(
      "the synthetic-demo attestation is not permitted here",
    );
  }

  return {
    load: async (): Promise<ModelCatalogSnapshot> => {
      const snapshot = await catalog.load();
      const provider = snapshot.providers.find(
        (candidate) => candidate.code === providerCode,
      );
      if (provider === undefined) {
        throw new TestRoutingRefusedError(
          `the catalogue has no provider ${providerCode}`,
        );
      }
      const modelIds = snapshot.models
        .filter(
          (model) =>
            model.providerId === provider.id &&
            model.status === "ACTIVE" &&
            model.modelType === "TEXT_GENERATION",
        )
        .map((model) => model.id);
      if (modelIds.length === 0) {
        throw new TestRoutingRefusedError(
          `the catalogue has no active text model for ${providerCode}`,
        );
      }
      return {
        ...snapshot,
        routingPolicies: snapshot.routingPolicies.map((policy) => ({
          ...policy,
          // First, not only: when the diagnostic provider is out, the
          // ordinary routes still answer, and a test that cannot fall
          // back is not testing the thing it claims to.
          preferredModels: [
            ...modelIds,
            ...policy.preferredModels.filter((id) => !modelIds.includes(id)),
          ],
          fallbackModels: policy.fallbackModels.filter(
            (id) => !modelIds.includes(id),
          ),
        })),
      };
    },
  };
}
