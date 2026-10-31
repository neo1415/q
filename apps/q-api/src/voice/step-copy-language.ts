import { writtenLanguageNote } from "@capital-q/q-core";
import { languageInfo } from "@capital-q/q-core/language";

/**
 * The questions code adds to an onboarding reply, in the person's language
 * (live 2026-10-16: an Arabic interview had "How many founders?" appended
 * in English). Any language goes through Q's shared translation layer
 * (the step's English question is product copy); Arabic's hand-written
 * questions below win, as Arabic's hand catalogue does for the screens.
 */
export const SPOKEN_QUESTIONS_AR: Readonly<Record<string, string>> = {
  // Founder
  "F0.intent": "ما الذي جاء بك إلى Capital Q؟",
  "F1.company_name": "ما اسم شركتك؟",
  "F1.website": "ما موقعك الإلكتروني؟",
  "F1.country": "أين يقع مقر الشركة؟",
  "F1.stage": "في أي مرحلة الشركة الآن؟",
  "F1.description": "في جملة أو جملتين، ماذا تفعل الشركة؟",
  "F1.categories": "كيف تصنّف الشركة؟",
  "F2.materials": "ما الذي لديك بالفعل من مواد؟",
  "F3.review": "هذا ما فهمته. هل يبدو صحيحاً؟",
  "F4.founder_role": "ما دورك في الشركة؟",
  "F4.founder_count": "كم عدد المؤسسين؟",
  "F4.full_time": "هل يعمل المؤسسون بدوام كامل؟",
  "F4.team_size": "كم شخصاً يعمل في الشركة اليوم؟",
  "F4.functions": "أيّ هذه المجالات يغطيها الفريق المؤسس؟",
  "F5.signal": "ما المؤشرات المبكرة التي لديك؟",
  "F5.pilots": "كم عدد التجارب أو شركاء التصميم؟",
  "F5.revenue_status": "كيف تصف الإيرادات اليوم؟",
  "F5.customers": "كم عدد العملاء الذين يدفعون؟",
  "F5.growth": "كيف كان النمو خلال الأشهر الستة الماضية؟",
  "F5.fin_currency": "بأي عملة تُعدّ أرقامك؟",
  "F5.monthly_revenue": "كم فوترتَ تقريباً الشهر الماضي؟",
  "F5.revenue_trend": "كيف تحركت الإيرادات الشهرية مؤخراً؟",
  "F5.gross_margin": "ما هامشك الإجمالي؟",
  "F5.monthly_burn": "كم تنفق شهرياً فوق ما تحققه من إيرادات؟",
  "F5.cash": "كم لديك من نقد في البنك اليوم؟",
  "F5.runway_months": "كم شهراً يكفيك ذلك؟",
  "F6.raising": "هل تجمع تمويلاً الآن؟",
  "F6.currency": "بأي عملة تجمع التمويل؟",
  "F6.target_amount": "كم تجمع؟",
  "F6.instrument": "ما الأداة التي تجمع بها التمويل؟",
  "F6.timeframe": "متى تريد إغلاق الجولة؟",
  "F6.use_of_funds": "إلى أين سيذهب المال أساساً؟",
  "F6.min_cheque": "ما أصغر مبلغ استثمار تقبله؟",
  "F6.confirm": "هل أحفظ هذا كهدف تمويلك؟",
  "F7.follow_up": "ما زلت أحتاج إلى بعض الأمور. هل يمكنك إطلاعي عليها؟",
  "F8.snapshot": "هكذا أفهم شركتك حالياً. هل يبدو ذلك صحيحاً؟",
  // Company profile (founder definition v6, owner template 2026-10-16)
  "F9.opportunity": "ما حجم الفرصة، وكيف تعمل الاقتصاديات لديكم؟",
  "F9.problem": "ما المشكلة التي تحلّونها، ولمن؟",
  "F9.solution": "ما هو حلّكم؟",
  "F9.how_it_works": "باختصار، كيف يعمل؟",
  "F9.business_model": "كيف تحققون الإيرادات؟",
  "F9.vision": "ما رؤيتكم للشركة على المدى البعيد؟",
  "F9.go_to_market": "كيف تصلون إلى العملاء وتكسبونهم؟",
  "F9.competition": "من غيركم يحلّ هذه المشكلة، وبماذا تختلفون؟",
  "F9.moats": "ما الذي يجعل موقعكم صعب التقليد؟",
  "F9.roadmap": "ما المحطات القادمة في خارطة طريقكم؟",
  "F9.why_us_why_now": "لماذا أنتم الفريق المناسب لهذا، ولماذا الآن؟",
  "F9.closing": "هل لديكم كلمة ختامية أو خطوة تالية تودّون مشاركتها؟",
  // Investor
  "I0.investor_type": "كيف تستثمر؟",
  "I0.organisation_name": "ما اسم شركتك الاستثمارية؟",
  "I0.business_title": "ما دورك فيها؟",
  "I1.deployment_status": "هل تستثمر رأس المال حالياً؟",
  "I1.mandate_context":
    "هل نُعدّ استراتيجيتك الاستثمارية الرئيسية، أم استراتيجية أخرى؟",
  "I2.stages": "في أي المراحل تستثمر؟",
  "I2.currency": "بأي عملة تستثمر؟",
  "I2.cheque_min": "ما الحد الأدنى لاستثمارك؟",
  "I2.cheque_typical": "ما حجم استثمارك المعتاد؟",
  "I2.cheque_max": "ما الحد الأقصى لاستثمارك؟",
  "I2.investment_role": "كيف تشارك عادةً في الجولات؟",
  "I3.geography": "أين تستثمر؟",
  "I3.geography_strength": "ما مدى صرامة ذلك؟",
  "I3.sectors": "ما القطاعات ومجالات المنتجات التي تهمك؟",
  "I3.sector_strength": "ما مدى صرامة ذلك؟",
  "I3.sectors_avoid": "هل هناك قطاعات تفضّل ألا تراها؟",
  "I4.business_models": "ما نماذج الأعمال التي تدعمها؟",
  "I4.customer_types": "ما أنواع العملاء التي تدعمها؟",
  "I4.capital_intensity":
    "إلى أي حد يمكن أن تكون الشركة كثيفة رأس المال بالنسبة لك؟",
  "I4.regulatory_appetite": "ما موقفك من الأسواق الخاضعة للتنظيم؟",
  "I4.revenue_state": "ما الإيرادات التي تتوقعها من الشركة؟",
  "I5.founder_preferences": "ما قدرات الفريق المؤسس التي تهمك؟",
  "I5.founder_strength": "ما مدى صرامة ذلك؟",
  "I6.green_flags": "ما الإشارات الإيجابية التي تبحث عنها؟",
  "I6.green_flag_strength": "ما مدى صرامة تلك الإشارات؟",
  "I6.custom_criteria": "هل هناك شيء آخر تبحث عنه؟",
  "I7.avoid": "ما الذي تفضّل ألا تراه؟",
  "I7.hard_exclusions": "هل هناك ما لا تريد أن يُعرض عليك أبداً؟",
  "I7.sector_exclusions": "هل هناك قطاعات تستبعدها تماماً؟",
  "I8.portfolio": "هل يمكنك ذكر بعض الشركات الممثلة لمحفظتك؟",
  "I9.discovery_mode": "إلى أي حد تريد أن يكون الاستكشاف جريئاً؟",
  "I10.inbound_preference": "كيف تفضّل أن يتواصل معك المؤسسون؟",
  "I11.additional_context": "هل فاتنا شيء، مثل أطروحتك الاستثمارية؟",
  "I11.review": "هذا هو التفويض الذي حددته. هل يبدو صحيحاً؟",
  "I12.handoff": "تفويضك جاهز. هل أنقلك إلى Discover؟",
};

/**
 * Said to the interviewing model when the person chose a language other
 * than English: the generic written-language note, and that the journey's
 * steps reach it in English.
 */
export function onboardingLanguageNote(language: string | null): string {
  const note = writtenLanguageNote(language);
  return note === null
    ? ""
    : `${note} The steps and notes you are given are in English: ask each of them in their language, including your first words.`;
}

/** Optional-step and finish lines the code adds, in Arabic (hand-written). */
export const ARABIC_OPTIONAL_TAIL = " يمكننا العودة إلى هذا إن فضّلت تخطيه.";
export const ARABIC_FINISH_OR_CONTINUE =
  "هل تودّ الإنهاء الآن، أم المتابعة بالتفاصيل الاختيارية؟";

const OPTIONAL_TAIL_EN = " We can come back to this if you'd rather skip it.";
const FINISH_OR_CONTINUE_EN =
  "Would you like to finish now, or keep going with the optional details?";

type Step = {
  readonly stepKey: string;
  readonly configuration: { readonly prompt: string };
};

/** A hand-written step copy: questions by step key, and the two added lines. */
type HandStepCopy = {
  readonly questions: Readonly<Record<string, string>>;
  readonly optionalTail: string;
  readonly finishOrContinue: string;
};

/**
 * Hand-written step copy by primary language subtag (like the web's hand
 * catalogues and the email's hand locales): it wins over machine
 * translation for that language. Another hand copy drops in here.
 */
export const HAND_STEP_COPY: Readonly<Record<string, HandStepCopy>> = {
  ar: {
    questions: SPOKEN_QUESTIONS_AR,
    optionalTail: ARABIC_OPTIONAL_TAIL.trim(),
    finishOrContinue: ARABIC_FINISH_OR_CONTINUE,
  },
};

/** English lines code may add, longest first, each with its hand copy. */
function addedLines(
  steps: readonly Step[],
  spoken: Readonly<Record<string, string>>,
  hand: HandStepCopy | undefined,
): readonly { readonly english: string; readonly hand: string | null }[] {
  const lines: { english: string; hand: string | null }[] = [
    { english: OPTIONAL_TAIL_EN.trim(), hand: hand?.optionalTail ?? null },
    { english: FINISH_OR_CONTINUE_EN, hand: hand?.finishOrContinue ?? null },
  ];
  for (const step of steps) {
    const prompt = step.configuration.prompt;
    for (const english of [
      spoken[step.stepKey],
      prompt.endsWith("?") ? prompt : `${prompt}?`,
    ]) {
      if (english === undefined || english.length <= 3) continue;
      lines.push({ english, hand: hand?.questions[step.stepKey] ?? null });
    }
  }
  return lines.sort((a, b) => b.english.length - a.english.length);
}

/**
 * The reply with each English question code added put in `language`: the
 * language's hand step copy where there is one, otherwise `localise` (Q's
 * shared translation layer). What the model wrote itself is left as it is; a line with no
 * translation stays as it was.
 */
export async function withQuestionsInLanguage(
  reply: string,
  steps: readonly Step[],
  spoken: Readonly<Record<string, string>>,
  language: string | null,
  localise: (lines: readonly string[]) => Promise<readonly (string | null)[]>,
): Promise<string> {
  const info = languageInfo(language ?? undefined);
  if (info === null || info.primary === "en") return reply;
  const present = addedLines(
    steps,
    spoken,
    HAND_STEP_COPY[info.primary],
  ).filter((line) => reply.includes(line.english));
  if (present.length === 0) return reply;
  const machine = present.every((line) => line.hand !== null)
    ? []
    : await localise(present.map((line) => line.english)).catch(() => []);
  let out = reply;
  present.forEach((line, i) => {
    const words = line.hand ?? machine[i] ?? null;
    if (words !== null) out = out.split(line.english).join(words);
  });
  return out;
}
