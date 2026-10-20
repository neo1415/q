/**
 * Arabic for the relationship record as the CRM prototypes drew it
 * (2026-10-20): the next-step rail, the request checklist, the inbox
 * split, the week of calls and the deal terms beside the record. Keys are
 * the English source; `{name}`, `{date}` and `{n}` keys carry a name, a
 * date or a figure (see ../patterns.ts).
 */
export const CRM_RECORD_AR: Readonly<Record<string, string>> = {
  // Header, rail and overview
  "Ask Q": "اسأل Q",
  "Nothing on record yet": "لا شيء مسجّل بعد",
  "How did the call go?": "كيف جرت المكالمة؟",
  "Your call is": "مكالمتك",
  "today at {date}": "اليوم الساعة {date}",
  "tomorrow at {date}": "غدًا الساعة {date}",
  "on {name} at {date}": "يوم {name} الساعة {date}",
  "Q prepared a brief for this call from what both sides shared.":
    "أعدّ Q موجزًا لهذه المكالمة مما شاركه الطرفان.",
  Reschedule: "إعادة الجدولة",
  "Call brief": "موجز المكالمة",
  "For your call with {name}": "لمكالمتك مع {name}",
  "Reading the brief…": "جارٍ قراءة الموجز…",
  "Q's preparation from what both sides shared. Check it before the call.":
    "تحضير Q مما شاركه الطرفان. راجعه قبل المكالمة.",
  "Q's inference, labelled as Q's. The decision stays yours.":
    "استنتاج Q، موسوم بأنه من Q. القرار يبقى لك.",
  "since {date}": "منذ {date}",
  "last activity just now": "آخر نشاط الآن",
  "last activity {name} ago": "آخر نشاط قبل {name}",
  "last activity {date}": "آخر نشاط {date}",
  "{n} of {n2} criteria known": "{n} من {n2} معايير معروفة",
  Interest: "الاهتمام",
  "You expressed interest on {date}.": "أبديت اهتمامك في {date}.",
  "You withdrew your interest.": "سحبت اهتمامك.",
  "They accepted the same day.": "قبلوا في اليوم نفسه.",
  "They declined the same day.": "اعتذروا في اليوم نفسه.",
  "They accepted on {date}.": "قبلوا في {date}.",
  "They declined on {date}.": "اعتذروا في {date}.",
  "They accepted.": "قبلوا.",
  "They declined.": "اعتذروا.",
  "They haven't answered yet.": "لم يردّوا بعد.",
  "What you did, kept apart from fit. Neither is a score for the relationship.":
    "ما فعلته، منفصلًا عن الملاءمة. لا أحد منهما درجة للعلاقة.",
  "Founder's claim": "ادعاء المؤسس",
  "Keep going": "المتابعة",
  "Continue diligence": "متابعة العناية الواجبة",
  "Pick it up again": "استئنافها",
  "Carry on as you are": "الاستمرار كما أنت",
  "Nothing is sent to them": "لا يُرسل إليهم شيء",
  "A respectful note for you to review first": "ملاحظة لائقة تراجعها أولًا",
  "{name} will see a short, respectful note": "سيرى {name} ملاحظة قصيرة لائقة",
  "Draft note, for you to edit": "مسودة ملاحظة لتعدّلها",
  "Nothing is sent until you approve this exact text.":
    "لا يُرسل شيء حتى توافق على هذا النص بعينه.",
  "Stays with your organisation unless you send the note; then they see it with the note.":
    "يبقى لدى مؤسستك ما لم ترسل الملاحظة؛ عندها يرونه معها.",
  "Record as not proceeding": "التسجيل كعدم متابعة",
  "Approve and send": "الموافقة والإرسال",
  "Keep as draft": "الإبقاء كمسودة",
  "Sending…": "جارٍ الإرسال…",
  // Deal and close
  "Deal and close": "الصفقة والإغلاق",
  "Reading the deal…": "جارٍ قراءة الصفقة…",
  "Record the terms": "تسجيل الشروط",
  "The terms": "الشروط",
  "{name} recorded {date}": "سُجّل {name} في {date}",
  "What will be recorded": "ما سيُسجّل",
  "Approved {date} today, as shown above.": "تمت الموافقة اليوم {date}، كما هو معروض أعلاه.",
  "Approved on {date}, as shown above.": "تمت الموافقة في {date}، كما هو معروض أعلاه.",
  "Approve revision {n}": "الموافقة على المراجعة {n}",
  Recorded: "مسجّل",
  "Recording…": "جارٍ التسجيل…",
  "Your amount": "مبلغك",
  "Post-money cap": "سقف ما بعد التمويل",
  "Pre-money cap": "سقف ما قبل التمويل",
  "Pre-money valuation": "التقييم قبل التمويل",
  "Post-money instead": "بعد التمويل بدلًا من ذلك",
  "Pre-money instead": "قبل التمويل بدلًا من ذلك",
  "Post-money SAFE": "SAFE بعد التمويل",
  "Pre-money SAFE": "SAFE قبل التمويل",
  Discount: "الخصم",
  None: "لا يوجد",
  "Not stated": "غير مذكور",
  "Other terms": "شروط أخرى",
  "Term sheet": "ورقة الشروط",
  "Other terms and the term sheet": "شروط أخرى وورقة الشروط",
  "Their pitch states:": "يذكر عرضهم:",
  "Founder's claim until the term sheet is uploaded.":
    "ادعاء المؤسس حتى تُرفع ورقة الشروط.",
  "Founder's claim; check it against the attached term sheet.":
    "ادعاء المؤسس؛ تحقّق منه مقابل ورقة الشروط المرفقة.",
  "Both sides see recorded terms. Corrections add a revision; nothing is overwritten.":
    "يرى الطرفان الشروط المسجّلة. التصحيحات تضيف مراجعة؛ لا يُكتب فوق شيء.",
  // Diligence checklist
  "Ask for a document": "طلب مستند",
  "Ask for it": "اطلبه",
  "Ask again": "اطلب مجددًا",
  "Asked, waiting": "مطلوب، في الانتظار",
  "Asked, waiting on you": "مطلوب، بانتظارك",
  "Asked {date}.": "طُلب في {date}.",
  "Shared {date}": "شورك في {date}",
  "{n} shared": "{n} مُشارك",
  "{n} waiting": "{n} في الانتظار",
  "{n} not asked": "{n} لم يُطلب",
  "Not asked yet": "لم يُطلب بعد",
  "Not asked yet. It's one of Q's open questions.":
    "لم يُطلب بعد. إنه أحد أسئلة Q المفتوحة.",
  "From your requests and what was shared. Not a verdict.":
    "من طلباتك وما شورك. ليس حكمًا.",
  "Q hasn't read it yet.": "لم يقرأه Q بعد.",
  "Shared without a request.": "شورك دون طلب.",
  "Shared without a request. Q hasn't read it yet.":
    "شورك دون طلب. لم يقرأه Q بعد.",
  Remind: "تذكير",
  "Remind them": "ذكّرهم",
  "Your message": "رسالتك",
  "Nothing is sent until you press Send. Both sides see the conversation.":
    "لا يُرسل شيء حتى تضغط إرسال. يرى الطرفان المحادثة.",
  "Request sent to {name}": "أُرسل الطلب إلى {name}",
  "Reminder sent to {name}": "أُرسل التذكير إلى {name}",
  "{name} sees your request in their diligence list":
    "يرى {name} طلبك في قائمة العناية الواجبة لديه",
  "Suggested from Q's open questions": "مقترح من أسئلة Q المفتوحة",
  "Something else": "شيء آخر",
  "What you need": "ما تحتاجه",
  "For example, the cap table": "مثلًا، جدول الملكية",
  "A note for them (optional)": "ملاحظة لهم (اختياري)",
  "Why you need it": "لماذا تحتاجه",
  "Send request": "إرسال الطلب",
  "Watermarked with your name while you read it here.":
    "تظهر عليه علامة باسمك أثناء قراءته هنا.",
  "Q's one line on it. Read the document for the detail.":
    "سطر Q الواحد عنه. اقرأ المستند للتفاصيل.",
  "Opening…": "جارٍ الفتح…",
  // Messages
  Conversations: "المحادثات",
  "All conversations": "كل المحادثات",
  "Every conversation, newest first": "كل محادثة، الأحدث أولًا",
  "Your conversations couldn't be read just now.":
    "تعذّرت قراءة محادثاتك الآن.",
  "Open record": "فتح السجل",
  "Open the relationship": "فتح العلاقة",
  "Messages open once both sides agree to connect":
    "تُفتح الرسائل بعد موافقة الطرفين على التواصل",
  "Interest sent {date}": "أُرسل الاهتمام في {date}",
  "No messages yet": "لا رسائل بعد",
  "{n} unread": "{n} غير مقروءة",
  "Draft a reply": "صياغة رد",
  "Q is drafting…": "Q يصوغ…",
  "Attach a shared document": "إرفاق مستند مُشارك",
  "Upload a file": "رفع ملف",
  "Draft by Q from your conversation. Edit it before sending.":
    "مسودة من Q من محادثتك. عدّلها قبل الإرسال.",
  "Write to {name}": "اكتب إلى {name}",
  "Both sides see this conversation. Private notes stay on the Overview.":
    "يرى الطرفان هذه المحادثة. تبقى الملاحظات الخاصة في النظرة العامة.",
  read: "مقروءة",
  Yesterday: "أمس",
  // Calls
  "This week": "هذا الأسبوع",
  "Next week": "الأسبوع القادم",
  "Previous week": "الأسبوع السابق",
  "Week of {date}": "أسبوع {date}",
  "Your calendar, busy times hidden in detail. Tap a free hour to propose it.":
    "تقويمك، مع إخفاء تفاصيل أوقات الانشغال. اضغط على ساعة فارغة لاقتراحها.",
  "Reading your calendar…": "جارٍ قراءة تقويمك…",
  "Booked calls still show; free hours need your calendar.":
    "تظهر المكالمات المحجوزة؛ الساعات الفارغة تحتاج إلى تقويمك.",
  Busy: "مشغول",
  Past: "مضى",
  "Calendar not read": "لم يُقرأ التقويم",
  "Free, tap to propose": "متاح، اضغط للاقتراح",
  "Propose {date}": "اقتراح {date}",
  "Invite sent": "أُرسلت الدعوة",
  "Waiting for them": "في انتظارهم",
  Today: "اليوم",
  Tomorrow: "غدًا",
  Day: "اليوم",
  "Propose a call to {name}": "اقتراح مكالمة مع {name}",
  "How long": "المدة",
  "{n} min": "{n} دقيقة",
  "Send invite": "إرسال الدعوة",
  "{name} gets a calendar invite with a Google Meet link. Nothing is sent until you press Send invite.":
    "يتلقى {name} دعوة تقويم برابط Google Meet. لا يُرسل شيء حتى تضغط إرسال الدعوة.",
  Earlier: "سابقًا",
  "Earlier calls": "المكالمات السابقة",
  "No calls yet.": "لا مكالمات بعد.",
};
