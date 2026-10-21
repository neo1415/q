/**
 * Arabic for the Work pages as the chosen designs draw them (2026-10-21):
 * the first-stage report's prepared next steps, the data room as folders,
 * the main pitch with chapters, rehearsals by person and their review, and
 * The Q Daily with its edition calendar. Keys are the English source; see
 * ../patterns.ts for `{name}`, `{date}` and `{n}`. Names and figures are
 * never translated.
 */
export const WORK_CHOSEN_AR: Readonly<Record<string, string>> = {
  // Shared: evidence, the approval track, sheets
  "Founder’s claim": "ادعاء المؤسس",
  "Q’s inference": "استنتاج Q",
  "Document-supported": "مدعوم بمستند",
  "Not known yet": "غير معروف بعد",
  "Their stated mandate": "تفويضهم المُعلن",
  "Where this is": "أين وصل هذا",
  Prepared: "مُعَدّ",
  Recommended: "موصى به",
  "Your yes": "موافقتك",
  Sent: "أُرسل",
  Close: "إغلاق",

  // First-stage report
  "First-stage report, {date}": "تقرير المرحلة الأولى، {date}",
  "Back to Q’s work": "العودة إلى عمل Q",
  "Download PDF": "تنزيل PDF",
  "This is Q’s recommendation, not a verified finding. The decision is yours.":
    "هذه توصية Q، وليست نتيجة موثّقة. القرار لك.",
  "Prepared next steps": "خطوات تالية مُعدّة",
  "Ask for a call": "اطلب مكالمة",
  "Ask them for a call with you": "اطلب منهم مكالمة معك",
  "Pick up what is still open with the founder directly.":
    "ناقش ما زال مفتوحاً مع المؤسس مباشرة.",
  "Send the open questions": "أرسل الأسئلة المفتوحة",
  "Send them the open questions": "أرسل لهم الأسئلة المفتوحة",
  "Written questions before any call.": "أسئلة مكتوبة قبل أي مكالمة.",
  "Pass, politely": "اعتذر بلطف",
  "A short, kind no. Q stops working this one.":
    "رفض قصير ولطيف. يتوقف Q عن العمل على هذا.",
  "Prepared, needs your yes": "مُعدّ، ينتظر موافقتك",
  "Sent by you": "أرسلته أنت",
  Finding: "النتيجة",
  "What it rests on": "ما تستند إليه",
  Where: "أين",
  Strength: "نقطة قوة",
  Concern: "مصدر قلق",
  "Q’s reading of the whole interview": "قراءة Q للمقابلة كلها",
  "Q’s reading, mainly of answer {n}": "قراءة Q، ولا سيما للإجابة {n}",
  "Said in the interview": "قيل في المقابلة",
  "Said in answer {n}": "قيل في الإجابة {n}",
  "Answer {n}, given by their Q from their brief":
    "الإجابة {n}، قدّمها Q الخاص بهم من موجزهم",
  "Q named no strengths or concerns in this interview.":
    "لم يذكر Q نقاط قوة أو مخاوف في هذه المقابلة.",
  "Ask next": "اسأل لاحقاً",
  "Nothing left open from this interview.":
    "لم يبقَ شيء مفتوح من هذه المقابلة.",
  "How it went, and the interview word for word": "كيف سارت، والمقابلة حرفياً",
  "Q, question {n}": "Q، السؤال {n}",
  "Answered by their Q, standing in from their approved brief":
    "أجاب عنها Q الخاص بهم نيابةً عنهم من موجزهم المعتمد",
  "Written by Q from a chat interview it ran for you. What the founder said is their own claim; nothing here is verified, and it is not investment advice.":
    "كتبه Q من مقابلة محادثة أجراها لك. ما قاله المؤسس ادعاؤه هو؛ لا شيء هنا موثّق، وليس نصيحة استثمارية.",
  "What Q will send, word for word": "ما سيرسله Q، حرفياً",
  "Nothing is sent until you approve. The founder sees it from you.":
    "لا يُرسل شيء حتى توافق. يراه المؤسس منك.",
  "Approve and send": "وافق وأرسل",
  Edit: "تعديل",
  Editing: "قيد التعديل",
  "Sending…": "جارٍ الإرسال…",
  "Sent. Q has stopped working on this one.": "أُرسل. توقف Q عن العمل على هذا.",
  "Sent. Q couldn't stop its work on this one; stop it from Q’s work.":
    "أُرسل. لم يتمكن Q من إيقاف عمله على هذا؛ أوقفه من عمل Q.",
  "Sent. It goes from you, in your conversation with them.":
    "أُرسل. يصل منك، في محادثتك معهم.",
  "There is no conversation with them yet, so nothing can be sent.":
    "لا توجد محادثة معهم بعد، لذا لا يمكن إرسال شيء.",
  "This report has no open questions to send.":
    "لا يحتوي هذا التقرير على أسئلة مفتوحة لإرسالها.",
  "Write the message before sending it.": "اكتب الرسالة قبل إرسالها.",
  "Your session ended. Sign in again.": "انتهت جلستك. سجّل الدخول مجدداً.",
  "This report isn't available any more.": "هذا التقرير لم يعد متاحاً.",
  "Nothing can be sent yet.": "لا يمكن إرسال شيء بعد.",
  "That didn't send. Nothing went out; try again.":
    "لم يُرسل ذلك. لم يخرج شيء؛ حاول مجدداً.",
  "This report isn't available": "هذا التقرير غير متاح",
  "It may not be written yet, or it isn't yours.":
    "ربما لم يُكتب بعد، أو أنه ليس لك.",

  // Data room folders
  "Your data room, as investors see it. Each folder says who can open it.":
    "غرفة بياناتك كما يراها المستثمرون. يذكر كل مجلد من يمكنه فتحه.",
  "Add documents": "أضف مستندات",
  "Capital Q members": "أعضاء Capital Q",
  "On request": "عند الطلب",
  "Only people you share with": "فقط من تشاركهم",
  "Only your team": "فريقك فقط",
  "Nothing filed yet": "لم يُحفظ شيء بعد",
  Mixed: "مختلط",
  "1 document": "مستند واحد",
  "{n} documents": "{n} مستندات",
  "In this folder": "في هذا المجلد",
  "Nothing filed here yet.": "لم يُحفظ شيء هنا بعد.",
  "Usually here for your stage, not filed yet: {items}.":
    "عادةً ما يكون هنا لمرحلتك، ولم يُحفظ بعد: {items}.",
  "Who can open it": "من يمكنه فتحه",
  "Loading who can open it": "جارٍ تحميل من يمكنه فتحه",
  "Who can open it couldn't load. Try again.":
    "تعذّر تحميل من يمكنه فتحه. حاول مجدداً.",
  "Investors who can find your company can open it. No one has been given extra access.":
    "يمكن للمستثمرين الذين يجدون شركتك فتحه. لم يُمنح أحد وصولاً إضافياً.",
  "No investor can open it. Once you're connected with one, you can share it here.":
    "لا يمكن لأي مستثمر فتحه. بمجرد اتصالك بأحدهم، يمكنك مشاركته هنا.",
  "Asked, not shared yet": "طلب، ولم يُشارَك بعد",
  "Connected, not shared": "متصل، ولم يُشارَك",
  "Asked to connect: accept first": "طلب الاتصال: اقبل أولاً",
  "View only until {date}": "عرض فقط حتى {date}",
  "View and download until {date}": "عرض وتنزيل حتى {date}",
  "View only until {date}, {n} of {n2}": "عرض فقط حتى {date}، {n} من {n2}",
  "View and download until {date}, {n} of {n2}":
    "عرض وتنزيل حتى {date}، {n} من {n2}",
  "View only, {n} of {n2}": "عرض فقط، {n} من {n2}",
  "View and download, {n} of {n2}": "عرض وتنزيل، {n} من {n2}",
  "View only": "عرض فقط",
  "View and download": "عرض وتنزيل",
  Withdraw: "سحب",
  Share: "مشاركة",
  "Review interest": "راجع الاهتمام",
  "Withdrawn. {name} can no longer open this folder.":
    "سُحب. لم يعد بإمكان {name} فتح هذا المجلد.",
  "Some access couldn't be withdrawn. Try again.":
    "تعذّر سحب بعض الوصول. حاول مجدداً.",
  "Shared with {name}: view only, for 30 days.":
    "شورك مع {name}: عرض فقط، لمدة 30 يوماً.",
  "Change who can see this folder": "غيّر من يمكنه رؤية هذا المجلد",
  "Who can see {name}": "من يمكنه رؤية {name}",
  " · asked for by {names}": " · طلبه {names}",

  // Pitch
  "No pitch video yet": "لا يوجد فيديو عرض بعد",
  "Upload a video": "ارفع فيديو",
  "Upload a recording you already have, even a rough one. Q reads it first and tells you what investors will hear.":
    "ارفع تسجيلاً لديك بالفعل، ولو كان أولياً. يقرؤه Q أولاً ويخبرك بما سيسمعه المستثمرون.",
  "No chapters yet.": "لا فصول بعد.",
  Chapters: "الفصول",
  "Chapters come once the video is ready and Q has read it.":
    "تأتي الفصول عندما يصبح الفيديو جاهزاً ويقرؤه Q.",
  "This video has no transcript, so Q can't mark its parts. A new take with clear speech gets chapters.":
    "لا يحتوي هذا الفيديو على نص مكتوب، لذا لا يستطيع Q تحديد أجزائه. تسجيل جديد بكلام واضح يحصل على فصول.",
  "Q hasn't read this pitch yet. Its chapters appear here once it has.":
    "لم يقرأ Q هذا العرض بعد. تظهر فصوله هنا بمجرد أن يقرأه.",
  "Q read this pitch but couldn't tell its parts apart. Saying each part plainly (the problem, traction, the ask) gives it chapters.":
    "قرأ Q هذا العرض لكنه لم يميّز أجزاءه. قول كل جزء بوضوح (المشكلة، والزخم، والطلب) يمنحه فصولاً.",
  "Who can watch": "من يمكنه المشاهدة",
  "New video": "فيديو جديد",
  "What Q heard in your pitch": "ما سمعه Q في عرضك",
  "Q’s reading of your video. Confirm each before it counts as your answer; until then it shows as said in your pitch.":
    "قراءة Q لفيديوك. أكّد كل واحد قبل أن يُحتسب إجابتك؛ وحتى ذلك الحين يظهر كما قيل في عرضك.",
  "Q’s reading couldn’t load just now.": "تعذّر تحميل قراءة Q الآن.",
  "{label}, at {time}": "{label}، عند {time}",
  "Your words for {label}": "كلماتك لـ {label}",
  Confirm: "تأكيد",
  Fix: "تصحيح",
  Save: "حفظ",
  Cancel: "إلغاء",
  Saved: "حُفظ",
  "Saving…": "جارٍ الحفظ…",
  "Your claim, confirmed": "ادعاؤك، مؤكَّد",
  "Your claim, said in the pitch": "ادعاؤك، كما قيل في العرض",
  "Investors who can find you": "المستثمرون الذين يمكنهم إيجادك",
  "Everyone on Capital Q": "الجميع على Capital Q",
  "Anyone with the link": "أي شخص لديه الرابط",
  "No one outside your company can see it.": "لا يستطيع أحد خارج شركتك رؤيته.",
  "Signed-in investors your company is discoverable to.":
    "المستثمرون المسجّلون الذين يمكنهم اكتشاف شركتك.",
  "Every signed-in investor and founder on Capital Q. Not on the open web.":
    "كل مستثمر ومؤسس مسجّل على Capital Q. ليس على الويب المفتوح.",
  "Not offered: a pitch never goes on the open web. Capital Q members and the public are different audiences.":
    "غير متاح: لا يُنشر العرض أبداً على الويب المفتوح. أعضاء Capital Q والجمهور جمهوران مختلفان.",
  "You can change this at any time.": "يمكنك تغيير هذا في أي وقت.",
  "Saved. Who can watch: {who}.": "حُفظ. من يمكنه المشاهدة: {who}.",
  "Replace, preview or delete": "استبدال أو معاينة أو حذف",
  Name: "الاسم",
  Pitch: "العرض",
  Published: "منشور",
  Private: "خاص",
  "In review": "قيد المراجعة",
  "Waiting for the file": "بانتظار الملف",
  Uploading: "جارٍ الرفع",
  Processing: "قيد المعالجة",
  "Needs a new file": "يحتاج إلى ملف جديد",
  Deleted: "محذوف",
  "{state}, {who}": "{state}، {who}",
  "{state}, uploaded {date}": "{state}، رُفع في {date}",
  "Play {name}": "شغّل {name}",
  "Play your pitch": "شغّل عرضك",
  "{name}, playing": "{name}، قيد التشغيل",
  "Your videos couldn't load": "تعذّر تحميل فيديوهاتك",

  // Rehearsals
  "Who do you want to practise with?": "مع من تريد أن تتدرّب؟",
  "People to practise with": "أشخاص للتدرّب معهم",
  "Not rehearsed yet": "لم يُتدرَّب معه بعد",
  "Rehearsed {date}": "تدرّبت في {date}",
  "Call {date}": "مكالمة {date}",
  "An investor you’re talking to": "مستثمر تتحدث معه",
  "A company you’re talking to": "شركة تتحدث معها",
  "Your booked call": "مكالمتك المحجوزة",
  "Q plays them from their profile, what they have shared with you and public sources. It is Q playing them, not them.":
    "يؤدي Q دورهم من ملفهم، وما شاركوه معك، والمصادر العامة. إنه Q يؤدي دورهم، وليسوا هم.",
  "Q plays each person from what it can read about them. It is Q playing them, not them.":
    "يؤدي Q دور كل شخص مما يمكنه قراءته عنه. إنه Q يؤدي دورهم، وليسوا هم.",
  "{caption}. It is Q playing them, not them. No connection or request is needed.":
    "{caption}. إنه Q يؤدي دورهم، وليسوا هم. لا حاجة إلى اتصال أو طلب.",
  "Research-informed simulation of their public priorities":
    "محاكاة مستندة إلى البحث لأولوياتهم العامة",
  "Research-informed simulation: {role}": "محاكاة مستندة إلى البحث: {role}",
  "No investors to practise with yet": "لا يوجد مستثمرون للتدرّب معهم بعد",
  "No companies to practise with yet": "لا توجد شركات للتدرّب معها بعد",
  "Find investors": "ابحث عن مستثمرين",
  "Find companies": "ابحث عن شركات",
  "Once you’re in touch with investors, you can rehearse with any of them here.":
    "بمجرد تواصلك مع مستثمرين، يمكنك التدرّب مع أي منهم هنا.",
  "Once you’re in touch with companies, you can rehearse with any of them here.":
    "بمجرد تواصلك مع شركات، يمكنك التدرّب مع أي منها هنا.",
  "Your rehearsal with {name} is still open.":
    "تدريبك مع {name} لا يزال مفتوحاً.",
  Rejoin: "عُد إليه",
  "Past rehearsals": "التدريبات السابقة",
  "Newest first": "الأحدث أولاً",
  "Filter by person": "تصفية حسب الشخص",
  Everyone: "الجميع",
  "No rehearsals yet": "لا تدريبات بعد",
  "Your rehearsals and their reviews will appear here, newest first.":
    "ستظهر تدريباتك ومراجعاتها هنا، الأحدث أولاً.",
  "Your past rehearsals couldn’t load just now.":
    "تعذّر تحميل تدريباتك السابقة الآن.",
  "In progress": "قيد التقدّم",
  "Ended before you answered, nothing to review":
    "انتهى قبل أن تجيب، لا شيء للمراجعة",
  "Ended. Q is writing your review": "انتهى. يكتب Q مراجعتك",
  "First notes ready. Q is finishing the review":
    "الملاحظات الأولى جاهزة. يُنهي Q المراجعة",
  "Review ready": "المراجعة جاهزة",
  "{date}. Work on: {text}": "{date}. اعمل على: {text}",
  "{date}. {state}": "{date}. {state}",
  "{date}. {state}, {outcome}": "{date}. {state}، {outcome}",
  " ({change} on the last)": " ({change} مقارنة بالسابق)",
  "No score": "بلا درجة",
  "Scores are Q’s review of each rehearsal, out of 10, from its ratings. They describe the practice, not your company.":
    "الدرجات هي مراجعة Q لكل تدريب، من 10، بناءً على تقييماته. تصف التدريب، لا شركتك.",
  "Rehearse with {name}": "تدرّب مع {name}",
  "For your call on {date}.": "لمكالمتك في {date}.",
  "How hard should they push?": "إلى أي مدى يجب أن يضغطوا؟",
  Gentle: "لطيف",
  Realistic: "واقعي",
  Tough: "صارم",
  "By voice, until a natural close. You can end it at any time.":
    "بالصوت، حتى نهاية طبيعية. يمكنك إنهاؤه في أي وقت.",
  "{words} By voice, until a natural close. You can end it at any time.":
    "{words} بالصوت، حتى نهاية طبيعية. يمكنك إنهاؤه في أي وقت.",
  "{n} {unit} left this month on your {plan} plan.":
    "تبقّى {n} {unit} هذا الشهر في خطتك {plan}.",
  "You've used this month's {unit} on your {plan} plan.":
    "استخدمت {unit} هذا الشهر في خطتك {plan}.",
  "Start rehearsal": "ابدأ التدريب",
  "Not now": "ليس الآن",
  "Change plan": "غيّر الخطة",
  Review: "المراجعة",
  "Open the full review": "افتح المراجعة كاملة",
  "{date}, with {name}": "{date}، مع {name}",
  "out of 10, Q’s review score": "من 10، درجة مراجعة Q",
  "Went well": "سار جيداً",
  "Work on": "اعمل على",
  "Nothing singled out.": "لم يُحدَّد شيء.",
  "It is still open. Rejoin to carry on, or end it there.":
    "لا يزال مفتوحاً. عُد إليه للمتابعة، أو أنهِه هناك.",
  "You left before answering anything, so there’s nothing to review.":
    "غادرت قبل أن تجيب عن أي شيء، لذا لا يوجد ما يُراجَع.",
  "Q has written first notes from the transcript and is finishing the full review.":
    "كتب Q ملاحظات أولى من النص ويُنهي المراجعة الكاملة.",
  "Q is writing your review. It appears here when it’s ready.":
    "يكتب Q مراجعتك. تظهر هنا عندما تجهز.",

  // Rehearsal review
  "Your rehearsal with {name}": "تدريبك مع {name}",
  "{name} (Q)": "{name} (Q)",
  You: "أنت",
  " · looking at your screen": " · ينظر إلى شاشتك",
  "No score yet": "لا درجة بعد",
  "From the ratings": "من التقييمات",
  "Q is still writing the full review": "لا يزال Q يكتب المراجعة الكاملة",
  "This page updates when it’s ready. Your transcript is already saved.":
    "تتحدّث هذه الصفحة عندما تجهز. نصّك محفوظ بالفعل.",
  "Nothing to review yet": "لا شيء للمراجعة بعد",
  "Start again": "ابدأ من جديد",
  "You left before answering anything, so there’s nothing to review yet.":
    "غادرت قبل أن تجيب عن أي شيء، لذا لا يوجد ما يُراجَع بعد.",
  Transcript: "النص",
  "Nothing was said in this rehearsal.": "لم يُقل شيء في هذا التدريب.",
  "Feedback, tied to what you said": "ملاحظات مرتبطة بما قلته",
  "Try:": "جرّب:",
  "About the rehearsal as a whole, not one line.":
    "عن التدريب ككل، لا عن سطر واحد.",
  "What went right": "ما سار على ما يرام",
  Breakdown: "التفصيل",
  "Tips for meeting {name}": "نصائح للقاء {name}",
  Presence: "الحضور",
  "From what Q saw on your camera, with your permission. No images were kept.":
    "مما رآه Q عبر كاميرتك، بإذنك. لم تُحفظ أي صور.",
  "Your screen": "شاشتك",
  "What Q saw on the screen you shared, and what to fix. No images were kept.":
    "ما رآه Q على الشاشة التي شاركتها، وما يجب إصلاحه. لم تُحفظ أي صور.",
  "Rehearse again": "تدرّب مجدداً",
  Rehearsals: "التدريبات",
  Finished: "انتهى",
  "Still open": "لا يزال مفتوحاً",
  "{outcome}, {length}, gentle difficulty": "{outcome}، {length}، صعوبة لطيفة",
  "{outcome}, {length}, realistic difficulty":
    "{outcome}، {length}، صعوبة واقعية",
  "{outcome}, {length}, tough difficulty": "{outcome}، {length}، صعوبة شديدة",
  "{n} min": "{n} دقيقة",
  "{n} sec": "{n} ثانية",
  "Up {n} since last time ({n2})": "ارتفع {n} منذ المرة الماضية ({n2})",
  "Down {n} since last time ({n2})": "انخفض {n} منذ المرة الماضية ({n2})",
  "Same as last time ({n})": "كما في المرة الماضية ({n})",
  "AI rehearsal of {name}, based on public and shared information":
    "تدريب بالذكاء الاصطناعي لـ {name}، مبني على معلومات عامة ومشتركة",

  // The Q Daily
  "Source: {source}": "المصدر: {source}",
  "Q’s take, Q’s inference": "رأي Q، استنتاج Q",
  "Q has no take on this one.": "ليس لدى Q رأي في هذا.",
  "A quiet day in your markets: nothing new Q could cite.":
    "يوم هادئ في أسواقك: لا جديد يمكن لـ Q الاستشهاد به.",
  "A quiet week in your markets: nothing new Q could cite.":
    "أسبوع هادئ في أسواقك: لا جديد يمكن لـ Q الاستشهاد به.",
  "No. {n}, daily edition": "العدد {n}، إصدار يومي",
  "No. {n}, weekly edition": "العدد {n}، إصدار أسبوعي",
  "No. {n}, daily edition, for {name}": "العدد {n}، إصدار يومي، لـ {name}",
  "No. {n}, weekly edition, for {name}": "العدد {n}، إصدار أسبوعي، لـ {name}",
  "In brief": "باختصار",
  "Nothing else Q could cite this time.":
    "لا شيء آخر يمكن لـ Q الاستشهاد به هذه المرة.",
  "Deals and rounds": "الصفقات والجولات",
  "No rounds Q could cite this time.":
    "لا جولات يمكن لـ Q الاستشهاد بها هذه المرة.",
  "Amount not reported": "المبلغ غير مُعلن",
  Following: "المتابَعون",
  "Nothing new about the people you follow that Q could cite.":
    "لا جديد عن الأشخاص الذين تتابعهم يمكن لـ Q الاستشهاد به.",
  "Nothing new about them that Q could cite":
    "لا جديد عنهم يمكن لـ Q الاستشهاد به",
  "Every story names its source. Q’s take is Q’s inference, not reporting.":
    "كل خبر يذكر مصدره. رأي Q استنتاج من Q، وليس تقريراً صحفياً.",
  "Open PDF": "افتح PDF",
  "Change how often": "غيّر عدد المرات",
  "Earlier editions": "الإصدارات السابقة",
  "Read at the source": "اقرأ في المصدر",
  "Edition calendar": "تقويم الإصدارات",
  Editions: "الإصدارات",
  "Earlier: {month}": "السابق: {month}",
  "Later: {month}": "التالي: {month}",
  "Editions in {month}": "الإصدارات في {month}",
  "{day} {month}: edition No. {n}": "{day} {month}: الإصدار رقم {n}",
  "{day} {month}: edition No. {n}, {headline}":
    "{day} {month}: الإصدار رقم {n}، {headline}",
  "{day} {month}: no edition": "{day} {month}: لا إصدار",
  "{day} {month}: still to come": "{day} {month}: لم يأتِ بعد",
  "A dot marks a day with an edition. Pick one to read it.":
    "تشير النقطة إلى يوم فيه إصدار. اختره لقراءته.",
  "A dot marks a day with an edition. Yours comes weekly, so most days have none.":
    "تشير النقطة إلى يوم فيه إصدار. إصدارك أسبوعي، لذا معظم الأيام بلا إصدار.",
  "A dot marks a day with an edition. The Q Daily is off, so no new ones come.":
    "تشير النقطة إلى يوم فيه إصدار. The Q Daily متوقفة، لذا لا تأتي إصدارات جديدة.",
  "This month's editions couldn't load. The days show without them.":
    "تعذّر تحميل إصدارات هذا الشهر. تظهر الأيام من دونها.",
  "Today’s edition is being prepared": "يجري إعداد إصدار اليوم",
  "Q is checking its sources. It appears here in a few minutes.":
    "يتحقق Q من مصادره. يظهر هنا خلال دقائق.",
  "Your edition is taking longer than usual. It will appear here and in your email when it's ready.":
    "يستغرق إصدارك وقتاً أطول من المعتاد. سيظهر هنا وفي بريدك عندما يجهز.",
  "Read the latest edition": "اقرأ أحدث إصدار",
  "Get it now": "احصل عليه الآن",
  "Starting…": "جارٍ البدء…",
  "You have a recent edition. Ask again tomorrow.":
    "لديك إصدار حديث. اطلب مجدداً غداً.",
  "You have a recent edition. You can ask for another after {date}.":
    "لديك إصدار حديث. يمكنك طلب آخر بعد {date}.",
  "The Q Daily is off. Turn it on first.": "The Q Daily متوقفة. شغّلها أولاً.",
  "The Q Daily is off": "The Q Daily متوقفة",
  "Turn it on": "شغّلها",
  "Turning it on…": "جارٍ التشغيل…",
  On: "مُشغَّلة",
  "The Q Daily is on. Your first edition is on its way.":
    "The Q Daily مُشغَّلة. إصدارك الأول في الطريق.",
  "Turn it on for a short, sourced newspaper about your markets and the people you follow.":
    "شغّلها لتحصل على صحيفة قصيرة موثّقة المصادر عن أسواقك والأشخاص الذين تتابعهم.",
  "Your first edition is on its way": "إصدارك الأول في الطريق",
  "No edition today": "لا إصدار اليوم",
  "Read {day}’s edition": "اقرأ إصدار {day}",
  "Q writes your next one when it is due.":
    "يكتب Q إصدارك التالي عندما يحين موعده.",
  "Your next edition: {date}.": "إصدارك التالي: {date}.",
  "No edition on {day}": "لا إصدار في {day}",
  "Q didn't write one that day: it may have been off, weekly, or before your first edition.":
    "لم يكتب Q إصداراً في ذلك اليوم: ربما كانت متوقفة، أو أسبوعية، أو قبل إصدارك الأول.",
  "Your latest edition, {day}": "أحدث إصداراتك، {day}",
  "This edition couldn't load. Reload in a moment.":
    "تعذّر تحميل هذا الإصدار. أعد التحميل بعد لحظة.",
};
