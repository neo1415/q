/**
 * Arabic for Capital Q's transactional emails (multilingual Q). Keys are
 * the exact English a template renders; `{name}`-style placeholders carry
 * what must stay exact (names, codes, links, dates, amounts), and `{n}`
 * matches a figure only. A captured value that is itself a key here (a
 * role, "company") is translated; anything else passes through unchanged.
 * What a person or Q wrote (a fund's reply, a note, a Daily story) is not
 * here and stays as written.
 */
export const EMAIL_ARABIC: Readonly<Record<string, string>> = {
  // The layout
  "Manage notifications": "إدارة الإشعارات",
  "Capital Q · Investment intelligence for founders and investors":
    "Capital Q · ذكاء استثماري للمؤسسين والمستثمرين",
  Open: "فتح",
  "You're receiving this because of your Capital Q account.":
    "تصلك هذه الرسالة بسبب حسابك على Capital Q.",
  "{name} via Capital Q": "{name} عبر Capital Q",

  // Reminders and notices
  "Reminder: {title}": "تذكير: {title}",
  "The reminder you set on Capital Q is due.":
    "حان موعد التذكير الذي ضبطته على Capital Q.",
  "Open Capital Q to act on it.": "افتح Capital Q للتصرف بشأنه.",
  "Open Capital Q": "افتح Capital Q",
  "You're receiving this because you asked Capital Q to remind you.":
    "تصلك هذه الرسالة لأنك طلبت من Capital Q تذكيرك.",
  "Q needs you on Capital Q.": "يحتاج إليك Q على Capital Q.",
  "Open it": "افتحه",
  "You're receiving this because Q needs you and the notice is still unread. Turn these emails off in Settings, Notifications.":
    "تصلك هذه الرسالة لأن Q يحتاج إليك والتنبيه لم يُقرأ بعد. يمكنك إيقاف هذه الرسائل من الإعدادات، الإشعارات.",
  "{name} wants to connect": "{name} يريد التواصل",
  "{name} hasn’t replied": "لم يردّ {name}",
  "Saved, no interest sent": "محفوظ، لم يُرسل اهتمام",
  "Your deck isn’t shared with investors":
    "عرضك التقديمي غير مُشارَك مع المستثمرين",
  "Mandate: {list}": "التفويض: {list}",

  // Team invitations and join requests
  "{inviter} invited you to join {organisation} on Capital Q":
    "دعاك {inviter} للانضمام إلى {organisation} على Capital Q",
  "Join as an {role}. The link works for {n} days.":
    "انضم بصفة {role}. يعمل الرابط لمدة {n} أيام.",
  "Join as a {role}. The link works for {n} days.":
    "انضم بصفة {role}. يعمل الرابط لمدة {n} أيام.",
  "Join {organisation}": "انضم إلى {organisation}",
  "{inviter} invited you to join {organisation} on Capital Q as an {role}. You'll work on the {word}'s relationships, notes and documents together.":
    "دعاك {inviter} للانضمام إلى {organisation} على Capital Q بصفة {role}. ستعملون معاً على علاقات {word} وملاحظاتها ومستنداتها.",
  "{inviter} invited you to join {organisation} on Capital Q as a {role}. You'll work on the {word}'s relationships, notes and documents together.":
    "دعاك {inviter} للانضمام إلى {organisation} على Capital Q بصفة {role}. ستعملون معاً على علاقات {word} وملاحظاتها ومستنداتها.",
  "Or open this link": "أو افتح هذا الرابط",
  "The link works for {n} days, once. Sign in with this email address to accept.":
    "يعمل الرابط لمدة {n} أيام، مرة واحدة. سجّل الدخول بعنوان البريد هذا للقبول.",
  "{inviter} entered this address to invite you to their {word} on Capital Q.":
    "أدخل {inviter} هذا العنوان لدعوتك إلى {word} على Capital Q.",
  Admin: "مسؤول",
  Member: "عضو",
  company: "الشركة",
  firm: "المؤسسة الاستثمارية",
  "You're in: {organisation} on Capital Q":
    "تم قبولك: {organisation} على Capital Q",
  "Welcome to {organisation}": "مرحباً بك في {organisation}",
  "{actor} let you in to {organisation} on Capital Q. Sign in to work on the {word}'s relationships, notes and documents together.":
    "قبل {actor} انضمامك إلى {organisation} على Capital Q. سجّل الدخول لتعملوا معاً على علاقات {word} وملاحظاتها ومستنداتها.",
  "Open {organisation}": "افتح {organisation}",
  "You asked to join {organisation} on Capital Q.":
    "طلبت الانضمام إلى {organisation} على Capital Q.",
  "Your request to join {organisation}": "طلبك الانضمام إلى {organisation}",
  "About {organisation}": "بشأن {organisation}",
  "{actor} didn't let you in to {organisation} this time. If you think that's a mistake, ask them directly or ask again from Capital Q.":
    "لم يقبل {actor} انضمامك إلى {organisation} هذه المرة. إن كنت تظن ذلك خطأً، فاسألهم مباشرة أو اطلب مجدداً من Capital Q.",
  "{actor} offered you ownership of {organisation}":
    "عرض عليك {actor} ملكية {organisation}",
  "Take over {organisation}?": "تولّي {organisation}؟",
  "{actor} offered to make you an owner of {organisation} on Capital Q. Nothing changes until you accept it on the Team page.":
    "عرض {actor} أن يجعلك مالكاً لـ {organisation} على Capital Q. لا يتغيّر شيء حتى تقبل ذلك من صفحة الفريق.",
  "Review the offer": "راجع العرض",
  "You are a member of {organisation} on Capital Q.":
    "أنت عضو في {organisation} على Capital Q.",

  // GateQ
  "{fund}'s answer on {company}": "ردّ {fund} بشأن {company}",
  "{fund} replied about {company}": "ردّ {fund} بخصوص {company}",
  "An answer from {fund}": "إجابة من {fund}",
  "A reply from {fund}": "رد من {fund}",
  "{fund} answered your application for {company} on Capital Q. Their words:":
    "ردّ {fund} على طلبك لـ {company} على Capital Q. كلماتهم:",
  "You applied to {fund} through their GateQ link on Capital Q.":
    "تقدّمت إلى {fund} عبر رابط GateQ الخاص بهم على Capital Q.",
  "Your code to claim {company} on Capital Q":
    "رمزك للمطالبة بـ {company} على Capital Q",
  "Enter {code} on Capital Q. It works for {n} minutes.":
    "أدخل {code} على Capital Q. يعمل لمدة {n} دقيقة.",
  "Your code: {code}": "رمزك: {code}",
  "Someone using this address asked to claim {company} on Capital Q. Enter this code on the screen where you asked; it works for {n} minutes, once.":
    "طلب شخص يستخدم هذا العنوان المطالبة بـ {company} على Capital Q. أدخل هذا الرمز في الشاشة التي طلبت منها؛ يعمل لمدة {n} دقيقة، مرة واحدة.",
  "A confirmed work email is evidence for the people who decide the claim; it does not make you a member by itself. If this wasn't you, ignore this email.":
    "بريد العمل المؤكد دليل لمن يبتّون في المطالبة؛ ولا يجعلك عضواً بحد ذاته. إن لم تكن أنت، فتجاهل هذه الرسالة.",
  "This address was entered to claim {company} on Capital Q.":
    "أُدخل هذا العنوان للمطالبة بـ {company} على Capital Q.",
  "Your Capital Q code for {company}'s application":
    "رمزك على Capital Q لطلب {company}",
  "Enter {code} to confirm your email. It works for {n} minutes.":
    "أدخل {code} لتأكيد بريدك. يعمل لمدة {n} دقيقة.",
  "Someone using this address is applying for {company} through a GateQ link on Capital Q. Enter this code on the application screen; it works for {n} minutes.":
    "يتقدّم شخص يستخدم هذا العنوان بطلب لـ {company} عبر رابط GateQ على Capital Q. أدخل هذا الرمز في شاشة الطلب؛ يعمل لمدة {n} دقيقة.",
  "Confirming your email lets the investor reach you about this application. It does not create an account or join you to any organisation. If this wasn't you, ignore this email.":
    "تأكيد بريدك يتيح للمستثمر التواصل معك بشأن هذا الطلب. لا ينشئ حساباً ولا يضمّك إلى أي مؤسسة. إن لم تكن أنت، فتجاهل هذه الرسالة.",
  "This address was entered as the contact for an application to an investor on Capital Q.":
    "أُدخل هذا العنوان كجهة تواصل لطلب مقدَّم إلى مستثمر على Capital Q.",

  // Calls and meetings
  "Updated: {subject}": "تحديث: {subject}",
  "Your call has changed: {purpose}": "تغيّرت مكالمتك: {purpose}",
  "Your call is booked: {purpose}": "تم حجز مكالمتك: {purpose}",
  "Your call is agreed: {purpose}": "تم الاتفاق على مكالمتك: {purpose}",
  "Call: {purpose}": "مكالمة: {purpose}",
  "{when} · {n} minutes · video link to follow":
    "{when} · {n} دقيقة · رابط الفيديو لاحقاً",
  "{when} · {n} minutes · Google Meet": "{when} · {n} دقيقة · Google Meet",
  "{when} ({zone}). The calendar invite is attached.":
    "{when} ({zone}). دعوة التقويم مرفقة.",
  When: "الموعد",
  Length: "المدة",
  Location: "المكان",
  Where: "المكان",
  "Time zone": "المنطقة الزمنية",
  "{n} minutes": "{n} دقيقة",
  "Video link to follow": "رابط الفيديو لاحقاً",
  "Video link: to follow. Capital Q will email it as soon as it is ready.":
    "رابط الفيديو: لاحقاً. سيرسله Capital Q بالبريد فور جاهزيته.",
  "Join with Google Meet": "انضم عبر Google Meet",
  "Or open:": "أو افتح:",
  "The calendar invite is attached (invite.ics): open it to add the call to your calendar.":
    "دعوة التقويم مرفقة (invite.ics): افتحها لإضافة المكالمة إلى تقويمك.",
  "The calendar invite is attached (invite.ics): open it to add the call to your calendar. A video link will follow.":
    "دعوة التقويم مرفقة (invite.ics): افتحها لإضافة المكالمة إلى تقويمك. سيصلك رابط الفيديو لاحقاً.",
  "Prepare with Q: the prep brief and a rehearsal of this call":
    "استعد مع Q: موجز التحضير وتدريب على هذه المكالمة",
  "You're receiving this because this call was arranged on Capital Q.":
    "تصلك هذه الرسالة لأن هذه المكالمة رُتّبت على Capital Q.",
  "You're receiving this because this call was agreed on Capital Q.":
    "تصلك هذه الرسالة لأنه تم الاتفاق على هذه المكالمة على Capital Q.",
  "Q's record of your call: {purpose}": "سجل Q لمكالمتك: {purpose}",
  Hello: "مرحباً",
  "Hi {name}": "مرحباً {name}",
  "Attended:": "الحضور:",
  Agreed: "ما تم الاتفاق عليه",
  "Money mentioned": "الأموال المذكورة",
  Transcript: "النص",
  "Open the meeting record": "افتح سجل الاجتماع",
  "not recorded": "غير مسجّل",

  // Operators
  "Capital Q: Q paused {name}'s account":
    "Capital Q: أوقف Q حساب {name} مؤقتاً",
  "After {n} warnings. Review and reinstate from the admin console.":
    "بعد {n} تحذيرات. راجع وأعد التفعيل من لوحة الإدارة.",
  "Q paused {name}'s account": "أوقف Q حساب {name} مؤقتاً",
  "Q paused this account after {n} warnings about steering onboarding to small talk.":
    "أوقف Q هذا الحساب مؤقتاً بعد {n} تحذيرات بشأن تحويل الإعداد إلى أحاديث جانبية.",
  "Review it and reinstate it from the admin console.":
    "راجعه وأعد تفعيله من لوحة الإدارة.",
  "Review in the admin console": "راجع في لوحة الإدارة",
  "You're receiving this because you are a Capital Q platform operator.":
    "تصلك هذه الرسالة لأنك مشغّل لمنصة Capital Q.",

  // The Q Daily's frame (its stories stay as Q wrote them)
  "Open Capital Q and choose The Q Daily to read the full edition.":
    "افتح Capital Q واختر The Q Daily لقراءة الإصدار كاملاً.",
  "Read the full edition": "اقرأ الإصدار كاملاً",
  "Change how often it comes": "غيّر عدد مرات وصوله",
  "You're receiving this because you follow The Q Daily on Capital Q.":
    "تصلك هذه الرسالة لأنك تتابع The Q Daily على Capital Q.",
  "Deals and rounds": "الصفقات والجولات",
  "Photos provided by Pexels": "الصور مقدّمة من Pexels",
  "Your markets this week": "أسواقك هذا الأسبوع",
  "A quiet day in your markets: nothing new we could cite.":
    "يوم هادئ في أسواقك: لا جديد يمكننا الاستشهاد به.",
  "A quiet week in your markets: nothing new we could cite.":
    "أسبوع هادئ في أسواقك: لا جديد يمكننا الاستشهاد به.",
  "Following {topics}": "متابَع: {topics}",
};
