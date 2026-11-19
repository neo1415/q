/**
 * Arabic for the CRM import (decision 106): the import screen, its column
 * fields and stages, the private prospects list and each side's own
 * pipeline fields on a relationship. Keys are the English source; `{n}`,
 * `{name}`, `{date}` carry a figure, a name or a date (see ../patterns.ts).
 */
export const CRM_IMPORT_AR: Readonly<Record<string, string>> = {
  // Entry and page
  Import: "استيراد",
  "Import your pipeline": "استورد مسار صفقاتك",
  "Bring the deal pipeline you already keep. Q reads your file, matches each company on Capital Q, and shows you everything before it changes.":
    "أحضر مسار الصفقات الذي تحتفظ به. يقرأ Q ملفك ويطابق كل شركة على Capital Q، ويعرض عليك كل شيء قبل أي تغيير.",
  "Bring the investor tracker you already keep. Q reads your file, matches each investor on Capital Q, and shows you everything before it changes.":
    "أحضر متتبّع المستثمرين الذي تحتفظ به. يقرأ Q ملفك ويطابق كل مستثمر على Capital Q، ويعرض عليك كل شيء قبل أي تغيير.",
  "Your pipeline belongs to your company or firm":
    "مسار صفقاتك يخص شركتك أو مؤسستك",
  "Finish your setup, then import the pipeline you already keep.":
    "أكمل الإعداد، ثم استورد المسار الذي تحتفظ به.",
  "Your pipeline belongs to your company or firm. Finish your setup first.":
    "مسار صفقاتك يخص شركتك أو مؤسستك. أكمل الإعداد أولاً.",
  // Steps
  "Import steps": "خطوات الاستيراد",
  Columns: "الأعمدة",
  // File
  "Choose a CSV or Excel file": "اختر ملف CSV أو Excel",
  "Choose file": "اختر ملفاً",
  "An export from Affinity, HubSpot, DealCloud, Airtable or your own spreadsheet. Q reads the columns and matches each company.":
    "ملف مُصدَّر من Affinity أو HubSpot أو DealCloud أو Airtable أو جدولك الخاص. يقرأ Q الأعمدة ويطابق كل شركة.",
  "An export from Foundersuite, Visible, HubSpot or your own investor tracker. Q reads the columns and matches each investor.":
    "ملف مُصدَّر من Foundersuite أو Visible أو HubSpot أو متتبّع المستثمرين الخاص بك. يقرأ Q الأعمدة ويطابق كل مستثمر.",
  "Nothing is imported until you approve. The file is checked for safety first.":
    "لا يُستورد شيء حتى توافق. يُفحص الملف أمنياً أولاً.",
  "Uploading your file": "جارٍ رفع ملفك",
  "Checking the file for safety": "جارٍ فحص الملف أمنياً",
  "Checking the file for safety…": "جارٍ فحص الملف أمنياً…",
  "Q is reading your columns and matching each row":
    "يقرأ Q أعمدتك ويطابق كل صف",
  "Choose a CSV or an Excel (.xlsx) file.":
    "اختر ملف CSV أو ملف Excel ‏(.xlsx).",
  "That file is larger than 10 MB. Export fewer columns or rows.":
    "حجم الملف أكبر من 10 ميغابايت. صدّر أعمدة أو صفوفاً أقل.",
  "That file is empty.": "الملف فارغ.",
  "The safety check is taking longer than usual. Try again in a few minutes; the file is kept.":
    "الفحص الأمني يستغرق وقتاً أطول من المعتاد. حاول مجدداً بعد دقائق؛ الملف محفوظ.",
  "The file couldn't be uploaded. Check your connection and try again.":
    "تعذّر رفع الملف. تحقق من اتصالك وحاول مجدداً.",
  "That file isn't one of yours, or it no longer exists.":
    "هذا الملف ليس من ملفاتك، أو لم يعد موجوداً.",
  "That file is still being checked for safety. Try again in a minute.":
    "ما زال الملف قيد الفحص الأمني. حاول بعد دقيقة.",
  "That file did not pass the safety check, so it can't be read.":
    "لم يجتز الملف الفحص الأمني، لذا لا يمكن قراءته.",
  "That file is too large to import.": "الملف أكبر من أن يُستورد.",
  "That file can't be read here.": "لا يمكن قراءة هذا الملف هنا.",
  "Couldn't read the file just now. Nothing was imported; try again.":
    "تعذّرت قراءة الملف الآن. لم يُستورد شيء؛ حاول مجدداً.",
  // Review
  "{n} rows": "{n} صفاً",
  "In Capital Q": "على Capital Q",
  "Kept private": "محفوظة بشكل خاص",
  "Can't import": "لا يمكن استيرادها",
  "Q matched your columns to Capital Q's fields. Change any that look wrong.":
    "طابق Q أعمدتك مع حقول Capital Q. غيّر أي حقل يبدو خاطئاً.",
  "Read with the columns you chose.": "قُرئ بالأعمدة التي اخترتها.",
  "Matched by the column names. Change any that look wrong.":
    "طوبقت حسب أسماء الأعمدة. غيّر أي حقل يبدو خاطئاً.",
  "Not imported": "لا يُستورد",
  "Reading…": "جارٍ القراءة…",
  "Read again with these columns": "اقرأ مجدداً بهذه الأعمدة",
  "Your rows are matched again before you approve.":
    "تُطابَق صفوفك مجدداً قبل موافقتك.",
  "Choose the column that names each company.":
    "اختر العمود الذي يحمل اسم كل شركة.",
  "Choose the column that names each investor.":
    "اختر العمود الذي يحمل اسم كل مستثمر.",
  "Each column can go to one field only, and one column must name the company or investor.":
    "يُخصَّص كل عمود لحقل واحد فقط، ويجب أن يحمل عمود واحد اسم الشركة أو المستثمر.",
  Rows: "الصفوف",
  "Rows by how they matched": "الصفوف حسب نتيجة المطابقة",
  "These companies are on Capital Q. Each joins your pipeline with its stage, notes and next step, private to your firm.":
    "هذه الشركات موجودة على Capital Q. تنضم كل منها إلى مسارك بمرحلتها وملاحظاتها وخطوتها التالية، خاصة بمؤسستك.",
  "These investors are on Capital Q. Each joins your pipeline with its stage, notes and next step, private to your company.":
    "هؤلاء المستثمرون موجودون على Capital Q. ينضم كل منهم إلى مسارك بمرحلته وملاحظاته وخطوته التالية، خاصة بشركتك.",
  "More than one organisation fits these rows. Choose the right one, keep the row private, or skip it. A row left unchosen is skipped.":
    "أكثر من جهة تطابق هذه الصفوف. اختر الجهة الصحيحة، أو احتفظ بالصف بشكل خاص، أو تخطَّه. الصف الذي لا تختار له يُتخطّى.",
  "Not on Capital Q yet. These stay a private list for your organisation; nothing is created or shared.":
    "ليست على Capital Q بعد. تبقى قائمة خاصة بجهتك؛ لا يُنشأ شيء ولا يُشارك.",
  "These rows can't be imported.": "لا يمكن استيراد هذه الصفوف.",
  "No rows here.": "لا توجد صفوف هنا.",
  "The first rows are shown; all {n} are imported.":
    "تُعرض الصفوف الأولى؛ وتُستورد كلها ({n}).",
  "No name": "بلا اسم",
  "Row {n}": "الصف {n}",
  "Who is {name}?": "من هو {name}؟",
  "Keep as a private prospect": "احتفظ به كجهة محتملة خاصة",
  "Skip this row": "تخطَّ هذا الصف",
  "Your stage: {stage}": "مرحلتك: {stage}",
  "Kept in your words": "محفوظة بكلماتك",
  "Matched on Capital Q": "طوبقت على Capital Q",
  "Matched to {name}": "طوبقت مع {name}",
  "Private prospect": "جهة محتملة خاصة",
  "This row has no company name.": "هذا الصف بلا اسم شركة.",
  "This row has no investor name.": "هذا الصف بلا اسم مستثمر.",
  "This row can't be read.": "لا يمكن قراءة هذا الصف.",
  // Approve
  "{n} go into your pipeline and {n2} stay a private list.":
    "{n} تدخل مسارك و{n2} تبقى قائمة خاصة.",
  "Stages, notes and next steps stay private to your side; nothing is shared with anyone you track.":
    "تبقى المراحل والملاحظات والخطوات التالية خاصة بجانبك؛ لا يُشارك شيء مع أي جهة تتابعها.",
  "Only your firm sees this.": "مؤسستك وحدها ترى هذا.",
  "Only your company sees this.": "شركتك وحدها ترى هذا.",
  "Approve and import": "وافق واستورد",
  "Importing…": "جارٍ الاستيراد…",
  "Importing {n} rows": "جارٍ استيراد {n} صفاً",
  "Read the file again with your columns before approving.":
    "اقرأ الملف مجدداً بأعمدتك قبل الموافقة.",
  "This import changed since it was approved. Review it again.":
    "تغيّر هذا الاستيراد منذ الموافقة عليه. راجعه مجدداً.",
  "Review the import again before approving.":
    "راجع الاستيراد مجدداً قبل الموافقة.",
  "Couldn't finish the import just now. Approving again continues it without duplicates.":
    "تعذّر إكمال الاستيراد الآن. الموافقة مجدداً تُكمله دون تكرار.",
  // Done
  Imported: "تم الاستيراد",
  "Already imported": "مستورد مسبقاً",
  "In your pipeline": "في مسارك",
  "New relationships": "علاقات جديدة",
  "Kept as private prospects": "محفوظة كجهات محتملة خاصة",
  "Stages recorded": "مراحل مسجّلة",
  "Pipeline fields set": "حقول مسار محددة",
  "Next steps on your board": "خطوات تالية على لوحتك",
  "Relationships updated": "العلاقات المحدّثة",
  "Open your pipeline": "افتح مسارك",
  "See private prospects": "اعرض الجهات المحتملة الخاصة",
  "Import another file": "استورد ملفاً آخر",
  // Column fields
  "Name (company or investor)": "الاسم (شركة أو مستثمر)",
  Stage: "المرحلة",
  "Stage date": "تاريخ المرحلة",
  "Date added": "تاريخ الإضافة",
  "Last contact": "آخر تواصل",
  "Contact name": "اسم جهة الاتصال",
  "Contact email": "بريد جهة الاتصال",
  "Contact title": "منصب جهة الاتصال",
  "Deal owner": "مسؤول الصفقة",
  "Source or introducer": "المصدر أو المُعرِّف",
  "Cheque or ticket size": "حجم الشيك أو التذكرة",
  "Priority or tier": "الأولوية أو الفئة",
  "Next step due": "موعد الخطوة التالية",
  "Pass reason": "سبب الاعتذار",
  Tags: "الوسوم",
  // Stages
  Contacted: "تم التواصل",
  Meeting: "اجتماع",
  "Stage unclear": "المرحلة غير واضحة",
  // Prospects
  "Private prospects": "الجهات المحتملة الخاصة",
  "Companies from your imports that aren't on Capital Q yet.":
    "شركات من ملفاتك المستوردة ليست على Capital Q بعد.",
  "Investors from your imports that aren't on Capital Q yet.":
    "مستثمرون من ملفاتك المستوردة ليسوا على Capital Q بعد.",
  "Your private prospects couldn't be read just now.":
    "تعذّرت قراءة جهاتك المحتملة الخاصة الآن.",
  "No private prospects yet. Companies in an imported file that aren't on Capital Q are kept here.":
    "لا توجد جهات محتملة خاصة بعد. تُحفظ هنا الشركات الواردة في ملف مستورد وليست على Capital Q.",
  "No private prospects yet. Investors in an imported file that aren't on Capital Q are kept here.":
    "لا توجد جهات محتملة خاصة بعد. يُحفظ هنا المستثمرون الواردون في ملف مستورد وليسوا على Capital Q.",
  "Only your firm sees this list.": "مؤسستك وحدها ترى هذه القائمة.",
  "Only your company sees this list.": "شركتك وحدها ترى هذه القائمة.",
  "Priority: {value}": "الأولوية: {value}",
  "Source: {value}": "المصدر: {value}",
  "From {file}, {date}": "من {file}، {date}",
  // Your pipeline (a relationship's own-side fields)
  "Your pipeline": "مسارك",
  "Your stage": "مرحلتك",
  "Introduced by": "عرّفنا به",
  "Introducer's email": "بريد المُعرِّف",
  "Expected ticket": "التذكرة المتوقعة",
  "Expected cheque": "الشيك المتوقع",
  Priority: "الأولوية",
  High: "مرتفعة",
  Medium: "متوسطة",
  Low: "منخفضة",
  "High priority": "أولوية مرتفعة",
  "Medium priority": "أولوية متوسطة",
  "Low priority": "أولوية منخفضة",
  "Not set": "غير محدد",
  "Where it came from, like a warm intro or an event.":
    "من أين جاءت، مثل تعريف مباشر أو فعالية.",
  "Your pipeline fields couldn't be read just now. They are unchanged.":
    "تعذّرت قراءة حقول مسارك الآن. لم تتغير.",
  "Write the amount as a number, like 250000 or 1500000.50.":
    "اكتب المبلغ رقماً، مثل 250000 أو 1500000.50.",
  "Someone on your side changed these just now. Reload to see the latest.":
    "غيّر أحد في جانبك هذه الحقول للتو. أعد التحميل لترى الأحدث.",
  "Choose someone from your own team as the owner.":
    "اختر أحد أعضاء فريقك مسؤولاً.",
  "That relationship isn't yours.": "هذه العلاقة ليست لك.",
  "Couldn't read your pipeline fields just now.":
    "تعذّرت قراءة حقول مسارك الآن.",
  "Check the fields: an amount is a number like 250000 with a currency, and an email looks like name@firm.com.":
    "تحقق من الحقول: المبلغ رقم مثل 250000 مع عملة، والبريد بصيغة name@firm.com.",
  "Couldn't save just now. Nothing was lost; try again.":
    "تعذّر الحفظ الآن. لم يُفقد شيء؛ حاول مجدداً.",
};
