import type { QLanguageCode } from "@capital-q/contracts";

/**
 * The words code puts at the head of "what should I do next?" (the
 * readiness lead), by language (lane ml, live 2026-10-16: an Arabic answer
 * opened in English). The steps themselves are the readiness rules' own
 * titles and next actions; the Arabic for each is keyed by its English,
 * so a rule that is added or reworded without a translation shows in
 * English rather than disappearing, and what is listed never changes with
 * the language. Presentation only: which steps are open is code's.
 */
export type ReadinessLeadCopy = {
  /** Heading over their own action plan's open steps. */
  readonly planHeading: string;
  /** Heading when investors cannot find the company yet. */
  readonly notFindableHeading: string;
  /** A rule's title or next action in this language, else as given. */
  readonly step: (english: string) => string;
  /**
   * Owner 2026-10-30: the line that closes the answer to what to do now,
   * offering -- never starting -- a full plan, which takes minutes.
   */
  readonly planOffer: string;
};

const AR_STEPS: Readonly<Record<string, string>> = {
  "Confirm who the founders are": "أكّد من هم المؤسسون",
  "Add the founders and whether they are full-time.":
    "أضف المؤسسين وهل يعملون بدوام كامل.",
  "Add each founder's background": "أضف خلفية كل مؤسس",
  "Add one or two lines of relevant experience per founder.":
    "أضف سطراً أو سطرين عن الخبرة ذات الصلة لكل مؤسس.",
  "Verify your identity": "وثّق هويتك",
  "Start identity verification.": "ابدأ توثيق الهوية.",
  "Strengthen the founders slide": "قوِّ شريحة المؤسسين",
  "Say why this team is the one to build it.":
    "اشرح لماذا هذا الفريق هو الأقدر على بنائه.",
  "Source your market size": "اذكر مصدر حجم السوق",
  "Add a market size with a public source or report.":
    "أضف حجم السوق مع مصدر عام أو تقرير.",
  "Make the market slide clear": "اجعل شريحة السوق واضحة",
  "Size the market bottom-up and say who buys.":
    "قدّر حجم السوق من الأسفل إلى الأعلى ووضّح من يشتري.",
  "Choose your sector": "اختر قطاعك",
  "Pick the categories that describe the company.":
    "اختر الفئات التي تصف الشركة.",
  "Describe the product in one line": "صف المنتج في سطر واحد",
  "Write what you sell, to whom, and why they pay.":
    "اكتب ماذا تبيع ولمن ولماذا يدفعون.",
  "Put a number on the problem": "حدّد حجم المشكلة برقم",
  "Say who has the problem and what it costs them.":
    "وضّح من يعاني المشكلة وكم تكلّفه.",
  "Show the product in the deck": "اعرض المنتج في العرض التقديمي",
  "Explain the product in one sentence and show it.":
    "اشرح المنتج في جملة واحدة واعرضه.",
  "Share your traction figures": "شارك أرقام النمو",
  "Add customers, usage or pilot numbers, each with a date.":
    "أضف أرقام العملاء أو الاستخدام أو التجارب، مع تاريخ لكل رقم.",
  "Add 3 months of revenue evidence": "أضف إثبات إيرادات لثلاثة أشهر",
  "Upload bank statements or invoices for the last three months.":
    "ارفع كشوف حساب بنكية أو فواتير لآخر ثلاثة أشهر.",
  "Make the traction slide count": "اجعل شريحة النمو مقنعة",
  "Show the trend over time, with dates on every number.":
    "اعرض الاتجاه عبر الزمن مع تاريخ على كل رقم.",
  "Share burn and runway": "شارك معدل الإنفاق والمدى النقدي",
  "Add monthly burn, runway in months, and gross margin if you have it.":
    "أضف الإنفاق الشهري والمدى النقدي بالأشهر وهامش الربح الإجمالي إن وُجد.",
  "Upload your financial statements": "ارفع قوائمك المالية",
  "Add management accounts or a financial model to the data room.":
    "أضف الحسابات الإدارية أو نموذجاً مالياً إلى غرفة البيانات.",
  "Say how you make money": "وضّح كيف تحقق الإيرادات",
  "Show price, who pays, and the margin on each sale.":
    "اعرض السعر ومن يدفع والهامش في كل عملية بيع.",
  "Add your team size": "أضف حجم فريقك",
  "Say how many people work on the company today.":
    "اذكر عدد من يعملون في الشركة اليوم.",
  "Show how you reach customers": "وضّح كيف تصل إلى العملاء",
  "Name the channel that works today and what it costs.":
    "سمِّ القناة التي تنجح اليوم وكم تكلّف.",
  "Verify the company": "وثّق الشركة",
  "Request company verification.": "اطلب توثيق الشركة.",
  "Verify your web domain": "وثّق نطاق موقعك",
  "Verify the domain from Verification.": "وثّق النطاق من صفحة التوثيق.",
  "File incorporation and cap table documents":
    "أودِع مستندات التأسيس وجدول الملكية",
  "Add the certificate of incorporation and a cap table summary.":
    "أضف شهادة التأسيس وملخص جدول الملكية.",
  "Name your main risks": "سمِّ أهم المخاطر",
  "Add the two or three risks you are managing and how.":
    "أضف المخاطر الاثنين أو الثلاثة التي تديرها وكيف.",
  "Upload your pitch deck": "ارفع عرضك التقديمي",
  "Upload the deck you are sending investors.":
    "ارفع العرض الذي ترسله إلى المستثمرين.",
  "Record your raise": "سجّل جولة التمويل",
  "Add the target and the currency on Capital.":
    "أضف المبلغ المستهدف والعملة في صفحة Capital.",
  "Name your use of funds": "حدّد استخدامات الأموال",
  "Say where the money goes: hiring, product, growth, runway.":
    "وضّح أين تذهب الأموال: التوظيف، المنتج، النمو، المدى النقدي.",
  "Set the instrument and terms": "حدّد الأداة والشروط",
  "Choose SAFE, note or equity, and the cap or valuation if set.":
    "اختر SAFE أو سنداً قابلاً للتحويل أو أسهماً، والسقف أو التقييم إن حُدّد.",
  "State the ask in the deck": "اذكر المبلغ المطلوب في العرض التقديمي",
  "Say how much, on what instrument, and what it buys.":
    "وضّح كم، وبأي أداة، وماذا يموّل.",
  "Add a one-page summary": "أضف ملخصاً من صفحة واحدة",
  "File a one-page summary in the data room.":
    "أودِع ملخصاً من صفحة واحدة في غرفة البيانات.",
};

const ENGLISH: ReadinessLeadCopy = {
  planHeading: "What to do next for your raise, most important first:",
  notFindableHeading:
    "Investors can't find your company in Discover yet. What to do next, most important first:",
  step: (english) => english,
  planOffer:
    "If you'd like a full plan for the weeks ahead, say so and I'll build it. I draft it from where things stand and have it reviewed before you see it, which takes a few minutes.",
};

const ARABIC: ReadinessLeadCopy = {
  planHeading: "الخطوات التالية لجولة التمويل، الأهم أولاً:",
  notFindableHeading:
    "لا يستطيع المستثمرون العثور على شركتك في Discover بعد. الخطوات التالية، الأهم أولاً:",
  planOffer:
    "إن أردت خطة كاملة للأسابيع القادمة فأخبرني وسأعدّها. أكتبها انطلاقاً من وضعك الحالي وتُراجَع قبل أن تراها، ويستغرق ذلك بضع دقائق.",
  step: (english) => {
    const trimmed = english.trim();
    // A step with its trailing full stop is still the same step.
    const bare = trimmed.replace(/\.$/u, "");
    const found = AR_STEPS[trimmed] ?? AR_STEPS[bare];
    if (found === undefined) return english;
    return trimmed.endsWith(".") && !found.endsWith(".") ? `${found}.` : found;
  },
};

/** Hand-written copies by primary subtag (trusted product copy). */
const COPIES: Readonly<Record<string, ReadinessLeadCopy>> = {
  en: ENGLISH,
  ar: ARABIC,
};

const primaryOf = (language: QLanguageCode | null | undefined): string =>
  language === null || language === undefined
    ? "en"
    : (language.split("-")[0] ?? "").toLowerCase();

/**
 * The copy for a language; English when nothing is chosen or no hand copy
 * exists (callers that would prepend English to an answer in another
 * language ask `hasReadinessLeadCopy` first and leave the lead out).
 */
export function readinessLeadCopy(
  language: QLanguageCode | null | undefined,
): ReadinessLeadCopy {
  return COPIES[primaryOf(language)] ?? ENGLISH;
}

/**
 * Whether code may lead an answer with this copy: English, or a language
 * with a hand-written copy. Any other language gets no code-written lead,
 * so an answer in French never opens with an English list (lane ml's live
 * defect, generalised); Q's own answer carries the steps in their language.
 */
export function hasReadinessLeadCopy(
  language: QLanguageCode | null | undefined,
): boolean {
  return COPIES[primaryOf(language)] !== undefined;
}

/**
 * The rule titles and next actions in Arabic, keyed by their English: the
 * web catalogue uses the same words, so the action plan on the page and
 * Q's spoken lead never say a step two ways.
 */
export const READINESS_STEPS_ARABIC: Readonly<Record<string, string>> =
  AR_STEPS;

/** Rule texts with an Arabic rendering, for tests. */
export const READINESS_LEAD_ARABIC_STEPS: readonly string[] =
  Object.keys(AR_STEPS);
