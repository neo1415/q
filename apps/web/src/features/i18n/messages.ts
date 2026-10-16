import {
  Q_LANGUAGE_DIRECTION,
  type QLanguagePreference,
} from "@capital-q/contracts";

/**
 * The interface's language (multilingual Q, Arabic first, 2026-10-16).
 *
 * A minimal message catalogue, not a framework: the English source string
 * is the key and the fallback, so an untranslated string shows in English
 * rather than as a key, and adding a surface is adding lines here. Product
 * names (Capital Q, Q, GateQ, Q Pitch, The Q Daily) stay as they are in
 * every language. Only the person's saved choice changes the interface; an
 * Arabic device with nothing chosen still gets English screens (Q's voice
 * follows the device on its own).
 */
export type UiLanguage = "en" | "ar";

export function uiLanguageOf(
  preference: QLanguagePreference | null | undefined,
): UiLanguage {
  return preference === "ar" ? "ar" : "en";
}

export function directionOf(language: UiLanguage): "ltr" | "rtl" {
  return Q_LANGUAGE_DIRECTION[language];
}

const AR: Readonly<Record<string, string>> = {
  // Navigation
  Discover: "اكتشف",
  Explore: "استكشف",
  CRM: "العلاقات",
  Profile: "الملف الشخصي",
  Settings: "الإعدادات",
  "Pitch & media": "العرض والوسائط",
  "Data room & deck": "غرفة البيانات والعرض",
  "Company requests": "طلبات الشركات",
  Rehearsals: "التدريبات",
  Documents: "المستندات",
  Work: "المهام",
  Usage: "الاستخدام",
  "Admin console": "لوحة الإدارة",
  Workspace: "مساحة العمل",
  You: "أنت",
  Admin: "الإدارة",
  More: "المزيد",
  "More sections": "أقسام أخرى",
  Current: "الحالية",
  Primary: "التنقل الرئيسي",
  // Settings
  Account: "الحساب",
  Team: "الفريق",
  Appearance: "المظهر",
  "How Q speaks for you": "كيف يتحدث Q نيابة عنك",
  Notifications: "الإشعارات",
  Connections: "الاتصالات",
  "Plan and billing": "الخطة والفوترة",
  Privacy: "الخصوصية",
  "What investors and founders see": "ما يراه المستثمرون والمؤسسون",
  "Edit profile": "تعديل الملف الشخصي",
  Firm: "الشركة الاستثمارية",
  Company: "الشركة",
  "Set up when Q onboards you": "يُعدّ عندما يرحّب بك Q",
  "Not set yet": "لم يُحدَّد بعد",
  Email: "البريد الإلكتروني",
  "Not available": "غير متاح",
  Password: "كلمة المرور",
  Change: "تغيير",
  "This device": "هذا الجهاز",
  "Signs you out on this device": "يسجّل خروجك من هذا الجهاز",
  "Your team": "فريقك",
  "Just you, for now": "أنت فقط حالياً",
  "Invite your team": "ادعُ فريقك",
  Open: "فتح",
  "How Capital Q looks on this device.": "مظهر Capital Q على هذا الجهاز.",
  Theme: "السمة",
  "Q motion": "حركة Q",
  "How much Q's light moves": "مقدار حركة ضوء Q",
  Sounds: "الأصوات",
  "Q's small sounds on this device": "أصوات Q الصغيرة على هذا الجهاز",
  "How Q sounds and works with you.": "كيف يبدو Q وكيف يعمل معك.",
  Language: "اللغة",
  "For Q's replies, voice and these screens": "لردود Q وصوته وهذه الشاشات",
  Voice: "الصوت",
  "Listening sounds": "أصوات الإصغاء",
  "Wake word": "كلمة التنبيه",
  "On this device only": "على هذا الجهاز فقط",
  Personality: "الشخصية",
  "Your morning newspaper": "صحيفتك الصباحية",
  "Outreach and stand-in": "التواصل والنيابة",
  "What Q may do on your behalf": "ما يجوز لـ Q فعله نيابة عنك",
  "In-app notices always show.": "تظهر تنبيهات التطبيق دائماً.",
  "Gmail, Calendar and Meet": "Gmail والتقويم وMeet",
  "Your Q email address": "عنوان بريد Q الخاص بك",
  Plan: "الخطة",
  Billing: "الفوترة",
  Allowances: "المخصصات",
  "What your plan includes": "ما تتضمنه خطتك",
  "What Q used for you this month": "ما استخدمه Q لك هذا الشهر",
  "What Q remembers": "ما يتذكره Q",
  "See, correct or forget it": "اطّلع عليه أو صحّحه أو احذفه",
  Review: "مراجعة",
  // Language setting
  Automatic: "تلقائي",
  "Q's language": "لغة Q",
  "Saved. Q uses this from your next message or call.":
    "تم الحفظ. يستخدم Q هذه اللغة من رسالتك أو مكالمتك التالية.",
  "Couldn't save that just now. Please try again.":
    "تعذّر الحفظ الآن. يُرجى المحاولة مرة أخرى.",
  "Video rehearsals in Arabic depend on the face's voice; if it does not sound right, use a voice or text rehearsal.":
    "تعتمد التدريبات المرئية بالعربية على صوت الوجه المختار؛ إن لم يبدُ مناسباً فاستخدم التدريب الصوتي أو النصي.",
  // Onboarding shell
  Back: "رجوع",
  "Save & leave": "احفظ وغادر",
  Saving: "جارٍ الحفظ",
  Saved: "تم الحفظ",
  Continue: "متابعة",
};

const CATALOGUE: Readonly<
  Record<UiLanguage, Readonly<Record<string, string>>>
> = { en: {}, ar: AR };

/** The text in this language; the English source when there is none. */
export function translate(language: UiLanguage, english: string): string {
  return CATALOGUE[language][english] ?? english;
}

/** Strings this catalogue translates, for tests. */
export function translatedStrings(language: UiLanguage): readonly string[] {
  return Object.keys(CATALOGUE[language]);
}
