# Evidence: packages/q-firewall/src/purpose.ts (lines 30-195)

- Original path: `packages/q-firewall/src/purpose.ts`
- Line range: 30-195 (HEAD 9177629d)
- Why included: Task class derivation, candidate scopes, actor-wide scopes incl. GENERAL_MODEL_KNOWLEDGE (no role gate).

```ts
   30  export type SubjectSummary = {
   31    readonly kind: QSubjectKind;
   32    readonly relation: SubjectRelation;
   33  };
   34  
   35  export function deriveTaskClass(
   36    capability: QCapability,
   37    subjects: readonly SubjectSummary[],
   38  ): QTaskClass {
   39    if (capability === "PREPARE_ACTION") {
   40      return "ACTION_PREPARATION";
   41    }
   42    if (capability === "COMPARE") {
   43      return "COMPARISON";
   44    }
   45    const all = subjects.filter(
   46      (subject) => subject.kind !== "USER" && subject.kind !== "ORGANISATION",
   47    );
   48    /**
   49     * The actor's OWN investor organisation, carried beside a company they
   50     * are asking about, is context — their declared mandate — not what the
   51     * question is about (CQ-QX-007). It must not turn "is this company worth
   52     * my time?" into an investor question: the company stays on the side of
   53     * the firewall its relation puts it, and the counterparty rules keep
   54     * applying to it. The own organisation's scopes are still evaluated on
   55     * their own merits (owner rights), so this changes the class and
   56     * nothing about what either subject may reach.
   57     */
   58    const companyShaped = all.some(
   59      (subject) =>
   60        subject.kind === "COMPANY" ||
   61        subject.kind === "CAPITAL_OBJECTIVE" ||
   62        subject.kind === "DOCUMENT",
   63    );
   64    const entity = companyShaped
   65      ? all.filter(
   66          (subject) =>
   67            !(
   68              subject.kind === "INVESTOR_ORGANISATION" &&
   69              subject.relation === "OWNER"
   70            ),
   71        )
   72      : all;
   73    if (entity.length === 0) {
   74      return "GENERAL_QUESTION";
   75    }
   76    if (entity.some((subject) => subject.kind === "RELATIONSHIP")) {
   77      return "RELATIONSHIP_QUESTION";
   78    }
   79    if (entity.some((subject) => subject.kind === "INVESTOR_ORGANISATION")) {
   80      return "INVESTOR_QUESTION";
   81    }
   82    // Company-shaped subjects (company, capital objective, document): the
   83    // actor's relation to them decides which side of the firewall they are.
   84    return entity.every((subject) => subject.relation === "OWNER")
   85      ? "OWN_COMPANY_QUESTION"
   86      : "COUNTERPARTY_COMPANY_QUESTION";
   87  }
   88  
   89  /**
   90   * Subject-bound knowledge a capability may need for a subject kind. The
   91   * owner side and the counterparty side get the same candidates: which of
   92   * them survive is the permission layer's answer, not this one's.
   93   */
   94  export function candidateScopeKinds(
   95    capability: QCapability,
   96    subjectKind: QSubjectKind,
   97  ): readonly QKnowledgeScopeKind[] {
   98    switch (subjectKind) {
   99      case "COMPANY":
  100        switch (capability) {
  101          case "ANSWER":
  102            return [
  103              "COMPANY_PROFILE",
  104              "COMPANY_CAPITAL_OBJECTIVE",
  105              "EVIDENCE_DOCUMENTS",
  106              "OWN_PUBLIC_PRESENCE",
  107            ];
  108          case "INVESTIGATE":
  109          case "ASSESS":
  110            return [
  111              "COMPANY_PROFILE",
  112              "COMPANY_CAPITAL_OBJECTIVE",
  113              "COMPANY_PRIVATE_FINANCIALS",
  114              "EVIDENCE_DOCUMENTS",
  115              "OWN_PUBLIC_PRESENCE",
  116            ];
  117          case "COMPARE":
  118            return ["COMPANY_PROFILE", "COMPANY_CAPITAL_OBJECTIVE"];
  119          case "CLASSIFY":
  120          case "PREPARE_ACTION":
  121            return ["COMPANY_PROFILE"];
  122        }
  123        break;
  124      case "INVESTOR_ORGANISATION":
  125        switch (capability) {
  126          case "ANSWER":
  127          case "INVESTIGATE":
  128          case "ASSESS":
  129            return [
  130              "INVESTOR_PROFILE",
  131              "INVESTOR_MANDATE",
  132              "OWN_PUBLIC_PRESENCE",
  133            ];
  134          case "COMPARE":
  135          case "CLASSIFY":
  136          case "PREPARE_ACTION":
  137            return ["INVESTOR_PROFILE"];
  138        }
  139        break;
  140      case "RELATIONSHIP":
  141        return ["RELATIONSHIP_CONTEXT"];
  142      case "CAPITAL_OBJECTIVE":
  143        return ["COMPANY_CAPITAL_OBJECTIVE"];
  144      case "DOCUMENT":
  145        return ["EVIDENCE_DOCUMENTS"];
  146      case "USER":
  147        // A USER subject is only ever oneself. What Capital Q understands
  148        // about the person from their own public footprint belongs to the
  149        // person, and answering "what do you know about me" without it means
  150        // the arrival research was performed and thrown away.
  151        return capability === "CLASSIFY"
  152          ? ["OWN_Q_CONVERSATION"]
  153          : ["OWN_Q_CONVERSATION", "OWN_PUBLIC_PRESENCE"];
  154      case "ORGANISATION":
  155        // An organisation is a context, not knowledge.
  156        return [];
  157    }
  158    return [];
  159  }
  160  
  161  /** Actor-wide knowledge every task may use. Classification stays on the subject. */
  162  export function actorWideScopeKinds(
  163    capability: QCapability,
  164  ): readonly QKnowledgeScopeKind[] {
  165    return capability === "CLASSIFY"
  166      ? ["GENERAL_MODEL_KNOWLEDGE"]
  167      : [
  168          "OWN_Q_CONVERSATION",
  169          // Who the person is, from their own onboarding (CQ-QX-007): Home Q
  170          // told an onboarded investor it could not say who they were.
  171          "OWN_ONBOARDING",
  172          "NETWORK_VISIBLE_DATA",
  173          "PUBLIC_EXTERNAL_DATA",
  174          "GENERAL_MODEL_KNOWLEDGE",
  175        ];
  176  }
  177  
  178  /**
  179   * The strongest sensitivity a task may carry into reasoning. RESTRICTED
  180   * (identity artefacts) never enters Q (doc 14 §34); preparing an action or
  181   * classifying text never needs a financial model.
  182   */
  183  export function sensitivityCeiling(taskClass: QTaskClass): QSensitivityClass {
  184    switch (taskClass) {
  185      case "ACTION_PREPARATION":
  186      case "COMPARISON":
  187        return "CONFIDENTIAL";
  188      case "OWN_COMPANY_QUESTION":
  189      case "COUNTERPARTY_COMPANY_QUESTION":
  190      case "INVESTOR_QUESTION":
  191      case "RELATIONSHIP_QUESTION":
  192      case "GENERAL_QUESTION":
  193        return "HIGHLY_CONFIDENTIAL";
  194    }
  195  }
```
