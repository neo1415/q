# Evidence: packages/contracts/src/q/result-block.ts (lines 1-309)

- Original path: `packages/contracts/src/q/result-block.ts`
- Line range: 1-309 (HEAD 520bd123)
- Why included: Complete: the closed QResultBlock union (14 kinds); TEXT claims no Markdown contract.

```
    1  import { z } from "zod";
    2  
    3  import { UuidSchema } from "../common/ids.js";
    4  import { QActionProposalSchema } from "./action.js";
    5  import { QAnswerCardsBlockSchema } from "./answer-cards.js";
    6  import { QArtifactStatusSchema, QArtifactTypeSchema } from "./artifact.js";
    7  import { QArtifactIdSchema } from "./ids.js";
    8  import { QUncertainConfidenceLevelSchema } from "./confidence.js";
    9  import { QEvidenceRefsSchema } from "./evidence-ref.js";
   10  import { QPublicFindingSchema } from "./finding.js";
   11  import { QSubjectRefSchema } from "./subject.js";
   12  import {
   13    Q_COMPARISON_SUBJECTS_MAX,
   14    Q_COMPARISON_SUBJECTS_MIN,
   15    QUiIntentSchema,
   16  } from "./ui-intent.js";
   17  
   18  /**
   19   * What Q returns: a bounded sequence of typed blocks, not one text blob
   20   * (doc 12 §44, §70; doc 22 §192).
   21   *
   22   * A block describes renderable meaning. It is never markup, never a
   23   * component, never code. TEXT is plain text: no HTML, no Markdown contract
   24   * (no sanitising renderer exists yet, so none is promised), and a `<script>`
   25   * inside it is characters a client escapes like any other. Structured
   26   * meaning -- a company, a comparison, evidence, a finding, an action, a
   27   * navigation suggestion -- has its own kind with identifier or enum
   28   * parameters, so a client renders from types rather than parsing prose.
   29   *
   30   * Blocks carry references, not objects. A COMPANY_REFERENCE is an id the
   31   * client resolves under its own permissions; embedding the company here
   32   * would turn every Q response into a second, unguarded projection of the
   33   * company record.
   34   *
   35   * The union is closed and exhaustively discriminated. It evolves additively.
   36   */
   37  export const Q_RESULT_BLOCK_KINDS = [
   38    "TEXT",
   39    "COMPANY_REFERENCE",
   40    "INVESTOR_REFERENCE",
   41    "COMPARISON",
   42    "COMPARISON_CARDS",
   43    "ANSWER_CARDS",
   44    "EVIDENCE",
   45    "FINDING",
   46    "UNCERTAINTY",
   47    "CLARIFICATION_REQUEST",
   48    "ACTION_PROPOSAL",
   49    "ARTIFACT_REFERENCE",
   50    "UI_INTENT",
   51    "PUBLIC_SOURCE",
   52  ] as const;
   53  
   54  export type QResultBlockKind = (typeof Q_RESULT_BLOCK_KINDS)[number];
   55  
   56  export const QResultBlockKindSchema = z.enum(Q_RESULT_BLOCK_KINDS);
   57  
   58  export const Q_TEXT_BLOCK_MAX_LENGTH = 16_000;
   59  
   60  export const QTextBlockSchema = z
   61    .object({
   62      kind: z.literal("TEXT"),
   63      text: z.string().min(1).max(Q_TEXT_BLOCK_MAX_LENGTH),
   64    })
   65    .strict();
   66  
   67  export const QCompanyReferenceBlockSchema = z
   68    .object({ kind: z.literal("COMPANY_REFERENCE"), companyId: UuidSchema })
   69    .strict();
   70  
   71  export const QInvestorReferenceBlockSchema = z
   72    .object({
   73      kind: z.literal("INVESTOR_REFERENCE"),
   74      investorOrganisationId: UuidSchema,
   75    })
   76    .strict();
   77  
   78  export const Q_COMPARISON_ROWS_MAX = 30;
   79  export const Q_COMPARISON_LABEL_MAX_LENGTH = 120;
   80  export const Q_COMPARISON_VALUE_MAX_LENGTH = 500;
   81  
   82  /**
   83   * Subjects side by side across labelled rows. Every row has exactly one
   84   * plain-text value per subject, in subject order, so a client can lay the
   85   * grid out without interpreting anything. "Unknown" is a legitimate value;
   86   * an empty string is how a cell says so.
   87   */
   88  export const QComparisonBlockSchema = z
   89    .object({
   90      kind: z.literal("COMPARISON"),
   91      subjects: z
   92        .array(QSubjectRefSchema)
   93        .min(Q_COMPARISON_SUBJECTS_MIN)
   94        .max(Q_COMPARISON_SUBJECTS_MAX),
   95      rows: z
   96        .array(
   97          z
   98            .object({
   99              label: z.string().trim().min(1).max(Q_COMPARISON_LABEL_MAX_LENGTH),
  100              values: z.array(z.string().max(Q_COMPARISON_VALUE_MAX_LENGTH)),
  101            })
  102            .strict(),
  103        )
  104        .max(Q_COMPARISON_ROWS_MAX),
  105    })
  106    .strict()
  107    .refine(
  108      (block) =>
  109        block.rows.every((row) => row.values.length === block.subjects.length),
  110      {
  111        message: "every row carries exactly one value per subject",
  112        path: ["rows"],
  113      },
  114    );
  115  
  116  /**
  117   * Named things side by side as cards (founder design 2026-09-28): a name,
  118   * a line under it, and the few points that matter for what was asked. The
  119   * names are the analyst's words, not resolved entities, so this is not a
  120   * COMPARISON over subject references. Never ordered, scored or ranked: the
  121   * cards are laid out in the order written and carry no verdict.
  122   */
  123  export const QComparisonCardsBlockSchema = z
  124    .object({
  125      kind: z.literal("COMPARISON_CARDS"),
  126      title: z.string().trim().max(120).nullable(),
  127      items: z
  128        .array(
  129          z
  130            .object({
  131              name: z.string().trim().min(1).max(80),
  132              subtitle: z.string().trim().max(120).nullable(),
  133              points: z.array(z.string().trim().min(1).max(160)).min(1).max(4),
  134            })
  135            .strict(),
  136        )
  137        .min(2)
  138        .max(4),
  139    })
  140    .strict();
  141  
  142  export const QEvidenceBlockSchema = z
  143    .object({
  144      kind: z.literal("EVIDENCE"),
  145      evidenceRefs: QEvidenceRefsSchema.min(1),
  146    })
  147    .strict();
  148  
  149  export const QFindingBlockSchema = z
  150    .object({ kind: z.literal("FINDING"), finding: QPublicFindingSchema })
  151    .strict();
  152  
  153  export const Q_UNCERTAINTY_STATEMENT_MAX_LENGTH = 2000;
  154  export const Q_UNCERTAINTY_MISSING_MAX = 10;
  155  export const Q_UNCERTAINTY_MISSING_ITEM_MAX_LENGTH = 200;
  156  
  157  /**
  158   * Q saying what it could not establish, and why. Confidence here can only
  159   * be an uncertain level; an uncertainty block claiming HIGH confidence would
  160   * be a contradiction the schema refuses. Absence of information is reported
  161   * as absence, never as a low score for the subject.
  162   */
  163  export const QUncertaintyBlockSchema = z
  164    .object({
  165      kind: z.literal("UNCERTAINTY"),
  166      statement: z.string().trim().min(1).max(Q_UNCERTAINTY_STATEMENT_MAX_LENGTH),
  167      confidence: QUncertainConfidenceLevelSchema,
  168      /** What would resolve it, in plain terms: "a recent bank statement". */
  169      missing: z
  170        .array(
  171          z.string().trim().min(1).max(Q_UNCERTAINTY_MISSING_ITEM_MAX_LENGTH),
  172        )
  173        .max(Q_UNCERTAINTY_MISSING_MAX)
  174        .optional(),
  175    })
  176    .strict();
  177  
  178  export const Q_CLARIFICATION_QUESTION_MAX_LENGTH = 1000;
  179  export const Q_CLARIFICATION_OPTIONS_MIN = 2;
  180  export const Q_CLARIFICATION_OPTIONS_MAX = 6;
  181  export const Q_CLARIFICATION_OPTION_MAX_LENGTH = 200;
  182  
  183  /** Q asking the person before proceeding (doc 12 §8.2; doc 22 §77). */
  184  export const QClarificationRequestBlockSchema = z
  185    .object({
  186      kind: z.literal("CLARIFICATION_REQUEST"),
  187      question: z.string().trim().min(1).max(Q_CLARIFICATION_QUESTION_MAX_LENGTH),
  188      options: z
  189        .array(z.string().trim().min(1).max(Q_CLARIFICATION_OPTION_MAX_LENGTH))
  190        .min(Q_CLARIFICATION_OPTIONS_MIN)
  191        .max(Q_CLARIFICATION_OPTIONS_MAX)
  192        .optional(),
  193    })
  194    .strict();
  195  
  196  export const QActionProposalBlockSchema = z
  197    .object({
  198      kind: z.literal("ACTION_PROPOSAL"),
  199      proposal: QActionProposalSchema,
  200    })
  201    .strict();
  202  
  203  /**
  204   * Something Q composed, referred to from the answer that composed it.
  205   *
  206   * A reference and a label, like every other reference block: enough to
  207   * render a card and open it, never the content. The status is here because
  208   * a card for an artifact still being prepared has to say so, and the
  209   * browser must not have to guess from an absence.
  210   */
  211  export const QArtifactReferenceBlockSchema = z
  212    .object({
  213      kind: z.literal("ARTIFACT_REFERENCE"),
  214      artifactId: QArtifactIdSchema,
  215      type: QArtifactTypeSchema,
  216      status: QArtifactStatusSchema,
  217      title: z.string().trim().min(1).max(160),
  218    })
  219    .strict();
  220  
  221  /**
  222   * A document tool's own result when it filed a new version of one of the
  223   * person's documents (`revise_my_document`). The answer path turns exactly
  224   * this -- a tool's authorised result, never a model's words -- into the
  225   * document's card on the answer, so the new version is one tap away.
  226   */
  227  export const QDocumentToolResultSchema = z
  228    .object({
  229      status: z.literal("DOCUMENT_UPDATED"),
  230      document: z
  231        .object({
  232          artifactId: QArtifactIdSchema,
  233          type: QArtifactTypeSchema,
  234          status: QArtifactStatusSchema,
  235          title: z.string().trim().min(1).max(160),
  236          currentVersion: z.number().int().min(1),
  237        })
  238        .strict(),
  239      /**
  240       * Q room W5: the slide `edit_my_document` changed (1-based), so the
  241       * room's viewer goes to it; and whether this was the same edit again
  242       * (the version it already made, nothing new written).
  243       */
  244      slide: z.number().int().min(1).max(24).optional(),
  245      replayed: z.boolean().optional(),
  246    })
  247    .strict();
  248  export type QDocumentToolResult = z.infer<typeof QDocumentToolResultSchema>;
  249  
  250  export const QUiIntentBlockSchema = z
  251    .object({ kind: z.literal("UI_INTENT"), intent: QUiIntentSchema })
  252    .strict();
  253  
  254  /**
  255   * A public web page Q read for this answer (R23, R38). The answer is said
  256   * first; the page sits behind the Sources disclosure with the only fields
  257   * a person needs to judge and follow it. Unlike the reference blocks this
  258   * carries the page's public fields rather than an id: it is a public URL,
  259   * not a guarded record, and there is nothing for a client to resolve. It
  260   * is unverified by definition -- a public source is never a verified fact.
  261   */
  262  export const QPublicSourceBlockSchema = z
  263    .object({
  264      kind: z.literal("PUBLIC_SOURCE"),
  265      url: z
  266        .string()
  267        .url()
  268        .max(2048)
  269        .refine((value) => /^https?:\/\//i.test(value), {
  270          message: "a public source is an http(s) page",
  271        }),
  272      domain: z.string().trim().min(1).max(253),
  273      /** The page title, or the domain when the page had none. */
  274      title: z.string().trim().min(1).max(160),
  275      /** YYYY-MM-DD when the page was dated; otherwise null. */
  276      publishedOn: z
  277        .string()
  278        .regex(/^\d{4}-\d{2}-\d{2}$/)
  279        .nullable(),
  280      /** YYYY-MM-DD when Capital Q read it. */
  281      retrievedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  282    })
  283    .strict();
  284  
  285  export const QResultBlockSchema = z.discriminatedUnion("kind", [
  286    QTextBlockSchema,
  287    QCompanyReferenceBlockSchema,
  288    QInvestorReferenceBlockSchema,
  289    QComparisonBlockSchema,
  290    QComparisonCardsBlockSchema,
  291    QAnswerCardsBlockSchema,
  292    QEvidenceBlockSchema,
  293    QFindingBlockSchema,
  294    QUncertaintyBlockSchema,
  295    QClarificationRequestBlockSchema,
  296    QActionProposalBlockSchema,
  297    QArtifactReferenceBlockSchema,
  298    QUiIntentBlockSchema,
  299    QPublicSourceBlockSchema,
  300  ]);
  301  
  302  export type QResultBlock = z.infer<typeof QResultBlockSchema>;
  303  
  304  /** Blocks per message or run summary. A V1 technical bound. */
  305  export const Q_RESULT_BLOCKS_MAX = 50;
  306  
  307  export const QResultBlocksSchema = z
  308    .array(QResultBlockSchema)
  309    .max(Q_RESULT_BLOCKS_MAX);
```

# Evidence: packages/contracts/src/q/answer-cards.ts (lines 1-135)

- Original path: `packages/contracts/src/q/answer-cards.ts`
- Line range: 1-135 (HEAD 520bd123)
- Why included: Complete: ANSWER_CARDS (RANKED/SIDE_BY_SIDE/RESEARCH), fit computed by code.

```
    1  import { z } from "zod";
    2  
    3  import { QSubjectRefSchema } from "./subject.js";
    4  
    5  /**
    6   * Q's answer as cards (founder brief 2026-10-05, C1-C5; ADR 0053).
    7   *
    8   * "Top three", "compare them" and "research Y Combinator" are answered on
    9   * the Q page as a set of cards, not as prose, a Markdown table or a PDF.
   10   * The model fills the parts that are reading (names, reasons, how well
   11   * each measure fits, Q's view, what Q says about each card); Capital Q's
   12   * code fills the parts that must be reproducible: the colour, the order of
   13   * a ranked answer and the fit out of 10, computed from the measure levels
   14   * (`answerCardFit` in the model gateway). A model never writes a number.
   15   *
   16   * Fit is fit against what the person declared (their mandate), never a
   17   * verdict on the business: Fit is not Business Quality (CLAUDE.md
   18   * invariants). An unknown measure is left out of the fit and counted in
   19   * `of`, so "based on 4 of 6" says what was not known instead of scoring
   20   * it as zero.
   21   */
   22  
   23  /** How one measure fits, in words. Shown with a shape, never colour alone. */
   24  export const Q_ANSWER_CARD_LEVELS = [
   25    "STRONG",
   26    "GOOD",
   27    "PARTIAL",
   28    "UNKNOWN",
   29  ] as const;
   30  export const QAnswerCardLevelSchema = z.enum(Q_ANSWER_CARD_LEVELS);
   31  export type QAnswerCardLevel = z.infer<typeof QAnswerCardLevelSchema>;
   32  
   33  /**
   34   * RANKED: a "top N", ordered by fit (code orders it).
   35   * SIDE_BY_SIDE: a comparison, in the order asked; the page can lay it out
   36   *   as one table because every card carries the same measures.
   37   * RESEARCH: parts of a research answer; no fit, no order.
   38   */
   39  export const Q_ANSWER_CARDS_SHAPES = [
   40    "RANKED",
   41    "SIDE_BY_SIDE",
   42    "RESEARCH",
   43  ] as const;
   44  export const QAnswerCardsShapeSchema = z.enum(Q_ANSWER_CARDS_SHAPES);
   45  export type QAnswerCardsShape = z.infer<typeof QAnswerCardsShapeSchema>;
   46  
   47  export const Q_ANSWER_CARDS_MAX = 10;
   48  export const Q_ANSWER_CARD_REASONS_MAX = 3;
   49  export const Q_ANSWER_CARD_MEASURES_MAX = 8;
   50  export const Q_ANSWER_CARD_FOLLOW_UPS_MAX = 3;
   51  /** Identity colours: `--cq-card-hue-1` .. `--cq-card-hue-7`. */
   52  export const Q_ANSWER_CARD_HUES = 7;
   53  
   54  export const QAnswerCardMeasureSchema = z
   55    .object({
   56      label: z.string().trim().min(1).max(40),
   57      level: QAnswerCardLevelSchema,
   58      /** What was found, in a few words ("£38k a month"); null when not known. */
   59      value: z.string().trim().max(80).nullable(),
   60    })
   61    .strict();
   62  export type QAnswerCardMeasure = z.infer<typeof QAnswerCardMeasureSchema>;
   63  
   64  /** Fit out of 10, computed by code from the known measures. */
   65  export const QAnswerCardFitSchema = z
   66    .object({
   67      score: z.number().min(0).max(10),
   68      /** Measures that were known and went into the score. */
   69      measured: z.number().int().min(1).max(Q_ANSWER_CARD_MEASURES_MAX),
   70      /** All measures on the card, known or not. */
   71      of: z.number().int().min(1).max(Q_ANSWER_CARD_MEASURES_MAX),
   72    })
   73    .strict()
   74    .refine((fit) => fit.measured <= fit.of, {
   75      message: "measured never exceeds the measures on the card",
   76    });
   77  export type QAnswerCardFit = z.infer<typeof QAnswerCardFitSchema>;
   78  
   79  export const QAnswerCardSchema = z
   80    .object({
   81      /** Stable within the block (the page keys animation and dismissal on it). */
   82      key: z.string().trim().min(1).max(64),
   83      name: z.string().trim().min(1).max(80),
   84      line: z.string().trim().max(140).nullable(),
   85      /**
   86       * What the company does, in its own one line, so Q can talk about it
   87       * ("tell me about the third one"). Absent from an older server.
   88       */
   89      about: z.string().trim().max(160).nullable().optional(),
   90      /** Its current raise in words ("$2 million"), only as this reader may see it. */
   91      raise: z.string().trim().max(60).nullable().optional(),
   92      hue: z.number().int().min(1).max(Q_ANSWER_CARD_HUES),
   93      fit: QAnswerCardFitSchema.nullable(),
   94      reasons: z
   95        .array(z.string().trim().min(1).max(160))
   96        .min(1)
   97        .max(Q_ANSWER_CARD_REASONS_MAX),
   98      measures: z.array(QAnswerCardMeasureSchema).max(Q_ANSWER_CARD_MEASURES_MAX),
   99      /** Q's view in a few words ("Meet: ask who leads"); null for none. */
  100      view: z.string().trim().max(120).nullable(),
  101      /** What Q says while this card is in focus; null for none. */
  102      said: z.string().trim().max(300).nullable(),
  103      /** How many of the answer's sources this card rests on. */
  104      sourceCount: z.number().int().min(0).max(100),
  105      /** The resolved record behind the card, when there is one. */
  106      subject: QSubjectRefSchema.nullable(),
  107    })
  108    .strict();
  109  export type QAnswerCard = z.infer<typeof QAnswerCardSchema>;
  110  
  111  export const QAnswerCardsBlockSchema = z
  112    .object({
  113      kind: z.literal("ANSWER_CARDS"),
  114      shape: QAnswerCardsShapeSchema,
  115      /** What was asked, as a heading ("Top three for your mandate"). */
  116      title: z.string().trim().min(1).max(120),
  117      cards: z.array(QAnswerCardSchema).min(1).max(Q_ANSWER_CARDS_MAX),
  118      /** Q's own next questions; one tap runs one (C8). */
  119      followUps: z
  120        .array(z.string().trim().min(1).max(120))
  121        .max(Q_ANSWER_CARD_FOLLOW_UPS_MAX),
  122    })
  123    .strict()
  124    .refine(
  125      (block) =>
  126        new Set(block.cards.map((card) => card.key)).size === block.cards.length,
  127      { message: "card keys are unique within an answer", path: ["cards"] },
  128    )
  129    .refine(
  130      (block) =>
  131        block.shape !== "RESEARCH" ||
  132        block.cards.every((card) => card.fit === null),
  133      { message: "a research answer carries no fit", path: ["cards"] },
  134    );
  135  export type QAnswerCardsBlock = z.infer<typeof QAnswerCardsBlockSchema>;
```

