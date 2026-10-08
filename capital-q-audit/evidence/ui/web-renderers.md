# Evidence: apps/web/src/features/q/q-answer.tsx (lines 17-206)

- Original path: `apps/web/src/features/q/q-answer.tsx`
- Line range: 17-206 (HEAD 520bd123)
- Why included: QAnswer: which blocks render inline, behind chips, or on the stage.

```
   17  /**
   18   * One Q reply as a chat row (founder direction A, 2026-09-28; ADR 0018).
   19   *
   20   * The answer reads first, as structure when it is structured (lists,
   21   * tables, callouts; `QMarkdown`). What the answer produced stays inline
   22   * and compact: a document Q made, a comparison, a question back, a place
   23   * to go. What it rests on is behind small chips under it -- Sources, the
   24   * companies or investors it referred to -- which open in place. Collapsed
   25   * is not removed: every panel is rendered, hidden, so what the server sent
   26   * is all on the page. Nothing here invents a percentage or a verdict.
   27   */
   28
   29  type Panel = "sources" | "companies" | "investors";
   30
   31  /** What stays in view, and what sits behind a chip. */
   32  export function replyParts(blocks: readonly QTurnObjectBlock[]): {
   33    readonly inline: readonly QTurnObjectBlock[];
   34    readonly companies: readonly QTurnObjectBlock[];
   35    readonly investors: readonly QTurnObjectBlock[];
   36  } {
   37    const inline: QTurnObjectBlock[] = [];
   38    const companies: QTurnObjectBlock[] = [];
   39    const investors: QTurnObjectBlock[] = [];
   40    for (const block of blocks) {
   41      switch (block.kind) {
   42        case "COMPANY_REFERENCE":
   43          companies.push(block);
   44          break;
   45        case "INVESTOR_REFERENCE":
   46          investors.push(block);
   47          break;
   48        case "ACTION_PROPOSAL":
   49          // Shown once, where it is decided (the approval, exact payload).
   50          break;
   51        case "ARTIFACT_REFERENCE":
   52        case "UI_INTENT":
   53        case "COMPARISON":
   54        case "COMPARISON_CARDS":
   55        case "CLARIFICATION_REQUEST":
   56          // What the answer produced or needs from the person: in view.
   57          inline.push(block);
   58          break;
   59        case "ANSWER_CARDS":
   60          // Laid out on the stage over the presence, not repeated inline.
   61          break;
   62      }
   63    }
   64    return { inline, companies, investors };
   65  }
   66
   67  function counted(one: string, many: string, n: number): string {
   68    return `${n === 1 ? one : many} · ${String(n)}`;
   69  }
   70
   71  export function QAnswer({
   72    turn,
   73    onAsk,
   74    onOpenArtifact,
   75    mark = true,
   76  }: {
   77    readonly turn: Extract<QTurn, { kind: "Q" }>;
   78    /** Continue in this thread from something Q referred to (QX-001 §9). */
   79    readonly onAsk?: ((question: string) => void) | undefined;
   80    readonly onOpenArtifact?: ((artifactId: string) => void) | undefined;
   81    /** False in a thread, where the row itself says who is speaking. */
   82    readonly mark?: boolean | undefined;
   83  }) {
   84    const id = useId();
   85    const [open, setOpen] = useState<Panel | null>(null);
   86    const { inline, companies, investors } = replyParts(turn.blocks);
   87    const sources = evidenceSummary(turn, false);
   88
   89    const chips: { key: Panel; label: string }[] = [];
   90    if (sources !== null) {
   91      chips.push({
   92        key: "sources",
   93        label: sources.label === "" ? "Sources" : `Sources · ${sources.label}`,
   94      });
   95    }
   96    if (companies.length > 0) {
   97      chips.push({
   98        key: "companies",
   99        label: counted("Company", "Companies", companies.length),
  100      });
  101    }
  102    if (investors.length > 0) {
  103      chips.push({
  104        key: "investors",
  105        label: counted("Investor", "Investors", investors.length),
  106      });
  107    }
  108
  109    return (
  110      <div
  111        className="cq-q-answer flex w-full max-w-(--cq-layout-reading) flex-col gap-3"
  112        data-q-answer={turn.streaming ? "streaming" : "settled"}
  113      >
  114        {mark ? (
  115          <QMark size="sm" state={turn.streaming ? "WORKING" : "IDLE"} />
  116        ) : null}
  117        {turn.text.length > 0 ? (
  118          <QMarkdown
  119            text={turn.text}
  120            streaming={turn.streaming}
  121            className="cq-body text-(--cq-text-primary)"
  122          />
  123        ) : null}
  124        {inline.length > 0 ? (
  125          <QResultBlocks
  126            blocks={inline}
  127            onAsk={onAsk}
  128            onOpenArtifact={onOpenArtifact}
  129          />
  130        ) : null}
  131        {/* DOCS: any substantive answer, as a PDF. */}
  132        {!turn.streaming &&
  133        turn.runId !== undefined &&
  134        turn.text.length >= ANSWER_PDF_MIN_CHARS ? (
  135          <AnswerPdf runId={turn.runId} messageId={turn.id} />
  136        ) : null}
  137        {chips.length > 0 ? (
  138          <div className="flex flex-col gap-2">
  139            <div
  140              className="flex flex-wrap gap-2"
  141              role="group"
  142              aria-label="About this answer"
  143              data-q-chips
  144            >
  145              {chips.map((chip) => (
  146                <button
  147                  key={chip.key}
  148                  type="button"
  149                  className="cq-q-chip"
  150                  aria-expanded={open === chip.key}
  151                  aria-controls={`${id}-${chip.key}`}
  152                  onClick={() => {
  153                    setOpen((current) =>
  154                      current === chip.key ? null : chip.key,
  155                    );
  156                  }}
  157                  data-q-chip={chip.key}
  158                >
  159                  {chip.label}
  160                  <ChevronDown
  161                    aria-hidden="true"
  162                    className="cq-q-chip-caret"
  163                    size={ICON_SIZE.compact}
  164                    strokeWidth={ICON_STROKE}
  165                  />
  166                </button>
  167              ))}
  168            </div>
  169            {sources !== null ? (
  170              <div
  171                id={`${id}-sources`}
  172                hidden={open !== "sources"}
  173                data-q-evidence
  174                data-q-panel="sources"
  175              >
  176                <QEvidenceBody
  177                  turn={turn}
  178                  onAsk={onAsk}
  179                  onOpenArtifact={onOpenArtifact}
  180                  includeBlocks={false}
  181                />
  182              </div>
  183            ) : null}
  184            {companies.length > 0 ? (
  185              <div
  186                id={`${id}-companies`}
  187                hidden={open !== "companies"}
  188                data-q-panel="companies"
  189              >
  190                <QResultBlocks blocks={companies} onAsk={onAsk} />
  191              </div>
  192            ) : null}
  193            {investors.length > 0 ? (
  194              <div
  195                id={`${id}-investors`}
  196                hidden={open !== "investors"}
  197                data-q-panel="investors"
  198              >
  199                <QResultBlocks blocks={investors} onAsk={onAsk} />
  200              </div>
  201            ) : null}
  202          </div>
  203        ) : null}
  204      </div>
  205    );
  206  }
```

# Evidence: apps/web/src/features/q/q-result-blocks.tsx (lines 286-622)

- Original path: `apps/web/src/features/q/q-result-blocks.tsx`
- Line range: 286-622 (HEAD 520bd123)
- Why included: QResultBlocks renderer: INVESTOR_REFERENCE has no name and no link; COMPARISON columns labelled 'Company 1/2'; ACTION_PROPOSAL display-only.

```
  286    CAPITAL_RAISE: "Open Raise & rounds",
  287    CAPITAL_READINESS: "Open your readiness",
  288    CAPITAL_ACTION_PLAN: "Open your action plan",
  289    CAPITAL_PLAN: "Open your 12-month plan",
  290    CAPITAL_INVESTORS: "Open your investors on Capital",
  291  };
  292
  293  function subjectLabel(subject: QSubjectRef): string {
  294    switch (subject.kind) {
  295      case "COMPANY":
  296        return "Company";
  297      case "INVESTOR_ORGANISATION":
  298        return "Investor";
  299      case "RELATIONSHIP":
  300        return "Relationship";
  301      case "CAPITAL_OBJECTIVE":
  302        return "Raise";
  303      case "DOCUMENT":
  304        return "Document";
  305      case "USER":
  306        return "Person";
  307      case "ORGANISATION":
  308        return "Organisation";
  309    }
  310  }
  311
  312  /**
  313   * The shell every result object sits in.
  314   *
  315   * One border, one heading, one row of actions. QX-003 extends this for
  316   * generated artifacts rather than inventing a second card language beside
  317   * it, which is the whole reason it is a named component and not a div
  318   * repeated five times below.
  319   */
  320  export function QResultCard({
  321    label,
  322    title,
  323    children,
  324    actions,
  325  }: {
  326    readonly label: string;
  327    readonly title?: string | undefined;
  328    readonly children?: React.ReactNode;
  329    readonly actions?: React.ReactNode;
  330  }) {
  331    return (
  332      <section
  333        className="flex flex-col gap-3 rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
  334        data-q-result-card
  335      >
  336        <div className="flex flex-col gap-1">
  337          <span className="cq-label text-(--cq-text-tertiary)">{label}</span>
  338          {title === undefined ? null : (
  339            <p className="cq-body font-medium text-(--cq-text-primary)">
  340              {title}
  341            </p>
  342          )}
  343        </div>
  344        {children}
  345        {actions === undefined ? null : (
  346          <div className="flex flex-wrap gap-2">{actions}</div>
  347        )}
  348      </section>
  349    );
  350  }
  351
  352  export type QResultBlocksProps = {
  353    readonly blocks: readonly QTurnObjectBlock[];
  354    /** Ask Q something about one of these objects, in the same thread. */
  355    readonly onAsk?: ((question: string) => void) | undefined;
  356    /** Open what Q composed. Absent on a surface with no viewer. */
  357    readonly onOpenArtifact?: ((artifactId: string) => void) | undefined;
  358  };
  359
  360  export function QResultBlocks({
  361    blocks,
  362    onAsk,
  363    onOpenArtifact,
  364  }: QResultBlocksProps) {
  365    // W7: drawn again once the wire's contracts are in (safeWebsite).
  366    useWire();
  367    // Prose, findings, uncertainties and the source count are the answer's
  368    // own; an evidence identifier never reaches this component at all. What
  369    // arrives here is the part a person can act on.
  370    if (blocks.length === 0) {
  371      return null;
  372    }
  373
  374    return (
  375      <div className="flex flex-col gap-3" data-q-result-blocks>
  376        {blocks.map((block, index) => {
  377          const key = `${block.kind}-${String(index)}`;
  378          switch (block.kind) {
  379            case "COMPANY_REFERENCE":
  380              // The company page authorises the read as this person; a
  381              // company they may not see is its plain not-found.
  382              return (
  383                <QResultCard
  384                  key={key}
  385                  label="Company"
  386                  actions={
  387                    <>
  388                      <Link
  389                        href={recordPagePath("COMPANY", block.companyId)}
  390                        className={buttonClassName("secondary", "compact")}
  391                      >
  392                        Open the company
  393                      </Link>
  394                      {onAsk === undefined ? null : (
  395                        <button
  396                          type="button"
  397                          className={buttonClassName("quiet", "compact")}
  398                          onClick={() => {
  399                            onAsk("Tell me more about that company.");
  400                          }}
  401                        >
  402                          Ask Q about it
  403                        </button>
  404                      )}
  405                    </>
  406                  }
  407                >
  408                  {/* The company's picture through its gated photo route;
  409                      the block names no one, so the frame stays unlabelled. */}
  410                  <CompanyAvatar companyId={block.companyId} size={40} />
  411                </QResultCard>
  412              );
  413
  414            case "INVESTOR_REFERENCE":
  415              return (
  416                <QResultCard
  417                  key={key}
  418                  label="Investor"
  419                  actions={
  420                    onAsk === undefined ? undefined : (
  421                      <button
  422                        type="button"
  423                        className={buttonClassName("quiet", "compact")}
  424                        onClick={() => {
  425                          onAsk("Tell me more about that investor.");
  426                        }}
  427                      >
  428                        Ask Q about them
  429                      </button>
  430                    )
  431                  }
  432                >
  433                  {/* The investor's logo through its gated photo route, which
  434                      answers only where this reader may see their name. */}
  435                  <EntityAvatar
  436                    kind="investor"
  437                    name="Investor"
  438                    investorOrganisationId={block.investorOrganisationId}
  439                    size={40}
  440                    decorative
  441                  />
  442                </QResultCard>
  443              );
  444
  445            case "COMPARISON_CARDS":
  446              return <ComparisonCards key={key} block={block} onAsk={onAsk} />;
  447
  448            case "ANSWER_CARDS":
  449              // In the thread and on the Board: the overview, every card
  450              // with its first reason; tapping one opens it.
  451              return <StaticAnswerCards key={key} block={block} onAsk={onAsk} />;
  452
  453            case "COMPARISON":
  454              return (
  455                <QResultCard key={key} label="Side by side">
  456                  <div className="overflow-x-auto">
  457                    <table className="w-full border-collapse text-left">
  458                      <thead>
  459                        <tr>
  460                          <th className="cq-label px-0 py-2 pr-4 text-(--cq-text-tertiary)">
  461                            <span className="sr-only">Attribute</span>
  462                          </th>
  463                          {block.subjects.map((subject, column) => (
  464                            <th
  465                              key={`${subject.kind}-${String(column)}`}
  466                              scope="col"
  467                              className="cq-label px-4 py-2 text-(--cq-text-tertiary)"
  468                            >
  469                              {subjectLabel(subject)} {column + 1}
  470                            </th>
  471                          ))}
  472                        </tr>
  473                      </thead>
  474                      <tbody>
  475                        {block.rows.map((row) => (
  476                          <tr
  477                            key={row.label}
  478                            className="border-t border-(--cq-border-subtle)"
  479                          >
  480                            <th
  481                              scope="row"
  482                              className="cq-body-sm px-0 py-2 pr-4 font-normal text-(--cq-text-secondary)"
  483                            >
  484                              {row.label}
  485                            </th>
  486                            {row.values.map((value, column) => (
  487                              <td
  488                                key={`${row.label}-${String(column)}`}
  489                                className="cq-body-sm px-4 py-2 text-(--cq-text-primary)"
  490                              >
  491                                {/* An empty cell is how the contract says
  492                                    "unknown". Never a zero, never a dash
  493                                    that could be read as one. */}
  494                                {value === "" ? (
  495                                  <span className="text-(--cq-text-tertiary)">
  496                                    Not known
  497                                  </span>
  498                                ) : (
  499                                  value
  500                                )}
  501                              </td>
  502                            ))}
  503                          </tr>
  504                        ))}
  505                      </tbody>
  506                    </table>
  507                  </div>
  508                </QResultCard>
  509              );
  510
  511            case "CLARIFICATION_REQUEST":
  512              return (
  513                <QResultCard
  514                  key={key}
  515                  label="Q needs to know"
  516                  title={block.question}
  517                  actions={
  518                    block.options === undefined ||
  519                    onAsk === undefined ? undefined : (
  520                      <>
  521                        {block.options.map((option) => (
  522                          <button
  523                            key={option}
  524                            type="button"
  525                            className={buttonClassName("secondary", "compact")}
  526                            onClick={() => {
  527                              onAsk(option);
  528                            }}
  529                          >
  530                            {option}
  531                          </button>
  532                        ))}
  533                      </>
  534                    )
  535                  }
  536                />
  537              );
  538
  539            case "ACTION_PROPOSAL":
  540              // Shown, never actioned from here. Approval binds to the exact
  541              // payload and lives on the approval control the conversation
  542              // already renders; a second Approve button beside it would be
  543              // a second place to say yes.
  544              return (
  545                <QResultCard
  546                  key={key}
  547                  label="Q has prepared something"
  548                  title={block.proposal.summary}
  549                >
  550                  <p className="cq-body-sm text-(--cq-text-secondary)">
  551                    Nothing happens until you approve it below.
  552                  </p>
  553                </QResultCard>
  554              );
  555
  556            case "ARTIFACT_REFERENCE":
  557              // Something Q composed (QX-003E, R36): one card language for
  558              // the answer and the Board. Older versions stay in the viewer.
  559              return (
  560                <ArtifactCard
  561                  key={key}
  562                  block={block}
  563                  onOpen={onOpenArtifact}
  564                  onAsk={onAsk}
  565                />
  566              );
  567
  568            case "UI_INTENT": {
  569              // Q room R5: suggested times and the connect card, in the room.
  570              if (block.intent.kind === "SHOW_CALENDAR_CONNECT") {
  571                return <CalendarConnectCard key={key} intent={block.intent} />;
  572              }
  573              // Their own website, opened in a new tab as the answer arrived;
  574              // the link stays for a browser that blocked the automatic open.
  575              const website = safeWebsite(block.intent);
  576              if (website !== null) {
  577                return (
  578                  <QResultCard
  579                    key={key}
  580                    label="Your website"
  581                    actions={
  582                      <a
  583                        href={website}
  584                        target="_blank"
  585                        rel="noopener noreferrer"
  586                        className={buttonClassName("secondary", "compact")}
  587                      >
  588                        Open {new URL(website).hostname}
  589                      </a>
  590                    }
  591                  />
  592                );
  593              }
  594              const href = intentHref(block.intent);
  595              // Ignored rather than guessed, exactly as a spoken
  596              // destination with no route is.
  597              if (href === null) {
  598                return null;
  599              }
  600              return (
  601                <QResultCard
  602                  key={key}
  603                  label="Where this lives"
  604                  actions={
  605                    <Link
  606                      href={href}
  607                      className={buttonClassName("secondary", "compact")}
  608                    >
  609                      {intentLabel(block.intent)}
  610                    </Link>
  611                  }
  612                />
  613              );
  614            }
  615
  616            default:
  617              return null;
  618          }
  619        })}
  620      </div>
  621    );
  622  }
```

# Evidence: apps/web/src/features/q/markdown.tsx (lines 14-38)

- Original path: `apps/web/src/features/q/markdown.tsx`
- Line range: 14-38 (HEAD 520bd123)
- Why included: Custom safe Markdown subset renderer (no library, no HTML).

```
   14  /**
   15   * Q's answer text as structure (founder direction D, 2026-09-28).
   16   *
   17   * The answer model writes a small Markdown subset: headings, bullet and
   18   * numbered lists, tables, bold, italics, inline code, links and quoted
   19   * callouts. This renders that subset and nothing else, and it is safe by
   20   * construction rather than by sanitising: the source is parsed into a
   21   * handful of block and inline kinds and every character reaches the page
   22   * as a React text node. Raw HTML is never interpreted (a `<script>` in an
   23   * answer is shown as the characters it is), there is no
   24   * `dangerouslySetInnerHTML`, and a link is kept only when its target is an
   25   * absolute http(s) URL -- anything else (`javascript:`, `data:`, relative
   26   * paths) keeps its visible words and loses the link.
   27   *
   28   * It is written for text that is still arriving. It is re-parsed on every
   29   * delta (answers are short, the parse is linear), and while `streaming` a
   30   * half-written construct renders as what it is becoming rather than as
   31   * stray syntax: an unclosed `**` is already bold, a link whose target has
   32   * not arrived shows its words, and table rows wait for the header's
   33   * separator line instead of flashing as pipes.
   34   *
   35   * Why not a Markdown library: the subset is small, the output must never
   36   * contain HTML, and a hand-rolled parser keeps the dependency tree and
   37   * the bundle unchanged.
   38   */
```
