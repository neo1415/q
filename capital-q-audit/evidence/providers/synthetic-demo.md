# Synthetic-demo attestation

Why included: Conditions under which hosted staging may route any sensitivity to UNREVIEWED providers.

## `packages/model-gateway/src/policy/synthetic-demo.ts` lines 1-240

```ts
    1  /**
    2   * Server attestation that a deployment's material is synthetic demo data
    3   * (doc 15 §62).
    4   *
    5   * §62 is the rule this implements, in full: *"Free" is a cost property. It
    6   * is not a privacy classification. Free/shared inference may be used
    7   * aggressively for public data, synthetic data, development, low-sensitivity
    8   * tasks where terms permit. Confidential customer information requires an
    9   * approved provider/endpoint.*
   10   *
   11   * The gateway could not express the first half. It knows a request's
   12   * sensitivity and a provider's reviewed ceiling, and it treats every
   13   * request as somebody's data — which is correct, and which is why a demo
   14   * deployment full of invented companies could only reach a reviewed
   15   * provider. Migration 20260926 said the same thing from the other side when
   16   * it reverted the demo posture: the routing preference "takes effect
   17   * exactly where Gemini is eligible — PUBLIC work, synthetic development
   18   * data, and any request a reviewed paid tier later justifies." This is that
   19   * synthetic-development-data case, made executable.
   20   *
   21   * What it is NOT:
   22   *
   23   *   - not a sensitivity class. Nothing here rewrites a declared
   24   *     sensitivity, and no provider's reviewed ceiling moves. A confidential
   25   *     customer request is refused by exactly the same two checks as before.
   26   *   - not an environment switch. Migration 20260926 is explicit that
   27   *     "config's deployment environment is operational metadata and no
   28   *     permission decision may depend on it". The environment is one of
   29   *     three conditions here and cannot carry the decision alone: an
   30   *     operator must also opt in, the deployment's database must be
   31   *     loopback, and the individual request must still declare the posture.
   32   *   - not reachable from a browser. The posture is a field on the internal
   33   *     gateway request; no HTTP DTO carries it, and a request that does not
   34   *     declare it is a customer's.
   35   *
   36   * Absent an allowance the posture does nothing at all: `planRoute` falls
   37   * back to the strict path, which is the behaviour every existing
   38   * deployment already has.
   39   */
   40
   41  const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
   42  /** Environments that attest through a loopback database on the operator's own machine. */
   43  const LOOPBACK_ENVIRONMENTS = new Set(["local", "test"]);
   44
   45  /**
   46   * The Supabase project a connection string belongs to.
   47   *
   48   * Two forms are in use: a direct database host is `db.<ref>.supabase.co`,
   49   * and a pooled one carries the ref in the user as `postgres.<ref>`. Both
   50   * are read, because a deployment that switched to the pooler must not
   51   * silently stop being identifiable.
   52   */
   53  export function supabaseProjectRefOf(url: string): string | null {
   54    let parsed: URL;
   55    try {
   56      parsed = new URL(url);
   57    } catch {
   58      return null;
   59    }
   60    const fromHost = /^db\.([a-z0-9]{16,})\.supabase\.(co|com|net)$/i.exec(
   61      parsed.hostname,
   62    );
   63    if (fromHost?.[1] !== undefined) return fromHost[1].toLowerCase();
   64    const fromProjectHost = /^([a-z0-9]{16,})\.supabase\.(co|com|net)$/i.exec(
   65      parsed.hostname,
   66    );
   67    if (fromProjectHost?.[1] !== undefined)
   68      return fromProjectHost[1].toLowerCase();
   69    const fromUser = /^postgres\.([a-z0-9]{16,})$/i.exec(
   70      decodeURIComponent(parsed.username),
   71    );
   72    if (fromUser?.[1] !== undefined) return fromUser[1].toLowerCase();
   73    return null;
   74  }
   75
   76  /**
   77   * Proof, held by the composition root, that this process may honour a
   78   * SYNTHETIC_DEMO posture. Constructed only by the factory below, which is
   79   * why the gateway can treat its presence as the attestation itself.
   80   */
   81  export type SyntheticDemoRoutingAllowance = {
   82    readonly permitted: true;
   83    /** The conditions that were checked, for the startup log and the postflight. */
   84    readonly attestation: readonly string[];
   85  };
   86
   87  /** The operator asked for synthetic-demo routing where it cannot hold. */
   88  export class SyntheticDemoRoutingRefusedError extends Error {
   89    constructor(reason: string) {
   90      super(`synthetic demo routing refused: ${reason}`);
   91      this.name = "SyntheticDemoRoutingRefusedError";
   92    }
   93  }
   94
   95  export type SyntheticDemoRoutingOptions = {
   96    /**
   97     * The operator's explicit opt-in for this deployment. False, or absent,
   98     * is the answer everywhere that serves a real customer.
   99     */
  100    readonly operatorEnabled: boolean;
  101    /**
  102     * CAPITAL_Q_ENV. `local` and `test` attest through a loopback database;
  103     * `staging` attests by naming the synthetic Supabase project it is
  104     * pinned to. `preview` and `production` can never attest.
  105     */
  106    readonly environment: string | undefined;
  107    /** The database this process talks to. */
  108    readonly databaseUrl: string;
  109    /**
  110     * `CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED` — the deployment's own statement
  111     * that everything it holds was invented (QX-004 §0.3).
  112     *
  113     * Separate from the operator's routing opt-in on purpose. The opt-in
  114     * says "prefer the free route where it is allowed"; this says "there is
  115     * no customer here". A hosted deployment has no loopback database to
  116     * prove the second with, so it has to be said.
  117     */
  118    readonly hostedAttested?: boolean | undefined;
  119    /**
  120     * `CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF` — the Supabase project the
  121     * attestation is about.
  122     *
  123     * Deliberately an identifier rather than a boolean: an operator has to
  124     * name the exact project they are vouching for, and a service later
  125     * repointed at another one stops attesting at startup instead of
  126     * routing a real customer's material to a free provider.
  127     */
  128    readonly syntheticProjectRef?: string | undefined;
  129    /** `SUPABASE_URL`, for the project this process is actually using. */
  130    readonly supabaseUrl?: string | undefined;
  131  };
  132
  133  /**
  134   * Null when the operator has not opted in — the ordinary answer, and not an
  135   * error. Throws when the operator HAS opted in somewhere the claim cannot
  136   * be true, because a deployment that believes it is a demo and is not
  137   * should fail at startup rather than route quietly.
  138   */
  139  export function createSyntheticDemoRoutingAllowance(
  140    options: SyntheticDemoRoutingOptions,
  141  ): SyntheticDemoRoutingAllowance | null {
  142    // Production first, and before the opt-in check: a deployment that
  143    // serves real people and nevertheless carries a synthetic attestation is
  144    // a configuration mistake that must stop the process, not a flag to
  145    // quietly ignore. `preview` is refused for the same reason — it mirrors
  146    // a real pushed checkpoint against real-shaped data.
  147    if (
  148      options.hostedAttested === true &&
  149      (options.environment === "production" || options.environment === "preview")
  150    ) {
  151      throw new SyntheticDemoRoutingRefusedError(
  152        `a synthetic-demo attestation cannot hold in ${options.environment}`,
  153      );
  154    }
  155
  156    if (!options.operatorEnabled) return null;
  157
  158    let host: string;
  159    try {
  160      host = new URL(options.databaseUrl).hostname;
  161    } catch {
  162      throw new SyntheticDemoRoutingRefusedError("database URL is not parseable");
  163    }
  164
  165    /**
  166     * Hosted staging (QX-004 §0.3).
  167     *
  168     * There is no loopback database to point at, so the proof is that the
  169     * operator named the synthetic Supabase project and this process is
  170     * demonstrably using that project and no other. The declared
  171     * sensitivity of a request is untouched by any of this: a RESTRICTED
  172     * synthetic payload stays RESTRICTED, and only provider eligibility
  173     * changes, because the deployment has said there is no customer here.
  174     */
  175    if (options.environment === "staging") {
  176      if (options.hostedAttested !== true) {
  177        throw new SyntheticDemoRoutingRefusedError(
  178          "hosted staging must set the synthetic-demo attestation explicitly",
  179        );
  180      }
  181      const declared = options.syntheticProjectRef?.trim().toLowerCase();
  182      if (declared === undefined || declared.length === 0) {
  183        throw new SyntheticDemoRoutingRefusedError(
  184          "hosted staging must name the synthetic Supabase project it attests about",
  185        );
  186      }
  187      // Every identifier this process can see must agree. A staging service
  188      // repointed at another project fails here rather than routing.
  189      const inUse = [
  190        supabaseProjectRefOf(options.databaseUrl),
  191        options.supabaseUrl === undefined
  192          ? null
  193          : supabaseProjectRefOf(options.supabaseUrl),
  194      ].filter((ref): ref is string => ref !== null);
  195      if (inUse.length === 0) {
  196        throw new SyntheticDemoRoutingRefusedError(
  197          "the Supabase project in use could not be identified",
  198        );
  199      }
  200      const disagreeing = inUse.find((ref) => ref !== declared);
  201      if (disagreeing !== undefined) {
  202        throw new SyntheticDemoRoutingRefusedError(
  203          "the attested synthetic Supabase project is not the one in use",
  204        );
  205      }
  206      return {
  207        permitted: true,
  208        attestation: Object.freeze([
  209          "operator opted in",
  210          "environment staging",
  211          "deployment attested synthetic",
  212          `supabase project ${declared}`,
  213        ]),
  214      };
  215    }
  216
  217    if (
  218      options.environment === undefined ||
  219      !LOOPBACK_ENVIRONMENTS.has(options.environment)
  220    ) {
  221      throw new SyntheticDemoRoutingRefusedError(
  222        `CAPITAL_Q_ENV must be local, test or staging (got ${options.environment ?? "unset"})`,
  223      );
  224    }
  225    if (!LOOPBACK_HOSTS.has(host)) {
  226      // A hosted database is where real people's companies are. Whatever the
  227      // operator intended, this deployment is not a demo.
  228      throw new SyntheticDemoRoutingRefusedError(
  229        `database host must be loopback (got ${host})`,
  230      );
  231    }
  232    return {
  233      permitted: true,
  234      attestation: Object.freeze([
  235        "operator opted in",
  236        `environment ${options.environment}`,
  237        `database host ${host}`,
  238      ]),
  239    };
  240  }
```
