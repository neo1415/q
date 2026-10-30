/**
 * Arabic for GateQ: the founder's apply flow (public gateway, fit check,
 * contact, interview, review), the investor's inbox, dossier, comparison,
 * gate rules and sharing. Keys are the English source; `{fund}`, `{name}`,
 * `{n}` carry a name or figure (see ../patterns.ts). Messages an investor
 * sends a founder stay as written: they are the investor's words.
 */
export const GATEQ_AR: Readonly<Record<string, string>> = {
  // Asking Q about one application (executive review 2026-10-17)
  "Ask Q about this application": "اسأل Q عن هذا الطلب",
  "What should we ask next?": "ماذا يجب أن نسأل بعد ذلك؟",
  "What is still unverified?": "ما الذي لم يُتحقق منه بعد؟",
  "Fit versus quality": "الملاءمة مقابل الجودة",
  // Chrome and tabs
  Applications: "الطلبات",
  "Find my startup": "ابحث عن شركتي الناشئة",
  Inbox: "الوارد",
  "Find a startup": "ابحث عن شركة ناشئة",
  "Your gate": "بوابتك",
  "GateQ inbox": "وارد GateQ",
  "Your GateQ inbox": "وارد GateQ الخاص بك",
  "{what} didn't load": "تعذّر تحميل {what}",
  "Your search": "بحثك",
  Search: "البحث",
  "The connection dropped before it finished. Nothing you did was lost.":
    "انقطع الاتصال قبل أن يكتمل. لم يُفقد شيء مما فعلته.",
  "Try again": "حاول مرة أخرى",
  "Powered by Capital Q": "مدعوم من Capital Q",

  // The fit check (Do we fit? Ask Q)
  "Do we fit?": "هل نتوافق؟",
  "Do we fit? Ask Q about {name}": "هل نتوافق؟ اسأل Q عن {name}",
  "Fit check with Q": "فحص التوافق مع Q",
  "{fund}: fit check with Q": "{fund}: فحص التوافق مع Q",
  "Check my fit": "افحص توافقي",
  "Q is {fund}'s analyst. Answer a few questions, or share your website, and Q tells you whether you fit {fund}'s published mandate. About two minutes.":
    "Q هو محلل {fund}. أجب عن بضعة أسئلة أو شارك موقعك الإلكتروني، وسيخبرك Q إن كنت تتوافق مع التفويض المنشور لـ {fund}. نحو دقيقتين.",
  "Q checks your company against {name}'s published mandate. Nothing is shared unless you choose to.":
    "يقارن Q شركتك بالتفويض المنشور لـ {name}. لا يُشارَك شيء ما لم تختر ذلك.",
  "Nothing is shared with {fund} unless you choose to at the end.":
    "لا يُشارَك شيء مع {fund} ما لم تختر ذلك في النهاية.",
  "{fund} isn't taking new conversations right now.":
    "لا يستقبل {fund} محادثات جديدة حالياً.",
  "{fund} isn't taking applications right now": "لا يستقبل {fund} طلبات حالياً",
  "You fit {fund}'s mandate": "أنت تتوافق مع تفويض {fund}",
  "Partly. Q couldn't confirm everything": "جزئياً. تعذّر على Q تأكيد كل شيء",
  "Not a fit for {fund} right now": "لا توافق مع {fund} حالياً",
  "Your answers meet every rule {fund} published. Q hasn't verified them yet.":
    "إجاباتك تستوفي كل قاعدة نشرها {fund}. لم يتحقق Q منها بعد.",
  "Unknown isn't a no. {fund} can only receive applications that meet its rules, so Q needs these answered first.":
    "غير المعروف ليس رفضاً. لا يستطيع {fund} استقبال إلا الطلبات التي تستوفي قواعده، لذا يحتاج Q إلى إجابات عن هذه أولاً.",
  "This is {fund}'s published mandate, not a view on your company. If an answer was wrong, change it.":
    "هذا هو التفويض المنشور لـ {fund}، وليس رأياً في شركتك. إن كانت إحدى الإجابات خاطئة فغيّرها.",
  "Share with {fund}": "شارِك مع {fund}",
  "Share with {fund}?": "المشاركة مع {fund}؟",
  "{fund} will see what you told Q, and nothing else:":
    "سيرى {fund} ما أخبرت به Q، ولا شيء غيره:",
  "Sent to {fund}": "أُرسل إلى {fund}",
  "{fund} has your answers": "لدى {fund} إجاباتك",
  " (reference {ref})": " (المرجع {ref})",
  ". The investment team may contact you through your confirmed email.":
    ". قد يتواصل معك فريق الاستثمار عبر بريدك الإلكتروني المؤكد.",
  "{fund} hasn't received anything. You can close this window.":
    "لم يستلم {fund} أي شيء. يمكنك إغلاق هذه النافذة.",
  "Back to the conversation": "العودة إلى المحادثة",
  "Your application is for {fund}. Nothing is submitted until you review it and press Submit.":
    "طلبك موجّه إلى {fund}. لا يُقدَّم شيء حتى تراجعه وتضغط «تقديم».",
  "Confirm your contact details": "أكّد بيانات التواصل",
  "Review before submitting": "راجع قبل التقديم",
  "{fund} will receive your confirmed contact details, form answers, the interview transcript and the {n} documents you chose to share. Applicant claims remain unverified unless supporting evidence is recorded.":
    "سيستلم {fund} بيانات التواصل المؤكدة وإجابات النموذج ونص المقابلة و{n} مستندات اخترت مشاركتها. تبقى ادعاءات المتقدّم غير متحقَّق منها ما لم يُسجَّل دليل داعم.",
  "Your application needs corrections before {fund} can receive it:":
    "يحتاج طلبك إلى تصحيحات قبل أن يستطيع {fund} استلامه:",
  "Submit to {fund}": "قدّم إلى {fund}",
  "Your interview for {fund}": "مقابلتك مع {fund}",
  "Apply to {name}": "تقدّم إلى {name}",
  "Tell Q about your company. {name} reviews every application.":
    "أخبر Q عن شركتك. يراجع {name} كل طلب.",
  "Talk it through with Q": "ناقش الأمر مع Q",
  "Start with Q": "ابدأ مع Q",
  "Prefer to talk it through?": "تفضّل مناقشة الأمر؟",
  "Review instead": "راجع بدلاً من ذلك",
  "Restoring your application…": "جارٍ استعادة طلبك…",
  "Couldn't restore your application.": "تعذّرت استعادة طلبك.",
  "Couldn't restore Q's reply. Please try again.":
    "تعذّرت استعادة رد Q. يُرجى المحاولة مرة أخرى.",
  "Couldn't open your gateway just now. Please try again.":
    "تعذّر فتح بوابتك الآن. يُرجى المحاولة مرة أخرى.",
  "Q is reading…": "يقرأ Q…",
  "Q is thinking": "يفكّر Q",
  "Q understood:": "فهم Q:",
  "Q asked:": "سأل Q:",
  "You said": "قلتَ",
  "You:": "أنت:",
  "Your fit": "توافقك",
  Fits: "يتوافق",
  Partial: "جزئي",
  "Not a fit": "غير متوافق",
  "Where you stand": "أين تقف",
  "What they look for": "ما يبحثون عنه",
  "What {fund} looks for": "ما يبحث عنه {fund}",
  "What {fund} looks at": "ما ينظر إليه {fund}",
  "Their gate is closed. You can still read what they look for.":
    "بوابتهم مغلقة. لا يزال بإمكانك قراءة ما يبحثون عنه.",
  "Replies within {n} working days": "يردّ خلال {n} أيام عمل",
  "Promise to founders": "التزام تجاه المؤسسين",

  // The founder's form
  "Apply to {fund} · {stage}": "تقدّم إلى {fund} · {stage}",
  "Step {n} of 4": "الخطوة {n} من 4",
  "Company and founder": "الشركة والمؤسس",
  "First, find your company": "أولاً، ابحث عن شركتك",
  "Find your company on Capital Q": "ابحث عن شركتك على Capital Q",
  "{fund} needs to know which company is applying. Find it on Capital Q or add it in a minute: upload your deck and Q fills in the rest.":
    "يحتاج {fund} إلى معرفة الشركة المتقدّمة. ابحث عنها على Capital Q أو أضفها في دقيقة: ارفع عرضك التقديمي وسيكمل Q الباقي.",
  "It may already be here: from a deck, a colleague, or public records. Search by name or website.":
    "قد تكون موجودة بالفعل: من عرض تقديمي أو زميل أو سجلات عامة. ابحث بالاسم أو الموقع الإلكتروني.",
  "Company name or website": "اسم الشركة أو موقعها الإلكتروني",
  "Searching the companies you can see…":
    "جارٍ البحث في الشركات التي يمكنك رؤيتها…",
  "Not listed?": "غير مُدرجة؟",
  "Add your company": "أضف شركتك",
  "Add it now: upload your deck and Q fills in your profile. You check everything before anyone sees it.":
    "أضفها الآن: ارفع عرضك التقديمي وسيملأ Q ملفك. تراجع كل شيء قبل أن يراه أحد.",
  "Upload your deck": "ارفع عرضك التقديمي",
  "Add it by hand": "أضفها يدوياً",
  "This is mine": "هذه شركتي",
  "Claim it": "طالِب بها",
  "Not claimed yet": "لم يُطالب بها بعد",
  "Already has {n} member": "لديها عضو واحد ({n})",
  "Already has {n} members": "لديها {n} أعضاء",
  "Ask to join": "اطلب الانضمام",
  "Ask to join {name}": "اطلب الانضمام إلى {name}",
  "Asked. {name}'s admins let you in from their Team page; you'll get an email when they decide.":
    "تم الطلب. يقبل مسؤولو {name} انضمامك من صفحة الفريق؛ وستصلك رسالة عندما يقررون.",
  "Asked. {name}'s members decide, and you'll see it here.":
    "تم الطلب. يقرر أعضاء {name}، وسترى ذلك هنا.",
  "You're already a member of {name}.": "أنت عضو بالفعل في {name}.",
  "A company that already has members on Capital Q lets you in when an admin says yes. If you think someone claimed yours wrongly, ask to join and say so: Capital Q reviews it.":
    "الشركة التي لها أعضاء على Capital Q تقبلك عندما يوافق أحد المسؤولين. إن ظننت أن أحداً طالب بشركتك خطأً، فاطلب الانضمام وأوضح ذلك: يراجعه Capital Q.",
  "Ask the members": "اسأل الأعضاء",
  "Someone already in the company says yes.": "يوافق أحد الموجودين في الشركة.",
  "Show it's yours": "أثبت أنها لك",
  "How to show it's yours": "كيف تثبت أنها لك",
  "Email at {domain}": "بريد إلكتروني على {domain}",
  "We check the address is at your company's own website.":
    "نتحقق من أن العنوان على نطاق موقع شركتك.",
  "Use an email at {domain}.": "استخدم بريداً إلكترونياً على {domain}.",
  "your company's website": "موقع شركتك الإلكتروني",
  "A registry document": "مستند من السجل التجاري",
  "Capital Q matches the company name and number.":
    "يطابق Capital Q اسم الشركة ورقمها.",
  "Certificate of incorporation or registry extract (PDF, PNG or JPEG, up to 10 MB)":
    "شهادة التأسيس أو مستخرج السجل (PDF أو PNG أو JPEG، حتى 10 ميغابايت)",
  "Attach a PDF, PNG or JPEG of 10 MB or less.":
    "أرفق ملف PDF أو PNG أو JPEG بحجم 10 ميغابايت أو أقل.",
  "Work email": "بريد العمل",
  "Email me a code": "أرسل لي رمزاً بالبريد",
  "Request in. Capital Q checks it and lets you know.":
    "وصل الطلب. يتحقق Capital Q منه ويُعلمك.",
  "Request sent": "أُرسل الطلب",
  "Your request is in, but the document didn't upload. Try attaching it again.":
    "وصل طلبك، لكن المستند لم يُرفع. حاول إرفاقه مرة أخرى.",
  "Email confirmed. Capital Q checks your claim and lets you know.":
    "تم تأكيد البريد. يتحقق Capital Q من مطالبتك ويُعلمك.",
  "Something wrong?": "هل هناك خطأ؟",
  "Know a company that isn't here?": "تعرف شركة غير موجودة هنا؟",
  "Not on Capital Q yet": "ليست على Capital Q بعد",
  "Your company": "شركتك",
  "your company": "شركتك",
  "Company name": "اسم الشركة",
  "Add your company's name.": "أضف اسم شركتك.",
  "What it does, in one line": "ما الذي تفعله، في سطر واحد",
  "Describe the company in a few words.": "صِف الشركة في بضع كلمات.",
  Website: "الموقع الإلكتروني",
  "Where is the company based?": "أين يقع مقر الشركة؟",
  "Choose a country": "اختر دولة",
  Country: "الدولة",
  Sector: "القطاع",
  Sectors: "القطاعات",
  "Your sector, in a few words": "قطاعك، في بضع كلمات",
  "In a few words, like insurance software":
    "في بضع كلمات، مثل برمجيات التأمين",
  Stage: "المرحلة",
  "Your round": "جولتك",
  "How much are you raising?": "كم تجمع من التمويل؟",
  "How are you raising?": "كيف تجمع التمويل؟",
  "Exact amount": "المبلغ الدقيق",
  "Exact amount, like 1,200,000": "المبلغ الدقيق، مثل 1,200,000",
  "Use numbers only, like 1,200,000.": "استخدم الأرقام فقط، مثل 1,200,000.",
  "Add the exact amount so the round-size rule can be checked. Without it, that rule stays unanswered.":
    "أضف المبلغ الدقيق ليتسنى فحص قاعدة حجم الجولة. دونه تبقى تلك القاعدة دون إجابة.",
  Currency: "العملة",
  "Under $500k": "أقل من 500 ألف دولار",
  "Over $3M": "أكثر من 3 ملايين دولار",
  Equity: "حقوق ملكية",
  SAFE: "SAFE",
  "Convertible note": "سند قابل للتحويل",
  "Do you have a lead investor?": "هل لديك مستثمر رئيسي؟",
  "Looking for one": "نبحث عن واحد",
  "Not decided": "لم يُحسم",
  "Too early to say": "من المبكر الجزم",
  "Rough numbers are fine. You can say you'd rather not.":
    "الأرقام التقريبية مقبولة. يمكنك القول إنك تفضّل عدم الإفصاح.",
  "Tap what fits. Rough is fine, and you can say you'd rather not.":
    "اختر ما يناسب. التقريب مقبول، ويمكنك القول إنك تفضّل عدم الإفصاح.",
  "Pick one, or say you'd rather not.":
    "اختر واحداً، أو قل إنك تفضّل عدم الإفصاح.",
  "Pick one. It takes a minute.": "اختر واحداً. يستغرق الأمر دقيقة.",
  "I'd rather not say": "أفضّل عدم الإفصاح",
  "I'd rather not say.": "أفضّل عدم الإفصاح.",
  "I don't know": "لا أعرف",
  "I don't know.": "لا أعرف.",
  "Something else": "شيء آخر",
  Other: "أخرى",
  "Filled in from your profile. Change anything that's out of date.":
    "مُعبّأ من ملفك. غيّر أي شيء لم يعد محدّثاً.",
  "From your profile": "من ملفك",
  "From your documents": "من مستنداتك",
  "A first draft from your profile; it's yours to change.":
    "مسودة أولى من ملفك؛ ولك أن تغيّرها.",
  "Note to {fund}": "ملاحظة إلى {fund}",
  "A line or two about why them.": "سطر أو اثنان عن سبب اختيارهم.",
  "Keep it to {n} characters.": "لا تتجاوز {n} حرفاً.",
  "Hi {fund} team,": "مرحباً فريق {fund}،",
  "We're raising {amount}.": "نجمع {amount}.",
  " (raising {amount})": " (نجمع {amount})",
  "Next, a few questions from Q, then you review everything before it goes. When you submit,":
    "بعد ذلك، بضعة أسئلة من Q، ثم تراجع كل شيء قبل إرساله. عند التقديم،",
  "{fund} gets your answers and your note. Nothing else.":
    "يحصل {fund} على إجاباتك وملاحظتك. لا شيء غير ذلك.",
  "gets:": "يحصل على:",
  ", your answers": "، إجاباتك",
  " and your note": " وملاحظتك",
  "Continue to interview": "تابع إلى المقابلة",
  "Unanswered isn't a no, but this gate needs":
    "عدم الإجابة ليس رفضاً، لكن هذه البوابة تحتاج إلى",
  "{fund}'s rules still need an answer": "ما زالت قواعد {fund} تحتاج إلى إجابة",
  "{fund}'s rules don't admit this application":
    "قواعد {fund} لا تقبل هذا الطلب",
  "of their {n} rules, but this gate only accepts companies that meet all of the required ones. That's about fit, not quality.":
    "من قواعدهم الـ {n}، لكن هذه البوابة لا تقبل إلا الشركات التي تستوفي كل القواعد المطلوبة. الأمر يتعلق بالتوافق لا بالجودة.",
  "You meet all {n} of {fund}'s rules": "تستوفي كل قواعد {fund} الـ {n}",
  "You can apply to {fund}": "يمكنك التقدّم إلى {fund}",
  "Not in your mandate, so no rule:": "ليس في تفويضك، فلا قاعدة له:",

  // Contact step
  "Your contact details": "بيانات التواصل الخاصة بك",
  "Your details": "بياناتك",
  "Contact details to share": "بيانات التواصل للمشاركة",
  "Who receives this": "من يستلم هذا",
  "Your application goes to {fund}'s team only, and only when you press Submit at the end. They'll see these contact details, your answers, your interview with Q and any documents you choose. They may contact you at the email you confirm here.":
    "يذهب طلبك إلى فريق {fund} فقط، وفقط عندما تضغط «تقديم» في النهاية. سيرون بيانات التواصل هذه وإجاباتك ومقابلتك مع Q وأي مستندات تختارها. قد يتواصلون معك على البريد الإلكتروني الذي تؤكده هنا.",
  "So they know who's applying and how to reach you. We'll email you a code to confirm the address.":
    "ليعرفوا من المتقدّم وكيف يصلون إليك. سنرسل إليك رمزاً لتأكيد العنوان.",
  "From your account. Check they're right; there's no code to type when it's your account's email.":
    "من حسابك. تأكد من صحتها؛ لا رمز لكتابته عندما يكون البريد هو بريد حسابك.",
  "Full name": "الاسم الكامل",
  "Your name": "اسمك",
  "Add your full name.": "أضف اسمك الكامل.",
  Role: "الدور",
  "Your role": "دورك",
  "Like Founder & CEO": "مثل المؤسس والرئيس التنفيذي",
  "Add your role, like Founder & CEO.":
    "أضف دورك، مثل المؤسس والرئيس التنفيذي.",
  Email: "البريد الإلكتروني",
  "Email for their reply": "البريد الإلكتروني لردّهم",
  "Add an email so they can reply.": "أضف بريداً إلكترونياً ليتمكنوا من الرد.",
  "Add an email the investor can reach you at.":
    "أضف بريداً إلكترونياً يمكن للمستثمر التواصل معك عبره.",
  "That email doesn't look right.": "لا يبدو ذلك البريد الإلكتروني صحيحاً.",
  Phone: "الهاتف",
  "Use digits, spaces and an optional +.":
    "استخدم الأرقام والمسافات و+ اختيارية.",
  "Add a phone number, or choose email.":
    "أضف رقم هاتف، أو اختر البريد الإلكتروني.",
  "Best way to reach you": "أفضل طريقة للتواصل معك",
  "Preferred contact": "وسيلة التواصل المفضلة",
  "Confirm my email": "أكّد بريدي الإلكتروني",
  "Confirm email": "تأكيد البريد الإلكتروني",
  "Send confirmation code": "أرسل رمز التأكيد",
  "Check your email": "تحقّق من بريدك الإلكتروني",
  "Enter the 6-digit code we sent to":
    "أدخل الرمز المكوّن من 6 أرقام الذي أرسلناه إلى",
  "We sent a 6-digit code to {email}.": "أرسلنا رمزاً من 6 أرقام إلى {email}.",
  "We sent a 6-digit code to {email}. It works for {n} minutes.":
    "أرسلنا رمزاً من 6 أرقام إلى {email}. يعمل لمدة {n} دقيقة.",
  "The six-digit code we emailed to":
    "الرمز المكوّن من ستة أرقام الذي أرسلناه إلى",
  "Email confirmation code": "رمز تأكيد البريد الإلكتروني",
  "Enter the six-digit code from the email.":
    "أدخل الرمز المكوّن من ستة أرقام من الرسالة.",
  "Enter the six-digit code from your email.":
    "أدخل الرمز المكوّن من ستة أرقام من بريدك.",
  "The code is six digits.": "الرمز مكوّن من ستة أرقام.",
  "Confirm code": "تأكيد الرمز",
  "Confirm and continue": "أكّد وتابع",
  "Send a new code": "أرسل رمزاً جديداً",
  "That code didn't match. Please try again.":
    "لم يتطابق الرمز. يُرجى المحاولة مرة أخرى.",
  "That code isn't right. Try again.": "الرمز غير صحيح. حاول مرة أخرى.",
  "That code isn't right. Check the email and try again.":
    "الرمز غير صحيح. تحقّق من الرسالة وحاول مرة أخرى.",
  "That code has expired. Send a new code.":
    "انتهت صلاحية الرمز. أرسل رمزاً جديداً.",
  "That code has expired. Send a new one.":
    "انتهت صلاحية الرمز. أرسل رمزاً جديداً.",
  "That code has expired. Close this and ask again for a new one.":
    "انتهت صلاحية الرمز. أغلق هذا واطلب رمزاً جديداً.",
  "There's no code waiting. Send a new one.":
    "لا يوجد رمز بانتظارك. أرسل رمزاً جديداً.",
  "We couldn't send a code just now. Try sending it again.":
    "تعذّر إرسال الرمز الآن. حاول إرساله مرة أخرى.",
  "The confirmation email couldn't be sent. Check your address and try again.":
    "تعذّر إرسال رسالة التأكيد. تحقّق من عنوانك وحاول مرة أخرى.",
  "Check the email and try again.":
    "تحقّق من البريد الإلكتروني وحاول مرة أخرى.",
  "Checking…": "جارٍ التحقق…",
  Confirmed: "مؤكَّد",
  " (email confirmed)": " (البريد مؤكَّد)",
  " (not checked)": " (لم يُتحقَّق منه)",
  "Confirm your contact email before submitting.":
    "أكّد بريد التواصل قبل التقديم.",
  "Confirm your contact email before submitting. Your answers and interview are saved.":
    "أكّد بريد التواصل قبل التقديم. إجاباتك ومقابلتك محفوظة.",
  "Confirm your contact email first, so {fund} can reach you.":
    "أكّد بريد التواصل أولاً، ليتمكن {fund} من الوصول إليك.",
  "Change details": "تغيير البيانات",
  "Sign in again to confirm your details.":
    "سجّل الدخول مجدداً لتأكيد بياناتك.",
  "Please check your contact details.": "يُرجى التحقق من بيانات التواصل.",
  "Please check your details and try again.":
    "يُرجى التحقق من بياناتك والمحاولة مرة أخرى.",
  "Your details couldn't be saved.": "تعذّر حفظ بياناتك.",
  "Have a Capital Q account? Sign in on the gate's page to share your deck too.":
    "لديك حساب على Capital Q؟ سجّل الدخول في صفحة البوابة لمشاركة عرضك التقديمي أيضاً.",

  // Interview step
  "Interview with Q": "مقابلة مع Q",
  "A few questions from Q": "بضعة أسئلة من Q",
  "Let’s understand your company": "لنفهم شركتك",
  "Q is {fund}'s analyst. It has your answers and asks what an investor would want to know about {company}.":
    "Q هو محلل {fund}. لديه إجاباتك ويسأل عمّا قد يرغب المستثمر في معرفته عن {company}.",
  "Talk it through on video, or type if you prefer; both go into the same interview. ":
    "ناقش الأمر عبر الفيديو، أو اكتب إن كنت تفضّل؛ كلاهما يدخل في المقابلة نفسها. ",
  "Fifteen minutes at most; stop whenever you like. ":
    "خمس عشرة دقيقة على الأكثر؛ توقف متى شئت. ",
  "“I don't know” is a fine answer.": "«لا أعرف» إجابة مقبولة.",
  "Say hello, or start with what you most want {fund} to know. Q takes it from there.":
    "ألقِ التحية، أو ابدأ بأكثر ما تريد أن يعرفه {fund}. يتولى Q الأمر من هناك.",
  "Say hello": "ألقِ التحية",
  "Begin interview": "ابدأ المقابلة",
  "I'm ready to begin the investment interview.":
    "أنا مستعد لبدء مقابلة الاستثمار.",
  "Your answer": "إجابتك",
  "Answer, or paste a link": "أجب، أو الصق رابطاً",
  "Quick answers": "إجابات سريعة",
  "That’s all I can share for now": "هذا كل ما يمكنني مشاركته الآن",
  Send: "إرسال",
  "Sending…": "جارٍ الإرسال…",
  "Not sent.": "لم يُرسل.",
  "Your message is still here. ": "رسالتك ما زالت هنا. ",
  "Couldn't load the interview.": "تعذّر تحميل المقابلة.",
  "Interview paused": "المقابلة متوقفة مؤقتاً",
  "Everything you've said is saved with your application. Pick up where you left off whenever you're ready; keep this page open, it holds your place. Nothing goes to {fund} until you submit.":
    "كل ما قلته محفوظ مع طلبك. تابع من حيث توقفت متى كنت مستعداً؛ أبقِ هذه الصفحة مفتوحة فهي تحفظ مكانك. لا يذهب شيء إلى {fund} حتى تقدّم.",
  "Resume the interview": "استأنف المقابلة",
  "Pause interview": "أوقف المقابلة مؤقتاً",
  "Pause, come back later": "توقف مؤقتاً، وعُد لاحقاً",
  "End and review my application": "أنهِ وراجع طلبي",
  "Finish and review": "أنهِ وراجع",
  "Skip to review": "تخطَّ إلى المراجعة",
  "Keep answering": "تابع الإجابة",
  "Answer more with Q": "أجب عن المزيد مع Q",
  "Back to the interview": "العودة إلى المقابلة",
  "Back to my answers": "العودة إلى إجاباتي",
  "Your last answer needs confirmation. Retry it to recover Q's reply.":
    "تحتاج إجابتك الأخيرة إلى تأكيد. أعد المحاولة لاستعادة رد Q.",
  "Your last answer needs confirmation. Retry to recover Q’s reply.":
    "تحتاج إجابتك الأخيرة إلى تأكيد. أعد المحاولة لاستعادة رد Q.",
  "Recover your last interview answer before submitting.":
    "استعِد آخر إجابة في المقابلة قبل التقديم.",
  "That's a lot in a short time. Give it a few minutes, then carry on.":
    "هذا كثير في وقت قصير. امنحه بضع دقائق، ثم تابع.",
  "The connection was interrupted. Please try again.":
    "انقطع الاتصال. يُرجى المحاولة مرة أخرى.",
  "The connection was interrupted. Your answer is still here; please try again.":
    "انقطع الاتصال. إجابتك ما زالت هنا؛ يُرجى المحاولة مرة أخرى.",
  "The connection was interrupted. Your application is still here; please try again.":
    "انقطع الاتصال. طلبك ما زال هنا؛ يُرجى المحاولة مرة أخرى.",
  "The connection was interrupted. Your saved application is still here; please try again.":
    "انقطع الاتصال. طلبك المحفوظ ما زال هنا؛ يُرجى المحاولة مرة أخرى.",
  "Your answers are still here.": "إجاباتك ما زالت هنا.",
  "Sign in again to carry on.": "سجّل الدخول مجدداً للمتابعة.",
  "Q uses your answers and shared materials to ask focused follow-ups. You can say “I don’t know” or decline any question, and pause by closing this tab’s page.":
    "يستخدم Q إجاباتك والمواد المشارَكة لطرح أسئلة متابعة مركّزة. يمكنك قول «لا أعرف» أو رفض أي سؤال، والتوقف مؤقتاً بإغلاق صفحة هذا التبويب.",
  // Video interview
  "Talk with Q on video instead": "تحدّث مع Q عبر الفيديو بدلاً من ذلك",
  "Continue by video": "تابع عبر الفيديو",
  "Continue by typing instead": "تابع بالكتابة بدلاً من ذلك",
  "Type my answers instead": "سأكتب إجاباتي بدلاً من ذلك",
  "Start the video interview": "ابدأ مقابلة الفيديو",
  "A short video conversation, the way you would pitch {fund} in person. Q asks, you answer out loud; every answer is written into this application for you to review.":
    "محادثة فيديو قصيرة، كما لو كنت تعرض على {fund} شخصياً. يسأل Q وتجيب بصوت عالٍ؛ تُكتب كل إجابة في هذا الطلب لتراجعها.",
  "I understand Q is an AI interviewer, my camera and microphone are used only while the video room is open, and what I say is transcribed into this application. Nothing reaches {fund} until I review and submit.":
    "أفهم أن Q مُحاور بالذكاء الاصطناعي، وأن الكاميرا والميكروفون يُستخدمان فقط أثناء فتح غرفة الفيديو، وأن ما أقوله يُدوَّن في هذا الطلب. لا يصل شيء إلى {fund} حتى أراجع وأقدّم.",
  "Q is an AI interviewer. Your camera and microphone go to the video room only while it is open. What you say is transcribed into this application; nothing is sent to the investor until you review and submit.":
    "Q مُحاور بالذكاء الاصطناعي. تذهب الكاميرا والميكروفون إلى غرفة الفيديو فقط أثناء فتحها. يُدوَّن ما تقوله في هذا الطلب؛ ولا يُرسل شيء إلى المستثمر حتى تراجع وتقدّم.",
  "Tick the box above to start the video interview.":
    "حدّد المربع أعلاه لبدء مقابلة الفيديو.",
  "Short sessions; typing stays available.": "جلسات قصيرة؛ تبقى الكتابة متاحة.",
  "Opening the video room…": "جارٍ فتح غرفة الفيديو…",
  "Q is joining the room. Its video can take up to 20 seconds to appear.":
    "ينضم Q إلى الغرفة. قد يستغرق ظهور الفيديو حتى 20 ثانية.",
  "Video interview for {fund} (Q, an AI interviewer)":
    "مقابلة فيديو مع {fund} (Q، مُحاور بالذكاء الاصطناعي)",
  "Video isn't available right now. You can continue by typing.":
    "الفيديو غير متاح حالياً. يمكنك المتابعة بالكتابة.",
  "Time is up. Your answers so far are saved; you can continue by typing.":
    "انتهى الوقت. إجاباتك حتى الآن محفوظة؛ يمكنك المتابعة بالكتابة.",
  "We’re closing shortly. Finish your point; everything recorded so far is saved.":
    "سننهي قريباً. أكمل فكرتك؛ كل ما سُجّل حتى الآن محفوظ.",
  "You’ve used this week’s video sessions. You can carry on by typing.":
    "استخدمت جلسات الفيديو لهذا الأسبوع. يمكنك المتابعة بالكتابة.",
  "You’ve used this application’s video session. Carry on by typing; everything you said is kept.":
    "استخدمت جلسة الفيديو الخاصة بهذا الطلب. تابع بالكتابة؛ كل ما قلته محفوظ.",
  "You’ve used the {n} video sessions this application allows. Carry on by typing; everything you said is kept.":
    "استخدمت جلسات الفيديو الـ {n} التي يسمح بها هذا الطلب. تابع بالكتابة؛ كل ما قلته محفوظ.",
  "Starting…": "جارٍ البدء…",
  "Opening…": "جارٍ الفتح…",

  // Review step
  "Review your application": "راجع طلبك",
  "Review my application": "راجع طلبي",
  "Review before you submit": "راجع قبل أن تقدّم",
  "This is everything {fund} will receive. Nothing has been sent yet.":
    "هذا كل ما سيستلمه {fund}. لم يُرسل شيء بعد.",
  "Exactly what {fund} receives": "ما يستلمه {fund} بالضبط",
  "Your answers above, and how they stand against {fund}'s published rules":
    "إجاباتك أعلاه، وموقعها من القواعد المنشورة لـ {fund}",
  "Both versions go to {fund} as they are.":
    "تذهب النسختان إلى {fund} كما هما.",
  "Your interview with Q, word for word ({n} turns)":
    "مقابلتك مع Q، كلمة بكلمة ({n} أدوار)",
  "Documents you ticked: {list}": "المستندات التي حددتها: {list}",
  "Pick what {fund} should see. They only get what you tick.":
    "اختر ما ينبغي أن يراه {fund}. لا يحصلون إلا على ما تحدده.",
  "What to share": "ما الذي تشاركه",
  "Documents selected for submission": "المستندات المحددة للتقديم",
  "Nothing else from your Capital Q account goes with it.":
    "لا يذهب معه أي شيء آخر من حسابك على Capital Q.",
  "Nothing is sent until you press Submit.": "لا يُرسل شيء حتى تضغط «تقديم».",
  "They see these as your answers. Capital Q hasn't verified them.":
    "يرون هذه على أنها إجاباتك. لم يتحقق منها Capital Q.",
  "Not known yet: {list}.": "غير معروف بعد: {list}.",
  "Preferred not to say: {list}.": "فضّلت عدم الإفصاح: {list}.",
  "A few answers are still missing": "ما زالت بعض الإجابات ناقصة",
  "Change an answer": "غيّر إجابة",
  "Change your answer": "غيّر إجابتك",
  "Two answers disagree": "إجابتان متعارضتان",
  "Two answers disagree; one clarification settles it":
    "إجابتان متعارضتان؛ يحسم الأمر توضيح واحد",
  "Answers disagree": "الإجابات متعارضة",
  "Clear it up with Q": "وضّح الأمر مع Q",
  "Couldn't load your review.": "تعذّر تحميل مراجعتك.",
  "Submitting…": "جارٍ التقديم…",
  "Please check your answers and try again.":
    "يُرجى التحقق من إجاباتك والمحاولة مرة أخرى.",
  "Sign in again to share your documents.":
    "سجّل الدخول مجدداً لمشاركة مستنداتك.",
  "Your documents couldn't be shared.": "تعذّرت مشاركة مستنداتك.",
  "Documents can't be attached right now. Try again later.":
    "لا يمكن إرفاق المستندات حالياً. حاول لاحقاً.",
  "Thank you.": "شكراً لك.",
  "Thank you. {fund} has your application": "شكراً لك. وصل طلبك إلى {fund}",
  "Their team will review it, and may contact you.":
    "سيراجعه فريقهم، وقد يتواصلون معك.",
  "Their team will review it, and may contact you {reach}.":
    "سيراجعه فريقهم، وقد يتواصلون معك {reach}.",
  "by phone at {phone} or at {email}": "عبر الهاتف على {phone} أو على {email}",
  "at {email}": "على {email}",
  "{fund} has committed to reply within {n} working days. ":
    "التزم {fund} بالرد خلال {n} أيام عمل. ",
  " {fund} promises a reply within {n} working days.":
    " يلتزم {fund} بالرد خلال {n} أيام عمل.",
  "You'll see every step on your GateQ page, and Q will tell you if they reply.":
    "سترى كل خطوة في صفحة GateQ الخاصة بك، وسيخبرك Q إن ردّوا.",
  "The investment team will review your application and may contact you at your confirmed email address.":
    "سيراجع فريق الاستثمار طلبك وقد يتواصل معك على بريدك الإلكتروني المؤكد.",
  "See your applications": "اطّلع على طلباتك",
  "Your applications": "طلباتك",

  // The founder's GateQ page
  "No applications yet": "لا توجد طلبات بعد",
  "Many investors have a gate: a short form that tells you at once if you fit what they look for. Open one from an investor's profile or a link they shared.":
    "لدى كثير من المستثمرين بوابة: نموذج قصير يخبرك فوراً إن كنت تتوافق مع ما يبحثون عنه. افتح واحدة من ملف المستثمر أو من رابط شاركه.",
  "Find investors": "ابحث عن مستثمرين",
  "Find investors who fit": "ابحث عن مستثمرين متوافقين",
  "In your Discover": "في صفحة اكتشف لديك",
  "You're a member": "أنت عضو",
  "You're a member of your company. Admins send applications; you can see where each stands.":
    "أنت عضو في شركتك. يرسل المسؤولون الطلبات؛ ويمكنك رؤية موقف كل منها.",
  Member: "عضو",
  "You're a": "أنت",
  ": you can read applications, add notes and download packs. Admins reply and pass.":
    ": يمكنك قراءة الطلبات وإضافة الملاحظات وتنزيل الحزم. يتولى المسؤولون الرد والاعتذار.",
  "What's happened": "ما حدث",
  "They replied": "ردّوا",
  "Still open": "ما زال مفتوحاً",
  Sent: "أُرسل",
  "Sent {date}": "أُرسل {date}",
  Replied: "تم الرد",
  Passed: "تم الاعتذار",
  "Passed:": "تم الاعتذار:",
  "What you've told them": "ما أخبرتهم به",
  "What they shared": "ما شاركوه",

  // Investor: inbox
  "Search applications": "ابحث في الطلبات",
  Filter: "تصفية",
  Views: "العروض",
  "Sorted by reply-by date": "مرتبة حسب تاريخ الرد المطلوب",
  "Nothing in this view right now.": "لا شيء في هذا العرض حالياً.",
  "Nothing here": "لا شيء هنا",
  "Assigned to me": "مُسندة إليّ",
  Starred: "المميّزة بنجمة",
  Archived: "المؤرشفة",
  "Fits your rules": "تتوافق مع قواعدك",
  "Outside your rules": "خارج قواعدك",
  "Nothing checked": "لم يُفحص شيء",
  "Nothing checked yet": "لم يُفحص شيء بعد",
  "Reply overdue": "تأخر الرد",
  "Reply today": "الرد اليوم",
  Yesterday: "أمس",
  " · Applied {when}": " · تقدّم {when}",
  " · Raising {amount}": " · يجمع {amount}",
  "Select {name}": "تحديد {name}",
  "Select all": "تحديد الكل",
  "Clear selection": "مسح التحديد",
  "{n} selected": "{n} محددة",
  "Select up to {n} applications to compare.": "حدّد حتى {n} طلبات للمقارنة.",
  "Select up to": "حدّد حتى",
  "applications to compare.": "طلبات للمقارنة.",
  Compare: "قارن",
  "Compare submitted applications": "قارن الطلبات المقدَّمة",
  "Download pack": "نزّل الحزمة",
  "Download packs": "نزّل الحزم",
  "Download zip": "نزّل ملف zip",
  "Preparing {n} packs.": "جارٍ تجهيز {n} حزم.",
  Pack: "الحزمة",
  "One zip with everything {name} shared with you, with your name on the summary. Your team notes are never in it.":
    "ملف zip واحد بكل ما شاركه {name} معك، مع اسمك على الملخص. ملاحظات فريقك لا تكون فيه أبداً.",
  "Included if the founder allows downloads; otherwise noted in the summary":
    "يُضمَّن إن سمح المؤسس بالتنزيل؛ وإلا يُذكر في الملخص",
  "In the download pack when the founder allows downloads":
    "في حزمة التنزيل عندما يسمح المؤسس بالتنزيل",
  Star: "تمييز بنجمة",
  Unstar: "إزالة النجمة",
  Archive: "أرشفة",
  "Archived.": "تمت الأرشفة.",
  Assign: "إسناد",
  "Assigned.": "تم الإسناد.",
  "Unassigned.": "أُلغي الإسناد.",
  "Assigned to {name}": "مُسندة إلى {name}",
  Label: "تصنيف",
  "New label": "تصنيف جديد",
  "New label, like IC next week":
    "تصنيف جديد، مثل «لجنة الاستثمار الأسبوع القادم»",
  'Labelled "{label}".': "صُنّف «{label}».",
  "More: label, archive": "المزيد: تصنيف، أرشفة",
  "Keyboard shortcuts": "اختصارات لوحة المفاتيح",
  "Keyboard shortcuts are off. ": "اختصارات لوحة المفاتيح معطّلة. ",
  "Keys:": "المفاتيح:",
  "Next / previous": "التالي / السابق",
  Enter: "Enter",
  Escape: "Escape",
  "Back to inbox": "العودة إلى الوارد",
  "Back to the list": "العودة إلى القائمة",
  "{name}'s application": "طلب {name}",
  "That application isn't in your GateQ inbox, or you don't have access to it. Nothing else has been opened in its place.":
    "ذلك الطلب ليس في وارد GateQ لديك، أو ليس لديك وصول إليه. لم يُفتح شيء آخر مكانه.",
  "Unavailable application": "طلب غير متاح",
  Unavailable: "غير متاح",
  Dossier: "الملف",
  Triage: "الفرز",
  "Q's triage": "فرز Q",
  "Q proposes what to look at first, what to ask for and which to prepare a pass for. You approve.":
    "يقترح Q ما يُنظر فيه أولاً، وما يُطلب، وأيها يُعدّ له اعتذار. وأنت توافق.",
  "From your gate's rules and your reply promise. Proposals only: nothing is sent or changed until you say so.":
    "من قواعد بوابتك والتزامك بالرد. مقترحات فقط: لا يُرسل شيء ولا يتغيّر حتى تقول ذلك.",
  "Look at first": "انظر فيه أولاً",
  "Look at it yourself": "انظر فيه بنفسك",
  "Worth a look": "يستحق النظر",
  "Ask for more": "اطلب المزيد",
  "Prepare a pass": "أعدّ اعتذاراً",
  "Prepare {n} pass": "أعدّ {n} اعتذارات",
  "Meets every rule of your gate.": "يستوفي كل قواعد بوابتك.",
  "Meets every rule of your gate, and your reply promise is close.":
    "يستوفي كل قواعد بوابتك، وموعد التزامك بالرد قريب.",
  "A required rule of your gate isn't met. If you pass, they get a reason.":
    "قاعدة مطلوبة في بوابتك غير مستوفاة. إن اعتذرت، يحصلون على سبب.",
  "Your gate has no published rules, so nothing was checked. Draft criteria from your mandate to sort what arrives.":
    "ليس لبوابتك قواعد منشورة، لذا لم يُفحص شيء. صُغ معايير من تفويضك لفرز ما يصل.",
  "Q never passes on your behalf.": "لا يعتذر Q نيابة عنك أبداً.",
  Later: "لاحقاً",
  // Reply and pass
  Reply: "ردّ",
  "Reply to {name}": "الرد على {name}",
  "To {name}": "إلى {name}",
  "the founder": "المؤسس",
  "Your message": "رسالتك",
  "Message to the founder": "رسالة إلى المؤسس",
  "Write the reply first.": "اكتب الرد أولاً.",
  "Reply sent.": "أُرسل الرد.",
  "Sent only when you press Send, exactly as shown.":
    "لا يُرسل إلا عندما تضغط «إرسال»، كما هو معروض تماماً.",
  "Sent only when you press the button, exactly as shown. Founders always get a reason.":
    "لا يُرسل إلا عندما تضغط الزر، كما هو معروض تماماً. يحصل المؤسسون دائماً على سبب.",
  Pass: "اعتذار",
  "Pass…": "اعتذار…",
  "Pass (with a reason)": "اعتذار (مع سبب)",
  "Pass on {name}": "الاعتذار عن {name}",
  "Pass on {n} applications": "الاعتذار عن {n} طلبات",
  "Send and pass": "أرسل واعتذر",
  "Send {n} and pass": "أرسل {n} واعتذر",
  "Main reason": "السبب الرئيسي",
  "Outside our stage": "خارج مرحلتنا",
  "Outside our sector": "خارج قطاعنا",
  "Cheque doesn't fit": "حجم الشيك لا يتناسب",
  Timing: "التوقيت",
  "Pick a reason and write the message first.":
    "اختر سبباً واكتب الرسالة أولاً.",
  "Sent. Moved to Passed.": "أُرسل. نُقل إلى «تم الاعتذار».",
  "Passed with a reason. They got: “": "تم الاعتذار مع سبب. وصلهم: «",
  "Hi,": "مرحباً،",
  "Hi {name},": "مرحباً {name}،",
  // Team notes
  "Team notes": "ملاحظات الفريق",
  "Only {fund} sees these": "لا يرى هذه إلا {fund}",
  "Add a note for your team": "أضف ملاحظة لفريقك",
  "Add note": "أضف ملاحظة",
  "Noted for your team.": "سُجّلت لفريقك.",
  "No note.": "لا توجد ملاحظة.",
  "Their note": "ملاحظتهم",
  "Founder's note": "ملاحظة المؤسس",
  "Ask a colleague": "اسأل زميلاً",
  "Book a call": "احجز مكالمة",
  "Contact company": "تواصل مع الشركة",
  "No contact on record.": "لا توجد بيانات تواصل مسجّلة.",

  // Dossier and submitted brief
  "Submitted GateQ application": "طلب GateQ مقدَّم",
  "Submitted investment brief": "الموجز الاستثماري المقدَّم",
  "Submitted company and contact": "الشركة وبيانات التواصل المقدَّمة",
  "Submitted information": "المعلومات المقدَّمة",
  "Submitted form answers": "إجابات النموذج المقدَّمة",
  "Submitted mandate qualification": "تأهيل التفويض المقدَّم",
  "Submitted investment dimensions": "الأبعاد الاستثمارية المقدَّمة",
  "Submitted diligence questions": "أسئلة العناية الواجبة المقدَّمة",
  "Submitted interview transcript": "نص المقابلة المقدَّم",
  "Submitted documents": "المستندات المقدَّمة",
  "Frozen from the founder's submission. Investment decisions remain with your team.":
    "مُثبّت من تقديم المؤسس. تبقى قرارات الاستثمار لفريقك.",
  "Frozen at submission ·": "مُثبّت عند التقديم ·",
  "Deterministic summary ·": "ملخص حتمي ·",
  "The founder's claims and documents. Capital Q hasn't verified them.":
    "ادعاءات المؤسس ومستنداته. لم يتحقق منها Capital Q.",
  "Their own claims, not verified.": "ادعاءاتهم الخاصة، غير متحقَّق منها.",
  "Claims, estimates and their recorded evidence are shown separately.":
    "تُعرض الادعاءات والتقديرات والأدلة المسجّلة لها كلٌّ على حدة.",
  "Company proposition": "عرض القيمة للشركة",
  "Company evidence by investment dimension":
    "أدلة الشركة حسب البعد الاستثماري",
  "No investment-dimension claims were recorded.":
    "لم تُسجَّل ادعاءات للأبعاد الاستثمارية.",
  "No facts recorded.": "لا توجد حقائق مسجّلة.",
  "Published mandate qualification": "التأهيل وفق التفويض المنشور",
  Qualification: "التأهيل",
  "Qualifies under your published rules": "مؤهل وفق قواعدك المنشورة",
  "Doesn't qualify under your published rules": "غير مؤهل وفق قواعدك المنشورة",
  "Meets the published mandate": "يستوفي التفويض المنشور",
  "Outside the published mandate": "خارج التفويض المنشور",
  "More information needed for mandate qualification":
    "يلزم مزيد من المعلومات للتأهيل وفق التفويض",
  "Not enough information to decide": "لا توجد معلومات كافية للحسم",
  "Required by the published mandate": "مطلوب وفق التفويض المنشور",
  "Preferred by the published mandate": "مفضّل وفق التفويض المنشور",
  "Required by your rules": "مطلوب وفق قواعدك",
  "Preferred by your rules": "مفضّل وفق قواعدك",
  "Your published rules, criterion by criterion":
    "قواعدك المنشورة، معياراً تلو الآخر",
  "Company, round, your rules and how they stood":
    "الشركة والجولة وقواعدك وموقفها منها",
  "No published criteria checked": "لم تُفحص أي معايير منشورة",
  "No published criteria were checked": "لم تُفحص أي معايير منشورة",
  "No published rules yet, so nothing was checked.":
    "لا توجد قواعد منشورة بعد، لذا لم يُفحص شيء.",
  "No published rules, so nothing was checked.":
    "لا توجد قواعد منشورة، لذا لم يُفحص شيء.",
  Meets: "يستوفي",
  "Doesn't meet": "لا يستوفي",
  "Not covered": "غير مشمول",
  "Not applicable": "لا ينطبق",
  Required: "مطلوب",
  Preferred: "مفضّل",
  Prefers: "يفضّل",
  Rule: "القاعدة",
  "Evidence gaps": "ثغرات الأدلة",
  "Evidence gaps and contradictions": "ثغرات الأدلة والتعارضات",
  "No gaps recorded": "لا توجد ثغرات مسجّلة",
  "No conflicts recorded": "لا توجد تعارضات مسجّلة",
  "No gaps or contradictions were recorded. This does not establish independent verification.":
    "لم تُسجَّل ثغرات أو تعارضات. لا يُعدّ ذلك تحققاً مستقلاً.",
  "Conflicting answers": "إجابات متعارضة",
  "Answers that disagree": "إجابات متعارضة",
  "Missing answer": "إجابة ناقصة",
  "Missing information": "معلومات ناقصة",
  "Missing ·": "ناقص ·",
  "Still missing": "ما زال ناقصاً",
  "What's still needed": "ما زال مطلوباً",
  "What we have": "ما لدينا",
  "What we have, what's still needed": "ما لدينا، وما زال مطلوباً",
  "What's still open, listed as open": "ما زال مفتوحاً، مُدرجاً كمفتوح",
  "Open questions": "أسئلة مفتوحة",
  "Needs clarification": "يحتاج إلى توضيح",
  "To clarify": "للتوضيح",
  "To ask": "للسؤال",
  "Questions for diligence": "أسئلة للعناية الواجبة",
  "Suggested diligence questions": "أسئلة مقترحة للعناية الواجبة",
  "Saved diligence questions": "أسئلة العناية الواجبة المحفوظة",
  "No diligence questions were recorded.": "لم تُسجَّل أسئلة للعناية الواجبة.",
  "Q's reading": "قراءة Q",
  "Q's reading of this submission isn't ready yet.":
    "قراءة Q لهذا التقديم ليست جاهزة بعد.",
  "Q synthesis: not yet available.": "خلاصة Q: غير متاحة بعد.",
  "Q's inference from this submission only. Not verified, not a score and not a decision.":
    "استنتاج Q من هذا التقديم فقط. ليس متحقَّقاً منه، وليس درجة ولا قراراً.",
  "Q's view, not a verified fact": "رأي Q، وليس حقيقة متحقَّقاً منها",
  "Q inference": "استنتاج Q",
  "Derived by Q": "مستخلص من Q",
  "Derived by Q, not said in these words": "مستخلص من Q، ولم يُقل بهذه الكلمات",
  "Drafted by Q": "صاغه Q",
  "Applicant claim": "ادعاء المتقدّم",
  "Applicant provided": "قدّمه المتقدّم",
  "Founder stated": "صرّح به المؤسس",
  "Self reported": "مُبلَّغ ذاتياً",
  Estimate: "تقدير",
  Estimated: "مُقدَّر",
  "Your estimate": "تقديرك",
  "Document supported": "مدعوم بمستند",
  "Document-supported": "مدعوم بمستند",
  "Document support recorded": "دعم بمستند مسجّل",
  "Supported by a shared document": "مدعوم بمستند مُشارَك",
  "Document support is recorded for some claims. Exact document, page or section references are not available in this brief.":
    "دعم المستندات مسجّل لبعض الادعاءات. مراجع المستند أو الصفحة أو القسم الدقيقة غير متاحة في هذا الموجز.",
  "A document would support": "مستند سيدعم",
  ". These stay your stated claims until evidence is shared.":
    ". تبقى هذه ادعاءاتك المعلنة حتى تُشارَك الأدلة.",
  "No evidence recorded": "لا توجد أدلة مسجّلة",
  "Source not recorded": "المصدر غير مسجّل",
  "Structured evidence coverage was not recorded for this submission":
    "لم تُسجَّل تغطية الأدلة المنظمة لهذا التقديم",
  "Evidence:": "الدليل:",
  "Truth:": "الحقيقة:",
  "Origin:": "المصدر:",
  "From:": "من:",
  "Not provided": "لم يُقدَّم",
  "Not recorded": "غير مسجّل",
  "Not recorded in this submission": "غير مسجّل في هذا التقديم",
  "Not answered": "لم تتم الإجابة",
  Unknown: "غير معروف",
  "Unknown ·": "غير معروف ·",
  "Unknown answer": "إجابة غير معروفة",
  "Unknown to the founder": "غير معروف للمؤسس",
  "Founder didn't know": "لم يعرف المؤسس",
  "Founder declined": "رفض المؤسس",
  "Founder preferred not to say": "فضّل المؤسس عدم الإفصاح",
  "Preferred not to say": "فضّل عدم الإفصاح",
  "You'd rather not say": "تفضّل عدم الإفصاح",
  "You don't know yet": "لا تعرف بعد",
  "Unknown is never counted as a no.": "لا يُحتسب غير المعروف رفضاً أبداً.",
  "Unknown isn't a no.": "غير المعروف ليس رفضاً.",
  "Unknown isn't a no. {fund} sees these as open.":
    "غير المعروف ليس رفضاً. يراها {fund} مفتوحة.",
  "Declined ·": "رفض ·",
  "Name not given": "لم يُذكر الاسم",
  "Declared country": "الدولة المعلنة",
  "Declared raise": "التمويل المعلن",
  "Declared sectors": "القطاعات المعلنة",
  "Declared stage": "المرحلة المعلنة",
  "Round size": "حجم الجولة",
  Location: "الموقع",
  Description: "الوصف",
  Contact: "التواصل",
  "Company profile": "ملف الشركة",
  Fundraising: "جمع التمويل",
  Traction: "الزخم",
  Team: "الفريق",
  Market: "السوق",
  Risk: "المخاطر",
  "Business model": "نموذج العمل",
  Financials: "البيانات المالية",
  Product: "المنتج",
  Strength: "نقطة قوة",
  "Interview transcript": "نص المقابلة",
  "Interview transcript · {n} turns": "نص المقابلة · {n} أدوار",
  "interview turn {n}": "دور المقابلة {n}",
  "Interview turn": "دور المقابلة",
  Turn: "الدور",
  "Founder interview with Q": "مقابلة المؤسس مع Q",
  "Conversation with Q": "محادثة مع Q",
  "Review full transcript": "راجع النص الكامل",
  "The founder's interview exactly as submitted. Claims and Q's questions retain their original wording.":
    "مقابلة المؤسس كما قُدّمت تماماً. تحتفظ الادعاءات وأسئلة Q بصياغتها الأصلية.",
  "The founder skipped the interview.": "تخطّى المؤسس المقابلة.",
  "No interview: you skipped it": "لا مقابلة: تخطيتها",
  "No interview transcript was included in this submission.":
    "لم يُضمَّن نص مقابلة في هذا التقديم.",
  "The submitted interview contains no turns.":
    "لا تحتوي المقابلة المقدَّمة على أي أدوار.",
  "This submission records {n} interview turns. The transcript is unavailable in this response.":
    "يسجّل هذا التقديم {n} أدوار للمقابلة. النص غير متاح في هذه الاستجابة.",
  "No documents": "لا توجد مستندات",
  "No documents submitted": "لم تُقدَّم مستندات",
  "No documents with the dossier.": "لا توجد مستندات مع الملف.",
  "No documents were attached to this submission.":
    "لم تُرفق مستندات بهذا التقديم.",
  "Nothing was shared": "لم يُشارَك شيء",
  "Nothing answered yet.": "لم تتم الإجابة عن شيء بعد.",
  "Nothing recorded yet. Answers appear here once they are saved.":
    "لم يُسجَّل شيء بعد. تظهر الإجابات هنا بعد حفظها.",
  "Helps the investor understand the company": "يساعد المستثمر على فهم الشركة",
  "Helps them understand you": "يساعدهم على فهمك",
  "Needed to understand the company": "مطلوب لفهم الشركة",
  "For understanding": "للفهم",
  "Their rules need this": "قواعدهم تتطلب هذا",
  "They prefer to know": "يفضّلون أن يعرفوا",
  "Not needed": "غير مطلوب",
  "Answer it": "أجب عنه",
  "Application data for your CRM": "بيانات الطلب لعلاقاتك",
  "Correct form answers": "صحّح إجابات النموذج",
  "Nothing outstanding for {fund}'s published mandate.":
    "لا شيء معلّق بالنسبة إلى التفويض المنشور لـ {fund}.",
  // Comparison
  "Submitted application comparison": "مقارنة الطلبات المقدَّمة",
  "Application comparison table": "جدول مقارنة الطلبات",
  "Selected GateQ applications": "طلبات GateQ المحددة",
  "Saved submitted applications compared side by side":
    "الطلبات المقدَّمة المحفوظة مقارنةً جنباً إلى جنب",
  "Saved submission data, compared side by side. Claims and evidence retain their recorded status. Your team makes the investment decision.":
    "بيانات التقديم المحفوظة، مقارنةً جنباً إلى جنب. تحتفظ الادعاءات والأدلة بحالتها المسجّلة. فريقك من يتخذ قرار الاستثمار.",
  "Loading selected submissions…": "جارٍ تحميل التقديمات المحددة…",
  "Couldn't load every selected application. Nothing was compared. Check your selection and try again.":
    "تعذّر تحميل كل الطلبات المحددة. لم تتم أي مقارنة. تحقّق من تحديدك وحاول مرة أخرى.",
  "Invalid selection": "تحديد غير صالح",

  // Investor: find a startup
  "Describe the company you're looking for": "صِف الشركة التي تبحث عنها",
  "Try: “climate hardware in East Africa”":
    "جرّب: «أجهزة المناخ في شرق أفريقيا»",
  "Climate hardware in East Africa": "أجهزة المناخ في شرق أفريقيا",
  "Seed fintech in Nigeria or Ghana, raising under $2M":
    "تقنية مالية في المرحلة التأسيسية في نيجيريا أو غانا، تجمع أقل من 2 مليون دولار",
  "No company on Capital Q matches all of that yet":
    "لا توجد شركة على Capital Q تطابق كل ذلك بعد",
  "Save it as an alert and it stays on your Find tab. Or loosen one part of the description.":
    "احفظه كتنبيه ليبقى في تبويب البحث. أو خفّف جزءاً من الوصف.",
  "Save as alert": "احفظ كتنبيه",
  "Saved as an alert. It never changes your mandate.":
    "حُفظ كتنبيه. لا يغيّر تفويضك أبداً.",
  "Showing companies open to everyone. Verify your firm to search companies that share only with verified investors.":
    "تُعرض الشركات المتاحة للجميع. وثّق شركتك الاستثمارية للبحث في الشركات التي لا تشارك إلا مع المستثمرين الموثّقين.",

  // Investor: your gate
  "You don't have a gate yet": "ليست لديك بوابة بعد",
  "A gate is a short form on your own link, QR code or website. Founders check their fit with your rules in two minutes, and only those who fit can send.":
    "البوابة نموذج قصير على رابطك أو رمز QR أو موقعك الإلكتروني. يفحص المؤسسون توافقهم مع قواعدك في دقيقتين، ولا يرسل إلا المتوافقون.",
  "Open my gateway": "افتح بوابتي",
  "Open your gateway first.": "افتح بوابتك أولاً.",
  "Only an investor organisation has a gateway.":
    "لا تملك البوابة إلا مؤسسة استثمارية.",
  "Only admins of your firm can change the gate. You can copy and share the link.":
    "لا يستطيع تغيير البوابة إلا مسؤولو شركتك الاستثمارية. يمكنك نسخ الرابط ومشاركته.",
  "Share your gate": "شارِك بوابتك",
  "Share your gate and founders can check their fit with you in two minutes. Only companies that meet your rules can send.":
    "شارِك بوابتك ليتمكن المؤسسون من فحص توافقهم معك في دقيقتين. لا ترسل إلا الشركات التي تستوفي قواعدك.",
  "Send them your gate link. They check their fit in two minutes.":
    "أرسل لهم رابط بوابتك. يفحصون توافقهم في دقيقتين.",
  "Your gate link": "رابط بوابتك",
  "Copy gate link": "انسخ رابط البوابة",
  "Copy link": "انسخ الرابط",
  Copied: "تم النسخ",
  "Gate link copied": "تم نسخ رابط البوابة",
  "QR code": "رمز QR",
  "QR code for your gate": "رمز QR لبوابتك",
  "Your gate's QR code": "رمز QR لبوابتك",
  "Website snippet": "مقتطف للموقع الإلكتروني",
  "Also as a QR code and a snippet for your website.":
    "متوفر أيضاً كرمز QR ومقتطف لموقعك الإلكتروني.",
  "Preview the form": "معاينة النموذج",
  "Who can apply": "من يمكنه التقدّم",
  Anyone: "أي شخص",
  "Anyone can send. Founders still see your rules and how they stand.":
    "يمكن لأي شخص الإرسال. يرى المؤسسون قواعدك وموقفهم منها.",
  "Only companies that meet my rules": "الشركات التي تستوفي قواعدي فقط",
  "Founders who don't meet a rule see why, and can't send. Unanswered questions never count as a no.":
    "يرى المؤسسون الذين لا يستوفون قاعدة السبب ولا يمكنهم الإرسال. الأسئلة غير المُجاب عنها لا تُحتسب رفضاً أبداً.",
  Nobody: "لا أحد",
  "Your gate is closed. Founders see that you're not taking applications right now.":
    "بوابتك مغلقة. يرى المؤسسون أنك لا تستقبل طلبات حالياً.",
  Closed: "مغلقة",
  "We reply to every qualified application within": "نردّ على كل طلب مؤهل خلال",
  "Working days": "أيام العمل",
  "Use a number of working days from 1 to 60.":
    "استخدم عدداً من أيام العمل بين 1 و60.",
  "Reply-by date": "تاريخ الرد المطلوب",
  "No reply promise yet.": "لا يوجد التزام بالرد بعد.",
  "No promise shown.": "لا يُعرض التزام.",
  "Saved. Founders see it before they apply.":
    "تم الحفظ. يراه المؤسسون قبل التقدّم.",
  // Rules (policy editor)
  "Your rules": "قواعدك",
  "Your gate's rules": "قواعد بوابتك",
  "No rules yet": "لا توجد قواعد بعد",
  "Draft rules with Q": "صُغ القواعد مع Q",
  "Draft criteria from your mandate": "صُغ المعايير من تفويضك",
  "Paste your mandate or thesis. Q drafts the rules founders are checked against; you confirm each one.":
    "الصق تفويضك أو أطروحتك. يصوغ Q القواعد التي يُفحص المؤسسون وفقها؛ وأنت تؤكد كل واحدة.",
  "Paste an updated mandate and Q drafts new rules. Your current rules stay until you publish.":
    "الصق تفويضاً محدّثاً وسيصوغ Q قواعد جديدة. تبقى قواعدك الحالية حتى تنشر.",
  "Paste your mandate first.": "الصق تفويضك أولاً.",
  "We invest $250k to $1.5m in pre-seed to Series A fintech in West Africa and Kenya. We don't invest in online betting.":
    "نستثمر من 250 ألف إلى 1.5 مليون دولار في شركات التقنية المالية من مرحلة ما قبل التأسيس إلى الفئة A في غرب أفريقيا وكينيا. لا نستثمر في المراهنات الإلكترونية.",
  "Q reads text and Markdown files here. For a PDF, paste its text.":
    "يقرأ Q هنا الملفات النصية وملفات Markdown. لملف PDF، الصق نصه.",
  "That file is too large. Paste the mandate text instead.":
    "ذلك الملف كبير جداً. الصق نص التفويض بدلاً منه.",
  "Upload a file": "ارفع ملفاً",
  "Q couldn't find rules in that text": "تعذّر على Q إيجاد قواعد في ذلك النص",
  "Couldn't read that just now. Please try again.":
    "تعذّرت قراءة ذلك الآن. يُرجى المحاولة مرة أخرى.",
  "Q drafted {n} rule. Check each one.": "صاغ Q قاعدة واحدة ({n}). راجعها.",
  "Q drafted {n} rules. Check each one.": "صاغ Q {n} قواعد. راجع كل واحدة.",
  "Nothing is live until you publish. Remove anything Q read wrong.":
    "لا يُفعَّل شيء حتى تنشر. أزل أي شيء قرأه Q خطأً.",
  "From your mandate: “": "من تفويضك: «",
  "Name founders see for the {dimension} rule":
    "الاسم الذي يراه المؤسسون لقاعدة {dimension}",
  stage: "المرحلة",
  "where they're based": "مكان المقر",
  sector: "القطاع",
  "cheque size": "حجم الشيك",
  "Remove the {label} rule": "أزل قاعدة {label}",
  "Not {value}": "ليس {value}",
  "Remove {value}": "إزالة {value}",
  "How strict": "مدى الصرامة",
  "Smallest cheque": "أصغر شيك",
  "Largest cheque (empty for no ceiling)":
    "أكبر شيك (اتركه فارغاً لعدم وجود سقف)",
  "Cheque size": "حجم الشيك",
  "One of the rules isn't complete.": "إحدى القواعد غير مكتملة.",
  "You mentioned not investing in": "ذكرت أنك لا تستثمر في",
  ". Places are only ever an allow-list here, so Q left that out.":
    ". الأماكن هنا قائمة سماح فقط، لذا استبعد Q ذلك.",
  "Your mandate stays private. Founders see only the name of each rule, never its values or your text.":
    "يبقى تفويضك خاصاً. لا يرى المؤسسون إلا اسم كل قاعدة، لا قيمها ولا نصك.",
  "Publish these rules": "انشر هذه القواعد",
  "Publish with no rules (open to all)": "انشر دون قواعد (مفتوحة للجميع)",
  "Publishing…": "جارٍ النشر…",
  "Published. Founders are now checked against these rules.":
    "تم النشر. يُفحص المؤسسون الآن وفق هذه القواعد.",
  "Couldn't publish just now. Please try again.":
    "تعذّر النشر الآن. يُرجى المحاولة مرة أخرى.",
  "No published criteria yet, so nothing is checked: founders see no judgement either way. Give Q your mandate and it drafts the criteria; you confirm each one.":
    "لا توجد معايير منشورة بعد، لذا لا يُفحص شيء: لا يرى المؤسسون أي حكم في أي اتجاه. أعطِ Q تفويضك ليصوغ المعايير؛ وأنت تؤكد كل واحد.",
  "No published criteria yet: nothing is checked, and every founder can share with them.":
    "لا توجد معايير منشورة بعد: لا يُفحص شيء، ويمكن لكل مؤسس المشاركة معهم.",
  "Companies don't share this with Capital Q yet, so it isn't checked":
    "لا تشارك الشركات هذا مع Capital Q بعد، لذا لا يُفحص",
  "Our fund": "صندوقنا",
  Elsewhere: "في مكان آخر",
  Never: "أبداً",
  // Stages, sectors, countries
  "Pre-seed": "ما قبل التأسيس",
  Seed: "التأسيسية",
  "Series A": "الفئة A",
  "Series B": "الفئة B",
  "Series C+": "الفئة C فما فوق",
  Agriculture: "الزراعة",
  Climate: "المناخ",
  Commerce: "التجارة",
  Fintech: "التقنية المالية",
  Health: "الصحة",
  Software: "البرمجيات",
  // Country names come from the one canonical country list (taxonomy).
  "Pitch deck": "العرض التقديمي",
  "Financial model": "النموذج المالي",
  "Management accounts": "الحسابات الإدارية",
  "One-page summary": "ملخص من صفحة واحدة",
  // Shared words
  Back: "رجوع",
  Cancel: "إلغاء",
  Change: "تغيير",
  Confirm: "تأكيد",
  Continue: "متابعة",
  Done: "تم",
  Edit: "تعديل",
  Open: "فتح",
  Review: "مراجعة",
  Save: "حفظ",
  "Saving…": "جارٍ الحفظ…",
  Select: "تحديد",
  Share: "مشاركة",
  "Sharing…": "جارٍ المشاركة…",
  Status: "الحالة",
  Type: "النوع",
  What: "ماذا",
  Yes: "نعم",
  Add: "إضافة",
  "Not now": "ليس الآن",
  "Not found": "غير موجود",
  "Not found.": "غير موجود.",
  "Not saved.": "لم يُحفظ.",
  Documents: "المستندات",
  Company: "الشركة",
  Founder: "المؤسس",
  "Optional.": "اختياري.",
  "A short note": "ملاحظة قصيرة",
  "A note for the admins (optional)": "ملاحظة للمسؤولين (اختياري)",
  "Your note": "ملاحظتك",
  "Please try again.": "يُرجى المحاولة مرة أخرى.",
  "Couldn't reach Capital Q just now. Please try again.":
    "تعذّر الوصول إلى Capital Q الآن. يُرجى المحاولة مرة أخرى.",
  "That didn't go through. Please try again.":
    "لم تتم العملية. يُرجى المحاولة مرة أخرى.",
  "I lead product, joined in May": "أقود المنتج، انضممت في مايو",
  "1 company matches": "شركة واحدة مطابقة",
  "{n} companies match": "{n} شركات مطابقة",
  "working days.": "أيام عمل.",
  "working days": "أيام عمل",
  "Origin: {origin} · Truth:": "المصدر: {origin} · الحقيقة:",
  "· Evidence:": "· الدليل:",
  UTC: "UTC",
  "· Turn": "· الدور",
  "{n} application outside your rules is under Not a fit. ":
    "{n} طلب خارج قواعدك ضمن «غير متوافق». ",
  "{n} applications outside your rules are under Not a fit. ":
    "{n} طلبات خارج قواعدك ضمن «غير متوافق». ",
  "move,": "للتنقل،",
  "select,": "للتحديد،",
  "star,": "للتمييز بنجمة،",
  "archive,": "للأرشفة،",
  "pass,": "للاعتذار،",
  "search.": "للبحث.",
  "(unread)": "(غير مقروء)",
  "Their answers": "إجاباتهم",
  "to review": "للمراجعة",
  "(confirmed by their account)": "(مؤكد عبر حسابهم)",
  "(confirmed by email code)": "(مؤكد برمز البريد)",
  "(not confirmed)": "(غير مؤكد)",
  "What the founder told you": "ما أخبرك به المؤسس",
  turn: "دور",
  "you@{domain}": "you@{domain}",
  to: "إلى",
  "{n} documents attached to this application.":
    "{n} مستندات مرفقة بهذا الطلب.",
  "documents attached to this application.": "مستندات مرفقة بهذا الطلب.",
  "6-digit code": "رمز من 6 أرقام",
  meets: "يستوفي",
  "Apply to": "تقدّم إلى",
  rule: "قاعدة",
  "(pick any)": "(اختر أياً منها)",
  "{fund} may contact you at": "قد يتواصل معك {fund} على",
  ", the email you confirmed.": "، البريد الإلكتروني الذي أكدته.",
  "to decide.": "للحسم.",
  "{fund} gets:": "يحصل {fund} على:",
  "Email ownership confirmed": "ملكية البريد مؤكدة",
  "Email ownership not confirmed": "ملكية البريد غير مؤكدة",
  Find: "بحث",
  selected: "محددة",
  "· Submitted": "· قُدِّم",
  "· preferred": "· مفضّل",
  "· required": "· مطلوب",

  // Design gateq-2 (2026-10-21): three panes, the dossier and your gate
  Qualifies: "مؤهَّل",
  "Answers disagree.": "الإجابات متعارضة.",
  "Both are kept until you ask.": "تُحفظ الإجابتان حتى تسأل.",
  "Doesn't qualify": "غير مؤهَّل",
  "Doesn't qualify under your published rules: a required rule isn't met.":
    "غير مؤهَّل وفق قواعدك المنشورة: قاعدة مطلوبة غير مستوفاة.",
  "Not enough information to decide.": "لا توجد معلومات كافية للحكم.",
  "Not enough information to decide: {n} rules not answered.":
    "لا توجد معلومات كافية للحكم: {n} قواعد بلا إجابة.",
  "Not enough information to decide: {n} rule not answered.":
    "لا توجد معلومات كافية للحكم: {n} قاعدة بلا إجابة.",
  "Reply by {date}": "الرد قبل {date}",
  Round: "الجولة",
  "Pass with a reason": "اعتذر مع ذكر السبب",
  "Prepare a pass: {name}": "جهّز اعتذارًا: {name}",
  "Prepare {n} passes": "جهّز {n} اعتذارات",
  "Book a call with {name}": "احجز مكالمة مع {name}",
  "Ask {name} for more": "اطلب المزيد من {name}",
  "Drafted by Q. Nothing is sent until you approve this exact message.":
    "صاغها Q. لا يُرسل شيء حتى توافق على هذه الرسالة بنصّها.",
  "Q drafted the questions from what they sent. Nothing is sent until you approve this exact message.":
    "صاغ Q الأسئلة مما أرسلوه. لا يُرسل شيء حتى توافق على هذه الرسالة بنصّها.",
  "Drafted by Q. Nothing is sent until you approve this exact message. Founders always get a reason.":
    "صاغها Q. لا يُرسل شيء حتى توافق على هذه الرسالة بنصّها. يحصل المؤسسون دائمًا على سبب.",
  "Passed with a reason. They got your exact message.":
    "اعتذرت مع ذكر السبب. وصلتهم رسالتك بنصّها.",
  "{n} passes sent, each with your exact message.":
    "أُرسلت {n} اعتذارات، كلٌّ برسالتك بنصّها.",
  "Sent after your approval. They're asked for times for a call.":
    "أُرسلت بعد موافقتك. طُلب منهم اقتراح مواعيد لمكالمة.",
  "Sent after your approval: your questions, exactly as shown.":
    "أُرسلت بعد موافقتك: أسئلتك كما ظهرت تمامًا.",
  "{n} applications outside your rules are under Outside your rules. ":
    "{n} طلبات خارج قواعدك موجودة تحت «خارج قواعدك». ",
  "{n} application outside your rules is under Outside your rules. ":
    "{n} طلب خارج قواعدك موجود تحت «خارج قواعدك». ",
  "Your published rules": "قواعدك المنشورة",
  "No published rules yet, so nothing is checked: founders see no judgement either way. Give Q your mandate and it drafts the rules; you confirm each one.":
    "لا قواعد منشورة بعد، لذا لا يُفحص شيء: لا يرى المؤسسون أي حكم. أعطِ Q تفويضك وسيصوغ القواعد؛ وتؤكد أنت كل واحدة.",
  "Edit {label}": "عدّل {label}",
  "Others see why and can't send.": "يرى الآخرون السبب ولا يمكنهم الإرسال.",
  "Anyone can send": "يمكن لأي شخص الإرسال",
  "Founders still see your rules and how they stand.":
    "يظل المؤسسون يرون قواعدك وموقفهم منها.",
  "Reply within": "الرد خلال",
  "No reply promise yet": "لا وعد بالرد بعد",
  "Reply within {n} working days": "الرد خلال {n} أيام عمل",
  "Reply within {n} working day": "الرد خلال {n} يوم عمل",
  "Shown on your gate. Late replies are marked in your inbox.":
    "يظهر على بوابتك. تُعلَّم الردود المتأخرة في الوارد.",
  "Copy snippet": "انسخ المقتطف",
  "Like “climate hardware in East Africa”. Q searches companies on Capital Q you are allowed to see.":
    "مثل «أجهزة مناخية في شرق أفريقيا». يبحث Q في الشركات على Capital Q المسموح لك برؤيتها.",
  "{n} companies on Capital Q": "{n} شركات على Capital Q",
  "{n} company on Capital Q": "{n} شركة على Capital Q",

  // Design gateqf-1: a founder's applications, with how the rules stood
  "What you sent through investors' gates, and what happened.":
    "ما أرسلته عبر بوابات المستثمرين، وما حدث.",
  "When you apply through an investor's gate, it shows here with how their rules stood and what they sent back.":
    "عندما تتقدّم عبر بوابة مستثمر، يظهر الطلب هنا مع موقف قواعدهم وما أرسلوه.",
  "Passed with a reason": "اعتذروا مع ذكر السبب",
  "Passed with a reason: {reason}.": "اعتذروا مع ذكر السبب: {reason}.",
  "Passed with a reason. They got: “{message}”":
    "اعتذروا مع ذكر السبب. وصلك: «{message}»",
  "They replied.": "ردّوا.",
  "They wrote: “{message}”": "كتبوا: «{message}»",
  "Sent. They haven't made a reply promise.": "أُرسل. لم يقدّموا وعدًا بالرد.",
  "Reply promised by {date}": "وعدوا بالرد قبل {date}",
  "How their rules stood when you sent it": "موقف قواعدهم عندما أرسلته",
  "They had no published rules then, so nothing was checked.":
    "لم تكن لديهم قواعد منشورة حينها، لذا لم يُفحص شيء.",
  "Their published bar, not their private thesis.":
    "معيارهم المنشور، لا أطروحتهم الخاصة.",
  "Answer in your messages": "أجب في رسائلك",
  "Not recorded for this application.": "لم يُسجَّل لهذا الطلب.",

  // Design gatepub-1: the form with live rule standing
  "{count} short questions, then an optional conversation with Q. You review everything before it goes.":
    "أسئلة قصيرة ({count})، ثم محادثة اختيارية مع Q. تراجع كل شيء قبل إرساله.",
  "Five short questions, then an optional conversation with Q. You review everything before it goes.":
    "خمسة أسئلة قصيرة، ثم محادثة اختيارية مع Q. تراجع كل شيء قبل إرساله.",
  "Six short questions, then an optional conversation with Q. You review everything before it goes.":
    "ستة أسئلة قصيرة، ثم محادثة اختيارية مع Q. تراجع كل شيء قبل إرساله.",
  "How you stand against their rules": "موقفك من قواعدهم",
  "No published rules yet: nothing is checked, and every founder can apply.":
    "لا قواعد منشورة بعد: لا يُفحص شيء، ويمكن لكل مؤسس التقدّم.",
  "Required. Meets": "مطلوبة. مستوفاة",
  "Preferred. Meets": "مفضّلة. مستوفاة",
  "Required. Doesn't meet. This one is required":
    "مطلوبة. غير مستوفاة. هذه القاعدة مطلوبة",
  "Preferred. Doesn't meet. Preferred only": "مفضّلة. غير مستوفاة. مفضّلة فقط",
  "Required. Not answered yet. Never counts as a no":
    "مطلوبة. لم يُجَب عنها بعد. لا تُحسب رفضًا أبدًا",
  "Preferred. Not answered yet. Never counts as a no":
    "مفضّلة. لم يُجَب عنها بعد. لا تُحسب رفضًا أبدًا",
  "Their published bar, not their private thesis. Meeting it is not a promise of interest.":
    "معيارهم المنشور، لا أطروحتهم الخاصة. استيفاؤه ليس وعدًا بالاهتمام.",
  "Your email": "بريدك الإلكتروني",
  "They reply to this email. Nothing goes to them until you submit.":
    "يردّون على هذا البريد. لا يصلهم شيء حتى ترسل.",
  "What stage are you at?": "في أي مرحلة أنتم؟",
  "Where are you based?": "أين مقرّكم؟",
  "A note to {fund}": "ملاحظة إلى {fund}",
  '{fund} only takes companies that meet "{label}". That\'s about fit, not quality.':
    "لا تقبل {fund} إلا الشركات التي تستوفي «{label}». الأمر يتعلق بالملاءمة لا بالجودة.",
  "Next, a few questions from Q, then you review everything before it goes.":
    "بعد ذلك، بعض الأسئلة من Q، ثم تراجع كل شيء قبل إرساله.",
  "{fund} promises a reply within {n} working days. Nothing is sent until you press Submit.":
    "تعِد {fund} بالرد خلال {n} أيام عمل. لا يُرسل شيء حتى تضغط «أرسل».",
  "Signed in as": "مسجّل الدخول باسم",
  "Back to your answers": "عُد إلى إجاباتك",
};
