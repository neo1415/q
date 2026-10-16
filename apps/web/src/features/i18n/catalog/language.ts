/**
 * Arabic for the language setting and the per-language notes (lane lang,
 * any-language interface). Keys are the English source; `{language}` is a
 * language's name in the reader's language, from Intl.
 */
export const LANGUAGE_AR: Readonly<Record<string, string>> = {
  "Search languages": "ابحث عن لغة",
  "Follows your device's language": "تتبع لغة جهازك",
  "No language matches that.": "لا توجد لغة مطابقة.",
  Screens: "الشاشات",
  "Translated by hand": "مترجمة يدوياً",
  "Translated by Q, automatically; anything not translated yet shows in English for a moment":
    "يترجمها Q آلياً؛ وما لم يُترجم بعد يظهر بالإنجليزية لحظات",
  "Q's replies": "ردود Q",
  "Written and spoken in this language": "مكتوبة ومنطوقة بهذه اللغة",
  "Voice conversations": "المحادثات الصوتية",
  Available: "متاحة",
  "Not available in this language yet: type to Q instead":
    "غير متاحة بهذه اللغة بعد: اكتب إلى Q بدلاً من ذلك",
  "Video rehearsals and interviews": "التدريبات والمقابلات المرئية",
  "Not available in this language yet: rehearsals continue by voice, interviews run in English":
    "غير متاحة بهذه اللغة بعد: تستمر التدريبات صوتياً، وتجري المقابلات بالإنجليزية",
  "The video interview runs in {language}. How clear it sounds depends on the face's voice; if it doesn't sound right, you can continue by typing.":
    "تجري المقابلة المرئية باللغة {language}، ويعتمد وضوحها على صوت الوجه المختار؛ إن لم يبدُ مناسباً فيمكنك المتابعة بالكتابة.",
  "Video interviews aren't available in {language} yet, so this one runs in English. You can continue by typing in your language instead.":
    "المقابلات المرئية غير متاحة باللغة {language} بعد، لذا تجري هذه المقابلة بالإنجليزية. يمكنك المتابعة بالكتابة بلغتك بدلاً من ذلك.",
  "Video rehearsals don’t run in your language yet, so you’re in the rehearsal room instead.":
    "لا تعمل التدريبات المرئية بلغتك بعد، لذا أنت في غرفة التدريب بدلاً من ذلك.",
};
