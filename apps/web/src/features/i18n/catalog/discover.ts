/** Arabic for Discover and Explore (feed, filters, saved, passed, compare). */
export const DISCOVER_AR: Readonly<Record<string, string>> = {
  // Cheque fit in a slate's explanation (owner 23 Oct 2026, cheque-fit.v1).
  "Your cheque range fits the round they are raising":
    "نطاق شيكاتك يتناسب مع الجولة التي يجمعونها",
  "Your smaller cheques fit the round; your largest is bigger than it":
    "شيكاتك الأصغر تتناسب مع الجولة؛ وأكبرها أكبر منها",
  "Your smallest cheque is larger than the round they are raising":
    "أصغر شيك لديك أكبر من الجولة التي يجمعونها",
  "Cheque size: this company has not shared its round size with you":
    "حجم الشيك: لم تشارك هذه الشركة حجم جولتها معك",
  "Cheque size: the round is in a different currency from your cheque range, so it was not compared":
    "حجم الشيك: الجولة بعملة مختلفة عن نطاق شيكاتك، لذلك لم تتم المقارنة",
  "Cheque size: not compared in this ranking":
    "حجم الشيك: لم تتم المقارنة في هذا الترتيب",
  "Cheque size: your mandate does not name one":
    "حجم الشيك: تفويضك لا يحدد حجماً",
  // Why a company is here (reason rows), evidence of a raise, and the
  // exclusion notes; {stage}/{country}/{rules} are filled in at runtime.
  Location: "الموقع",
  "Nothing in common with your company yet.": "لا شيء مشترك مع شركتك بعد.",
  Model: "النموذج",
  Customers: "العملاء",
  Status: "الحالة",
  Profile: "الملف",
  "In your stage range": "ضمن نطاق مراحلك",
  "{stage}, in your range": "{stage}، ضمن نطاقك",
  "A country you invest in": "دولة تستثمر فيها",
  "{country}, a country you invest in": "{country}، دولة تستثمر فيها",
  "In a region you invest in": "في منطقة تستثمر فيها",
  // Where a company does not fit the mandate (final check 2026-10-30).
  Cheque: "الشيك",
  "Outside your stage range": "خارج نطاق مراحلك",
  "{stage}, outside your stage range": "{stage}، خارج نطاق مراحلك",
  "Outside your regions": "خارج مناطقك",
  "{country}, outside your regions": "{country}، خارج مناطقك",
  "Not a category you named": "ليست فئة حددتها",
  "No companies with a pitch in your regions yet.":
    "لا توجد شركات لديها عرض في مناطقك بعد.",
  "1 company in your regions is on Capital Q without a pitch.":
    "شركة واحدة في مناطقك موجودة على Capital Q دون عرض.",
  "{count} companies in your regions are on Capital Q without a pitch.":
    "{count} شركات في مناطقك موجودة على Capital Q دون عرض.",
  "Showing others outside your regions.": "نعرض شركات أخرى خارج مناطقك.",
  "No companies with a pitch in your regions yet. Showing others outside your regions.":
    "لا توجد شركات لديها عرض في مناطقك بعد. نعرض شركات أخرى خارج مناطقك.",
  "A category you named": "فئة حددتها",
  "Close to a category you named": "قريبة من فئة حددتها",
  "A business model you named": "نموذج عمل حددته",
  "A customer type you named": "نوع عملاء حددته",
  "Said in their pitch": "قالوه في عرضهم",
  "Said in your pitch": "قلته في عرضك",
  "Your raise": "جولتك",
  "Declared by the company": "أعلنته الشركة",
  "Not added yet": "لم يُضَف بعد",
  "Link copied": "نُسخ الرابط",
  Share: "مشاركة",
  "red-flag": "المؤشرات التحذيرية",
  stage: "المرحلة",
  country: "الدولة",
  sector: "القطاع",
  "{a} and {b}": "{a} و{b}",
  "Your {rules} exclusion can't be checked automatically yet, so nobody is hidden because of it.":
    "لا يمكن التحقق من استبعاد {rules} تلقائياً بعد، لذا لا يُخفى أحد بسببه.",
  "Your {rules} exclusions can't be checked automatically yet, so nobody is hidden because of them.":
    "لا يمكن التحقق من استبعادات {rules} تلقائياً بعد، لذا لا يُخفى أحد بسببها.",
  "Your {rules} exclusion wasn't checked: this company hasn't stated it yet.":
    "لم يُتحقق من استبعاد {rules}: لم تذكره هذه الشركة بعد.",
  "Your {rules} exclusions weren't checked: this company hasn't stated it yet.":
    "لم يُتحقق من استبعادات {rules}: لم تذكرها هذه الشركة بعد.",
  Actions: "الإجراءات",
  "All details": "كل التفاصيل",
  "Back in Discover from your next page": "عُد إلى Discover من صفحتك التالية",
  "Back to Explore": "العودة إلى Explore",
  "Back to Saved": "العودة إلى المحفوظات",
  "Back, forward 5 s": "رجوع وتقديم 5 ثوانٍ",
  "Building your list.": "جارٍ إعداد قائمتك.",
  Cancel: "إلغاء",
  "Check your mandate": "راجع تفويضك",
  "Clear all": "مسح الكل",
  "Clear display": "إخفاء العناصر",
  "Clear filters": "مسح عوامل التصفية",
  "Companies appear here as founders choose to be discoverable. Companies you saved or passed on are kept in Saved and Passed, with their pitches.":
    "تظهر الشركات هنا عندما يختار مؤسسوها الظهور. والشركات التي حفظتها أو تجاوزتها تبقى في المحفوظات والمتجاوَزة، مع عروضها.",
  "Companies to review": "شركات للمراجعة",
  "Companies you pass on in Discover are listed here, so you can bring any of them back.":
    "الشركات التي تتجاوزها في Discover مدرجة هنا، لتتمكن من إعادة أي منها.",
  Companies: "الشركات",
  "Compare side by side": "قارن جنباً إلى جنب",
  "Compare with Q": "قارن مع Q",
  Country: "الدولة",
  Currency: "العملة",
  Decide: "قرّر",
  "Discover couldn't load.": "تعذّر تحميل Discover.",
  "Discover filters": "عوامل تصفية Discover",
  "Discover ranks companies against what you told Q. Your mandate isn't active yet, so there is nothing to rank them against.":
    "يرتّب Discover الشركات وفق ما أخبرت به Q. تفويضك غير مفعّل بعد، لذا لا يوجد ما تُرتَّب وفقه.",
  "Discover shows companies to investors and investors to founders. Which one you see follows from your setup.":
    "يعرض Discover الشركات للمستثمرين والمستثمرين للمؤسسين. وما تراه يتبع إعدادك.",
  "Download not allowed by the company": "لا تسمح الشركة بالتنزيل",
  "English (generated)": "الإنجليزية (مولَّدة)",
  "Filter Discover": "تصفية Discover",
  Filters: "عوامل التصفية",
  "Finish my mandate": "أكمل تفويضي",
  "See companies with what you've told Q so far.":
    "اطّلع على الشركات وفق ما أخبرت به Q حتى الآن.",
  "Your mandate isn't finished yet. Q can already rank companies against what you've told it, and you can finish the rest any time.":
    "لم يكتمل تفويضك بعد. يستطيع Q الآن ترتيب الشركات وفق ما أخبرته به، ويمكنك إكمال الباقي في أي وقت.",
  "Show me companies now": "أرني الشركات الآن",
  "Switching on Discover…": "جارٍ تشغيل Discover…",
  "Choose which mandate to use in your setup first.":
    "اختر أولاً التفويض الذي تريد استخدامه في إعدادك.",
  "Discover couldn't be switched on just now. Try again in a moment.":
    "تعذّر تشغيل Discover الآن. حاول مرة أخرى بعد قليل.",
  "Discover ranks companies for investors.":
    "يرتّب Discover الشركات للمستثمرين.",
  "Finish your mandate to see companies.": "أكمل تفويضك لترى الشركات.",
  "Founders' videos couldn't load": "تعذّر تحميل مقاطع المؤسسين",
  "Founders' videos": "مقاطع المؤسسين",
  From: "من",
  "Get set up": "ابدأ الإعداد",
  "Go to Discover": "اذهب إلى Discover",
  "Go to Saved": "اذهب إلى المحفوظات",
  "Has pitch video": "لديها مقطع عرض",
  "Hide everything over the video until you tap":
    "أخفِ كل ما فوق المقطع حتى تنقر",
  Interest: "الاهتمام",
  "Investor interest in your company": "اهتمام المستثمرين بشركتك",
  Investors: "المستثمرون",
  "Keyboard shortcuts": "اختصارات لوحة المفاتيح",
  "Loading more pitches…": "جارٍ تحميل المزيد من العروض…",
  "Loading pitches": "جارٍ تحميل العروض",
  "Loading your companies": "جارٍ تحميل شركاتك",
  "Loading your recommendations": "جارٍ تحميل توصياتك",
  "Move through the feed": "التنقل في الخلاصة",
  "Narrows your recommendations. The order stays as Q ranked them.":
    "يضيّق توصياتك. ويبقى الترتيب كما رتّبه Q.",
  "Next video": "المقطع التالي",
  "No scored companies match these filters.":
    "لا توجد شركات ذات درجة تطابق عوامل التصفية هذه.",
  "Unicorn Potential needs sufficient current evidence before an overall score is available. This view excludes companies without a score; missing evidence is not a judgment of business quality.":
    "تتطلب إمكانات النمو إلى شركة يونيكورن أدلة حالية كافية قبل إتاحة درجة إجمالية. يستبعد هذا العرض الشركات التي لا تتوفر لها درجة؛ ونقص الأدلة ليس حكماً على جودة الأعمال.",
  "No companies match these filters.": "لا توجد شركات تطابق عوامل التصفية هذه.",
  "No founder has shared a video with everyone yet.":
    "لم يشارك أي مؤسس مقطعاً مع الجميع بعد.",
  "No pitch to show yet": "لا يوجد عرض بعد",
  "No pitch to show yet.": "لا يوجد عرض بعد.",
  "None of these can be compared on fit right now.":
    "لا يمكن مقارنة أي منها من حيث التوافق الآن.",
  "Not available for this pitch yet": "غير متاح لهذا العرض بعد",
  "Not interested": "غير مهتم",
  "Not shared with you": "غير مشارك معك",
  "Nothing in common with your mandate yet.": "لا شيء مشترك مع تفويضك بعد.",
  "Nothing is lost. Capital Q didn't answer just now; try again in a moment.":
    "لم يضِع شيء. لم يستجب Capital Q الآن؛ حاول مجدداً بعد قليل.",
  "Nothing is lost. Try again in a moment.":
    "لم يضِع شيء. حاول مجدداً بعد قليل.",
  "Nothing is wrong with your mandate. Try again in a moment.":
    "لا خطأ في تفويضك. حاول مجدداً بعد قليل.",
  "Nothing is wrong with your profile. Try again in a moment.":
    "لا خطأ في ملفك الشخصي. حاول مجدداً بعد قليل.",
  "Nothing is wrong with your setup. Capital Q didn't answer just now; try again in a moment.":
    "لا خطأ في إعدادك. لم يستجب Capital Q الآن؛ حاول مجدداً بعد قليل.",
  "Nothing passed.": "لم تتجاوز شيئاً.",
  "Nothing saved yet.": "لم تحفظ شيئاً بعد.",
  "Nothing to review yet.": "لا شيء للمراجعة بعد.",
  "Only companies that shared their raise with me":
    "فقط الشركات التي شاركتني جولة تمويلها",
  "Open Explore": "افتح Explore",
  "Open company": "افتح الشركة",
  "Otherwise companies that haven't shared a raise stay in, marked “Raise not shared”.":
    "وإلا تبقى الشركات التي لم تشارك جولتها ظاهرة، مع علامة «الجولة غير مشاركة».",
  Pass: "تجاوز",
  "Passed couldn't load.": "تعذّر تحميل المتجاوَزة.",
  Passed: "المتجاوَزة",
  "Passing only hides a company from your feed. The company isn't told, and your mandate doesn't change.":
    "التجاوز يخفي الشركة من خلاصتك فقط. لا تُبلَّغ الشركة، ولا يتغير تفويضك.",
  Pause: "إيقاف مؤقت",
  "Pick 2 to 4 companies to compare.": "اختر من 2 إلى 4 شركات للمقارنة.",
  Pitches: "العروض",
  "Play pitch": "تشغيل العرض",
  Play: "تشغيل",
  "Playback speed": "سرعة التشغيل",
  "Previous, next": "السابق، التالي",
  "Q is matching discoverable companies to your mandate. Check back in a moment.":
    "يطابق Q الشركات الظاهرة مع تفويضك. عُد بعد قليل.",
  "Questions to investigate": "أسئلة للتحقق",
  "Raise size": "حجم الجولة",
  Raising: "تجمع تمويلاً",
  Relationship: "العلاقة",
  "Result types": "أنواع النتائج",
  "Review my hard rules": "راجع قواعدي الصارمة",
  "Review my mandate": "راجع تفويضي",
  "Same as Pass: moves on and records your pass":
    "مثل التجاوز: ينتقل ويسجّل تجاوزك",
  "Save a company in Discover and it stays here, across visits and devices.":
    "احفظ شركة في Discover وستبقى هنا، عبر الزيارات والأجهزة.",
  "Saved and passed companies": "الشركات المحفوظة والمتجاوَزة",
  "Saved couldn't load.": "تعذّر تحميل المحفوظات.",
  "Saves a copy to this device": "يحفظ نسخة على هذا الجهاز",
  "Saving isn’t interest. The company isn’t told.":
    "الحفظ ليس إبداء اهتمام. لا تُبلَّغ الشركة.",
  "Search companies": "ابحث في الشركات",
  "Search companies, investors, people and pitches":
    "ابحث في الشركات والمستثمرين والأشخاص والعروض",
  "Search companies, investors, people": "ابحث في الشركات والمستثمرين والأشخاص",
  "Searching for": "البحث عن",
  Sector: "القطاع",
  "See all": "عرض الكل",
  "Show companies": "عرض الشركات",
  "Show only": "اعرض فقط",
  "Sound stays off until you turn it on": "يبقى الصوت مغلقاً حتى تشغّله",
  Sound: "الصوت",
  Space: "مسافة",
  Speed: "السرعة",
  Stage: "المرحلة",
  "Tap for sound": "انقر للصوت",
  "Tell Q what you're here to do first.": "أخبر Q أولاً بما جئت لتفعله.",
  "The comparison didn't load.": "لم تُحمَّل المقارنة.",
  "The pitch is loading": "جارٍ تحميل العرض",
  "They pass your hard rules, but none shares a stage, country or sector you named. Widening your mandate is what brings them in.":
    "تجتاز قواعدك الصارمة، لكن لا يشترك أي منها في مرحلة أو دولة أو قطاع حددته. توسيع تفويضك هو ما يُدخلها.",
  "This feed shows only companies with a pitch you can play. The others pass your hard rules and are in Search and Explore; they join the feed when they add a pitch.":
    "تعرض هذه الخلاصة فقط الشركات التي لديها عرض يمكنك تشغيله. أما البقية فتجتاز قواعدك الصارمة وتظهر في البحث وExplore، وتنضم إلى الخلاصة عندما تضيف عرضاً.",
  "This pitch couldn't load right now. Try again in a moment.":
    "تعذّر تحميل هذا العرض الآن. حاول مجدداً بعد قليل.",
  "Tick them in Saved, then compare them side by side.":
    "حدّدها في المحفوظات، ثم قارنها جنباً إلى جنب.",
  To: "إلى",
  Topics: "المواضيع",
  "Try again": "حاول مجدداً",
  "Undo pass": "التراجع عن التجاوز",
  Verified: "موثّق",
  "What each has on record": "ما لدى كل منها في السجل",
  "What to discover": "ما الذي تريد اكتشافه",
  "When founders open a video to everyone on Capital Q, it shows here. Yours can too: choose 'Everyone on Capital Q' on any of your videos.":
    "عندما يتيح المؤسسون مقطعاً لكل من في Capital Q، يظهر هنا. ويمكن لمقطعك ذلك أيضاً: اختر «الجميع في Capital Q» على أي من مقاطعك.",
  "Why it's here": "لماذا هي هنا",
  "You may have no active mandate, or these companies are no longer visible to you.":
    "ربما ليس لديك تفويض مفعّل، أو لم تعد هذه الشركات ظاهرة لك.",
  "Your companies": "شركاتك",
  "Your picks on the same fit as your top three. Unknown never counts against a company, and the order is never paid for.":
    "اختياراتك بنفس معيار التوافق مثل أفضل ثلاث لديك. المجهول لا يُحسب ضد الشركة أبداً، ولا يُشترى الترتيب أبداً.",
  "Your recommendations are unchanged; these filters leave none of them in view.":
    "توصياتك لم تتغير؛ لكن عوامل التصفية هذه لا تُبقي أياً منها ظاهراً.",
  "Your videos": "مقاطعك",
  "companies side by side": "شركات جنباً إلى جنب",
  "companies you passed": "شركات تجاوزتها",
  // Discover A desktop dossier (2026-10-19).
  "Q's read": "قراءة Q",
  "Interest recorded": "تم تسجيل الاهتمام",
  "Its founders are told.": "يُبلَّغ مؤسسوها.",
  "Noted for your feed": "سُجّل لخلاصتك",
  "Review saved companies": "راجع الشركات المحفوظة",
  Suggested: "مقترح",
  "Today's slate": "قائمة اليوم",
  "View in CRM": "اعرض في إدارة العلاقات",
  "Why, if you like": "السبب، إن أردت",
  "You're through today's slate.": "أنهيت قائمة اليوم.",
  "what you can see": "ما يمكنك رؤيته",
  // Discover A: Q's read and the no-pitch card (2026-10-19).
  "Assessed once the company is listed": "يُقيَّم بعد إدراج الشركة",
  "Lowered by": "خفّضه",
  "No pitch video yet": "لا يوجد فيديو عرض بعد",
  "Outside your mandate": "خارج تفويضك",
  "Q can only speak to the profile": "يستطيع Q الحديث فقط عن الملف الذي نشرته",
  "Raise not shared": "الجولة غير مُشارَكة",
  "Suitability for you": "الملاءمة لك",
  "The other": "العوامل الأخرى",
  "There is not enough shared evidence for a number yet.":
    "لا توجد أدلة مُشارَكة كافية لرقم بعد.",
  "Unicorn potential": "إمكانية أن تصبح يونيكورن",
  "Would raise confidence": "سيرفع الثقة",
  "factors have evidence": "عوامل لها أدلة",
  "factors.": "عاملًا.",
  "have no evidence yet. They count as unknown, never against":
    "بلا أدلة بعد. تُحسب مجهولة، ولا تُحسب أبدًا ضد",
  "is notified": "أُبلِغت",
  "is read from": "مقروء من",
  "mandate checks known": "من فحوص التفويض معروفة",
  "published so far.": "حتى الآن.",
  "Ask about": "اسأل عن",
};
