# Evidence: apps/q-api/src/composition/instructions/engine.ts lines 1160-1280

- Original path: `apps/q-api/src/composition/instructions/engine.ts`
- Line range: 1160-1280 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: messageProblem: code's message checks (cold open, woo, mandate, unanswered question, bookingAuto).

```ts
 1160  
 1161  /**
 1162   * Code's check of a message: whether it may be written at all in this
 1163   * conversation, then its words against the material it may use.
 1164   */
 1165  function messageProblem(
 1166    input: unknown,
 1167    subject: string | null,
 1168    context: ValidationContext,
 1169    step: InstructionPlanStep,
 1170    /** A proposed call goes to the person's card: not a problem here. */
 1171    meetingToAsk = false,
 1172  ): { readonly problem: RefusalCode | null; readonly factReply: boolean } {
 1173    const pass = { problem: null, factReply: false } as const;
 1174    const refuse = (problem: RefusalCode) => ({ problem, factReply: false });
 1175    const body = (input as { input?: { kind?: unknown; body?: unknown } }).input;
 1176    if (body?.kind !== "TEXT" || typeof body.body !== "string") return pass;
 1177    const thread = subject === null ? undefined : context.facts?.get(subject);
 1178    // Live QA (instruction 76d6f281): "first" is the conversation's, never
 1179    // the planner's. Where their side has heard from the sender already, a
 1180    // first message is not one: it is a follow-up only where the grant allows
 1181    // follow-ups, and a reply only when they wrote last.
 1182    const written = sidesWritten(subject, context);
 1183    const replying = thread?.lastFrom === "THEM";
 1184    if (written && !replying && context.grant.followUps === false) {
 1185      return refuse("ALREADY_INTRODUCED");
 1186    }
 1187    // Live seed (7 Oct, Ledgerline and three others): the founder wrote first
 1188    // after accepting; the planner drafted "I came across the company through
 1189    // your Capital Q profile". A reply answers them, it never introduces.
 1190    if (replying && COLD_OPEN.test(body.body)) {
 1191      return refuse("COLD_OPEN_IN_REPLY");
 1192    }
 1193    const counterpartId =
 1194      subject === null
 1195        ? undefined
 1196        : context.people.find((person) => person.relationshipId === subject)
 1197            ?.counterpartId;
 1198    const material = context.material ?? null;
 1199    const counterpart =
 1200      counterpartId === undefined
 1201        ? []
 1202        : (material?.counterparts.get(counterpartId) ?? []);
 1203    // Founder 2026-10-07: a message that woos. Code's own read of Q's draft;
 1204    // a failing one is planned again (the rewrite), never sent as it is. An
 1205    // answer to their own question is about them already; a first message
 1206    // has its own, stricter grounding check below.
 1207    const answeringThem =
 1208      thread?.asksQuestion === true && thread.lastFrom === "THEM";
 1209    const read = subject === null ? undefined : context.threads?.get(subject);
 1210    const anchors = counterpart.flatMap((fact) => fact.anchors);
 1211    const woo = wooProblem({
 1212      body: body.body,
 1213      replying,
 1214      recipientTerms:
 1215        answeringThem || (!written && !replying) || anchors.length === 0
 1216          ? []
 1217          : [
 1218              ...anchors,
 1219              // Tensorgate, 8 Oct: a reply that takes up what they said is
 1220              // specific to them, though it names nothing from their profile.
 1221              // Only widens a check that already applies; never adds one.
 1222              ...(replying ? (read?.theirTerms ?? []) : []),
 1223            ],
 1224    });
 1225    if (woo !== null) {
 1226      return refuse(woo === "WOO_TOO_LONG" ? "MESSAGE_TOO_LONG" : woo);
 1227    }
 1228    if (context.material === undefined) return pass;
 1229    const first = !written && !replying;
 1230    // A first message only inside the sender's declared hard criteria.
 1231    if (
 1232      first &&
 1233      outsideCriteria(material?.sender.criteria, counterpart) !== null
 1234    ) {
 1235      return refuse("OUTSIDE_MANDATE");
 1236    }
 1237    // Their question Q may not answer has gone to the person: no reply.
 1238    const open =
 1239      thread === undefined
 1240        ? null
 1241        : questionVerdict(thread, material?.sender.facts ?? null);
 1242    if (open === "NOT_DECLARED") {
 1243      return refuse("UNANSWERED_QUESTION");
 1244    }
 1245    const answering =
 1246      thread?.asksQuestion === true && thread.lastFrom === "THEM"
 1247        ? (thread.questionAbout ?? ["OTHER" as const])
 1248        : undefined;
 1249    const problem = checkMessage({
 1250      body: body.body,
 1251      first,
 1252      counterpart,
 1253      sender: material?.sender.facts ?? [],
 1254      // Under delegation, proposing a time in a live conversation is one of
 1255      // the routine moves the person handed over.
 1256      bookingAuto:
 1257        meetingToAsk ||
 1258        context.grant.actions.some(
 1259          (entry) =>
 1260            entry.action === "schedule.meeting.book" && entry.mode === "AUTO",
 1261        ) ||
 1262        (context.delegation != null && connectedFor(context.people, subject)),
 1263      answering,
 1264      asks: step.message?.asks,
 1265      side: material?.sender.side,
 1266      criteria: material?.sender.criteria,
 1267      ownStated: read?.ourNumbers ?? [],
 1268    });
 1269    if (problem !== null) return refuse(problem);
 1270    return {
 1271      problem: null,
 1272      factReply:
 1273        open === "ANSWERABLE" &&
 1274        thread?.mentionsTermsOrMoney !== true &&
 1275        templatedAnswer(thread, context) !== null,
 1276    };
 1277  }
 1278  
 1279  // ---------------------------------------------------------------------------
 1280  // One firing
```
