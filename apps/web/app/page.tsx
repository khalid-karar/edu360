const skills = [
  "القرآن والتجويد",
  "اللغة الإنجليزية",
  "الرياضيات والعلوم",
  "الخط العربي",
  "الرسم والفنون",
  "الطبخ",
  "البرمجة",
  "الحرف اليدوية",
  "اللغات",
  "المهارات المهنية",
];

const whoCanTeach = [
  "ربّة منزل لديها موهبة",
  "متقاعد يحمل خبرة عمر",
  "خريج ينتظر فرصته",
  "شخص من ذوي الإعاقة يعلّم من بيته",
  "حافظ ومجوّد للقرآن",
  "صاحب حرفة أو فن",
];

const teacherSteps = [
  { n: "١", t: "وثّق هويتك", d: "تسجيل سريع وتحقق من الهوية عبر نفاذ." },
  { n: "٢", t: "قدّم مهارتك", d: "أضف شهاداتك وفيديو تعريفياً قصيراً، ثم مقابلة مع فريقنا." },
  { n: "٣", t: "درّس واكسب", d: "ابدأ جلساتك من بيتك، واستلم أرباحك بعد كل درس." },
];

const learnerSteps = [
  { n: "١", t: "اختر معلمك", d: "معلمون موثّقون، وتقييمات حقيقية من دروس فعلية." },
  { n: "٢", t: "احجز وادفع", d: "المبلغ يُحفظ ولا يصل المعلم إلا بعد إتمام الدرس." },
  { n: "٣", t: "تعلّم بأمان", d: "جلسة داخل المنصة، وولي الأمر يرى كل ما يخص ابنه." },
];

const trust = [
  { t: "هوية موثّقة", d: "لا يظهر أي معلم قبل التحقق من هويته وشهاداته ومقابلته." },
  { t: "دفع محمي", d: "المبلغ محجوز عبر مزوّد دفع مرخّص حتى يتم الدرس فعلاً." },
  { t: "كل شيء داخل المنصة", d: "الحجز والمحادثة والفصل والدفع، دون الحاجة لتبادل أرقام أو روابط." },
  { t: "ولي الأمر في الصورة", d: "حسابات الأبناء تحت إشراف ولي الأمر، وهو من يعتمد كل معلم." },
];

function Photo({
  src,
  label,
  className,
}: {
  src: string;
  label: string;
  className: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`photo ${className}`}
      style={{ backgroundImage: `url(/images/${src}), var(--photo-fallback)` }}
    />
  );
}

export default function Home() {
  return (
    <main>
      <header className="top">
        <span className="brand">منصة التعليم</span>
        <span className="soon">قريباً</span>
      </header>

      <section className="hero">
        <div className="hero-text">
          <p className="eyebrow">منصة سعودية للتعليم من المنزل</p>
          <h1>
            عندك مهارة؟
            <br />
            <span className="gold">بيتك صار فصلاً.</span>
          </h1>
          <p className="lead">
            نربط المعلّم الموهوب في بيته بالمتعلّم الذي يبحث عنه، بهوية موثّقة، ودفع
            محمي، وجلسات آمنة. نفتح باباً جديداً للإنتاج لكل من لديه ما يقدّمه.
          </p>
          <div className="cta-row">
            <a className="btn primary" href="#join">
              انضم لقائمة الانتظار
            </a>
            <a className="btn ghost" href="#how">
              كيف تعمل المنصة؟
            </a>
          </div>
        </div>

        <div className="mosaic" aria-hidden={false}>
          <Photo src="hero.jpg" label="معلمة سعودية تدرّس من منزلها عبر الحاسوب" className="m-main" />
          <Photo src="access.jpg" label="معلم من ذوي الإعاقة يدرّس من مكتبه المنزلي" className="m-a" />
          <Photo src="courtyard.jpg" label="معلمة تدرّس من فناء منزلها" className="m-b" />
        </div>
      </section>

      <div className="marquee" aria-label="مجالات التعليم">
        <div className="track">
          {[...skills, ...skills].map((s, i) => (
            <span key={i}>{s}</span>
          ))}
        </div>
      </div>

      <section className="who">
        <h2>من يستطيع أن يعلّم؟</h2>
        <p className="sub">كل من يملك مهارة ينفع بها غيره.</p>
        <ul className="chips">
          {whoCanTeach.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <div className="who-photos">
          <Photo src="office.jpg" label="معلم يدرّس من مكتبه المطل على أفق الرياض" className="w-a" />
          <Photo src="woman.jpg" label="معلمة تدرّس الخط العربي" className="w-b" />
          <Photo src="retiree.jpg" label="معلم متقاعد يدرّس من مجلسه" className="w-c" />
          <Photo src="group.jpg" label="جلسة تعليمية جماعية عبر الحاسوب" className="w-d" />
        </div>
      </section>

      <section id="how" className="how">
        <h2>كيف تعمل؟</h2>
        <div className="two">
          <div className="col">
            <h3>للمعلّم</h3>
            <ol>
              {teacherSteps.map((s) => (
                <li key={s.n}>
                  <span className="num">{s.n}</span>
                  <div>
                    <strong>{s.t}</strong>
                    <p>{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="col">
            <h3>للمتعلّم وولي الأمر</h3>
            <ol>
              {learnerSteps.map((s) => (
                <li key={s.n}>
                  <span className="num">{s.n}</span>
                  <div>
                    <strong>{s.t}</strong>
                    <p>{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="trust">
        <h2>الثقة هي منتجنا</h2>
        <p className="sub">نبني المنصة بحيث يكون الأمان هو الأساس لا الإضافة.</p>
        <div className="grid">
          {trust.map((c) => (
            <article key={c.t} className="card">
              <h3>{c.t}</h3>
              <p>{c.d}</p>
            </article>
          ))}
        </div>
        <p className="note">
          خيار «معلمة لطالبة» متاح لمن يفضّله، وجلسات القاصرين مسجّلة وتحت إشراف ولي الأمر.
        </p>
      </section>

      <section id="join" className="join">
        <h2>كن من الأوائل</h2>
        <p className="sub">سجّل اهتمامك وسنتواصل معك عند فتح التجربة الأولى.</p>
        <form
          name="waitlist"
          method="POST"
          action="/thanks"
          data-netlify="true"
          netlify-honeypot="bot-field"
        >
          <input type="hidden" name="form-name" value="waitlist" />
          <p hidden>
            <label>
              لا تملأ هذا الحقل: <input name="bot-field" />
            </label>
          </p>
          <label>
            الاسم
            <input name="name" type="text" required autoComplete="name" />
          </label>
          <label>
            الجوال أو البريد الإلكتروني
            <input name="contact" type="text" required autoComplete="email" />
          </label>
          <label>
            أنا
            <select name="role" defaultValue="teacher">
              <option value="teacher">معلّم أريد أن أدرّس</option>
              <option value="learner">متعلّم أبحث عن معلم</option>
              <option value="parent">ولي أمر</option>
            </select>
          </label>
          <button className="btn primary" type="submit">
            سجّلني
          </button>
          <p className="fine">
            بإرسالك بياناتك توافق على تواصلنا معك بخصوص إطلاق المنصة فقط، ولن نشاركها مع أي طرف.
          </p>
        </form>
      </section>

      <footer>
        <p>منصة التعليم · قيد الإعداد</p>
        <p className="fine">الصور المعروضة توضيحية.</p>
      </footer>
    </main>
  );
}
