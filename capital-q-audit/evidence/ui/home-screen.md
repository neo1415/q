# Evidence: apps/web/src/features/home/home-screen.tsx (lines 153-294)

- Original path: `apps/web/src/features/home/home-screen.tsx`
- Line range: 153-294 (HEAD 520bd123)
- Why included: Home composition: returning greeting (returning.ts), R35 briefing promise, FounderNext, WorkPanel only when !headed, QConversationPanel with welcome.

```
  153  export async function HomeScreen({
  154    conversationId = null,
  155    fresh = false,
  156    openBoard = false,
  157  }: {
  158    /** The conversation the URL names, resolved on the server. */
  159    readonly conversationId?: string | null | undefined;
  160    /** "New chat" (`?new=1`): a new conversation; a bare /home keeps this tab's. */
  161    readonly fresh?: boolean | undefined;
  162    /** Arrived from the answer chip's Board (C6): open on the Board. */
  163    readonly openBoard?: boolean | undefined;
  164  } = {}) {
  165    const qConnected = loadWebServerConfig().qApiBaseUrl !== undefined;
  166    // Which subject Q's questions are about, if Capital Q knows of one. A
  167    // server fact, resolved once per render and never asked of the browser.
  168    const context = qConnected
  169      ? await resolveOwnContext()
  170      : { kind: "NONE" as const };
  171    // A setup that was left part-way is offered back, in one tap -- to
  172    // somebody whose setup has not named a company yet as well, who is
  173    // back rather than new (CQ-WEB-030).
  174    const unfinished = qConnected ? await resolveUnfinishedSetup() : null;
  175    const arrival = arrivalFor(context, unfinished);
  176  
  177    /*
  178      Q's welcome, once, and only before a conversation: an open
  179      conversation is what they came to Home for, and it is not greeted
  180      over. Returning: what Capital Q knows about where they are. First
  181      time: who Q is and which side of the table they are on. Otherwise
  182      the one line under Q.
  183    */
  184    let welcome: ReactNode = undefined;
  185    let welcomeLine: string | undefined = undefined;
  186    let welcomeLead: string | undefined = undefined;
  187    // Whether the page already has its one visible h1 (the welcomes do).
  188    let headed = false;
  189    let briefing: Promise<Briefing | null> | undefined = undefined;
  190    if (conversationId === null) {
  191      if (arrival === "RETURNING") {
  192        // Q's briefing (R35) starts now and is not awaited: the page and Q
  193        // render first, and the briefing streams in when its reads answer.
  194        briefing = context.kind === "NONE" ? undefined : resolveBriefing(context);
  195        // Today's setup reminder, read (never claimed) once and given on one
  196        // surface only: the briefing's card where there is a briefing, this
  197        // welcome otherwise. No reminder today: neither mentions the setup.
  198        const [read, reminder] = await Promise.all([
  199          resolveReturningFacts(context, unfinished),
  200          unfinished === null ? null : resolveSetupReminder(),
  201        ]);
  202        const facts: ReturningFacts = {
  203          ...read,
  204          setupReminder:
  205            reminder === null
  206              ? undefined
  207              : briefing === undefined
  208                ? "WELCOME"
  209                : "BRIEFING",
  210        };
  211        const greeting = returningGreeting(facts);
  212        welcome = (
  213          <>
  214            <ReturningWelcome
  215              greeting={greeting}
  216              cards={chooseReturningCards(facts)}
  217              subject={askSubject(context)}
  218              briefing={briefing}
  219            />
  220            {/*
  221              Q.01/Q.04: a founder's next question from Q and next three
  222              steps. Streams in on its own; renders nothing when there is
  223              nothing to show, so Home stays Q first.
  224            */}
  225            {context.kind === "FOUNDER" ? (
  226              <Suspense fallback={null}>
  227                <FounderNext />
  228              </Suspense>
  229            ) : null}
  230          </>
  231        );
  232        welcomeLine = greeting.spoken;
  233        welcomeLead = greeting.headline;
  234        headed = true;
  235      } else if (arrival === "FIRST_TIME" && qConnected) {
  236        const name = firstName((await accountDetails()).displayName);
  237        welcome = <FirstRunWelcome name={name} />;
  238        headed = true;
  239        welcomeLine = `${name === null ? "Hi, I'm Q." : `Hi ${name}, I'm Q.`} ${FIRST_RUN_QUESTION}`;
  240      } else {
  241        welcome = (
  242          <p className="cq-body text-center text-balance text-(--cq-text-secondary)">
  243            {openingLine(context)}
  244          </p>
  245        );
  246      }
  247    }
  248  
  249    return (
  250      <div className="flex min-h-0 flex-1 flex-col">
  251        {/*
  252          The Q surface. Deliberately not a PageHeader and a card: a heading
  253          reading "Home" above a boxed chat is the dashboard composition
  254          this packet exists to replace. Previous conversations are one
  255          control away (the history control here, the collapsible list in
  256          the sidebar), never a list above the composer.
  257  
  258          Deliberately not inside a Suspense boundary (QX-003A): React
  259          reveals a streamed boundary on a requestAnimationFrame, which never
  260          fires in a hidden tab, and Home's whole Q surface stayed blank in a
  261          background tab until it was removed.
  262        */}
  263        {/*
  264          AUTO (ADR 0030): what Q is doing under an approved plan, above the
  265          conversation, only while something is running (renders nothing
  266          otherwise, so Home stays Q first).
  267        */}
  268        {qConnected && !headed ? (
  269          <div className="mx-auto max-h-[35dvh] w-full max-w-(--cq-layout-reading) flex-none overflow-y-auto px-(--cq-page-gutter) pt-4">
  270            <WorkPanel variant="home" />
  271          </div>
  272        ) : null}
  273        <section
  274          aria-label="Ask Q"
  275          className="flex min-h-0 flex-1 flex-col"
  276          data-q-surface
  277        >
  278          {/* A conversation view still has a page heading (R30 #34). */}
  279          {headed ? null : <h1 className="sr-only">Q</h1>}
  280          <QConversationPanel
  281            connected={qConnected}
  282            context={surfaceContext(context)}
  283            conversationId={conversationId}
  284            fresh={fresh}
  285            openBoard={openBoard}
  286            welcome={welcome}
  287            welcomeLine={welcomeLine}
  288            welcomeLead={welcomeLead}
  289            briefing={briefing}
  290          />
  291        </section>
  292      </div>
  293    );
  294  }
```

# Evidence: apps/web/src/features/home/returning-welcome.tsx (lines 65-245)

- Original path: `apps/web/src/features/home/returning-welcome.tsx`
- Line range: 65-245 (HEAD 520bd123)
- Why included: ReturningWelcome: ArrivalBriefing with 'Welcome back' fallback; R35 QBriefing only when the arrival is not READY; 'Where to start' cards.

```
   65  export function ReturningWelcome({
   66    greeting,
   67    cards,
   68    subject,
   69    briefing,
   70  }: {
   71    readonly greeting: ReturningGreeting;
   72    readonly cards: readonly ReturningCard[];
   73    /** The person's own company or organisation, resolved on the server. */
   74    readonly subject: QSubjectInput | undefined;
   75    /** Q's briefing (R35), streamed from the server after the page. */
   76    readonly briefing?: Promise<Briefing | null> | undefined;
   77  }) {
   78    const router = useRouter();
   79    const tools = useQSurfaceTools();
   80    const arrival = useArrivalStatus();
   81    const arrived = arrival.kind === "READY" && !arrival.nudge;
   82    const [asking, setAsking] = useState<string | null>(null);
   83    const [notice, setNotice] = useState<string | null>(null);
   84    // Today's setup reminder, when this welcome carries it: counted once the
   85    // cards are really seen, and gone at once on Later.
   86    const [putOff, setPutOff] = useState(false);
   87    const reminding = !putOff && cards.some((card) => card.reminder === true);
   88    const cardsRef = useRef<HTMLUListElement>(null);
   89    useClaimWhenSeen(cardsRef, reminding);
   90    const shownCards = putOff
   91      ? cards.filter((card) => card.reminder !== true)
   92      : cards;
   93  
   94    const ask = async (card: ReturningCard, prompt: string) => {
   95      if (asking !== null) return;
   96      if (tools !== null) {
   97        // The conversation right underneath takes it: same run, same place.
   98        tools.ask(prompt);
   99        return;
  100      }
  101      setAsking(card.id);
  102      setNotice(null);
  103      const result = await askQAction(prompt, undefined, subject);
  104      if (!result.ok) {
  105        setAsking(null);
  106        setNotice(result.message);
  107        return;
  108      }
  109      const conversationId = result.value.conversationId;
  110      if (conversationId === undefined) {
  111        // The run exists; only the way to open it is missing. Say so
  112        // rather than pretend the question went nowhere.
  113        setAsking(null);
  114        setNotice("Q is answering. You'll find it in your chats.");
  115        return;
  116      }
  117      router.push(`/home?c=${encodeURIComponent(conversationId)}`);
  118    };
  119  
  120    return (
  121      <section
  122        aria-labelledby="returning-headline"
  123        className="flex w-full flex-col items-center gap-5"
  124        data-q-returning
  125      >
  126        {/*
  127          The arrival briefing (2026-10-08): greeting by their clock, the
  128          lowdown, then what needs them, one card at a time. Until it is read,
  129          and when this is not an arrival, the welcome below shows instead.
  130        */}
  131        <ArrivalBriefing
  132          variant="page"
  133          fallback={
  134            <div className="flex flex-col items-center gap-2 text-center">
  135              <h1
  136                id="returning-headline"
  137                className="cq-title-lg text-balance text-(--cq-text-primary)"
  138              >
  139                {greeting.headline}
  140              </h1>
  141              <p className="cq-body-lg cq-prose text-balance text-(--cq-text-secondary)">
  142                {greeting.question}
  143              </p>
  144            </div>
  145          }
  146        />
  147  
  148        {greeting.leftOff === null || putOff ? null : (
  149          // Q's own last question, as Q asked it: where they left off is
  150          // shown, not paraphrased.
  151          <figure
  152            className="flex w-full max-w-(--cq-layout-narrow) flex-col gap-1 border-l-2 border-(--cq-border-strong) pl-3"
  153            data-q-left-off
  154          >
  155            <figcaption className="cq-caption text-(--cq-text-tertiary)">
  156              Where we left off
  157            </figcaption>
  158            <blockquote className="cq-body text-(--cq-text-primary)">
  159              {greeting.leftOff}
  160            </blockquote>
  161          </figure>
  162        )}
  163  
  164        {/* The arrival briefing carries what waits on them; not said twice. */}
  165        {briefing === undefined || arrived ? null : (
  166          <QBriefing briefing={briefing} />
  167        )}
  168  
  169        {shownCards.length > 0 ? (
  170          <ul
  171            ref={cardsRef}
  172            aria-label="Where to start"
  173            className="grid w-full gap-2 sm:grid-cols-2"
  174            data-q-returning-cards
  175          >
  176            {shownCards.map((card) => {
  177              const action = card.action;
  178              return (
  179                <li key={card.id} className="flex">
  180                  {action.kind === "NAVIGATE" ? (
  181                    <Link
  182                      href={action.href}
  183                      className={CARD_CLASS}
  184                      data-returning-card={card.id}
  185                    >
  186                      <CardBody card={card} />
  187                    </Link>
  188                  ) : action.kind === "OPEN_ARTIFACT" && tools === null ? (
  189                    // Outside a Q surface there is no viewer to open it in;
  190                    // the slides the server renders are the way in.
  191                    <a
  192                      href={`/api/q-artifact/${encodeURIComponent(action.artifactId)}/slides`}
  193                      className={CARD_CLASS}
  194                      data-returning-card={card.id}
  195                    >
  196                      <CardBody card={card} />
  197                    </a>
  198                  ) : (
  199                    <button
  200                      type="button"
  201                      className={CARD_CLASS}
  202                      onClick={() => {
  203                        if (action.kind === "OPEN_ARTIFACT") {
  204                          tools?.openArtifact(action.artifactId);
  205                        } else if (action.kind === "ASK_Q") {
  206                          void ask(card, action.prompt);
  207                        }
  208                      }}
  209                      disabled={asking !== null}
  210                      aria-busy={asking === card.id}
  211                      data-returning-card={card.id}
  212                    >
  213                      <CardBody card={card} />
  214                    </button>
  215                  )}
  216                </li>
  217              );
  218            })}
  219          </ul>
  220        ) : null}
  221  
  222        {reminding ? (
  223          <button
  224            type="button"
  225            onClick={() => {
  226              setPutOff(true);
  227              void remindSetupLaterAction();
  228            }}
  229            className="inline-flex min-h-11 items-center rounded-md px-3 cq-body-sm text-(--cq-text-secondary) transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
  230            data-setup-reminder-later
  231          >
  232            Remind me later
  233          </button>
  234        ) : null}
  235  
  236        {/* Polite, so a failed ask is read out without taking focus. */}
  237        <p
  238          role="status"
  239          className="cq-body-sm text-(--cq-text-secondary) empty:hidden"
  240        >
  241          {asking !== null ? "Asking Q…" : (notice ?? "")}
  242        </p>
  243      </section>
  244    );
  245  }
```

# Evidence: apps/web/src/features/home/returning.ts (lines 115-160)

- Original path: `apps/web/src/features/home/returning.ts`
- Line range: 115-160 (HEAD 520bd123)
- Why included: returningGreeting/questionFor: 'Welcome back, X.' + 'What would you like to work on today?' (the generic opener heard live 11:13).

```
  115  
  116  export function returningGreeting(facts: ReturningFacts): ReturningGreeting {
  117    const name = firstName(facts.name);
  118    const headline = name === null ? "Welcome back." : `Welcome back, ${name}.`;
  119    const question = questionFor(facts);
  120    const leftOff = welcomeReminds(facts) ? (facts.setup?.pending ?? null) : null;
  121    return { headline, question, leftOff, spoken: `${headline} ${question}` };
  122  }
  123  
  124  /** "mandate", "mandate and stage", "mandate, cheque and stage". */
  125  function joinParts(parts: readonly string[]): string {
  126    const lower = parts.map((part) => part.toLowerCase());
  127    if (lower.length <= 1) return lower[0] ?? "";
  128    return `${lower.slice(0, -1).join(", ")} and ${lower.at(-1) ?? ""}`;
  129  }
  130  
  131  /**
  132   * Q's question, picked from the one thing most worth saying. Bounded copy
  133   * rather than a model call: it renders instantly, and a claim here is
  134   * only ever one the facts make.
  135   */
  136  function questionFor(facts: ReturningFacts): string {
  137    const { unfinished } = facts;
  138    if (unfinished !== null && welcomeReminds(facts)) {
  139      // Where they left off, in the journey's own terms: what is settled,
  140      // then the offer. The question Q was on is shown beside this as Q's
  141      // own sentence (`leftOff`), not paraphrased into it.
  142      const covered = facts.setup?.covered ?? [];
  143      const done =
  144        covered.length === 0 ? "" : `We've covered ${joinParts(covered)}. `;
  145      return unfinished === "investor"
  146        ? `${done}Your mandate is part-way through — shall we pick it up where we left off, or would you rather look around first?`
  147        : `${done}Your company setup is part-way through — shall we pick it up where we left off?`;
  148    }
  149    const role = roleOf(facts);
  150    if (role === "INVESTOR" && facts.feed === "YES") {
  151      return "There are companies in your feed, ranked against your mandate. Where would you like to start?";
  152    }
  153    if (role === "INVESTOR" && facts.feed === "NO") {
  154      return "Your mandate is set, and nothing on Capital Q matches it yet. Shall we look at what's close, or go over the mandate together?";
  155    }
  156    if (role === "FOUNDER" && facts.pitch === "NO") {
  157      return "Investors watch a pitch before they read anything else. Would you like to record yours, or work on something else?";
  158    }
  159    return role === "FOUNDER"
  160      ? "What would you like to work on today?"
```

