# Evidence: apps/web/src/features/briefing/arrival.ts (lines 1-209)

- Original path: `apps/web/src/features/briefing/arrival.ts`
- Line range: 1-209 (HEAD 520bd123)
- Why included: ArrivalCard is APPROVAL|HELD only; arrivalWords composes greeting + lowdown + waiting notices + card summary.

```
    1  import {
    2    arrivalGreeting,
    3    cardFactsForVoice,
    4    cardLine,
    5    focusedCard,
    6    isTimeZone,
    7    lowdownOf,
    8    parseCardCommand,
    9    remainingAfterFocus,
   10    summaryOfCards,
   11    wordsAllowDismiss,
   12    wordsAllowSend,
   13    type ArrivalActivity,
   14    type CardCommand,
   15    type DecisionCardFacts,
   16    type SequenceCard,
   17    type SequenceEvent,
   18    type SequenceNote,
   19    type SequenceState,
   20  } from "@capital-q/q-core/speech";
   21  import type {
   22    BriefingCommandRequest,
   23    BriefingCommandResultDto,
   24    NamedPicture,
   25  } from "@capital-q/contracts";
   26  
   27  /**
   28   * The arrival briefing as the page shows and Q says it (Zino, 2026-10-08):
   29   * a greeting by their clock, a lowdown from what was recorded, then the
   30   * decisions one at a time. Pure, so every rule here is a test; the reads
   31   * are in arrival-actions.ts, the sequence itself in q-core.
   32   */
   33  
   34  /** One decision, with the exact content its verbs act on. */
   35  export type ArrivalCard = {
   36    readonly key: string;
   37    readonly kind: "APPROVAL" | "HELD";
   38    readonly approvalId: string | null;
   39    readonly draftId: string | null;
   40    readonly relationshipId: string | null;
   41    /** The other side's name, when known. */
   42    readonly counterpart: string | null;
   43    readonly named: NamedPicture | null;
   44    /** What the card is, in a line ("Reply to Halyard Security"). */
   45    readonly title: string;
   46    /** The card's own plain summary. */
   47    readonly summary: string;
   48    /** The exact message Q would send; null when the card is not a message. */
   49    readonly message: string | null;
   50    /** Their latest words, when they wrote last. */
   51    readonly theySaid: string | null;
   52    /** Held: why Q held it back. */
   53    readonly reason: string | null;
   54    readonly canDecide: boolean;
   55    readonly at: string;
   56  };
   57  
   58  export type ArrivalData = {
   59    readonly firstName: string | null;
   60    /** Their own zone from Capital Q; null: the browser's is used. */
   61    readonly timeZone: string | null;
   62    /** Null: what happened could not be read (said nothing about it). */
   63    readonly activity: ArrivalActivity | null;
   64    /** Hours since the last visit this browser knows; null: unknown. */
   65    readonly hoursAway: number | null;
   66    readonly cards: readonly ArrivalCard[];
   67    /**
   68     * Notices still waiting on them ("Zino Aviation is waiting for a
   69     * reply"), as their titles; absent or empty: none.
   70     */
   71    readonly waiting?: readonly string[] | undefined;
   72  };
   73  
   74  export function sequenceCardOf(card: ArrivalCard): SequenceCard {
   75    return {
   76      key: card.key,
   77      kind: card.kind,
   78      approvalId: card.approvalId,
   79      draftId: card.draftId,
   80      relationshipId: card.relationshipId,
   81      message: card.message,
   82      canDecide: card.canDecide,
   83    };
   84  }
   85  
   86  export function decisionFactsOf(card: ArrivalCard): DecisionCardFacts {
   87    return {
   88      kind: card.kind,
   89      counterpart: card.counterpart,
   90      theySaid: card.theySaid,
   91      message: card.message,
   92      summary: card.summary,
   93    };
   94  }
   95  
   96  /** The zone to greet by: theirs when Capital Q holds a valid one. */
   97  export function zoneFor(
   98    data: Pick<ArrivalData, "timeZone">,
   99    browserZone: string | null,
  100  ): string | null {
  101    if (isTimeZone(data.timeZone)) return data.timeZone;
  102    return isTimeZone(browserZone) ? browserZone : null;
  103  }
  104  
  105  export type ArrivalWords = {
  106    readonly greeting: string;
  107    readonly lowdown: string;
  108    readonly quiet: boolean;
  109    /** The first card, put to them; null with none. */
  110    readonly firstCard: string | null;
  111    /** Every card in one sentence ("Three things: ..."); null with none. */
  112    readonly summary: string | null;
  113    /** Everything Q says first, on voice. */
  114    readonly spoken: string;
  115  };
  116  
  117  /** "Zino Aviation is waiting for a reply" -> "Zino Aviation". */
  118  const WAITING_NAME =
  119    /^(.+?) (?:is waiting for (?:a|your) reply|sent you a message|wrote back|replied)\b/u;
  120  
  121  /**
  122   * Notices still waiting on them, said once per name (live 2026-10-08:
  123   * "Zino Aviation wrote back. Zino Aviation is waiting for a reply. Zino
  124   * Aviation sent you a message."). A name the lowdown already said is
  125   * "they"; a notice that names no one is said as its title.
  126   */
  127  export function waitingWords(
  128    titles: readonly string[],
  129    lowdown: string,
  130  ): string | null {
  131    const names: string[] = [];
  132    const others: string[] = [];
  133    for (const title of titles) {
  134      const name = WAITING_NAME.exec(title.trim())?.[1]?.trim();
  135      if (name === undefined) {
  136        const line = title.trim().replace(/[.!?\s]*$/u, ".");
  137        if (line.length > 1 && !others.includes(line)) others.push(line);
  138      } else if (!names.includes(name)) {
  139        names.push(name);
  140      }
  141    }
  142    const parts: string[] = [];
  143    if (names.length > 0) {
  144      const said = names.length === 1 && lowdown.includes(names[0] ?? "");
  145      const who = said
  146        ? "They're"
  147        : names.length === 1
  148          ? `${names[0] ?? ""} is`
  149          : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""} are`;
  150      parts.push(
  151        `${who} waiting for ${names.length === 1 ? "your reply" : "replies"}.`,
  152      );
  153    }
  154    parts.push(...others.slice(0, 2));
  155    return parts.length === 0 ? null : parts.join(" ");
  156  }
  157  
  158  /** What Q says on arrival, from the data alone. */
  159  export function arrivalWords(
  160    data: ArrivalData,
  161    now: Date,
  162    browserZone: string | null,
  163  ): ArrivalWords {
  164    const greeting = arrivalGreeting({
  165      firstName: data.firstName,
  166      now,
  167      timeZone: zoneFor(data, browserZone),
  168    });
  169    const read = lowdownOf({
  170      activity: data.activity ?? {},
  171      decisions: data.cards.length,
  172      hoursAway: data.hoursAway,
  173    });
  174    // Live 2026-10-08: "All quiet; nothing needs you" while an investor's
  175    // message waited for a reply. What waits on them is said, never "quiet".
  176    const waitingLine = waitingWords(data.waiting ?? [], read.text);
  177    const lowdown =
  178      waitingLine === null
  179        ? read
  180        : read.quiet
  181          ? { quiet: false, text: waitingLine }
  182          : { quiet: false, text: `${read.text} ${waitingLine}` };
  183    const first = data.cards[0];
  184    const firstCard =
  185      first === undefined
  186        ? null
  187        : cardLine(decisionFactsOf(first), 1, data.cards.length);
  188    // Zino, 2026-10-08: all of it up front, then any words they like.
  189    const summary =
  190      data.cards.length < 2
  191        ? null
  192        : summaryOfCards(data.cards.map(decisionFactsOf));
  193    return {
  194      greeting,
  195      lowdown: lowdown.text,
  196      quiet: lowdown.quiet,
  197      firstCard,
  198      summary,
  199      spoken: [
  200        greeting,
  201        lowdown.text,
  202        ...(summary === null
  203          ? [firstCard]
  204          : [summary, "Tell me what you'd like done with any of them."]),
  205      ]
  206        .filter((part): part is string => part !== null && part.length > 0)
  207        .join(" "),
  208    };
  209  }
```

# Evidence: packages/q-core/src/speech/arrival.ts (lines 50-288)

- Original path: `packages/q-core/src/speech/arrival.ts`
- Line range: 50-288 (HEAD 520bd123)
- Why included: arrivalGreeting/lowdownOf: deterministic greeting and lowdown from counts (sent/booked/interest/replies/matches/held); no company-match or opinion content.

```
   50  
   51  /** "Good afternoon, Zino." -- or, after 22:00, a late-hours hello. */
   52  export function arrivalGreeting(input: {
   53    readonly firstName: string | null;
   54    readonly now: Date;
   55    readonly timeZone: string | null | undefined;
   56  }): string {
   57    const name = input.firstName?.trim().split(/\s+/u)[0] ?? "";
   58    const named = name.length > 0 ? name : null;
   59    switch (partOfDay(input.now, input.timeZone)) {
   60      case "MORNING":
   61        return named === null ? "Good morning." : `Good morning, ${named}.`;
   62      case "AFTERNOON":
   63        return named === null ? "Good afternoon." : `Good afternoon, ${named}.`;
   64      case "EVENING":
   65        return named === null ? "Good evening." : `Good evening, ${named}.`;
   66      case "LATE":
   67        return named === null
   68          ? "Hello, you're up late."
   69          : `Hi ${named}, you're up late.`;
   70    }
   71  }
   72  
   73  // ---------------------------------------------------------------------------
   74  // The lowdown: what the agents did since the person was last here.
   75  
   76  /** One kind of thing done or received, with the names it touched. */
   77  export type ActivityCount = {
   78    readonly n: number;
   79    /** The other side's names, newest first, at most a few. */
   80    readonly names: readonly string[];
   81  };
   82  
   83  /**
   84   * What was recorded since their last visit. A field that could not be read
   85   * is absent and says nothing; it is never read as zero.
   86   */
   87  export type ArrivalActivity = {
   88    /** Messages Q sent for them. */
   89    readonly sent?: ActivityCount | undefined;
   90    /** Meetings Q set up. */
   91    readonly booked?: ActivityCount | undefined;
   92    /** Interest Q expressed on their behalf. */
   93    readonly interest?: ActivityCount | undefined;
   94    /** Messages Q drafted and held back for them to read. */
   95    readonly held?: ActivityCount | undefined;
   96    /** Replies from the other side of their relationships. */
   97    readonly replies?: ActivityCount | undefined;
   98    /** New relationships (matches, interest from the other side). */
   99    readonly matches?: ActivityCount | undefined;
  100  };
  101  
  102  export type ArrivalFacts = {
  103    readonly activity: ArrivalActivity;
  104    /** Decisions waiting on them now (approvals and held drafts). */
  105    readonly decisions: number;
  106    /** Hours since their last visit; null when this is the first one known. */
  107    readonly hoursAway: number | null;
  108  };
  109  
  110  export type Lowdown = {
  111    /** Nothing happened and nothing waits. */
  112    readonly quiet: boolean;
  113    /** The lowdown in one to three sentences, without the greeting. */
  114    readonly text: string;
  115    /** Names and counts any spoken version must carry. */
  116    readonly mustSay: readonly string[];
  117  };
  118  
  119  const NUMBER_WORDS = [
  120    "no",
  121    "one",
  122    "two",
  123    "three",
  124    "four",
  125    "five",
  126    "six",
  127    "seven",
  128    "eight",
  129    "nine",
  130    "ten",
  131  ] as const;
  132  
  133  function count(n: number): string {
  134    return NUMBER_WORDS[n] ?? String(n);
  135  }
  136  
  137  function list(names: readonly string[]): string {
  138    if (names.length <= 1) return names[0] ?? "";
  139    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
  140  }
  141  
  142  function capitalised(text: string): string {
  143    return text.length === 0
  144      ? text
  145      : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
  146  }
  147  
  148  /** A small, stable choice: the same facts get the same words. */
  149  export function arrivalSeed(text: string): number {
  150    let hash = 2166136261;
  151    for (const char of text) {
  152      hash ^= char.codePointAt(0) ?? 0;
  153      hash = Math.imul(hash, 16777619);
  154    }
  155    return hash >>> 0;
  156  }
  157  
  158  function pick<T>(options: readonly T[], seed: number, salt = 0): T {
  159    const chosen = options[(seed + salt * 7919) % options.length];
  160    if (chosen === undefined) throw new Error("pick from an empty list");
  161    return chosen;
  162  }
  163  
  164  /** Named when one or two, counted otherwise. */
  165  function who(item: ActivityCount, one: string, many: string): string {
  166    const names = item.names.slice(0, 2);
  167    if (item.n <= 2 && names.length === item.n) return list(names);
  168    return item.n === 1 ? one : `${count(item.n)} ${many}`;
  169  }
  170  
  171  function did(activity: ArrivalActivity): string[] {
  172    const parts: string[] = [];
  173    const sent = activity.sent;
  174    if (sent !== undefined && sent.n > 0) {
  175      const names = sent.names.slice(0, 2);
  176      parts.push(
  177        sent.n <= 2 && names.length === sent.n
  178          ? `replied to ${list(names)}`
  179          : `sent ${count(sent.n)} ${sent.n === 1 ? "message" : "messages"}`,
  180      );
  181    }
  182    const booked = activity.booked;
  183    if (booked !== undefined && booked.n > 0) {
  184      const names = booked.names.slice(0, 2);
  185      parts.push(
  186        booked.n === 1 && names.length === 1
  187          ? `booked your call with ${names[0] ?? ""}`
  188          : `set up ${count(booked.n)} ${booked.n === 1 ? "meeting" : "meetings"}`,
  189      );
  190    }
  191    const interest = activity.interest;
  192    if (interest !== undefined && interest.n > 0) {
  193      parts.push(
  194        `expressed interest in ${who(interest, "one company", "companies")}`,
  195      );
  196    }
  197    return parts;
  198  }
  199  
  200  function news(activity: ArrivalActivity): string[] {
  201    const parts: string[] = [];
  202    const replies = activity.replies;
  203    if (replies !== undefined && replies.n > 0) {
  204      parts.push(
  205        `${who(replies, "someone", "people")} wrote back`.replace(
  206          /^someone wrote back$/u,
  207          "you have a new reply",
  208        ),
  209      );
  210    }
  211    const matches = activity.matches;
  212    if (matches !== undefined && matches.n > 0) {
  213      parts.push(
  214        matches.n === 1
  215          ? matches.names[0] === undefined
  216            ? "there's a new match"
  217            : `${matches.names[0]} is a new match`
  218          : `${count(matches.n)} new matches came in`,
  219      );
  220    }
  221    const held = activity.held;
  222    if (held !== undefined && held.n > 0) {
  223      const names = held.names.slice(0, 1);
  224      parts.push(
  225        held.n === 1 && names.length === 1
  226          ? `I held back a message to ${names[0] ?? ""} for you to read`
  227          : `I held back ${count(held.n)} messages for you to read`,
  228      );
  229    }
  230    return parts;
  231  }
  232  
  233  function needs(decisions: number, seed: number): string | null {
  234    if (decisions <= 0) return null;
  235    if (decisions === 1) {
  236      return pick(["one thing needs you", "there's one thing for you"], seed, 3);
  237    }
  238    return pick(
  239      [
  240        `${count(decisions)} things need you`,
  241        `there are ${count(decisions)} things for you`,
  242      ],
  243      seed,
  244      3,
  245    );
  246  }
  247  
  248  /**
  249   * The lowdown, from recorded facts: what Q did, what came in, and how many
  250   * decisions wait. Quiet when nothing happened and nothing waits.
  251   */
  252  export function lowdownOf(facts: ArrivalFacts): Lowdown {
  253    const seed = arrivalSeed(JSON.stringify(facts));
  254    const doneParts = did(facts.activity);
  255    const newsParts = news(facts.activity);
  256    const waits = needs(facts.decisions, seed);
  257    const mustSay = [
  258      ...(facts.activity.sent?.names ?? []).slice(0, 2),
  259      ...(facts.activity.booked?.names ?? []).slice(0, 1),
  260      ...(facts.activity.replies?.names ?? []).slice(0, 2),
  261    ];
  262    if (doneParts.length === 0 && newsParts.length === 0 && waits === null) {
  263      const away = facts.hoursAway !== null && facts.hoursAway >= 20;
  264      return {
  265        quiet: true,
  266        text: away
  267          ? pick(
  268              [
  269                "Quiet while you were away; nothing needs you.",
  270                "Nothing came in while you were away, and nothing needs you.",
  271              ],
  272              seed,
  273            )
  274          : pick(
  275              ["Quiet day, nothing needs you.", "All quiet; nothing needs you."],
  276              seed,
  277            ),
  278        mustSay: [],
  279      };
  280    }
  281    const since =
  282      facts.hoursAway === null
  283        ? null
  284        : facts.hoursAway >= 20
  285          ? pick(["While you were away,", "Since you were last in,"], seed, 1)
  286          : pick(["Since you were last here,", "Since earlier,"], seed, 1);
  287    const sentences: string[] = [];
  288    if (doneParts.length > 0) {
```

# Evidence: packages/q-core/src/speech/arrival.ts (lines 289-427)

- Original path: `packages/q-core/src/speech/arrival.ts`
- Line range: 289-427 (HEAD 520bd123)
- Why included: summaryOfCards/cardLine/cardFactsForVoice: card gists from facts only.

```
  289      const what = `I ${list(doneParts)}`;
  290      sentences.push(since === null ? `${what}.` : `${since} ${what}.`);
  291    }
  292    const tail = [...newsParts];
  293    if (waits !== null) tail.push(waits);
  294    if (tail.length > 0) {
  295      // "Halyard wrote back, and three things need you."
  296      const joined =
  297        tail.length === 1
  298          ? (tail[0] ?? "")
  299          : `${tail.slice(0, -1).join(", ")}, and ${tail[tail.length - 1] ?? ""}`;
  300      sentences.push(
  301        `${doneParts.length === 0 && since !== null ? `${since} ${joined}` : capitalised(joined)}.`,
  302      );
  303    }
  304    return { quiet: false, text: sentences.join(" "), mustSay };
  305  }
  306  
  307  // ---------------------------------------------------------------------------
  308  // One decision card, as Q puts it to the person.
  309  
  310  export type DecisionCardFacts = {
  311    /** Approval or a draft Q held back. */
  312    readonly kind: "APPROVAL" | "HELD";
  313    /** The other side's name, when known. */
  314    readonly counterpart: string | null;
  315    /** Their latest words, when they wrote last. */
  316    readonly theySaid: string | null;
  317    /** The exact message Q would send; null when the card is not a message. */
  318    readonly message: string | null;
  319    /** The card's own plain-language summary. */
  320    readonly summary: string;
  321  };
  322  
  323  /** The first sentence, clipped to about twenty words. */
  324  export function gistOf(text: string, maxWords = 20): string {
  325    const flat = text.replace(/\s+/gu, " ").trim();
  326    const first = /^(.+?[.!?])(?:\s|$)/u.exec(flat)?.[1] ?? flat;
  327    const words = first.split(" ");
  328    return words.length <= maxWords
  329      ? first
  330      : `${words.slice(0, maxWords).join(" ")}…`;
  331  }
  332  
  333  const COUNT_WORDS = [
  334    "",
  335    "One thing",
  336    "Two things",
  337    "Three things",
  338    "Four things",
  339    "Five things",
  340    "Six things",
  341  ] as const;
  342  
  343  const WEEKDAY =
  344    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|this week|next week)\b/iu;
  345  const MEETING =
  346    /\b(call|meet|meeting|chat|catch up|catch-up|zoom|coffee|\d+ ?min(?:ute)?s)\b/iu;
  347  const DECK = /\b(deck|pitch deck|attached|attachment|data ?room|one-pager)\b/iu;
  348  
  349  /** One card in a few words, from its facts alone (never invented). */
  350  function cardGist(card: DecisionCardFacts): string {
  351    const name = card.counterpart ?? "someone";
  352    if (card.kind === "HELD") return `the ${name} reply is held`;
  353    if (card.message === null) {
  354      const gist = gistOf(card.summary, 10).replace(/[.!?]$/u, "");
  355      return `${gist.charAt(0).toLowerCase()}${gist.slice(1)}`;
  356    }
  357    const said = card.theySaid ?? "";
  358    if (MEETING.test(said)) {
  359      const day = WEEKDAY.exec(said)?.[1];
  360      if (day === undefined) return `${name} wants a call`;
  361      const lower = day.toLowerCase();
  362      const when =
  363        lower.startsWith("this ") || lower.startsWith("next ")
  364          ? lower
  365          : lower === "today" || lower === "tomorrow"
  366            ? lower
  367            : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
  368      return `${name} wants a call ${when}`;
  369    }
  370    if (DECK.test(said)) return `${name} sent their deck`;
  371    if (said.length > 0) return `${name} wrote back`;
  372    return `a message to ${name} is ready`;
  373  }
  374  
  375  /**
  376   * Every pending card in one sentence, up front (Zino, 2026-10-08: "Q
  377   * actually gives a summary of all the cards"): "Three things: the Spheros
  378   * reply is held, Tensorgate wants a call Thursday, and Clearwater sent
  379   * their deck." Null with no cards.
  380   */
  381  export function summaryOfCards(
  382    cards: readonly DecisionCardFacts[],
  383  ): string | null {
  384    if (cards.length === 0) return null;
  385    const parts = cards.map(cardGist);
  386    const count = COUNT_WORDS[cards.length] ?? `${String(cards.length)} things`;
  387    const list =
  388      parts.length === 1
  389        ? (parts[0] ?? "")
  390        : parts.length === 2
  391          ? `${parts[0] ?? ""} and ${parts[1] ?? ""}`
  392          : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1) ?? ""}`;
  393    return `${count}: ${list}.`;
  394  }
  395  
  396  const ORDINALS = ["First", "Next", "Then", "After that"] as const;
  397  
  398  /**
  399   * What Q says to put one card to the person, and asks; one question, then
  400   * stop. `position` is 1-based.
  401   */
  402  export function cardLine(
  403    card: DecisionCardFacts,
  404    position: number,
  405    total: number,
  406  ): string {
  407    const seed = arrivalSeed(`${card.summary}|${String(position)}`);
  408    const lead =
  409      total <= 1
  410        ? ""
  411        : position === 1
  412          ? "First, "
  413          : position === total
  414            ? "Last one: "
  415            : `${pick(ORDINALS.slice(1), seed)}, `;
  416    const name = card.counterpart ?? "them";
  417    if (card.kind === "HELD") {
  418      return `${lead}I held back a message to ${name}. It's on screen; send it as it is, change it, or drop it?`;
  419    }
  420    if (card.message === null) {
  421      return `${lead}${gistOf(card.summary)} Shall I go ahead?`.replace(
  422        /\.\s+Shall/u,
  423        ". Shall",
  424      );
  425    }
  426    const said =
  427      card.theySaid === null
```

