# Evidence: packages/q-specialists/src/answer.ts (lines 193-305)

- Original path: `packages/q-specialists/src/answer.ts`
- Line range: 193-305 (HEAD 9177629d)
- Why included: Turn reader input: last 6 recent turns (5 + reference note), modality from utteranceRef.

```ts
  193  /** An action the reader is told of; `available: false` is declared but not offered here. */
  194  type ReaderAction = {
  195    readonly name: string;
  196    readonly does: string;
  197    readonly available?: boolean | undefined;
  198    /** v32: a few words, and the area it is grouped under. */
  199    readonly short?: string | undefined;
  200    readonly area?: string | undefined;
  201  };
  202
  203  /** The reader's input: the person's own latest words and own recent turns. */
  204  /** A name without its parenthetical ("Savanna Seed Partners (fictional)"). */
  205  function bareName(text: string): string {
  206    return text
  207      .replace(/\([^)]*\)/gu, " ")
  208      .toLowerCase()
  209      .replace(/[^\p{L}\p{N}]+/gu, " ")
  210      .trim();
  211  }
  212
  213  /**
  214   * Whether the words name this counterpart: the whole name, parentheticals
  215   * dropped on both sides, or a run of as many words heard slightly wrong
  216   * ("Ledgefold" for Ledgerfold), by the shared name matcher.
  217   */
  218  export function namedInWords(utterance: string, name: string): boolean {
  219    const wanted = bareName(name);
  220    if (wanted.length < 3) return false;
  221    const said = bareName(utterance);
  222    if (` ${said} `.includes(` ${wanted} `)) return true;
  223    const words = said.split(" ").filter((word) => word.length > 0);
  224    const size = wanted.split(" ").length;
  225    for (let start = 0; start + size <= words.length; start += 1) {
  226      const window = words.slice(start, start + size).join(" ");
  227      if (
  228        window.length >= 4 &&
  229        closestByName([wanted], window, (n) => n).length > 0
  230      ) {
  231        return true;
  232      }
  233    }
  234    return false;
  235  }
  236
  237  /** Two summaries of one card: the same words, ignoring case and the full stop. */
  238  function sameCard(a: string, b: string): boolean {
  239    const plain = (text: string) =>
  240      text
  241        .trim()
  242        .replace(/[.\s]+$/u, "")
  243        .toLowerCase();
  244    return plain(a) === plain(b);
  245  }
  246
  247  function turnReaderInput(
  248    history: readonly QConversationMessage[],
  249    latest: QConversationMessage,
  250    actions: readonly ReaderAction[],
  251    context: {
  252      readonly tenantId: string;
  253      readonly userId: string;
  254      readonly correlationId: string;
  255      readonly signal?: AbortSignal | undefined;
  256    },
  257    /**
  258     * Capital Q's own note of what was shown and the last action (follow-55),
  259     * read as the last recent turn so "that one" and "try again" bind.
  260     */
  261    note: string | null = null,
  262  ) {
  263    // Spoken turns carry the recogniser's utterance; typed ones never do.
  264    // The reader needs to know which: only speech can be overheard.
  265    const spoken = latest.utteranceRef !== undefined;
  266    return {
  267      utterance: latest.content,
  268      actions,
  269      recentTurns: [
  270        ...history
  271          .filter((m) => m.id !== latest.id)
  272          .slice(note === null ? -6 : -5)
  273          .map((m) => ({
  274            role: m.role === "USER" ? ("USER" as const) : ("Q" as const),
  275            text: m.content,
  276          })),
  277        ...(note === null ? [] : [{ role: "Q" as const, text: note }]),
  278      ],
  279      modality: spoken ? ("VOICE" as const) : ("TEXT" as const),
  280      attribution: {
  281        tenantId: context.tenantId,
  282        userId: context.userId,
  283        correlationId: context.correlationId,
  284      },
  285      signal: context.signal,
  286    };
  287  }
  288
  289  /** The capability's reader label and area (v32), when it has them. */
  290  const labelOf = (capability: QCapability) => ({
  291    ...(capability.short === undefined ? {} : { short: capability.short }),
  292    ...(capability.area === undefined ? {} : { area: capability.area }),
  293  });
  294
  295  const actionsKey = (actions: readonly ReaderAction[]): string =>
  296    JSON.stringify(
  297      actions.map((a) => ({
  298        name: a.name,
  299        does: a.does,
  300        ...(a.available === false ? { available: false } : {}),
  301        ...(a.short === undefined ? {} : { short: a.short }),
  302        ...(a.area === undefined ? {} : { area: a.area }),
  303      })),
  304    );
  305
```
