/**
 * Each onboarding step asked in Arabic (multilingual Q, live 2026-10-16:
 * an Arabic interview had "How many founders?" appended in English by the
 * code that adds the next question). Platform copy keyed by step, like
 * SPOKEN_QUESTIONS: the same question, written in Arabic, never a
 * translation of anything the person said. A step without Arabic here is
 * left for the model to ask in Arabic rather than appended in English.
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
  "I11.additional_context": "هل فاتنا شيء؟",
  "I11.review": "هذا هو التفويض الذي حددته. هل يبدو صحيحاً؟",
  "I12.handoff": "تفويضك جاهز. هل أنقلك إلى Discover؟",
};

/**
 * Said to the interviewing model when the person chose Arabic. The
 * journey's questions and notes reach it in English; it asks them in
 * Arabic. Short, since it shares the "who you are" slot.
 */
export const ONBOARDING_ARABIC_NOTE =
  "LANGUAGE: this person chose Arabic. Write every reply in clear Modern Standard Arabic, including your first words and every question; the steps and notes you are given are in English, so ask them in Arabic. Keep names, company names, figures and currencies exactly as they gave them. If they write to you in English, follow them.";

/** Optional-step and finish lines the code adds, in Arabic. */
export const ARABIC_OPTIONAL_TAIL = " يمكننا العودة إلى هذا إن فضّلت تخطيه.";
export const ARABIC_FINISH_OR_CONTINUE =
  "هل تودّ الإنهاء الآن، أم المتابعة بالتفاصيل الاختيارية؟";

const OPTIONAL_TAIL_EN = " We can come back to this if you'd rather skip it.";
const FINISH_OR_CONTINUE_EN =
  "Would you like to finish now, or keep going with the optional details?";

/**
 * A reply for an Arabic speaker with the questions code added put in
 * Arabic: each step's English question (its spoken form or its prompt,
 * with or without "?") becomes the step's Arabic question. What the model
 * wrote itself is left as it is.
 */
export function withArabicQuestions(
  reply: string,
  steps: readonly {
    readonly stepKey: string;
    readonly configuration: { readonly prompt: string };
  }[],
  spoken: Readonly<Record<string, string>>,
): string {
  let out = reply
    .split(OPTIONAL_TAIL_EN)
    .join(ARABIC_OPTIONAL_TAIL)
    .split(FINISH_OR_CONTINUE_EN)
    .join(ARABIC_FINISH_OR_CONTINUE);
  for (const step of steps) {
    const arabic = SPOKEN_QUESTIONS_AR[step.stepKey];
    if (arabic === undefined) continue;
    const prompt = step.configuration.prompt;
    const forms = [
      spoken[step.stepKey],
      prompt.endsWith("?") ? prompt : `${prompt}?`,
    ]
      .filter((form): form is string => form !== undefined && form.length > 3)
      .sort((a, b) => b.length - a.length);
    for (const form of forms) out = out.split(form).join(arabic);
  }
  return out;
}
