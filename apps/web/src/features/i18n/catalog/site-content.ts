/**
 * Arabic for the site content editor in the admin console (decision 107).
 * Keys are the English source. Placeholder tokens such as
 * {{COMPANY_NAME}} stay as written.
 */
export const SITE_CONTENT_AR: Readonly<Record<string, string>> = {
  "Site content": "محتوى الموقع",
  "Site content · Admin": "محتوى الموقع · الإدارة",
  "Edit page · Admin": "تحرير الصفحة · الإدارة",
  "Site settings": "إعدادات الموقع",
  "All pages": "كل الصفحات",
  History: "السجل",
  Publish: "نشر",
  View: "العرض",
  "View live": "عرض الصفحة المنشورة",
  "The page couldn't load": "تعذّر تحميل الصفحة",
  "The pages couldn't load": "تعذّر تحميل الصفحات",
  "The home page, pricing, FAQ and legal pages. Open one to edit it block by block, preview it at desktop and phone widths, and publish. Every published version is kept.":
    "الصفحة الرئيسية والأسعار والأسئلة الشائعة والصفحات القانونية. افتح صفحة لتحريرها كتلةً كتلة، ومعاينتها بعرض الحاسوب والهاتف، ثم نشرها. تُحفظ كل نسخة منشورة.",
  "No pages yet. Import the default content with scripts/seed/site-content.mjs; legal pages arrive as drafts waiting for review.":
    "لا توجد صفحات بعد. استورد المحتوى الافتراضي عبر scripts/seed/site-content.mjs؛ تصل الصفحات القانونية مسوداتٍ بانتظار المراجعة.",
  "These fill the placeholders on every page, such as {{COMPANY_NAME}}. A change shows on every published page at once.":
    "تملأ هذه القيم العناصر النائبة في كل صفحة، مثل {{COMPANY_NAME}}. يظهر أي تغيير في كل الصفحات المنشورة فورًا.",
};
