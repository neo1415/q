/**
 * Arabic for the CRM as the chosen designs draw it (2026-10-20): the
 * Overview's morning brief, the Pipeline's bar, peek and export, and
 * Capital for investors and founders. Keys are the English source; see
 * ../patterns.ts for `{name}`, `{date}` and `{n}`. Names, figures and
 * currency codes are never translated.
 */
export const CRM_DESIGN_AR: Readonly<Record<string, string>> = {
  // Overview: Needs you
  "1 thing needs you": "أمر واحد يحتاج إليك",
  "{n} things need you": "{n} أمور تحتاج إليك",
  "Nothing needs you right now": "لا شيء يحتاج إليك الآن",
  "Newest first. Each one is a single step.":
    "الأحدث أولاً. كل واحد منها خطوة واحدة.",
  "{n} of {n2} done today": "أُنجز {n} من {n2} اليوم",
  "{n} of {n2} done": "أُنجز {n} من {n2}",
  "See all {n}": "عرض الكل ({n})",
  Later: "لاحقاً",
  "Moved to tomorrow morning": "نُقل إلى صباح الغد",
  "Record what you invested in {name}": "سجّل ما استثمرته في {name}",
  "{name} is invested since {date}. No amount is recorded, so your portfolio total is incomplete.":
    "{name} مستثمَر فيها منذ {date}. لم يُسجَّل أي مبلغ، لذا مجموع محفظتك غير مكتمل.",
  "Record amount": "سجّل المبلغ",
  "Record what you invested": "سجّل ما استثمرته",
  "{name}, invested since {date}": "{name}، مستثمَر منذ {date}",
  "{name} sees this amount and is asked to confirm it.":
    "ترى {name} هذا المبلغ ويُطلب منها تأكيده.",
  "A recorded amount completes your portfolio total.":
    "المبلغ المسجّل يُكمل مجموع محفظتك.",
  "Record {amount}": "سجّل {amount}",
  "{amount} recorded for {name}": "سُجّل {amount} لـ {name}",
  Recorded: "سُجّل",
  "Sending…": "جارٍ الإرسال…",

  // Overview: the period and the portfolio
  "Last 30 days": "آخر 30 يوماً",
  "Last 90 days": "آخر 90 يوماً",
  "This year": "هذا العام",
  "30 days": "30 يوماً",
  "90 days": "90 يوماً",
  "Calls held": "المكالمات المنعقدة",
  "{n} accepted, {count} declined": "قُبل {n}، ورُفض {count}",
  "{n} accepted, none declined": "قُبل {n}، ولم يُرفض أي منها",
  "More from this period": "المزيد من هذه الفترة",
  "Newest first": "الأحدث أولاً",
  "Invested {date}": "استُثمر في {date}",
  "Amount not recorded": "المبلغ غير مسجّل",
  "Amount couldn't be read": "تعذّرت قراءة المبلغ",
  "Open for the amount": "افتح لمعرفة المبلغ",
  "Known total: {amount}.": "المجموع المعروف: {amount}.",
  "No amount is recorded yet.": "لم يُسجَّل أي مبلغ بعد.",
  "One amount is not recorded, so the total is incomplete.":
    "مبلغ واحد غير مسجّل، لذا المجموع غير مكتمل.",
  "{n} amounts are not recorded, so the total is incomplete.":
    "{n} مبالغ غير مسجّلة، لذا المجموع غير مكتمل.",
  "Some amounts aren't read here, so the total is incomplete.":
    "بعض المبالغ لم تُقرأ هنا، لذا المجموع غير مكتمل.",

  // Pipeline: bar, chips, views, export
  "{label} {n}": "{label} {n}",
  "Best suited first": "الأنسب أولاً",
  "all states": "كل الحالات",
  "matching your search": "مطابقة لبحثك",
  "needs you, on this page": "تحتاج إليك، في هذه الصفحة",
  "Nothing on this page needs you.": "لا شيء في هذه الصفحة يحتاج إليك.",
  "Other pages may still have steps waiting on you.":
    "قد تكون في صفحات أخرى خطوات تنتظرك.",
  "Edit view": "تعديل العرض",
  "Edit this view": "تعديل هذا العرض",
  "Save this view": "احفظ هذا العرض",
  "Filters, sort and layout are saved together":
    "تُحفظ عوامل التصفية والترتيب والتخطيط معاً",
  "For example, Health seed deals": "مثلاً: صفقات البذرة الصحية",
  "Your team sees the view, not your private notes.":
    "يرى فريقك العرض، لا ملاحظاتك الخاصة.",
  "This device": "هذا الجهاز",
  "What goes in the file": "ما يدخل في الملف",
  "The same filters are checked again when the file is made":
    "يُعاد التحقق من عوامل التصفية نفسها عند إنشاء الملف",
  "Columns: counterpart, state, since, next step":
    "الأعمدة: الطرف الآخر، الحالة، منذ، الخطوة التالية",
  "Your private notes are never exported.": "لا تُصدَّر ملاحظاتك الخاصة أبداً.",
  "{n} selected relationships": "{n} علاقات محددة",
  "Every relationship in this view, {name}": "كل علاقة في هذا العرض، {name}",
  "1 relationship, {name}": "علاقة واحدة، {name}",
  "{n} relationships, {name}": "{n} علاقات، {name}",
  Downloaded: "نُزّل",
  "This view can't be exported just now. Reload and try again.":
    "تعذّر تصدير هذا العرض الآن. أعد التحميل وحاول مجدداً.",
  "{n} more": "{n} أخرى",
  "Not enough evidence": "لا أدلة كافية",

  // Pipeline: the record peek
  "{name}, last activity {when}": "{name}، آخر نشاط {when}",
  "Stage: {name}": "المرحلة: {name}",
  "This is waiting on you.": "هذا ينتظرك.",
  "Nothing to do until they reply.": "لا شيء لفعله حتى يردّوا.",
  "Suggested from where the relationship stands.": "مقترح بحسب موقع العلاقة.",
  "Fit with your mandate": "الملاءمة مع تفويضك",
  "{n} of {n2} criteria known": "{n} من {n2} معايير معروفة",
  "Fit is not interest. It reads their profile against your declared mandate.":
    "الملاءمة ليست اهتماماً. إنها تقرأ ملفهم مقابل تفويضك المعلن.",

  // Capital: the investor's book
  "Your book": "دفترك",
  "Received is confirmed by the company": "المستلَم تؤكده الشركة",
  "Received by companies": "استلمته الشركات",
  "Confirmed by both sides": "أكده الطرفان",
  "Committed, not yet received": "ملتزَم به، لم يُستلم بعد",
  "Nothing received yet": "لم يُستلم شيء بعد",
  "Nothing waiting": "لا شيء قيد الانتظار",
  None: "لا شيء",
  "1 amount": "مبلغ واحد",
  "{n} amounts": "{n} مبالغ",
  "Every amount is recorded": "كل المبالغ مسجّلة",
  "{name}, not recorded": "{name}، غير مسجّل",
  "Invested, amount not recorded": "مستثمَر، المبلغ غير مسجّل",
  "Not recorded": "غير مسجّل",
  "Confirm the amount": "أكّد المبلغ",
  "Mark the transfer as sent": "علّم التحويل كمُرسَل",
  "Transfer reference": "مرجع التحويل",
  "For example the bank reference": "مثلاً: مرجع البنك",
  "Sent is your side only.": "الإرسال من جهتك فقط.",
  "It counts as received once {name} confirms the money arrived. Q never marks it received for them.":
    "يُحتسب مستلَماً عندما تؤكد {name} وصول المال. لا يعلّمه Q مستلَماً نيابة عنهم.",
  "Mark {amount} as sent": "علّم {amount} كمُرسَل",
  "Marked as sent": "عُلّم كمُرسَل",
  "{amount} marked as sent. Waiting for {name} to confirm.":
    "عُلّم {amount} كمُرسَل. بانتظار تأكيد {name}.",
  "Confirm {amount}": "أكّد {amount}",
  "{amount} with {name} is confirmed": "تم تأكيد {amount} مع {name}",
  "{name} stated {amount}. Confirming tells them you agree; it is not received money.":
    "ذكرت {name} مبلغ {amount}. التأكيد يخبرهم بموافقتك؛ وليس مالاً مستلَماً.",
  "Q heard this in your call. Nothing is recorded until you confirm it.":
    "سمع Q هذا في مكالمتك. لا يُسجَّل شيء حتى تؤكده.",
  "Marked as not right": "عُلّم بأنه غير صحيح",
  Soft: "مبدئي",
  Firm: "مؤكد",
  Confirmed: "مؤكَّد",
  Sent: "مُرسَل",
  Received: "مُستلَم",
  Stated: "مذكور",
  Target: "الهدف",
  "Sent, not confirmed": "مُرسَل، غير مؤكد",

  // Capital: mandate and what Q noticed
  Thesis: "الأطروحة",
  "What Q noticed": "ما لاحظه Q",
  "Keep as is": "أبقه كما هو",
  "Kept. Q won't raise this again this month.":
    "أُبقي. لن يثير Q هذا مجدداً هذا الشهر.",
  "Review sectors": "راجع القطاعات",
  "Review geography": "راجع النطاق الجغرافي",
  "Review stages": "راجع المراحل",
  "1 company you're in touch with is outside your declared sectors.":
    "شركة واحدة تتواصل معها خارج قطاعاتك المعلنة.",
  "{n} companies you're in touch with are outside your declared sectors.":
    "{n} شركات تتواصل معها خارج قطاعاتك المعلنة.",
  "1 company you're in touch with is outside your declared geography.":
    "شركة واحدة تتواصل معها خارج نطاقك الجغرافي المعلن.",
  "{n} companies you're in touch with are outside your declared geography.":
    "{n} شركات تتواصل معها خارج نطاقك الجغرافي المعلن.",
  "1 company you're in touch with is outside your declared stages.":
    "شركة واحدة تتواصل معها خارج مراحلك المعلنة.",
  "{n} companies you're in touch with are outside your declared stages.":
    "{n} شركات تتواصل معها خارج مراحلك المعلنة.",
  "Being in touch is not a change of mandate. Your mandate only changes if you change it.":
    "التواصل ليس تغييراً في التفويض. لا يتغير تفويضك إلا إذا غيّرته أنت.",
  "1 saved": "محفوظة واحدة",
  "{n} saved": "{n} محفوظة",
  "Couldn't be read just now": "تعذّرت القراءة الآن",

  // Capital: the founder's sub-tabs
  "What could stop it": "ما قد يوقفه",
  "See readiness": "اطّلع على الجاهزية",
  "Next three steps": "الخطوات الثلاث التالية",
  "Step {n}": "الخطوة {n}",
  "Confirm {name}'s {amount}": "أكّد مبلغ {amount} من {name}",
  "They marked it sent on {date}.": "علّموه كمُرسَل في {date}.",
  "Q heard it in your call. Nothing counts until you confirm.":
    "سمعه Q في مكالمتك. لا يُحتسب شيء حتى تؤكد.",
  "They stated it. Confirming tells them you agree.":
    "ذكروه. التأكيد يخبرهم بموافقتك.",
  "Confirm you received {amount}": "أكّد أنك استلمت {amount}",
  "{name} marked it sent on {date}": "علّمته {name} كمُرسَل في {date}",
  "Check your bank account first. Confirming moves {amount} into Raised, and {name} sees it confirmed.":
    "تحقق من حسابك المصرفي أولاً. التأكيد ينقل {amount} إلى المجموع المجمَّع، وترى {name} أنه مؤكد.",
  "Amount that arrived": "المبلغ الذي وصل",
  "{amount} from {name} is now in Raised":
    "أصبح {amount} من {name} ضمن المجموع المجمَّع",
  "No round open": "لا جولة مفتوحة",
  "Open one to track what you raise in it.": "افتح جولة لتتبع ما تجمعه فيها.",
  "Open Raise & rounds": "افتح الجمع والجولات",
  "Open a round": "افتح جولة",
  "Raised counts only money you confirmed received.":
    "المجموع المجمَّع لا يحتسب إلا المال الذي أكدت استلامه.",
  "Open to investors": "مفتوحة للمستثمرين",
  "Nothing open. Steps appear here when Q finds a gap worth closing.":
    "لا شيء مفتوح. تظهر الخطوات هنا عندما يجد Q فجوة تستحق السد.",
  "Go there": "اذهب إلى هناك",
  "See it in the plan": "اطّلع عليها في الخطة",
  "Why and how": "لماذا وكيف",
  "Nothing here right now.": "لا شيء هنا الآن.",
  "{n} of {n2} areas are strong or developing.":
    "{n} من {n2} مجالات قوية أو قيد التطور.",
  "Q's reading of what you shared. No score is given, and nothing missing is counted against you.":
    "قراءة Q لما شاركته. لا تُعطى درجة، ولا يُحتسب أي نقص ضدك.",
  "{n} months": "{n} أشهر",
};
