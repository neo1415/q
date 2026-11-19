/**
 * Arabic for the account pages as the chosen designs draw them
 * (2026-10-21): your profile, settings, what Q remembers, plan and
 * billing, usage, team, verification, joining a team, choosing a
 * workspace and asking for a review. Keys are the English source; see
 * ../patterns.ts for `{name}`, `{n}` and `{date}`. Names, figures and
 * currency codes are never translated.
 */
export const ACCOUNT_AR: Readonly<Record<string, string>> = {
  "Your allowances": "مخصصاتك",
  // Shared
  "Added to your profile": "أُضيف إلى ملفك",
  Dismissed: "تم التجاهل",
  Optional: "اختياري",
  "Removing…": "جارٍ الحذف…",
  "None yet.": "لا شيء بعد.",
  Steps: "الخطوات",
  Who: "من",
  Choose: "اختر",
  "Choose file": "اختر ملفًا",
  "Choose another": "اختر ملفًا آخر",
  "Choose a PDF, PNG or JPEG.": "اختر ملف PDF أو PNG أو JPEG.",
  "That file is over 10 MB. Choose a smaller one.":
    "حجم هذا الملف أكبر من 10 ميغابايت. اختر ملفًا أصغر.",
  "Kept in your private documents.": "محفوظ في مستنداتك الخاصة.",
  "Last used": "آخر استخدام",
  "Your photo": "صورتك",

  // Your profile
  "Your profile": "ملفك الشخصي",
  "In your words": "بكلماتك",
  "What Q found in public": "ما وجده Q في المصادر العامة",
  "Nothing changes on your profile until you approve it.":
    "لا يتغير شيء في ملفك حتى توافق عليه.",
  "Look for public information about me": "ابحث عن معلومات عامة عني",
  "Who sees what": "من يرى ماذا",
  "Your name isn't set yet": "لم يُحدَّد اسمك بعد",
  "Upload a photo": "ارفع صورة",
  "Upload a new one": "ارفع صورة جديدة",
  "Shown on your Q Card and profile": "تظهر على بطاقة Q وفي ملفك",
  "Shown on your Q Card and your organisation’s profile":
    "يظهر على بطاقة Q وفي ملف مؤسستك",
  "Shown across the top of your profile": "تظهر في أعلى ملفك",
  "Where verification stands couldn't be read just now.":
    "تعذّرت قراءة حالة التوثيق الآن.",
  "From your saves and passes, once there are some.":
    "من عمليات الحفظ والتجاوز، حين توجد.",
  "Leave it as a reading": "اتركها قراءةً فقط",
  "What this reading is from": "ما الذي بُنيت عليه هذه القراءة",

  // Settings
  "Settings sections": "أقسام الإعدادات",
  "Change password": "غيّر كلمة المرور",
  "Used to sign in.": "تُستخدم لتسجيل الدخول.",
  "On this device.": "على هذا الجهاز.",
  "Set up when Q onboards you.": "تُعدّ حين يرافقك Q في البداية.",
  "Automatic follows your device.": "التلقائي يتبع جهازك.",
  "How much Q's light moves.": "مقدار حركة ضوء Q.",
  "Q’s personality": "شخصية Q",
  "Saved. Q follows it from its next message for you.":
    "تم الحفظ. يتبعها Q من رسالته التالية لك.",
  "Written and spoken in this language.": "كتابةً وحديثًا بهذه اللغة.",
  "Say “Hey Q” to start. Only on this device.":
    "قل «Hey Q» للبدء. على هذا الجهاز فقط.",
  "Capital Q’s house guide": "دليل Capital Q العام",
  "Save guide": "احفظ الدليل",
  "Remove your guide": "احذف دليلك",
  "Email me what needs me": "راسلني بما يحتاج إليّ",
  "If I haven’t seen it in 10 minutes.": "إن لم أطّلع عليه خلال 10 دقائق.",
  "Notifications are off for this device.": "الإشعارات متوقفة على هذا الجهاز.",
  "The lead story is always included.": "القصة الرئيسية مُدرجة دائمًا.",
  "Gmail is disconnected, and Capital Q no longer holds access.":
    "تم فصل Gmail، ولم يعد لدى Capital Q أي صلاحية وصول.",
  "Get a new address?": "هل تريد عنوانًا جديدًا؟",
  "Getting a new address…": "جارٍ إنشاء عنوان جديد…",
  "Free while Capital Q launches.": "مجانية خلال إطلاق Capital Q.",
  "Usage this month": "الاستخدام هذا الشهر",
  "See usage": "اعرض الاستخدام",
  "Manage billing": "إدارة الفوترة",
  "Thanks. I’ll learn how you like to work.": "شكرًا. سأتعلّم كيف تحب أن تعمل.",
  "Off. Q learns nothing new about how you like to work.":
    "متوقف. لا يتعلم Q شيئًا جديدًا عن طريقة عملك.",

  // What Q remembers
  "Forgotten. Q won’t use it again.": "نُسي. لن يستخدمه Q مجددًا.",
  "That wasn't forgotten. Try again in a moment.":
    "لم يُنسَ ذلك. حاول مرة أخرى بعد قليل.",
  "Correct what Q remembers": "صحّح ما يتذكره Q",
  "What Q should remember": "ما ينبغي أن يتذكره Q",
  "Saved. Q uses your correction from now on.":
    "تم الحفظ. يستخدم Q تصحيحك من الآن.",
  "Q hasn’t remembered anything about you yet": "لم يتذكر Q أي شيء عنك بعد",

  // Plan and billing
  "Other side": "الجهة الأخرى",
  "Not for your side": "ليست لجهتك",
  "Talk to us": "تواصل معنا",
  "Talk to us about": "تواصل معنا بشأن",
  "Seats for the whole team": "مقاعد للفريق كله",
  "How many people would use it?": "كم شخصًا سيستخدمها؟",
  "Anything we should know?": "هل هناك ما ينبغي أن نعرفه؟",
  "Sent. A person at Capital Q will reply.":
    "تم الإرسال. سيرد عليك شخص من Capital Q.",
  "Opening checkout…": "جارٍ فتح صفحة الدفع…",
  "Checkout opened in a new tab": "فُتحت صفحة الدفع في علامة تبويب جديدة",
  "Update in checkout": "حدّث في صفحة الدفع",
  "Kept by our payment provider. Capital Q never sees a card.":
    "يحتفظ بها مزوّد الدفع لدينا. لا يرى Capital Q أي بطاقة.",
  "An admin of your organisation manages payment.":
    "يدير الدفع مسؤول في مؤسستك.",
  "Your invoices are kept with our payment provider, as PDFs.":
    "فواتيرك محفوظة لدى مزوّد الدفع بصيغة PDF.",
  "Prices are before tax.": "الأسعار قبل الضريبة.",

  // Usage
  "Work Q did for you": "العمل الذي أنجزه Q لك",

  // Team
  "Invite a colleague": "ادعُ زميلًا",
  "Send invitation": "أرسل الدعوة",
  "Change role": "غيّر الدور",
  "1 person works here": "شخص واحد يعمل هنا",

  // Verification
  "Who is asking": "من يطلب",
  "Your company, as registered": "شركتك كما هي مسجّلة",
  "Your firm, as registered": "شركتك الاستثمارية كما هي مسجّلة",
  "As registered, if it differs from the company name.":
    "كما هو مسجّل، إن اختلف عن اسم الشركة.",
  "From your certificate": "من شهادتك",
  "Certificate of incorporation or registry extract":
    "شهادة التأسيس أو مستخرج السجل",
  "ID document (optional)": "وثيقة الهوية (اختياري)",
  "Send for verification": "أرسل للتوثيق",
  "Change something": "غيّر شيئًا",
  "None, sent without one": "لا شيء، أُرسل بدون مستند",
  "Send your details again and a person looks again.":
    "أرسل بياناتك مجددًا وسيراجعها شخص مرة أخرى.",
  "Verify you and your organisation": "وثّق نفسك ومؤسستك",
  "Disagree with a verification decision?": "لا توافق على قرار توثيق؟",

  // Join and workspaces
  "Joining…": "جارٍ الانضمام…",
  "This invitation was already used to join.":
    "استُخدمت هذه الدعوة للانضمام من قبل.",
  "Where are you working today?": "أين تعمل اليوم؟",
  "You belong to more than one workspace. Each keeps its own work.":
    "أنت عضو في أكثر من مساحة عمل. كل منها يحتفظ بعمله الخاص.",

  // Reviews
  "What is it about?": "بشأن ماذا؟",
  "Say what you want reviewed and why, in at least a sentence.":
    "قل ما تريد مراجعته ولماذا، في جملة على الأقل.",
  "Sent. A person at Capital Q will answer within 3 days.":
    "تم الإرسال. سيرد شخص من Capital Q خلال 3 أيام.",
  "Your earlier requests couldn't load. Nothing is lost.":
    "تعذّر تحميل طلباتك السابقة. لم يضِع شيء.",

  // Security: two-step verification and confirming an email
  Security: "الأمان",
  "Two-step verification": "التحقق بخطوتين",
  "Two-step verification keeps your account safe if your password is ever known to someone else.":
    "يحمي التحقق بخطوتين حسابك إذا عرف أحد كلمة مرورك يومًا.",
  "Two-step verification is on.": "التحقق بخطوتين مفعّل.",
  "Two-step verification is off.": "التحقق بخطوتين غير مفعّل.",
  "Two-step verification is on. You'll be asked for a code next time you sign in.":
    "التحقق بخطوتين مفعّل. سيُطلب منك رمز في المرة القادمة التي تسجّل فيها الدخول.",
  "Each time you sign in, you will also enter a code from an authenticator app on your phone, such as Google Authenticator, 1Password or Microsoft Authenticator.":
    "في كل مرة تسجّل فيها الدخول، ستُدخل أيضًا رمزًا من تطبيق مصادقة على هاتفك، مثل Google Authenticator أو 1Password أو Microsoft Authenticator.",
  "Signing in asks for a code from your authenticator app as well as your password, email link or Google.":
    "يطلب تسجيل الدخول رمزًا من تطبيق المصادقة إضافةً إلى كلمة المرور أو رابط البريد أو Google.",
  "Turn on two-step verification": "فعّل التحقق بخطوتين",
  "Turn off two-step verification": "أوقف التحقق بخطوتين",
  "Preparing…": "جارٍ التحضير…",
  "Turning off…": "جارٍ الإيقاف…",
  "Scan this code with your authenticator app.":
    "امسح هذا الرمز بتطبيق المصادقة.",
  "QR code to add Capital Q to your authenticator app":
    "رمز QR لإضافة Capital Q إلى تطبيق المصادقة",
  "Can't scan it? Enter this key in the app instead:":
    "لا يمكنك مسحه؟ أدخل هذا المفتاح في التطبيق بدلًا من ذلك:",
  "Enter the 6-digit code the app shows.":
    "أدخل الرمز المكوّن من 6 أرقام الذي يعرضه التطبيق.",
  "To turn it off, enter a code from your authenticator app.":
    "لإيقافه، أدخل رمزًا من تطبيق المصادقة.",
  "On. Signing in also asks for a code from your authenticator app.":
    "مفعّل. يطلب تسجيل الدخول أيضًا رمزًا من تطبيق المصادقة.",
  "Off. Add a code from an authenticator app to every sign-in.":
    "غير مفعّل. أضف رمزًا من تطبيق مصادقة إلى كل تسجيل دخول.",
  "Add a code from an authenticator app to every sign-in.":
    "أضف رمزًا من تطبيق مصادقة إلى كل تسجيل دخول.",
  Manage: "إدارة",
  "Enter the 6-digit code from your authenticator app to finish signing in.":
    "أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة لإكمال تسجيل الدخول.",
  "Enter the 6-digit code from your authenticator app.":
    "أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.",
  "That code didn't work. Enter the 6-digit code your authenticator app shows now.":
    "لم ينجح هذا الرمز. أدخل الرمز المكوّن من 6 أرقام الذي يعرضه تطبيق المصادقة الآن.",
  "Lost access to your authenticator app? Contact Capital Q support from the email on your account and we will help you back in.":
    "فقدت الوصول إلى تطبيق المصادقة؟ تواصل مع دعم Capital Q من البريد المسجّل في حسابك وسنساعدك على العودة.",
  "Sign in as someone else": "سجّل الدخول بحساب آخر",
  "Signing out…": "جارٍ تسجيل الخروج…",
  "That didn't work. Try again in a moment.":
    "لم ينجح ذلك. حاول مرة أخرى بعد قليل.",
  "Too many attempts. Wait a few minutes and try again.":
    "محاولات كثيرة. انتظر بضع دقائق ثم حاول مرة أخرى.",
  "Confirm your email to finish signing in. We can send the link again.":
    "أكّد بريدك الإلكتروني لإكمال تسجيل الدخول. يمكننا إرسال الرابط مجددًا.",
  "Send the confirmation link again": "أرسل رابط التأكيد مجددًا",
  "Enter your email.": "أدخل بريدك الإلكتروني.",

  // Your data (decision 107)
  "Your data": "بياناتك",
  "Download a copy of your data, or delete your account.":
    "نزّل نسخة من بياناتك، أو احذف حسابك.",
  "Download a copy of the data Capital Q keeps as yours, or delete your account. Your rights are described in the Privacy Policy.":
    "نزّل نسخة من البيانات التي يحتفظ بها Capital Q على أنها لك، أو احذف حسابك. حقوقك موضّحة في سياسة الخصوصية.",
  "Your data couldn't be loaded just now. Reload in a moment.":
    "تعذّر تحميل بياناتك الآن. أعد التحميل بعد لحظة.",
  "Privacy Policy": "سياسة الخصوصية",
  "a copy of your data to download": "نسخة من بياناتك للتنزيل",
  "deleting your account, and what is kept": "حذف حسابك، وما يُحتفظ به",
  "Download your data": "نزّل بياناتك",
  "A ZIP file with your profile, what you wrote and uploaded, your conversations with Q, what Q remembers about you, and your activity. Other people's private notes are not included.":
    "ملف ZIP يضم ملفك الشخصي وما كتبته ورفعته ومحادثاتك مع Q وما يتذكره Q عنك ونشاطك. لا تُضمَّن الملاحظات الخاصة بأشخاص آخرين.",
  "available until": "متاح حتى",
  "Being prepared. This usually takes a few minutes.":
    "قيد التجهيز. يستغرق ذلك عادةً بضع دقائق.",
  "The last download couldn't be prepared. Try again.":
    "تعذّر تجهيز آخر تنزيل. حاول مرة أخرى.",
  "Downloads stay available for 7 days.": "يبقى التنزيل متاحًا لمدة 7 أيام.",
  "Prepare a download": "جهّز تنزيلًا",
  "Prepare a new download": "جهّز تنزيلًا جديدًا",
  "You can ask three times a day. Try again tomorrow.":
    "يمكنك الطلب ثلاث مرات في اليوم. حاول غدًا.",
  "Preparing your download. We'll let you know when it's ready.":
    "نجهّز تنزيلك. سنُعلمك عندما يصبح جاهزًا.",
  "Delete your account": "احذف حسابك",
  "What is kept, and why": "ما يُحتفظ به، ولماذا",
  "Deletion cancelled. Your account stays.": "أُلغي الحذف. يبقى حسابك.",
  "Your account is being deleted.": "يجري حذف حسابك.",
  "Your account will be deleted on": "سيُحذف حسابك في",
  "It is waiting: make someone else an owner of your team first.":
    "الحذف في الانتظار: اجعل شخصًا آخر مالكًا لفريقك أولًا.",
  "It is waiting: your organisations changed. Cancel and ask again to review them.":
    "الحذف في الانتظار: تغيّرت مؤسساتك. ألغِ الطلب واطلبه مجددًا لمراجعتها.",
  "Until then you can keep using Capital Q and change your mind.":
    "حتى ذلك الحين يمكنك مواصلة استخدام Capital Q وتغيير رأيك.",
  "Keep my account": "أبقِ حسابي",
  "Code sent to your email.": "أُرسل الرمز إلى بريدك الإلكتروني.",
  "Deletion scheduled. You can cancel it on this page.":
    "جُدول الحذف. يمكنك إلغاؤه من هذه الصفحة.",
  "Your profile, documents, conversations with Q, what Q remembers about you and your other content are deleted. You are signed out everywhere. Records other people need are kept without your name.":
    "يُحذف ملفك الشخصي ومستنداتك ومحادثاتك مع Q وما يتذكره Q عنك وسائر محتواك. ويُسجَّل خروجك من كل الأجهزة. أما السجلات التي يحتاجها آخرون فتُحفظ من دون اسمك.",
  "Nothing happens for": "لن يحدث شيء لمدة",
  "days, so you can change your mind. Download your data first if you want a copy.":
    "يومًا، لتتمكن من تغيير رأيك. نزّل بياناتك أولًا إن أردت نسخة منها.",
  "You are the only owner of": "أنت المالك الوحيد لـ",
  "Make someone else an owner first, or remove the other members.":
    "اجعل شخصًا آخر مالكًا أولًا، أو أزل الأعضاء الآخرين.",
  "Open Team": "افتح الفريق",
  "You are the only member of": "أنت العضو الوحيد في",
  "It closes with your account: it leaves Discover and nobody can sign in to it. Other parties keep their own records of it.":
    "تُغلق مع حسابك: تخرج من الاستكشاف ولا يمكن لأحد تسجيل الدخول إليها. ويحتفظ الآخرون بسجلاتهم الخاصة عنها.",
  "You leave": "تغادر",
  "Your team keeps its documents and records.":
    "يحتفظ فريقك بمستنداته وسجلاته.",
  "Confirm it's you": "أكّد أنك أنت",
  "With my password": "بكلمة المرور",
  "With a code by email": "برمز عبر البريد الإلكتروني",
  Code: "الرمز",
  "We email it to the address you sign in with.":
    "نرسله إلى البريد الذي تسجّل الدخول به.",
  "Send code": "أرسل الرمز",
  Type: "اكتب",
  "to confirm": "للتأكيد",
  "I understand my account and content will be deleted after the grace period, and this cannot be undone after that.":
    "أفهم أن حسابي ومحتواي سيُحذفان بعد فترة السماح، وأن ذلك لا يمكن التراجع عنه بعدها.",
  "Delete my account": "احذف حسابي",
  "Audit and security records": "سجلات التدقيق والأمان",
  "They show what happened, and under whose authority, without saying who you were.":
    "تُظهر ما حدث وبأي صلاحية، من دون أن تذكر من كنت.",
  "Up to 2 years": "حتى سنتين",
  "Other people's relationship history": "سجل العلاقات لدى الآخرين",
  "An investor's or company's own record of meetings, interest and deals stays accurate. You appear as a former user.":
    "يبقى سجل المستثمر أو الشركة للاجتماعات والاهتمام والصفقات دقيقًا. وتظهر فيه مستخدمًا سابقًا.",
  "As long as their account keeps it": "طالما احتفظ به حسابهم",
  "Messages you sent to others": "الرسائل التي أرسلتها إلى آخرين",
  "They stay in the recipient's records, attributed to a former user.":
    "تبقى في سجلات المستلم، منسوبة إلى مستخدم سابق.",
  "As long as the recipient keeps them": "طالما احتفظ بها المستلم",
  "Your organisation's documents and records": "مستندات مؤسستك وسجلاتها",
  "Documents you uploaded for a team that continues belong to that team. An organisation you are the only member of closes with your account.":
    "المستندات التي رفعتها لفريق مستمر تعود لذلك الفريق. أما المؤسسة التي أنت عضوها الوحيد فتُغلق مع حسابك.",
  "As long as the organisation keeps them": "طالما احتفظت بها المؤسسة",
  "Invoices, payments and usage": "الفواتير والمدفوعات والاستخدام",
  "Tax and company law require them.": "يفرضها قانون الضرائب وقانون الشركات.",
  "Typically 6 years": "عادةً 6 سنوات",
  Backups: "النسخ الاحتياطية",
  "Backups are overwritten on a rolling cycle; deleted data stays protected and unused until then.":
    "تُستبدل النسخ الاحتياطية بشكل دوري، وتبقى البيانات المحذوفة محمية وغير مستخدمة حتى ذلك الحين.",
  "Until the backup cycle overwrites them": "حتى تستبدلها دورة النسخ الاحتياطي",
};
