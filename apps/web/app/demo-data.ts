// Mock data for the demo area. Nothing here is real: names, numbers, IDs and phones are invented.
export type RoleKey = "learner" | "guardian" | "minor" | "teacher" | "vetting" | "safety" | "finance" | "admin";

export const ROLES: { key: RoleKey; ar: string; en: string; who: string; phone: string; blurb: string; icon: string }[] = [
  { key: "learner", ar: "متعلّم (١٨+)", en: "Learner", who: "خالد العمري", phone: "+966500000001", blurb: "ابحث عن معلّم، احجز، وادفع بحماية.", icon: "🎓" },
  { key: "guardian", ar: "ولي أمر", en: "Guardian", who: "أم عبدالله", phone: "+966500000002", blurb: "تحكّم بحسابات أبنائك واعتمد كل معلّم جديد.", icon: "👨‍👩‍👧" },
  { key: "minor", ar: "متعلّم قاصر", en: "Minor learner", who: "عبدالله (١٢ سنة)", phone: "+966500000003", blurb: "يحضر الجلسات تحت حساب ولي أمره.", icon: "🧒" },
  { key: "teacher", ar: "معلّم", en: "Teacher", who: "أ. نورة العتيبي", phone: "+966500000004", blurb: "ملفك، جدولك، أرباحك، وتوثيق الهوية.", icon: "🧑‍🏫" },
  { key: "vetting", ar: "مسؤول التحقق", en: "Vetting officer", who: "ليلى الغامدي", phone: "+966500000005", blurb: "مراجعة الهوية والشهادات وقبول المعلّمين.", icon: "🪪" },
  { key: "safety", ar: "الثقة والسلامة", en: "Trust & Safety", who: "فهد السبيعي", phone: "+966500000006", blurb: "البلاغات والتسجيلات ومنع التواصل خارج المنصة.", icon: "🛡️" },
  { key: "finance", ar: "المالية", en: "Finance", who: "منال الزهراني", phone: "+966500000007", blurb: "التحويلات والاسترداد وتسوية الدفعات.", icon: "💳" },
  { key: "admin", ar: "مدير النظام", en: "Super admin", who: "طلال الزامل", phone: "+966500000008", blurb: "الإعدادات والعمولات وسجل التدقيق.", icon: "⚙️" },
];

export const TEACHER_NATIONAL_ID = "1000000001"; // ends in 1 → mock Nafath approves (ending 0 = rejected)

export const TEACHERS = [
  { id: "t1", name: "أ. نورة العتيبي", subject: "رياضيات", level: "ثانوي", city: "الرياض", price: 85, rating: 4.9, sessions: 212, bio: "معلّمة رياضيات ١٠ سنوات خبرة، تبسّط التفاضل والتكامل." },
  { id: "t2", name: "أ. سارة القحطاني", subject: "لغة إنجليزية", level: "متوسط", city: "جدة", price: 70, rating: 4.8, sessions: 148, bio: "محادثة وقواعد، مع تحضير لاختبار STEP." },
  { id: "t3", name: "أ. ريم الدوسري", subject: "قرآن وتجويد", level: "جميع المراحل", city: "الدمام", price: 60, rating: 5.0, sessions: 301, bio: "إجازة بالسند، تحفيظ وتجويد للصغار والكبار." },
  { id: "t4", name: "أ. هند الشمري", subject: "رسم وفنون", level: "ابتدائي", city: "الرياض", price: 90, rating: 4.7, sessions: 64, bio: "ورش رسم للأطفال بأسلوب ممتع وآمن." },
  { id: "t5", name: "أ. منى الحربي", subject: "برمجة للأطفال", level: "متوسط", city: "المدينة", price: 100, rating: 4.9, sessions: 97, bio: "Scratch وبايثون خطوة بخطوة بمشاريع صغيرة." },
];

export const LEARNER_SESSIONS = [
  { id: "s1", teacher: "أ. نورة العتيبي", subject: "رياضيات", when: "الأحد ٧:٠٠ م", status: "قادمة", price: 85 },
  { id: "s2", teacher: "أ. سارة القحطاني", subject: "إنجليزي", when: "الثلاثاء ٦:٣٠ م", status: "قادمة", price: 70 },
  { id: "s3", teacher: "أ. نورة العتيبي", subject: "رياضيات", when: "الأسبوع الماضي", status: "مكتملة", price: 85 },
];

export const CHILDREN = [
  { id: "c1", name: "عبدالله", age: 12, next: "قرآن وتجويد · الإثنين ٥:٠٠ م" },
  { id: "c2", name: "ريم", age: 9, next: "رسم وفنون · الأربعاء ٤:٠٠ م" },
];

export const APPROVALS = [
  { id: "a1", child: "ريم", teacher: "أ. هند الشمري", subject: "رسم وفنون", rating: 4.7 },
  { id: "a2", child: "عبدالله", teacher: "أ. منى الحربي", subject: "برمجة للأطفال", rating: 4.9 },
];

export const TEACHER_REQUESTS = [
  { id: "r1", learner: "متعلّم ٤٢١٨", subject: "رياضيات ثانوي", when: "الخميس ٨:٠٠ م" },
  { id: "r2", learner: "ولي أمر ٧٧٠٣", subject: "مراجعة اختبار", when: "الجمعة ٣:٠٠ م" },
];

export const EARNINGS = [
  { week: "هذا الأسبوع", sessions: 9, gross: 765, rate: 0.12 },
  { week: "الأسبوع الماضي", sessions: 11, gross: 935, rate: 0.12 },
  { week: "قبل أسبوعين", sessions: 7, gross: 560, rate: 0.2 },
];

export const APPLICANTS = [
  { id: "p1", name: "أ. لمى الجهني", subject: "فيزياء", docs: "هوية ✓ · شهادة بكالوريوس ✓ · مقابلة بانتظار الموعد", risk: "منخفض" },
  { id: "p2", name: "أ. بدر المطيري", subject: "حاسب آلي", docs: "هوية ✓ · شهادة ⚠ غير مقروءة", risk: "متوسط" },
  { id: "p3", name: "أ. دانة الرشيد", subject: "لغة عربية", docs: "هوية ✓ · شهادة ✓ · مقابلة ✓", risk: "منخفض" },
];

export const REPORTS = [
  { id: "x1", kind: "تواصل خارج المنصة", detail: "رقم جوال في المحادثة (حُجب تلقائياً)", who: "معلّم #٣١٢", sev: "متوسط" },
  { id: "x2", kind: "بلاغ سلوك", detail: "ولي أمر أبلغ عن ألفاظ غير لائقة في جلسة", who: "جلسة #٨٨٤", sev: "عالٍ" },
  { id: "x3", kind: "عدم حضور", detail: "المعلّم لم يحضر الجلسة — استرداد كامل", who: "جلسة #٨٧٩", sev: "منخفض" },
];

export const PAYOUTS = [
  { id: "y1", teacher: "أ. نورة العتيبي", net: 673.2, period: "الأسبوع الماضي" },
  { id: "y2", teacher: "أ. ريم الدوسري", net: 1210.5, period: "الأسبوع الماضي" },
  { id: "y3", teacher: "أ. سارة القحطاني", net: 402.0, period: "الأسبوع الماضي" },
];

export const REFUNDS = [
  { id: "f1", session: "#٨٧٩", amount: 70, reason: "غياب المعلّم" },
  { id: "f2", session: "#٨٦١", amount: 42.5, reason: "إلغاء المتعلّم أقل من ٢٤ ساعة (٥٠٪)" },
];

export const AUDIT_SEED = [
  "٠٩:١٢ — vetting/ليلى: قبول أ. دانة الرشيد",
  "٠٨:٤٠ — finance/منال: اعتماد تحويل #٤١٧",
  "٠٨:٠٥ — safety/فهد: تحذير معلّم #٢٩٠",
];
