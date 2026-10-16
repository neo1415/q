import { READINESS_STEPS_ARABIC } from "@capital-q/q-core";

/**
 * Arabic for what the live Arabic check of 2026-10-16 still found in
 * English: Home's readiness and action plan, the welcome, Settings,
 * Discover's investor cards and gates, the onboarding coverage list,
 * Results, and the screens the wrap pass reached after it. The readiness
 * rules' titles and next actions come from q-core, so Q's spoken lead and
 * the page say the same words.
 */
export const SWEEP_AR: Readonly<Record<string, string>> = {
  ...READINESS_STEPS_ARABIC,

  // Welcome
  "Hi, I'm Q.": "مرحباً، أنا Q.",
  "Hi {name}, I'm Q.": "مرحباً {name}، أنا Q.",
  "I'll help you understand where you are, prepare what you need, and move through the capital process without making you repeat yourself.":
    "سأساعدك على فهم موقعك، وتجهيز ما تحتاجه، والمضي في رحلة التمويل دون أن تكرر ما قلته.",
  "Let's set up your company. I'll use what you've already told me, and you can talk to me or type.":
    "لنُعدّ شركتك. سأستخدم ما أخبرتني به من قبل، ويمكنك التحدث معي أو الكتابة.",
  "Let's set up your mandate. I'll use what you've already told me, and you can talk to me or type.":
    "لنُعدّ تفويضك الاستثماري. سأستخدم ما أخبرتني به من قبل، ويمكنك التحدث معي أو الكتابة.",
  "I work from whatever you already have. You can talk to me or type — whichever you prefer.":
    "أعمل بما لديك بالفعل. يمكنك التحدث معي أو الكتابة، كما تفضّل.",
  "Mute Q": "كتم صوت Q",
  "Unmute Q": "تشغيل صوت Q",
  "Here to invest instead?": "هل أنت هنا للاستثمار؟",
  "Here to raise instead?": "هل أنت هنا لجمع التمويل؟",
  "What are you here to do?": "ما الذي جئت لتفعله؟",

  // Shell, Home and arrival
  "Skip to content": "انتقل إلى المحتوى",
  "Here's what's waiting.": "إليك ما ينتظرك.",
  "What Capital Q knows about your company, and what investors would see.":
    "ما يعرفه Capital Q عن شركتك، وما سيراه المستثمرون.",
  "Investors who made themselves discoverable, and why they might fit.":
    "مستثمرون أتاحوا الوصول إليهم، ولماذا قد يناسبونك.",
  "A short video investors watch before they read anything else.":
    "فيديو قصير يشاهده المستثمرون قبل أن يقرؤوا أي شيء آخر.",
  "May I learn how you like to work from our conversations, like how brief to be? You can change this anytime in What Q remembers.":
    "هل تسمح لي بأن أتعلم من محادثاتنا كيف تحب أن تعمل، مثل مدى الإيجاز الذي تفضّله؟ يمكنك تغيير ذلك في أي وقت من «ما يتذكره Q».",
  Chat: "المحادثة",
  "You:": "أنت:",
  "what needs you": "ما يحتاج إليك",

  // Readiness
  "Only your team sees this": "لا يرى هذا إلا فريقك",
  "Action plan": "خطة العمل",
  Readiness: "الجاهزية",
  "Readiness by pillar": "الجاهزية حسب المحور",
  "Pillars by status": "المحاور حسب الحالة",
  "What could stop your raise": "ما قد يعيق جولتك",
  "Open the action plan": "افتح خطة العمل",
  Strong: "قوية",
  Developing: "قيد التطوير",
  Gap: "فجوة",
  Verified: "موثّق",
  "Your claim": "ادعاؤك",
  Estimate: "تقدير",
  "Q's inference": "استنتاج Q",
  "Q’s inference": "استنتاج Q",
  Unknown: "غير معروف",
  "no evidence": "لا دليل",
  "self-reported": "مُصرَّح به ذاتياً",
  "document supported": "مدعوم بمستند",
  "several sources": "عدة مصادر",
  "externally verified": "موثّق خارجياً",
  "verified on Capital Q": "موثّق على Capital Q",
  "{truth} · {evidence}": "{truth} · {evidence}",
  "1 piece of evidence": "دليل واحد",
  "{n} pieces of evidence": "الأدلة: {n}",
  Evidence: "الأدلة",
  "Nothing on record yet.": "لا شيء مسجّل بعد.",
  "What would move it": "ما الذي سيحسّنه",
  "Nothing expected is missing here.": "لا ينقص هنا شيء متوقع.",
  "Nothing that investors at your stage usually ask for first is missing from what you've shared.":
    "لا ينقص مما شاركته شيء مما يطلبه المستثمرون في مرحلتك عادةً أولاً.",
  "No score: each pillar says what Q can see and what is missing. Not shared yet means Q has nothing to go on, and it is never counted against you.":
    "لا توجد درجة: كل محور يوضح ما يراه Q وما ينقص. «لم تُشارَك بعد» يعني أن Q لا يملك ما يبني عليه، ولا يُحسب ذلك ضدك أبداً.",
  "How ready your company looks to an investor today, from what you have shared. Each pillar in words, with the evidence behind it.":
    "مدى جاهزية شركتك في نظر المستثمر اليوم، بناءً على ما شاركته. كل محور بالكلمات، مع الأدلة التي تسنده.",
  "Q's action plan, sequenced. Each step names the gap it closes.":
    "خطة عمل Q مرتبة. كل خطوة تسمّي الفجوة التي تسدّها.",
  "Built from your readiness gaps. Steps close themselves when Q sees the evidence.":
    "مبنية على فجوات جاهزيتك. تُغلق الخطوات تلقائياً حين يرى Q الدليل.",
  "On record: {items}.": "مسجّل: {items}.",
  "Two readings to settle: {items}.": "قراءتان بحاجة إلى حسم: {items}.",
  "Not yet: {items}.": "لم يُسجَّل بعد: {items}.",
  You: "أنت",
  "Q drafts, you approve": "يصوغ Q وتوافق أنت",
  "You or an adviser": "أنت أو مستشار",
  Why: "لماذا",
  Owner: "المسؤول",
  "Done when": "يكتمل عندما",
  Done: "تم",
  "Mark done": "حدّده كمكتمل",
  Team: "الفريق",
  Market: "السوق",
  Product: "المنتج",
  Traction: "النمو",
  Financials: "البيانات المالية",
  Execution: "التنفيذ",
  "Governance & trust": "الحوكمة والثقة",
  "Raise & documents": "الجولة والمستندات",
  "Founders named": "تسمية المؤسسين",
  "Founder backgrounds": "خلفيات المؤسسين",
  "Founder identity verified": "توثيق هوية المؤسس",
  "Founders slide": "شريحة المؤسسين",
  "Market size": "حجم السوق",
  "Market slide": "شريحة السوق",
  "Product description": "وصف المنتج",
  "Problem slide": "شريحة المشكلة",
  "Solution slide": "شريحة الحل",
  "Traction figures": "أرقام النمو",
  "Revenue evidence": "إثبات الإيرادات",
  "Traction slide": "شريحة النمو",
  "Burn, runway or margin": "الحرق أو المدرج المالي أو الهامش",
  "Financial statements": "القوائم المالية",
  "Business model slide": "شريحة نموذج العمل",
  "Team size": "حجم الفريق",
  "Go-to-market slide": "شريحة الوصول إلى السوق",
  "Company verified": "توثيق الشركة",
  "Domain verified": "توثيق النطاق",
  "Company and cap table documents": "مستندات الشركة وجدول الملكية",
  "Risks and compliance": "المخاطر والامتثال",
  "Pitch deck": "العرض التقديمي",
  "Raise target": "هدف الجولة",
  "Use of funds": "استخدام الأموال",
  "Instrument and terms": "الأداة والشروط",
  "The ask slide": "شريحة الطلب",
  "Fundraising documents": "مستندات جمع التمويل",
  "The first thing an investor checks is who is building this.":
    "أول ما يتحقق منه المستثمر هو من يبني هذا.",
  "Investors back people first; the team must be on record.":
    "يدعم المستثمرون الأشخاص أولاً؛ يجب أن يكون الفريق مسجّلاً.",
  "Founder count and full-time status are on your profile.":
    "عدد المؤسسين وتفرّغهم مسجّلان في ملفك.",
  "Investors look for why this team can win this market.":
    "يبحث المستثمرون عن سبب قدرة هذا الفريق على الفوز بهذا السوق.",
  "Relevant experience is the quickest answer to 'why you?'.":
    "الخبرة ذات الصلة هي أسرع إجابة عن سؤال «لماذا أنت؟».",
  "Each founder has a background line.": "لكل مؤسس سطر عن خلفيته.",
  "A verified founder is the first trust signal investors see.":
    "المؤسس الموثّق هو أول إشارة ثقة يراها المستثمرون.",
  "Investors see a verified founder before anything else.":
    "يرى المستثمرون المؤسس الموثّق قبل أي شيء آخر.",
  "At least one founder is verified.": "مؤسس واحد على الأقل موثّق.",
  "The deck is often read before the profile.":
    "كثيراً ما يُقرأ العرض التقديمي قبل الملف.",
  "Q reads the founders slide as Clear or better.":
    "يقرأ Q شريحة المؤسسين بوصفها واضحة أو أفضل.",
  "A stated market size without a source gets discounted.":
    "حجم السوق المذكور بلا مصدر يُنتقص من قيمته.",
  "A stated number without a source gets discounted.":
    "الرقم المذكور بلا مصدر يُنتقص من قيمته.",
  "Market size is supported by a document or source.":
    "حجم السوق مدعوم بمستند أو مصدر.",
  "Investors need to see the size of the prize.":
    "يحتاج المستثمرون إلى رؤية حجم الفرصة.",
  "Q reads the market slide as Clear or better.":
    "يقرأ Q شريحة السوق بوصفها واضحة أو أفضل.",
  "Investors filter by sector before anything else.":
    "يصفّي المستثمرون حسب القطاع قبل أي شيء آخر.",
  "At least one category is on your profile.": "فئة واحدة على الأقل في ملفك.",
  "An investor must understand the product in one line.":
    "يجب أن يفهم المستثمر المنتج في سطر واحد.",
  "Your profile has a description.": "ملفك يتضمن وصفاً.",
  "Without a clear problem the product has nothing to solve.":
    "من دون مشكلة واضحة لا يجد المنتج ما يحلّه.",
  "A quantified pain is what makes investors lean in.":
    "الألم المُقاس بالأرقام هو ما يجذب اهتمام المستثمرين.",
  "Q reads the problem slide as Clear or better.":
    "يقرأ Q شريحة المشكلة بوصفها واضحة أو أفضل.",
  "Investors need to see what you built.":
    "يحتاج المستثمرون إلى رؤية ما بنيته.",
  "Q reads the solution slide as Clear or better.":
    "يقرأ Q شريحة الحل بوصفها واضحة أو أفضل.",
  "Two figures for one fact make investors check everything twice.":
    "رقمان لحقيقة واحدة يدفعان المستثمرين إلى التحقق من كل شيء مرتين.",
  "Customers, usage or pilots are the evidence the market wants this.":
    "العملاء أو الاستخدام أو التجارب هي الدليل على أن السوق يريد هذا.",
  "Traction figures are on record with no open contradiction.":
    "أرقام النمو مسجّلة دون تناقض قائم.",
  "Investors at this stage ask for revenue evidence before a first call. Three months of statements or invoices close it.":
    "يطلب المستثمرون في هذه المرحلة إثبات الإيرادات قبل أول مكالمة. كشوف أو فواتير ثلاثة أشهر تكفي لإغلاق ذلك.",
  "Investors at this stage ask for it before a first call.":
    "يطلبه المستثمرون في هذه المرحلة قبل أول مكالمة.",
  "Revenue is supported by a document.": "الإيرادات مدعومة بمستند.",
  "Traction is the slide investors spend longest on.":
    "شريحة النمو هي التي يقضي المستثمرون عندها أطول وقت.",
  "Q reads the traction slide as Clear or better.":
    "يقرأ Q شريحة النمو بوصفها واضحة أو أفضل.",
  "Investors size the round against your burn and runway.":
    "يقدّر المستثمرون حجم الجولة مقارنةً بالحرق والمدرج المالي.",
  "Investors size the round against your runway.":
    "يقدّر المستثمرون حجم الجولة مقارنةً بمدرجك المالي.",
  "Burn or runway is on record.": "الحرق أو المدرج المالي مسجّل.",
  "Financial statements are the first diligence request.":
    "القوائم المالية هي أول طلب في الفحص النافي للجهالة.",
  "They are the first diligence request.":
    "إنها أول طلب في الفحص النافي للجهالة.",
  "The data room's financials items are filed.":
    "بنود البيانات المالية في غرفة البيانات مودَعة.",
  "Investors need to see how a customer becomes revenue.":
    "يحتاج المستثمرون إلى رؤية كيف يتحول العميل إلى إيراد.",
  "Q reads the business model slide as Clear or better.":
    "يقرأ Q شريحة نموذج العمل بوصفها واضحة أو أفضل.",
  "Investors read the plan against the team that delivers it.":
    "يقرأ المستثمرون الخطة في ضوء الفريق الذي سينفذها.",
  "Team size is on your profile.": "حجم الفريق مسجّل في ملفك.",
  "How you reach customers is how the money turns into growth.":
    "طريقة وصولك إلى العملاء هي ما يحوّل المال إلى نمو.",
  "It is how the money turns into growth.": "هكذا يتحول المال إلى نمو.",
  "Q reads the go-to-market slide as Clear or better.":
    "يقرأ Q شريحة الوصول إلى السوق بوصفها واضحة أو أفضل.",
  "Verification tells investors the company is real and yours.":
    "التوثيق يخبر المستثمرين أن الشركة حقيقية وأنها لك.",
  "It tells investors the company is real and yours.":
    "يخبر المستثمرين أن الشركة حقيقية وأنها لك.",
  "The company is verified.": "الشركة موثّقة.",
  "A verified domain links the company to its website.":
    "النطاق الموثّق يربط الشركة بموقعها الإلكتروني.",
  "It links the company to its website.": "يربط الشركة بموقعها الإلكتروني.",
  "Your domain is verified.": "نطاقك موثّق.",
  "Incorporation, ownership and the cap table are checked in every diligence.":
    "التأسيس والملكية وجدول الملكية تُفحص في كل عملية فحص نافٍ للجهالة.",
  "They are checked in every diligence.": "تُفحص في كل عملية فحص نافٍ للجهالة.",
  "Every company and cap table item for your stage is filed.":
    "كل بنود الشركة وجدول الملكية لمرحلتك مودَعة.",
  "Naming the risks yourself builds trust.": "تسمية المخاطر بنفسك تبني الثقة.",
  "A risk or compliance fact is on record.":
    "معلومة عن المخاطر أو الامتثال مسجّلة.",
  "Almost every investor asks for the deck first.":
    "يطلب كل المستثمرين تقريباً العرض التقديمي أولاً.",
  "A pitch deck is on your profile.": "يوجد عرض تقديمي في ملفك.",
  "Investors need to know how much you are raising.":
    "يحتاج المستثمرون إلى معرفة المبلغ الذي تجمعه.",
  "A current raise with a target is on Capital.":
    "توجد جولة حالية بهدف محدد في Capital.",
  "A target with no plan for the money reads as unfinished.":
    "الهدف بلا خطة لاستخدام المال يبدو غير مكتمل.",
  "The raise lists where the money goes.": "الجولة توضح أين يذهب المال.",
  "Investors decide faster when the instrument is known.":
    "يقرر المستثمرون أسرع حين تكون الأداة معروفة.",
  "The raise has an instrument or valuation.": "للجولة أداة أو تقييم.",
  "The ask tells investors whether the round fits their cheque.":
    "الطلب يخبر المستثمرين إن كانت الجولة تناسب حجم استثمارهم.",
  "It tells investors whether the round fits their cheque.":
    "يخبر المستثمرين إن كانت الجولة تناسب حجم استثمارهم.",
  "Q reads the ask slide as Clear or better.":
    "يقرأ Q شريحة الطلب بوصفها واضحة أو أفضل.",
  "A one-page summary is what gets forwarded inside a fund.":
    "الملخص من صفحة واحدة هو ما يُتداول داخل الصندوق.",
  "It is what gets forwarded inside a fund.": "هو ما يُتداول داخل الصندوق.",
  "The data room's fundraising items are filed.":
    "بنود جمع التمويل في غرفة البيانات مودَعة.",

  // Readiness follow-ups
  "Q still wants to know · {n} of {m}": "ما زال Q يريد أن يعرف · {n} من {m}",
  "{n} of {m}": "{n} من {m}",
  "Two readings disagree": "قراءتان متعارضتان",
  "Still needed": "ما زال مطلوباً",
  "Not clear yet": "غير واضح بعد",
  "Investors will ask": "سيسأل المستثمرون",
  "Please confirm": "يُرجى التأكيد",
  "Why Q asks:": "لماذا يسأل Q:",
  "Yes, actively": "نعم، بنشاط",
  "Preparing to raise": "نستعد لجمع التمويل",
  "Skip for now": "تخطَّ الآن",
  "Saved as your claim until evidence backs it.":
    "حُفظ كادعاء منك إلى أن يسنده دليل.",
  "Saved. That was the last thing Q wanted to ask.":
    "حُفظ. كان هذا آخر ما أراد Q أن يسأل عنه.",
  "Saved as your answer.": "حُفظ كإجابة منك.",
  "Set aside. Unknown stays unknown.":
    "وُضع جانباً. ما هو غير معروف يبقى غير معروف.",
  "Capital Q didn't answer. Try again.": "لم يستجب Capital Q. حاول مرة أخرى.",
  "Q has nothing left to ask right now.": "لم يعد لدى Q ما يسأل عنه الآن.",
  "Go there": "اذهب إلى هناك",
  "What your records say": "ما تقوله سجلاتك",

  // Settings
  "You are here as founder": "أنت هنا بصفتك مؤسساً",
  "You are here as admin": "أنت هنا بصفتك مسؤولاً",
  "You are here as member": "أنت هنا بصفتك عضواً",
  "You are here as partner": "أنت هنا بصفتك شريكاً",
  "You are here as owner": "أنت هنا بصفتك مالكاً",
  "You are here as {role}": "أنت هنا بصفة {role}",
  "Co-founders and teammates who work on your company with you.":
    "المؤسسون الشركاء وزملاء الفريق الذين يعملون معك على شركتك.",
  "Colleagues who work on your firm with you.":
    "الزملاء الذين يعملون معك في شركتك الاستثمارية.",
  Light: "فاتح",
  Device: "حسب الجهاز",
  Dark: "داكن",
  Full: "كاملة",
  Calm: "هادئة",
  Quiet: "هادئة",
  "Female voice": "صوت نسائي",
  "Male voice": "صوت رجالي",
  Subtle: "خفيف",
  Natural: "طبيعي",
  Warm: "دافئ",
  Witty: "ظريف",
  Sharp: "حاد",
  "Capital Q's house guide": "دليل Capital Q",
  "Write your guide": "اكتب دليلك",
  "The guide": "الدليل",
  "Paste the guide, or upload a PDF or Word file.":
    "الصق الدليل، أو ارفع ملف PDF أو Word.",
  "How we talk to investors and founders": "كيف نتحدث إلى المستثمرين والمؤسسين",
  "Connect Google": "اربط Google",
  "Reconnect Google": "أعد ربط Google",
  Disconnect: "افصل",
  "Q drafts emails you approve, tells you when they reply, and books calls with a Meet link.":
    "يصوغ Q رسائل بريد توافق عليها، ويخبرك حين يردّون، ويحجز المكالمات برابط Meet.",
  "Gmail isn't available yet.": "Gmail غير متاح بعد.",
  "Email sent here reaches Q for you. Q tells you, and replies only when you approve.":
    "البريد المرسل إلى هنا يصل إلى Q نيابةً عنك. يخبرك Q، ولا يردّ إلا بموافقتك.",
  Copy: "نسخ",
  "New address": "عنوان جديد",
  "Get a new address": "احصل على عنوان جديد",
  "Anyone with the old address won't reach you any more.":
    "لن يصل إليك بعد الآن من لديه العنوان القديم.",
  "New address ready. The old one no longer receives email.":
    "العنوان الجديد جاهز. العنوان القديم لم يعد يستقبل البريد.",
  "Receiving email isn't available yet.": "استقبال البريد غير متاح بعد.",
  "Open Billing to see your plan": "افتح الفوترة لترى خطتك",
  "Launch · free while Capital Q launches":
    "الإطلاق · مجاناً خلال فترة إطلاق Capital Q",
  Launch: "الإطلاق",
  "Saved. Q uses this from your next message or call.":
    "حُفظ. يستخدم Q هذا من رسالتك أو مكالمتك التالية.",
  "Couldn't save that just now. Please try again.":
    "تعذّر الحفظ الآن. حاول مرة أخرى.",

  // Discover: investor cards and gates
  Angel: "مستثمر ملائكي",
  "Venture fund": "صندوق رأس مال جريء",
  "Family office": "مكتب عائلي",
  "Corporate venture": "ذراع استثمار مؤسسي",
  Syndicate: "تحالف استثماري",
  Accelerator: "مسرّعة أعمال",
  Scout: "مستكشف استثمارات",
  Institutional: "مؤسسي",
  Investor: "مستثمر",
  "Open to founders": "منفتح على المؤسسين",
  "Not taking requests": "لا يستقبل طلبات",
  "Ask Q about fit": "اسأل Q عن مدى الملاءمة",
  "How well does {name} fit my raise, from what they have declared publicly? What is unknown?":
    "ما مدى ملاءمة {name} لجولتي بناءً على ما أعلنوه علناً؟ وما الذي لا يزال غير معروف؟",
  "Has a gate · no published criteria yet": "لديه بوابة · لا معايير منشورة بعد",
  "Has a gate · 1 criterion": "لديه بوابة · معيار واحد",
  "Has a gate · {n} criteria": "لديه بوابة · المعايير: {n}",
  "All {n} met.": "استُوفيت جميعها ({n}).",
  "{n} of {m} met.": "استُوفي {n} من {m}.",
  "All {n} met; the rest:": "استُوفيت جميعها ({n})؛ والباقي:",
  "{n} of {m} met; the rest:": "استُوفي {n} من {m}؛ والباقي:",
  Met: "مستوفى",
  "Not met": "غير مستوفى",
  "Not known yet": "غير معروف بعد",
  "{n} more on their page": "{n} أخرى في صفحتهم",
  "Check and apply": "تحقّق وقدّم",
  "Their gate isn't taking applications right now.":
    "بوابتهم لا تستقبل طلبات الآن.",
  "Open to applications · no published criteria yet.":
    "مفتوحة للطلبات · لا معايير منشورة بعد.",
  "Doesn't meet one required criterion: {items}.":
    "لا يستوفي معياراً مطلوباً واحداً: {items}.",
  "Doesn't meet {n} required criteria: {items}.":
    "لا يستوفي معايير مطلوبة عددها {n}: {items}.",
  "Meets {n} of their {m} published criteria; one Q can't check until you share more.":
    "يستوفي {n} من معاييرهم المنشورة البالغة {m}؛ وواحد لا يستطيع Q التحقق منه حتى تشارك المزيد.",
  "Meets {n} of their {m} published criteria; {k} Q can't check until you share more.":
    "يستوفي {n} من معاييرهم المنشورة البالغة {m}؛ و{k} لا يستطيع Q التحقق منها حتى تشارك المزيد.",
  "Meets all {n} of their published criteria.":
    "يستوفي جميع معاييرهم المنشورة ({n}).",
  "Meets {n} of {m}; the rest are preferences, not requirements.":
    "يستوفي {n} من {m}؛ والباقي تفضيلات لا متطلبات.",
  "Sectors we focus on": "القطاعات التي نركز عليها",
  "Round size we can join": "حجم الجولة التي يمكننا المشاركة فيها",
  "Our cheque size": "حجم استثمارنا",
  "Where the company is based": "مقر الشركة",
  "Where you're based": "مكان مقرّك",
  "Stage we invest at": "المرحلة التي نستثمر فيها",
  "Where their public profile matches you": "أين يتوافق ملفهم العام معك",
  "This is their published bar, not their private thesis. Meeting it is not a promise of interest.":
    "هذا معيارهم المنشور، لا أطروحتهم الخاصة. استيفاؤه ليس وعداً بالاهتمام.",
  "From their public profile and their published GateQ criteria only.":
    "من ملفهم العام ومعايير GateQ المنشورة فقط.",

  // Onboarding
  "Essentials {n} of {m}": "الأساسيات {n} من {m}",
  "{n} to confirm": "{n} للتأكيد",
  "{n} not saved yet": "{n} لم تُحفظ بعد",
  "about {n} min left": "تبقّى نحو {n} دقيقة",
  "How Q talks to you (concise or detailed, your language) is yours to see and change in":
    "طريقة حديث Q معك (موجزة أو مفصلة، وبلغتك) تستطيع رؤيتها وتغييرها في",
  "Needs your choice": "يحتاج إلى اختيارك",
  "To confirm": "للتأكيد",
  "Saved, a document would support it": "محفوظ، ومستند سيدعمه",
  "Can wait": "يمكن أن ينتظر",
  "from sign-up": "من التسجيل",
  "from your choice": "من اختيارك",
  "from your profile": "من ملفك",
  "from the form": "من النموذج",
  "from your conversation with Q": "من محادثتك مع Q",
  "from your document": "من مستندك",
  "from a public page, not verified": "من صفحة عامة، غير موثّق",
  "Q's suggestion": "اقتراح Q",
  offered: "مقترح",
  " or ": " أو ",
  "Company name": "اسم الشركة",
  Country: "الدولة",
  Stage: "المرحلة",
  "Your role": "دورك",
  Founders: "المؤسسون",
  CEO: "الرئيس التنفيذي",
  "Upload a document": "ارفع مستنداً",
  Skip: "تخطَّ",
  "Skip this": "تخطَّ هذا",
  "Review remaining gaps": "راجع الفجوات المتبقية",
  "Review what Q knows": "راجع ما يعرفه Q",
  "Review as form": "راجع كنموذج",
  "Open in the form": "افتح في النموذج",
  "What Q knows": "ما يعرفه Q",
  "What Q still needs": "ما يحتاجه Q بعد",
  "What Q picked up": "ما التقطه Q",
  "Continue by typing; your interview carries on where it is.":
    "تابع بالكتابة؛ تستمر مقابلتك من حيث توقفت.",
  "Use the form instead; everything you enter is kept the same way.":
    "استخدم النموذج بدلاً من ذلك؛ يُحفظ كل ما تدخله بالطريقة نفسها.",
  "Q can't lead this setup right now.": "لا يستطيع Q قيادة هذا الإعداد الآن.",
  "Q starts the form from your company profile.":
    "يبدأ Q النموذج من ملف شركتك.",
  "I think these are the closest fits. Keep them, or adjust.":
    "أظن أن هذه الأقرب. أبقِها أو عدّلها.",
  "Keep all": "أبقِها كلها",
  "Say it in a sentence, or search the categories below.":
    "قلها في جملة، أو ابحث في الفئات أدناه.",
  "Search categories": "ابحث في الفئات",
  "Matching categories": "الفئات المطابقة",
  "Categories to keep": "الفئات التي ستُبقى",

  // Results and relationships
  "last 30 days": "آخر 30 يوماً",
  "last 7 days": "آخر 7 أيام",
  "last 90 days": "آخر 90 يوماً",
  confirmed: "مؤكَّد",
  soft: "مبدئي",
  "{n} interests received": "الاهتمامات المستلمة: {n}",
  "1 interest received": "اهتمام واحد مستلم",
  "{n} new connections": "الاتصالات الجديدة: {n}",
  "1 new connection": "اتصال جديد واحد",
  "{n} answered": "المُجاب عنها: {n}",
  "{n} investors in conversation": "المستثمرون في محادثة: {n}",
  "1 investor in conversation": "مستثمر واحد في محادثة",
  "{n} waiting": "بالانتظار: {n}",
  "{n} times": "{n} مرات",
  "1 time": "مرة واحدة",
  day: "يوم",

  // Discover and fit (wrap pass)
  "Set your mandate": "حدّد تفويضك",
  "Set your mandate to see fit": "حدّد تفويضك لترى مدى الملاءمة",
  "Set up your mandate": "أعدّ تفويضك",
  "Change your mandate": "غيّر تفويضك",
  "No companies fit your mandate yet": "لا توجد شركات تلائم تفويضك بعد",
  "Ranking your companies against your mandate…":
    "جارٍ ترتيب الشركات وفق تفويضك…",
  "No active mandate yet. Tell Q what you invest in and Discover orders companies against it.":
    "لا يوجد تفويض فعّال بعد. أخبر Q بما تستثمر فيه وسيرتب Discover الشركات وفقه.",
  "No active mandate yet. Your answers above become your rules.":
    "لا يوجد تفويض فعّال بعد. تصبح إجاباتك أعلاه قواعدك.",
  "Q ranks companies against what you tell it: stage, sectors, countries and cheque size. It takes about two minutes, and you can skip anything.":
    "يرتب Q الشركات وفق ما تخبره به: المرحلة والقطاعات والدول وحجم الاستثمار. يستغرق ذلك نحو دقيقتين، ويمكنك تخطي أي شيء.",
  "Measured against your mandate, the same way for every company. Unknown never counts against a company; it only lowers confidence.":
    "يُقاس وفق تفويضك، بالطريقة نفسها لكل شركة. غير المعروف لا يُحسب ضد الشركة أبداً؛ بل يخفض الثقة فقط.",
  "Fit shows once your mandate is set and the company has shared enough to compare.":
    "تظهر الملاءمة بعد تحديد تفويضك ومشاركة الشركة ما يكفي للمقارنة.",
  "What you declared": "ما صرّحت به",
  "What you did": "ما فعلته",
  "What Q reads from it": "ما يستنتجه Q منه",
  "What you declared decides your feed. What you did and what Q reads from it are shown apart, and never change your rules unless you approve.":
    "ما صرّحت به يحدد ما يُعرض لك. ما فعلته وما يستنتجه Q منه يُعرضان منفصلين، ولا يغيّران قواعدك إلا بموافقتك.",
  "Not enough saves and passes yet for Q to read anything.":
    "لا توجد بعد مرات حفظ وتجاوز كافية ليستنتج Q شيئاً.",
  "Saving isn’t interest, and viewing counts for nothing here.":
    "الحفظ ليس اهتماماً، والمشاهدة لا تُحتسب هنا.",
  "Saved companies": "الشركات المحفوظة",
  "Q's view": "رأي Q",
  "Q's view · not verified": "رأي Q · غير موثّق",
  "No view yet.": "لا يوجد رأي بعد.",
  "See why": "اعرف السبب",
  "Worth knowing": "يستحق المعرفة",
  "In short": "باختصار",
  "Companies that asked to connect": "الشركات التي طلبت التواصل",
  "No company requests yet.": "لا توجد طلبات من شركات بعد.",
  "When a founder asks to connect, their company shows up here with how well it fits your mandate. Who can ask follows the choice you set under Visibility.":
    "حين يطلب مؤسس التواصل، تظهر شركته هنا مع مدى ملاءمتها لتفويضك. من يستطيع الطلب يتبع اختيارك في «الظهور».",
  "When an investor expresses interest in your company, it appears here for you to accept or decline.":
    "حين يبدي مستثمر اهتماماً بشركتك، يظهر ذلك هنا لتقبله أو ترفضه.",
  "No investor interest yet.": "لا يوجد اهتمام من مستثمرين بعد.",
  "Sending interest…": "جارٍ إرسال الاهتمام…",
  "Open the relationship": "افتح العلاقة",
  "Let founders find me": "اسمح للمؤسسين بالعثور عليّ",
  "How founders can reach you": "كيف يمكن للمؤسسين الوصول إليك",
  "Not set yet, so founders can't send you requests.":
    "لم يُحدَّد بعد، لذا لا يستطيع المؤسسون إرسال طلبات إليك.",
  "What founders will see": "ما سيراه المؤسسون",
  "Set up your mandate first. Until then there is nothing founders could see.":
    "أعدّ تفويضك أولاً. حتى ذلك الحين لا يوجد ما يمكن للمؤسسين رؤيته.",
  "This is the whole profile. Your mandate, cheque size, portfolio and anything you have discussed with Q are not part of it.":
    "هذا هو الملف بالكامل. تفويضك وحجم استثمارك ومحفظتك وما ناقشته مع Q ليست جزءاً منه.",
  "No investor profile to show yet.": "لا يوجد ملف مستثمر لعرضه بعد.",
  "Everyone in your firm sees it from their next page.":
    "يراه كل من في شركتك من صفحته التالية.",
  "How Q reads your thesis": "كيف يقرأ Q أطروحتك",
  "Names you can already see": "أسماء يمكنك رؤيتها بالفعل",
  "Main qualification": "المؤهل الرئيسي",
  "Based in": "المقر في",

  // Assumptions, approvals and drafts
  "Questions to investigate": "أسئلة للتحقق",
  "How to settle one": "كيف تحسم أحدها",
  "Ask Q to check": "اطلب من Q التحقق",
  "request a document": "اطلب مستنداً",
  "Request a document": "اطلب مستنداً",
  "Evidence board": "لوحة الأدلة",
  "Rests on": "يستند إلى",
  "Ask Q to check the evidence": "اطلب من Q التحقق من الأدلة",
  "Q prepared this from the assumptions you picked. Nothing is sent until you approve.":
    "أعدّ Q هذا من الافتراضات التي اخترتها. لا يُرسل شيء حتى توافق.",
  How: "الطريقة",
  "They see": "يرون",
  "To change the wording, close this and pick again, or ask Q to draft it with you. Sending twice sends it once.":
    "لتغيير الصياغة، أغلق هذا واختر من جديد، أو اطلب من Q صياغته معك. الإرسال مرتين يُرسله مرة واحدة.",
  "Q prepares · you approve · nothing is sent until you press Send":
    "يُعدّ Q · توافق أنت · لا يُرسل شيء حتى تضغط «إرسال»",
  "Saving asks for your approval again, for exactly these words.":
    "يطلب الحفظ موافقتك مجدداً، على هذه الكلمات بالضبط.",
  "Approve this change": "وافق على هذا التغيير",
  "Edit email": "عدّل البريد",
  Subject: "الموضوع",
  "Email me too": "أرسل إليّ أيضاً",
  "Let Q do it": "دع Q يتولاه",
  "Q can do this for you. It prepares it and nothing is saved until you approve it.":
    "يستطيع Q فعل هذا نيابةً عنك. يُعدّه ولا يُحفظ شيء حتى توافق عليه.",
  "Ask Q to handle something": "اطلب من Q تولي أمر ما",
  "Ask Q to make it": "اطلب من Q إعداده",
  "Yes, draft it": "نعم، صُغه",
  "Draft my application": "صُغ طلبي",

  // Capital and rounds
  "Raise terms": "شروط الجولة",
  "Edit terms": "عدّل الشروط",
  "Save terms": "احفظ الشروط",
  "Save changes": "احفظ التغييرات",
  Valuation: "التقييم",
  "Valuation is": "التقييم",
  "Discount (%)": "الخصم (%)",
  "Pro-rata rights": "حقوق المشاركة التناسبية",
  "Lead investor": "المستثمر القائد",
  "Lead's name": "اسم المستثمر القائد",
  "Target close date": "تاريخ الإغلاق المستهدف",
  "Private to your company. Leave a field empty when it isn't decided; Q never fills it in for you.":
    "خاص بشركتك. اترك الحقل فارغاً إن لم يُحسم بعد؛ لا يملؤه Q نيابةً عنك أبداً.",
  "Add a round": "أضف جولة",
  "Record a past round": "سجّل جولة سابقة",
  "Add to history": "أضف إلى السجل",
  "A round you raised before Capital Q. It goes into your history and never becomes your current round.":
    "جولة جمعتها قبل Capital Q. تُضاف إلى سجلك ولا تصبح جولتك الحالية أبداً.",
  "Extends an earlier round": "تمدّد جولة سابقة",
  "Every change to this round, newest first.":
    "كل تغيير على هذه الجولة، الأحدث أولاً.",
  "Changes are kept in the round's history, with what they replaced.":
    "تُحفظ التغييرات في سجل الجولة، مع ما استُبدل بها.",
  "The history couldn't load. Try again in a moment.":
    "تعذّر تحميل السجل. حاول بعد قليل.",
  "Why the change (optional)": "سبب التغيير (اختياري)",
  "Corrected after the term sheet": "صُحّح بعد ورقة الشروط",
  "In force": "سارٍ",
  "In force now": "سارٍ الآن",
  Agreed: "متفق عليه",
  "As said in the call; not a commitment until confirmed.":
    "كما قيل في المكالمة؛ ليس التزاماً حتى يُؤكَّد.",
  "My commitments": "التزاماتي",
  "Money mentioned": "المبالغ المذكورة",
  "Transfer reference (optional)": "مرجع التحويل (اختياري)",
  "Your 3/6/12-month plan": "خطتك لـ 3/6/12 شهراً",
  "Plan horizon": "أفق الخطة",
  "Plan columns": "أعمدة الخطة",
  "18 months of runway: two engineers, a sales lead":
    "مدرج مالي لـ 18 شهراً: مهندسان ومسؤول مبيعات",
  "The figures": "الأرقام",
  "These series have incompatible categories. The original figures are shown below.":
    "لهذه السلاسل فئات غير متوافقة. تظهر الأرقام الأصلية أدناه.",

  // Pitch and video
  Video: "الفيديو",
  "The video": "الفيديو",
  "New video": "فيديو جديد",
  "All videos": "كل الفيديوهات",
  "Choose a pitch video": "اختر فيديو العرض",
  "a pitch video": "فيديو عرض",
  "a new pitch video": "فيديو عرض جديد",
  "Delete video": "احذف الفيديو",
  "Delete this video?": "هل تحذف هذا الفيديو؟",
  "It stops playing everywhere on Capital Q straight away. Your other videos stay.":
    "يتوقف تشغيله في كل مكان على Capital Q فوراً. تبقى فيديوهاتك الأخرى.",
  "Investors watch this first. Keep it to what you'd say across a table.":
    "يشاهد المستثمرون هذا أولاً. اقتصر على ما ستقوله وجهاً لوجه.",
  "Investors may play this pitch": "يمكن للمستثمرين تشغيل هذا العرض",
  "Let investors play this pitch": "اسمح للمستثمرين بتشغيل هذا العرض",
  "Let investors download my pitch": "اسمح للمستثمرين بتنزيل عرضي",
  "Who can watch it": "من يستطيع مشاهدته",
  "Make private": "اجعله خاصاً",
  "Keep it private": "أبقِه خاصاً",
  "Keep this one": "أبقِ هذا",
  "Use this": "استخدم هذا",
  Replace: "استبدل",
  "Upload paused": "الرفع متوقف مؤقتاً",
  "Cancel upload": "ألغِ الرفع",
  "Cancel that upload": "ألغِ ذلك الرفع",
  "The video service is preparing your pitch": "خدمة الفيديو تجهّز عرضك",
  "What an investor's player will show. Muted until they turn the sound on.":
    "ما سيعرضه مشغّل المستثمر. صامت حتى يشغّل الصوت.",
  "Shown with the video. Leave blank to show it as your pitch.":
    "يُعرض مع الفيديو. اتركه فارغاً ليُعرض كعرضك.",
  Title: "العنوان",
  Summary: "الملخص",
  Length: "المدة",
  Chapters: "الفصول",
  "Your pitch couldn't load": "تعذّر تحميل عرضك",
  "Your pitch couldn't load.": "تعذّر تحميل عرضك.",
  "Your videos couldn't load": "تعذّر تحميل فيديوهاتك",
  "A pitch belongs to a company.": "العرض يخص شركة.",
  "Pitches are made by founders.": "يصنع المؤسسون العروض.",
  "A pitch reaches investors through the same door as the rest of your profile.":
    "يصل العرض إلى المستثمرين عبر الباب نفسه الذي يصل منه بقية ملفك.",
  "As an investor you watch them: every discoverable company's pitch plays in Discover.":
    "بصفتك مستثمراً، تشاهدها: يُعرض فيديو كل شركة متاحة في Discover.",
  "Set up your company with Q first; the pitch comes after, once there is something for investors to see.":
    "أعدّ شركتك مع Q أولاً؛ يأتي العرض بعد ذلك، حين يوجد ما يراه المستثمرون.",
  "Company or product profile": "ملف الشركة أو المنتج",

  // Q Pitch tour
  "Q Pitch runs only on a fictional demo account. This account is not one, so the tour has not started.":
    "يعمل Q Pitch على حساب تجريبي وهمي فقط. هذا الحساب ليس كذلك، لذا لم تبدأ الجولة.",
  "Start the tour": "ابدأ الجولة",
  "Captions only": "الترجمة النصية فقط",
  "Q Pitch tour": "جولة Q Pitch",
  Tour: "الجولة",
  "End tour": "أنهِ الجولة",
  "Guided tours": "جولات إرشادية",
  "the Capital Q tour": "جولة Capital Q",
  "Feature Atlas": "أطلس الميزات",
  "Start at any chapter. Chapters marked internal show code-verified behaviour without a browser receipt yet.":
    "ابدأ من أي فصل. الفصول الموسومة بـ«داخلي» تعرض سلوكاً تحقق منه الكود دون إيصال من المتصفح بعد.",
  "Q guides you through the real app. These are internal rehearsals of a draft script on demonstration data. You can pause, go back, skip or ask a question at any point.":
    "يرشدك Q عبر التطبيق الفعلي. هذه تدريبات داخلية على نص مسودة ببيانات تجريبية. يمكنك الإيقاف أو الرجوع أو التخطي أو طرح سؤال في أي وقت.",
  "Show me that again": "أرني ذلك مرة أخرى",
  "Start again": "ابدأ من جديد",
  "Tap to skip": "انقر للتخطي",
  "Time left:": "الوقت المتبقي:",

  // Calls and meetings
  "Find a time": "اعثر على موعد",
  "Or pick a time": "أو اختر موعداً",
  "Looking at your calendar…": "جارٍ الاطلاع على تقويمك…",
  "Plan it": "خطّط له",
  "What the call is for": "الغرض من المكالمة",
  "Google Meet link": "رابط Google Meet",
  "Join Google Meet": "انضم إلى Google Meet",
  "Cancel call": "ألغِ المكالمة",
  "Meeting record": "سجل الاجتماع",
  "Who was there": "من حضر",
  When: "متى",
  "Q joins and keeps the record for both sides.":
    "ينضم Q ويحتفظ بالسجل للطرفين.",
  "Decline recording": "ارفض التسجيل",
  "Yes, decline": "نعم، ارفض",
  "Q won't record this call. Everyone on it, and Capital Q, will see that you declined.":
    "لن يسجّل Q هذه المكالمة. سيرى كل المشاركين، وCapital Q، أنك رفضت.",
  "Let Q record": "دع Q يسجّل",
  "Send Q in": "أرسل Q",
  "Send Q in again": "أرسل Q مرة أخرى",
  "Keep Q": "أبقِ Q",
  "The video room isn’t available right now.": "غرفة الفيديو غير متاحة الآن.",
  "Remind me to": "ذكّرني بأن",
  "Set reminder": "اضبط التذكير",

  // Chat
  Attach: "أرفق",
  "Record a voice note": "سجّل ملاحظة صوتية",
  "Voice note": "ملاحظة صوتية",
  "Chat options": "خيارات المحادثة",
  "Block messages": "احظر الرسائل",
  "Block messages?": "هل تحظر الرسائل؟",
  "Unblock messages": "ألغِ حظر الرسائل",
  "Unblock messages?": "هل تلغي حظر الرسائل؟",
  "Report conversation": "أبلغ عن المحادثة",
  "Why are you reporting this?": "لماذا تبلغ عن هذا؟",
  "Something private": "شيء خاص",
  Edited: "معدَّلة",

  // Q card and profile sharing
  "Create Q Card": "أنشئ بطاقة Q",
  "Customize card": "خصّص البطاقة",
  "What the card shows": "ما تعرضه البطاقة",
  "Who sees it": "من يراها",
  "The name is always shown. Choose who sees each field: nobody, people signed in to Capital Q, or everyone with the link. Your raise and financials stay private and can't go on a card.":
    "يُعرض الاسم دائماً. اختر من يرى كل حقل: لا أحد، أو المسجّلون في Capital Q، أو كل من لديه الرابط. تبقى جولتك وبياناتك المالية خاصة ولا يمكن وضعها على البطاقة.",
  "The Q Card couldn't load just now. Reload in a moment.":
    "تعذّر تحميل بطاقة Q الآن. أعد التحميل بعد قليل.",
  "Download QR": "نزّل رمز QR",
  "Download image": "نزّل الصورة",
  Handle: "المعرّف",
  "Change handle": "غيّر المعرّف",
  "Your old handle keeps redirecting here for 90 days, and nobody else can take it meanwhile.":
    "يستمر معرّفك القديم في التحويل إلى هنا لمدة 90 يوماً، ولا يستطيع أحد غيرك أخذه خلالها.",
  "Let search engines list the public page":
    "اسمح لمحركات البحث بإدراج الصفحة العامة",
  "Off by default. Public fields are still visible to anyone with the link either way.":
    "معطّل افتراضياً. تبقى الحقول العامة مرئية لكل من لديه الرابط في الحالتين.",
  "Change what the profile says": "غيّر ما يقوله الملف",
  "Search a name among your relationships and Discover, or open anyone's Q Card by their @handle.":
    "ابحث عن اسم ضمن علاقاتك وDiscover، أو افتح بطاقة Q لأي شخص بمعرّفه @.",
  "Search results": "نتائج البحث",
  "search results": "نتائج البحث",

  // Brand and appearance
  "A theme sets the page, the menu bar, the buttons and Q's light together. Your own colour can still go on top.":
    "يضبط السمة الصفحة وشريط القائمة والأزرار وضوء Q معاً. ويمكن أن يُضاف لونك الخاص فوقها.",
  "Capital Q blue is the product's classic look; its pairs are checked in the design tokens.":
    "أزرق Capital Q هو المظهر الكلاسيكي للمنتج؛ أزواج ألوانه مُتحقق منها في رموز التصميم.",
  "Every pair is checked against WCAG AA. Gold is a fill or a deep bronze for text, never pale gold text on white.":
    "كل زوج مُتحقق منه وفق WCAG AA. الذهبي يُستخدم تعبئةً أو برونزياً داكناً للنص، ولا يكون نصاً ذهبياً باهتاً على الأبيض أبداً.",
  "Accent colour as hex": "لون التمييز بصيغة hex",
  "Pick a colour": "اختر لوناً",
  "Reset to black and gold": "أعد الضبط إلى الأسود والذهبي",
  "The theme's own": "الخاص بالسمة",
  Contrast: "التباين",
  Ratio: "النسبة",
  Pair: "الزوج",
  Sample: "عيّنة",
  Point: "نقطة",
  Clear: "امسح",
  Build: "أنشئ",
  "Capital Q. Opportunity, intelligently connected.":
    "Capital Q. فرص متصلة بذكاء.",
  "Opportunity, intelligently connected.": "فرص متصلة بذكاء.",

  // Verification and reviews
  "Where verification stands": "أين وصل التوثيق",
  "Still being checked": "ما زال قيد التحقق",
  "Verification couldn't load.": "تعذّر تحميل التوثيق.",
  "Verification belongs to a company.": "التوثيق يخص شركة.",
  "Founders ask Capital Q to verify their identity and their organisation once their company is set up.":
    "يطلب المؤسسون من Capital Q توثيق هويتهم ومؤسستهم بعد إعداد شركتهم.",
  "Capital Q has already asked from what you'd told us. Add the registered details and a document to speed it up.":
    "سبق أن طلب Capital Q ذلك بناءً على ما أخبرتنا به. أضف البيانات المسجّلة ومستنداً لتسريعه.",
  "Registered legal name": "الاسم القانوني المسجّل",
  "Registration number": "رقم التسجيل",
  "Country of registration": "دولة التسجيل",
  "2-letter code, e.g. NG, GB, US.": "رمز من حرفين، مثل AE أو SA أو US.",
  "Registered address (optional)": "العنوان المسجّل (اختياري)",
  "Website (optional)": "الموقع الإلكتروني (اختياري)",
  "Your certificate of incorporation or a registry extract. Kept in your private documents.":
    "شهادة تأسيسك أو مستخرج من السجل. تُحفظ في مستنداتك الخاصة.",
  "A passport or national ID. Kept in your private documents and seen only by the person at Capital Q who checks it.":
    "جواز سفر أو هوية وطنية. تُحفظ في مستنداتك الخاصة ولا يراها إلا الشخص في Capital Q الذي يتحقق منها.",
  "Your name as on your ID": "اسمك كما في هويتك",
  "Human review": "مراجعة بشرية",
  "Ask a person to review it": "اطلب من شخص مراجعته",
  "Ask for a review": "اطلب مراجعة",
  "Your reviews": "مراجعاتك",
  "No reviews yet": "لا توجد مراجعات بعد",
  "Your reviews couldn't load": "تعذّر تحميل مراجعاتك",
  "What should a person look at?": "ما الذي ينبغي أن ينظر فيه الشخص؟",
  "In your own words. If you have new evidence, add it to your profile or documents first; the reviewer reads it there.":
    "بكلماتك. إن كان لديك دليل جديد، أضفه إلى ملفك أو مستنداتك أولاً؛ يقرؤه المراجع هناك.",
  "Disagree with something Capital Q or Q decided? A person at Capital Q will look at it and answer within 3 days. A review checks the evidence; it doesn't bypass it.":
    "لا توافق على أمر قرره Capital Q أو Q؟ سينظر فيه شخص في Capital Q ويجيب خلال 3 أيام. المراجعة تتحقق من الأدلة ولا تتجاوزها.",

  // Documents and Q room
  "No documents yet.": "لا توجد مستندات بعد.",
  "From the document only. Each line cites its page.":
    "من المستند فقط. كل سطر يذكر صفحته.",
  "Read it": "اقرأه",
  "Make a PDF": "أنشئ ملف PDF",
  Format: "الصيغة",
  "Preview is not available yet": "المعاينة غير متاحة بعد",
  "This document could not be finished. Ask Q to try again.":
    "تعذّر إكمال هذا المستند. اطلب من Q المحاولة مرة أخرى.",
  "Previous page": "الصفحة السابقة",
  "One line": "سطر واحد",
  "Show fewer": "اعرض أقل",
  "Cards on this screen": "البطاقات على هذه الشاشة",
  "· selected": "· محدد",
  "This answer read no public sources.": "لم تعتمد هذه الإجابة على مصادر عامة.",
  "This page couldn't be drawn.": "تعذّر عرض هذه الصفحة.",
  "Couldn't load — try again.": "تعذّر التحميل، حاول مرة أخرى.",
  "Try again in a moment. Nothing is lost.": "حاول بعد قليل. لم يُفقد شيء.",
  "Your plan couldn't load. Reload to try again.":
    "تعذّر تحميل خطتك. أعد التحميل للمحاولة مجدداً.",
  "Your mandate couldn't load. Try again in a moment.":
    "تعذّر تحميل تفويضك. حاول بعد قليل.",

  // Account and joining
  "Your account is paused": "حسابك متوقف مؤقتاً",
  "Q paused your account after the setup was set aside a few times. Someone from the Capital Q team has been told and will be in touch to get you going again.":
    "أوقف Q حسابك مؤقتاً بعد تأجيل الإعداد عدة مرات. أُبلغ أحد أعضاء فريق Capital Q وسيتواصل معك لاستئناف العمل.",
  "go back to sign in": "عُد إلى تسجيل الدخول",
  "an invitation to join": "دعوة للانضمام",
  "Your gateway": "بوابتك",
};
