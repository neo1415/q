# Evidence: packages/q-tools/src/registry.ts (lines 154-386)

- Original path: `packages/q-tools/src/registry.ts`
- Line range: 154-386 (HEAD 9177629d)
- Why included: Tool registry: two lanes (SAFE_READ/READ_ONLY, LOW_RISK_INTERNAL/SIDE_EFFECT), ranked/eligible/available/nameable, focus.

```ts
  154  /**
  155   * The hand-written proposers that still serve a declared action (a
  156   * `legacyTool` named propose_*): as much declared actions as a generated
  157   * tool (QA run 92e8545d: "Remind me on Monday at 10am to review
  158   * Tallyloom's deck" was refused -- the turn was about a company, the
  159   * purpose did not list propose_reminder, and only generated tools were
  160   * eligible when named, so the router never saw it).
  161   */
  162  const DECLARED_PROPOSERS: ReadonlySet<string> = new Set(
  163    appActionToolNames(APP_ACTIONS).filter((name) => name.startsWith("propose_")),
  164  );
  165  
  166  /** A declared app action's tool: offered when named, on any purpose its scopes allow. */
  167  function declaredAction(record: QToolRecord): boolean {
  168    return (
  169      record.definition.eligibleWhenNamed === true ||
  170      DECLARED_PROPOSERS.has(record.definition.providerName)
  171    );
  172  }
  173  
  174  export function createQToolRegistry(
  175    definitions: readonly AnyQToolDefinition[],
  176  ): QToolRegistry {
  177    const records: QToolRecord[] = [];
  178    const byVersion = new Map<string, QToolRecord>();
  179    const activeById = new Map<QToolName, QToolRecord>();
  180    const activeByProviderName = new Map<string, QToolRecord>();
  181  
  182    for (const definition of definitions) {
  183      const id = QToolNameSchema.parse(definition.id);
  184      if (!Number.isInteger(definition.version) || definition.version < 1) {
  185        throw new Error(`tool ${id} has an invalid version`);
  186      }
  187      /**
  188       * Two lanes, and only two (ADR 0016). SAFE_READ tools read. The one
  189       * write lane is LOW_RISK_INTERNAL with a SIDE_EFFECT classification:
  190       * a write to the caller's own record, at their own word, that the
  191       * owning service validates again and that is idempotent there — an
  192       * onboarding answer. Anything that needs approval (CONFIRM_REQUIRED
  193       * and above) is an Approval Engine action, never a tool.
  194       */
  195      const read =
  196        definition.riskClass === "SAFE_READ" &&
  197        definition.classification === "READ_ONLY";
  198      const ownWrite =
  199        definition.riskClass === "LOW_RISK_INTERNAL" &&
  200        definition.classification === "SIDE_EFFECT";
  201      if (!read && !ownWrite) {
  202        throw new Error(
  203          `tool ${id} is ${definition.riskClass}/${definition.classification}; a tool is SAFE_READ/READ_ONLY or LOW_RISK_INTERNAL/SIDE_EFFECT, and anything else is an approval-engine action`,
  204        );
  205      }
  206      const versionId = versionIdOf(id, definition.version);
  207      if (byVersion.has(versionId)) {
  208        throw new Error(`duplicate tool version ${versionId}`);
  209      }
  210      const modelDefinition = ModelToolDefinitionSchema.parse({
  211        name: definition.providerName,
  212        description: definition.description,
  213        inputJsonSchema: inputJsonSchemaOf(definition.input),
  214      });
  215      const record: QToolRecord = Object.freeze({
  216        versionId,
  217        definition: Object.freeze(definition),
  218        modelDefinition: Object.freeze(modelDefinition),
  219      });
  220      if (definition.status === "ACTIVE") {
  221        if (activeById.has(id)) {
  222          throw new Error(`tool ${id} has two ACTIVE versions`);
  223        }
  224        const clash = activeByProviderName.get(definition.providerName);
  225        if (clash !== undefined) {
  226          throw new Error(
  227            `tools ${clash.versionId} and ${versionId} both project ${definition.providerName}`,
  228          );
  229        }
  230        activeById.set(id, record);
  231        activeByProviderName.set(definition.providerName, record);
  232      }
  233      byVersion.set(versionId, record);
  234      records.push(record);
  235    }
  236    records.sort((a, b) => a.versionId.localeCompare(b.versionId));
  237    Object.freeze(records);
  238  
  239    /**
  240     * Relevance, then priority (R33, lead decision 2026-09-27): the core
  241     * first; then the tools that declare fewer purposes, being the more
  242     * specific to this one; then id. Deterministic for the same catalogue
  243     * and plan, so the same run always offers the same tools.
  244     */
  245    const ranked = (context: QToolExecutionContext): readonly QToolRecord[] => {
  246      if (context.actor.actorType !== "HUMAN") {
  247        return [];
  248      }
  249      const kinds = planScopeKinds(context.plan);
  250      const purpose = context.plan.purpose.taskClass;
  251      const core = (record: QToolRecord) => record.definition.core === true;
  252      const focus = context.focus;
  253      const focused =
  254        focus !== undefined && (focus.areas.length > 0 || focus.tools.length > 0);
  255      const areas = new Set(focus?.areas ?? []);
  256      const named = new Set(focus?.tools ?? []);
  257      // Focused: the core, the tools the turn named (whatever their
  258      // purposes), and this purpose's tools in the turn's areas. A tool no
  259      // capability lists has no area to judge it by, so it is kept.
  260      const relevant = (record: QToolRecord): boolean => {
  261        if (core(record)) return true;
  262        const name = record.definition.providerName;
  263        const forPurpose = record.definition.supportedPurposes.includes(purpose);
  264        if (!focused) return forPurpose;
  265        const app = declaredAction(record);
  266        // A named tool off this purpose is offered only when it is a declared
  267        // app action: what is offered is what may execute.
  268        if (named.has(name)) return forPurpose || app;
  269        const area = TOOL_AREAS.get(name);
  270        const inArea = area !== undefined && areas.has(area);
  271        // A declared app action is offered whenever its area is in the
  272        // turn's focus, whatever the purpose (lead 2026-10-03, run d396af2f:
  273        // a reader that named nothing left diligence_documents unreachable).
  274        if (!forPurpose) return app && inArea;
  275        return focus?.widen === true || area === undefined || inArea;
  276      };
  277      const focusArea = (record: QToolRecord): boolean => {
  278        const area = TOOL_AREAS.get(record.definition.providerName);
  279        return area !== undefined && areas.has(area);
  280      };
  281      return [...activeById.values()]
  282        .filter(relevant)
  283        .filter(
  284          ({ definition }) =>
  285            definition.requiredScopeKinds.length === 0 ||
  286            definition.requiredScopeKinds.some((kind) => kinds.has(kind)),
  287        )
  288        .sort(
  289          (a, b) =>
  290            Number(core(b)) - Number(core(a)) ||
  291            // What the turn named leads, so no bound can cut it.
  292            Number(named.has(b.definition.providerName)) -
  293              Number(named.has(a.definition.providerName)) ||
  294            // Then what is in the turn's areas, so a widened offer keeps
  295            // what the turn is about within the bound.
  296            Number(focusArea(b)) - Number(focusArea(a)) ||
  297            a.definition.supportedPurposes.length -
  298              b.definition.supportedPurposes.length ||
  299            a.definition.id.localeCompare(b.definition.id),
  300        );
  301    };
  302  
  303    const eligible = (context: QToolExecutionContext): readonly QToolRecord[] =>
  304      ranked(context).slice(0, Math.min(Q_TURN_TOOLS_MAX, MODEL_TOOLS_MAX));
  305  
  306    // What the run's purpose and plan allow, exactly as before a turn's focus
  307    // existed, within what one request can carry.
  308    const unfocused = (context: QToolExecutionContext): readonly QToolRecord[] =>
  309      ranked({ ...context, focus: undefined }).slice(0, MODEL_TOOLS_MAX);
  310  
  311    // The declared app actions this plan's scopes allow, whatever the purpose
  312    // (lead 2026-10-03: "We've decided not to proceed with Ledgerfold" plans
  313    // as INVESTOR_QUESTION, and relationship_outcome was refused there).
  314    const nameable = (context: QToolExecutionContext): readonly QToolRecord[] =>
  315      ranked({
  316        ...context,
  317        focus: {
  318          areas: [],
  319          tools: [...activeById.values()]
  320            .filter(declaredAction)
  321            .map(({ definition }) => definition.providerName),
  322        },
  323      }).filter(declaredAction);
  324  
  325    /** The tool's area is one the turn is about. */
  326    const inFocusArea = (
  327      context: QToolExecutionContext,
  328      providerName: string,
  329    ): boolean => {
  330      const area = TOOL_AREAS.get(providerName);
  331      return area !== undefined && (context.focus?.areas.includes(area) ?? false);
  332    };
  333  
  334    const available = (
  335      context: QToolExecutionContext,
  336    ): readonly QToolRecord[] => {
  337      const listed = unfocused(context);
  338      const names = new Set(listed.map(({ definition }) => definition.id));
  339      return [
  340        ...listed,
  341        ...nameable(context).filter(
  342          ({ definition }) => !names.has(definition.id),
  343        ),
  344      ];
  345    };
  346  
  347    // use_capability reads what this run may use from here, never more.
  348    for (const record of records) {
  349      const bind = (
  350        record.definition as {
  351          readonly [BIND_CATALOGUE]?: (catalogue: CapabilityCatalogue) => void;
  352        }
  353      )[BIND_CATALOGUE];
  354      bind?.((context) =>
  355        available(context).map(({ definition }) => ({
  356          providerName: definition.providerName,
  357          description: definition.description,
  358        })),
  359      );
  360    }
  361  
  362    return {
  363      get: (id, version) => byVersion.get(versionIdOf(id, version)),
  364      getActive: (id) => activeById.get(id),
  365      list: () => records,
  366      eligible,
  367      ranked,
  368      // What may execute is what the run's purpose and plan allow, exactly as
  369      // before a turn's focus existed: the focus narrows what the model is
  370      // shown (cost), never what the run is authorised to use. A code read
  371      // of a fact the model was not shown this turn still runs.
  372      // A declared app action the turn named may execute on any purpose its
  373      // plan's scopes allow; nothing else the focus names widens authority.
  374      offeredByProviderName: (context, providerName) =>
  375        unfocused(context).find(
  376          (record) => record.definition.providerName === providerName,
  377        ) ??
  378        (context.focus?.tools.includes(providerName) === true ||
  379        inFocusArea(context, providerName)
  380          ? nameable(context).find(
  381              (record) => record.definition.providerName === providerName,
  382            )
  383          : undefined),
  384      available,
  385    };
  386  }
```
