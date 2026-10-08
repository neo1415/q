# Evidence: packages/contracts/src/q/ui-intent.ts (lines 1-120)

- Original path: `packages/contracts/src/q/ui-intent.ts`
- Line range: 1-120 (HEAD 520bd123)
- Why included: UI_INTENT kinds; NAVIGATE destinations.

```
    1  import { z } from "zod";
    2  
    3  import { UuidSchema } from "../common/ids.js";
    4  import { StageCodeSchema } from "../http/companies.js";
    5  import {
    6    DISCOVER_FILTER_LIST_MAX,
    7    DiscoverRaiseFilterSchema,
    8  } from "../http/discovery.js";
    9  import { TaxonomyCanonicalCodeSchema } from "../http/taxonomy.js";
   10  import { QEvidenceRefsSchema } from "./evidence-ref.js";
   11  import type { QVoiceChoice, QVoiceDestination } from "./voice.js";
   12  
   13  /**
   14   * A known Capital Q UI action Q may suggest (doc 12 §70-71).
   15   *
   16   * Q proposes navigation; the client decides whether and how to perform it,
   17   * under the same permission checks the person would face clicking the same
   18   * thing. Every intent is a closed shape with identifier or enum parameters
   19   * only -- except OPEN_WEBSITE's validated http(s) URL, bounded below to the
   20   * person's own declared site. There is no general OPEN_URL, no RUN_SCRIPT,
   21   * no SET_HTML and no CALL_API, and a string that looks like JavaScript
   22   * inside a text field is text.
   23   *
   24   * Intents refer to companies rather than to a generic subject because these
   25   * are the screens that exist. Investor and relationship surfaces gain their
   26   * own intents when those screens do -- additively.
   27   */
   28  export const Q_UI_INTENT_KINDS = [
   29    "OPEN_COMPANY",
   30    "SHOW_COMPARISON",
   31    "FOCUS_SECTION",
   32    "SHOW_EVIDENCE",
   33    "NAVIGATE",
   34    "SET_THEME",
   35    "RELOAD_PAGE",
   36    "OPEN_WEBSITE",
   37    "SET_Q_MOTION",
   38    "SET_VOICE",
   39    "SIGN_OUT",
   40    "OPEN_RECORD_PAGE",
   41    "OPEN_SETUP",
   42    "OPEN_SETTINGS",
   43    "SHOW_IN_Q_ROOM",
   44    "SHOW_CALENDAR_CONNECT",
   45    "DOCUMENT_ACT",
   46  ] as const;
   47  
   48  export type QUiIntentKind = (typeof Q_UI_INTENT_KINDS)[number];
   49  
   50  export const QUiIntentKindSchema = z.enum(Q_UI_INTENT_KINDS);
   51  
   52  /**
   53   * Sections of the company surface a client knows how to focus. Bounded to
   54   * what the information architecture defines today (doc 17); a section name
   55   * is never free text.
   56   */
   57  export const Q_UI_COMPANY_SECTIONS = [
   58    "OVERVIEW",
   59    "TEAM",
   60    "PITCH",
   61    "FINANCIALS",
   62    "CAPITAL_OBJECTIVE",
   63    "EVIDENCE",
   64    "DOCUMENTS",
   65  ] as const;
   66  
   67  export type QUiCompanySection = (typeof Q_UI_COMPANY_SECTIONS)[number];
   68  
   69  export const QUiCompanySectionSchema = z.enum(Q_UI_COMPANY_SECTIONS);
   70  
   71  /** Companies in one comparison view. Matches the comparison block bound. */
   72  export const Q_COMPARISON_SUBJECTS_MIN = 2;
   73  export const Q_COMPARISON_SUBJECTS_MAX = 6;
   74  
   75  export const QOpenCompanyIntentSchema = z
   76    .object({ kind: z.literal("OPEN_COMPANY"), companyId: UuidSchema })
   77    .strict();
   78  
   79  export const QShowComparisonIntentSchema = z
   80    .object({
   81      kind: z.literal("SHOW_COMPARISON"),
   82      companyIds: z
   83        .array(UuidSchema)
   84        .min(Q_COMPARISON_SUBJECTS_MIN)
   85        .max(Q_COMPARISON_SUBJECTS_MAX),
   86    })
   87    .strict();
   88  
   89  export const QFocusSectionIntentSchema = z
   90    .object({
   91      kind: z.literal("FOCUS_SECTION"),
   92      companyId: UuidSchema,
   93      section: QUiCompanySectionSchema,
   94    })
   95    .strict();
   96  
   97  export const QShowEvidenceIntentSchema = z
   98    .object({
   99      kind: z.literal("SHOW_EVIDENCE"),
  100      evidenceRefs: QEvidenceRefsSchema.min(1),
  101    })
  102    .strict();
  103  
  104  /**
  105   * Where a typed request may take the person (CQ-QACT-001): the platform's
  106   * own top-level surfaces, by name. A subset of the spoken destinations, so
  107   * a typed "take me to Discover" and a spoken one go to the same place
  108   * through the same route map; the setup and form hand-offs are the
  109   * interview's own and are not offered here. Never a path, never a URL.
  110   */
  111  export const Q_NAVIGATE_DESTINATIONS = [
  112    "HOME",
  113    "PROFILE",
  114    "CAPITAL",
  115    "DISCOVER",
  116    "COMPANY_VISIBILITY",
  117    "RELATIONSHIPS",
  118    // R33: every page a person can open from the app's own navigation.
  119    "SETTINGS",
  120    "VERIFICATION",
```

# Evidence: packages/contracts/src/q/ui-intent.ts (lines 368-450)

- Original path: `packages/contracts/src/q/ui-intent.ts`
- Line range: 368-450 (HEAD 520bd123)
- Why included: SHOW_IN_Q_ROOM: model picks only object kind + id; content read by the screen as the person.

```
  368  /**
  369   * Q room R4: what Q can bring into the room as a card while it talks. The
  370   * model picks only the kind and the record id; the card's content is read
  371   * by the screen through the page's own reads, as the person, so a card is
  372   * never model-authored UI. SOURCES is the public sources this answer read
  373   * (no id): news and web results as cards.
  374   */
  375  export const Q_ROOM_OBJECTS = [
  376    "COMPANY_PROFILE",
  377    "DATA_ROOM",
  378    "PITCH_DECK",
  379    "CHAT_WITH_COMPANY",
  380    "CHAT_WITH_INVESTOR",
  381    "WORK_PLAN",
  382    "CAPITAL_ROUND",
  383    "GATEQ_APPLICATION",
  384    "SOURCES",
  385    /**
  386     * Q room W5 (R8): a document Q made for them (a deck, one-pager or
  387     * memo), by its artifact id: the deck surface with page thumbnails,
  388     * placeholders marked, and the floating Upload button.
  389     */
  390    "Q_DOCUMENT",
  391    /**
  392     * Q.03/Q.04/Q.01 (2026-10-07): a founder's own readiness (what could
  393     * stop the raise, pillars in words), their action plan, and the
  394     * questions Q still wants answered. Founder-private; the id is their own
  395     * company's, resolved by the server, never the model.
  396     */
  397    "READINESS",
  398    "ACTION_PLAN",
  399    "FOLLOW_UPS",
  400    /**
  401     * Investor promises (2026-10-07). ASSUMPTIONS / EVIDENCE_BOARD: one
  402     * company's claims as this investor may see them (Q.07), by the
  403     * company's id. THESIS: the investor's own "how Q reads your thesis"
  404     * (Q.02); SAVED_COMPARISON: their saved companies side by side (Q.10);
  405     * INVESTOR_FIT: for a founder, investors by their published criteria
  406     * and gates (Q.05). The last three are the actor's own, resolved by the
  407     * server (the id is their own organisation's).
  408     */
  409    "ASSUMPTIONS",
  410    "EVIDENCE_BOARD",
  411    "THESIS",
  412    "SAVED_COMPARISON",
  413    "INVESTOR_FIT",
  414    /**
  415     * Overdeliver (2026-10-07). READINESS_BLUEPRINT: a founder's own
  416     * 3/6/12-month plan (Q.04; plan-gated, founder-private; the id is their
  417     * own company's, server-resolved). INVESTOR_LOOKS_FOR: for a founder, one
  418     * investor's public profile and published gate criteria with the
  419     * founder's own standing on each, and "Draft my application" (Q.05; the
  420     * id is the investor organisation's; never the private mandate).
  421     */
  422    "READINESS_BLUEPRINT",
  423    "INVESTOR_LOOKS_FOR",
  424    /**
  425     * Founder documents (2026-10-08). INVESTOR_REQUESTS: what investors
  426     * asked the founder's company for (documents and questions, each with
  427     * its state). DOCUMENT_ACCESS: who can see each of the company's
  428     * documents. Both are the founder's own company's, server-resolved (the
  429     * id is their own company's).
  430     */
  431    "INVESTOR_REQUESTS",
  432    "DOCUMENT_ACCESS",
  433  ] as const;
  434  export const QRoomObjectSchema = z.enum(Q_ROOM_OBJECTS);
  435  export type QRoomObject = z.infer<typeof QRoomObjectSchema>;
  436  
  437  export const QShowInQRoomIntentSchema = z
  438    .object({
  439      kind: z.literal("SHOW_IN_Q_ROOM"),
  440      object: QRoomObjectSchema,
  441      /** The record; absent only for SOURCES. */
  442      id: UuidSchema.optional(),
  443      /**
  444       * The record's name as its own service gave it (never the model's
  445       * words), so the room can tell when the subject comes back.
  446       */
  447      title: z.string().trim().min(1).max(120),
  448    })
  449    .strict();
  450  export type QShowInQRoomIntent = z.infer<typeof QShowInQRoomIntentSchema>;
```

# Evidence: packages/contracts/src/q/ui-intent.ts (lines 512-634)

- Original path: `packages/contracts/src/q/ui-intent.ts`
- Line range: 512-634 (HEAD 520bd123)
- Why included: SCREEN_ACT, DOCUMENT_ACT, client-action union and the tools that produce them.

```
  512  /**
  513   * Q working the screen the person is on (founder report 2026-09-30: "it
  514   * would be nice if it could even scroll for me... take me anywhere"):
  515   * scroll, go back, bring a section of the page into view, or open one of
  516   * the page's own dialogs. Every target is a fixed name the page defines;
  517   * a name the page does not have does nothing.
  518   */
  519  export const Q_SCREEN_ACTS = [
  520    "SCROLL_TOP",
  521    "SCROLL_BOTTOM",
  522    "PAGE_DOWN",
  523    "PAGE_UP",
  524    "GO_BACK",
  525    "SHOW_SECTION",
  526    "OPEN_BOOK_CALL",
  527    "OPEN_REMINDER",
  528    // Discover's feed, through its own controls (founder report 2026-09-30):
  529    // the next or previous company, and Pass or Save on the one on screen.
  530    "NEXT_ITEM",
  531    "PREVIOUS_ITEM",
  532    "PASS_CURRENT",
  533    "SAVE_CURRENT",
  534  ] as const;
  535  export const QScreenActSchema = z.enum(Q_SCREEN_ACTS);
  536  export type QScreenAct = z.infer<typeof QScreenActSchema>;
  537  
  538  export const Q_SCREEN_SECTIONS = [
  539    "history",
  540    "commitment",
  541    "next",
  542    "context",
  543    "objective",
  544    "relationships",
  545    "share",
  546    "applications",
  547  ] as const;
  548  export const QScreenSectionSchema = z.enum(Q_SCREEN_SECTIONS);
  549  
  550  export const QScreenActIntentSchema = z
  551    .object({
  552      kind: z.literal("SCREEN_ACT"),
  553      act: QScreenActSchema,
  554      section: QScreenSectionSchema.optional(),
  555    })
  556    .strict();
  557  export type QScreenActIntent = z.infer<typeof QScreenActIntentSchema>;
  558  
  559  /**
  560   * Q room W3 (R3): the document open in the Q room, worked by asking --
  561   * "next page", "go to page 3", "read it to me", "summarise it",
  562   * "download it", "close it". Every act names a fixed control of the
  563   * viewer; a document that is not open makes it do nothing. Reading,
  564   * summarising and downloading are the viewer's own, under the same signed,
  565   * permission-checked read the Data room tab uses.
  566   */
  567  export const Q_DOCUMENT_ACTS = [
  568    "NEXT_PAGE",
  569    "PREVIOUS_PAGE",
  570    "GO_TO_PAGE",
  571    "READ_ALOUD",
  572    "STOP_READING",
  573    "SUMMARISE",
  574    "DOWNLOAD",
  575    "CLOSE",
  576  ] as const;
  577  export const QDocumentActSchema = z.enum(Q_DOCUMENT_ACTS);
  578  export type QDocumentAct = z.infer<typeof QDocumentActSchema>;
  579  export const Q_DOCUMENT_PAGE_MAX = 10_000;
  580  
  581  export const QDocumentActIntentSchema = z
  582    .object({
  583      kind: z.literal("DOCUMENT_ACT"),
  584      act: QDocumentActSchema,
  585      /** GO_TO_PAGE (required), READ_ALOUD (optional): 1-based. */
  586      page: z.number().int().min(1).max(Q_DOCUMENT_PAGE_MAX).optional(),
  587    })
  588    .strict()
  589    .refine(
  590      (intent) => intent.act !== "GO_TO_PAGE" || intent.page !== undefined,
  591      {
  592        message: "GO_TO_PAGE names a page",
  593      },
  594    );
  595  export type QDocumentActIntent = z.infer<typeof QDocumentActIntentSchema>;
  596  
  597  export const QClientActionIntentSchema = z.discriminatedUnion("kind", [
  598    QScreenActIntentSchema,
  599    QSetDiscoverFiltersIntentSchema,
  600    QOpenRecordPageIntentSchema,
  601    QSetThemeIntentSchema,
  602    QReloadPageIntentSchema,
  603    QOpenWebsiteIntentSchema,
  604    QSetQMotionIntentSchema,
  605    QSetVoiceIntentSchema,
  606    QSignOutIntentSchema,
  607    QOpenSetupIntentSchema,
  608    QOpenSettingsIntentSchema,
  609    QShowInQRoomIntentSchema,
  610    QShowCalendarConnectIntentSchema,
  611    QDocumentActIntentSchema,
  612  ]);
  613  export type QClientActionIntent = z.infer<typeof QClientActionIntentSchema>;
  614  
  615  /**
  616   * The model-facing names of the tools that produce a client action, so the
  617   * answer can tell a model these happen at once (not "for approval").
  618   */
  619  export const Q_CLIENT_ACTION_TOOLS = [
  620    "set_theme",
  621    "reload_page",
  622    "open_website",
  623    "set_q_motion",
  624    "set_voice",
  625    "sign_out",
  626    "open_page",
  627    "control_screen",
  628    "continue_onboarding",
  629    "set_discover_filters",
  630    // Q room R4: a card in the Q room.
  631    "show",
  632    // Q room W3: the document open in the room.
  633    "control_document",
  634  ] as const;
```

