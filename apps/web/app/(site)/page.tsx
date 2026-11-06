import Calculator from "../../components/Calculator";
import HowTabs from "../../components/HowTabs";
import RoleSelect from "../../components/RoleSelect";

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

const icons: Record<string, string> = {
  id: "M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5l8-3zm-1 13l6-6-1.4-1.4L11 12.2 8.4 9.6 7 11l4 4z",
  pay: "M3 6h18v12H3V6zm0 3h18M7 15h4",
  app: "M4 4h16v12H8l-4 4V4zm4 4h8M8 11h5",
  fam: "M8 11a3 3 0 100-6 3 3 0 000 6zm8 0a3 3 0 100-6 3 3 0 000 6zM2 20c0-3 3-5 6-5s6 2 6 5M14 20c0-2 1.5-3.6 4-4 2.2.2 4 1.6 4 4",
};

const faq = [
  { q: "هل أحتاج شهادة لأعلّم؟", a: "ليس دائماً. نطلب إثباتاً لمهارتك: نموذج من أعمالك أو فيديو تعريفي ثم مقابلة قصيرة. المواد الدراسية والقرآن لها متطلبات أعلى حسب المجال." },
  { q: "هل يجب أن أظهر وجهي؟", a: "الجلسات بالصوت والصورة داخل المنصة. وإن كنتِ تفضّلين، يمكنك اختيار التدريس للطالبات فقط عبر خيار «معلمة لطالبة»." },
  { q: "متى أستلم أرباحي؟", a: "بعد إتمام الدرس تمر فترة مراجعة ٤٨ ساعة، ثم يُحوَّل المبلغ أسبوعياً إلى حسابك البنكي. للمعلمين الجدد يكون أول تحويل بعد ١٤ يوماً." },
  { q: "كم تأخذ المنصة؟", a: "عمولة ٢٠٪ لأول ٥ جلسات مع كل متعلّم، ثم ١٢٪ فقط. لا رسوم اشتراك ولا رسوم تسجيل." },
  { q: "هل يمكنني التواصل مع الطالب خارج المنصة؟", a: "لا. الحجز والمحادثة والدفع كلها داخل المنصة، وهذا ما يحمي الطرفين من الاحتيال ويضمن لك حقك." },
];

const trust = [
  { i: "id", t: "هوية موثّقة", d: "لا يظهر أي معلم قبل التحقق من هويته وشهاداته ومقابلته." },
  { i: "pay", t: "دفع محمي", d: "المبلغ محجوز عبر مزوّد دفع مرخّص حتى يتم الدرس فعلاً." },
  { i: "app", t: "كل شيء داخل المنصة", d: "الحجز والمحادثة والفصل والدفع، دون الحاجة لتبادل أرقام أو روابط." },
  { i: "fam", t: "ولي الأمر في الصورة", d: "حسابات الأبناء تحت إشراف ولي الأمر، وهو من يعتمد كل معلم." },
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
        <img className="logo" src="/images/logo-light.png" alt="عِلمك Ilmak" width={382} height={152} />
        <span className="soon">قريباً</span>
      </header>

      <section className="hero">
        <div className="hero-text">
          <h1>
            <span className="l1">عندك علم؟</span>
            <span className="l2">خلّه يشتغل لك.</span>
          </h1>
          <p className="lead">
            نربط المعلّم الموهوب في بيته بالمتعلّم الذي يبحث عنه، بهوية موثّقة، ودفع
            محمي، وجلسات آمنة. نفتح باباً جديداً للإنتاج لكل من لديه ما يقدّمه.
          </p>
          <div className="cta-row">
            <a className="btn primary" href="#earn">
              احسب دخلك
            </a>
            <a className="btn ghost" href="#join">
              انضم لقائمة الانتظار
            </a>
          </div>
          <p className="seek">تبحث عن معلم؟ <a href="?role=learner#join">سجّل اهتمامك كمتعلّم</a></p>
        </div>

        <div className="mosaic" aria-hidden={false}>
          <Photo src="hero.jpg" label="معلمة سعودية تدرّس من منزلها عبر الحاسوب" className="m-main" />
          <Photo src="retiree.jpg" label="معلم متقاعد يدرّس من مجلسه" className="m-a" />
          <Photo src="courtyard.jpg" label="معلمة تدرّس من فناء منزلها" className="m-b" />
        </div>
      </section>

      <div className="sadu" aria-hidden="true" />
      <div className="marquee" aria-label="مجالات التعليم">
        <div className="track">
          {[...skills, ...skills].map((s, i) => (
            <span key={i}>{s}</span>
          ))}
        </div>
      </div>
      <div className="sadu flip" aria-hidden="true" />

      <Calculator />

      <section className="founding" aria-labelledby="found-h">
        <div className="founding-card">
          <p className="tag">مقاعد محدودة</p>
          <h2 id="found-h">كن من أول ١٠٠ معلّم مؤسس</h2>
          <p className="sub">المعلمون الأوائل هم من يصنعون عِلمك، ولهم مكانة خاصة:</p>
          <ul>
            <li>شارة «معلّم مؤسس» دائمة على ملفك</li>
            <li>ظهور مميّز في نتائج البحث لأول ٣ أشهر</li>
            <li>دخول مبكر قبل الإطلاق العام</li>
            <li>مرافقة مباشرة من فريقنا في أول دروسك</li>
          </ul>
          <a className="btn primary" href="?role=teacher#join">
            احجز مقعدك
          </a>
        </div>
      </section>

      <section className="who">
        <h2>من يستطيع أن يعلّم؟</h2>
        <p className="sub">كل من يملك مهارة ينفع بها غيره.</p>
        <ul className="chips">
          {whoCanTeach.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <div className="who-photos">
          <figure>
            <Photo src="calligraphy.jpg" label="يدا خطّاطة تكتب بالقصبة" className="w-a" />
            <figcaption>خطّاطة تعلّم فنّها من بيتها</figcaption>
          </figure>
          <figure>
            <Photo src="access.jpg" label="معلم من ذوي الإعاقة يدرّس من مكتبه المنزلي" className="w-b" />
            <figcaption>يعلّم من بيته، والإعاقة ما منعته</figcaption>
          </figure>
          <figure>
            <Photo src="office.jpg" label="معلم يدرّس من مكتبه المطل على أفق الرياض" className="w-c" />
            <figcaption>محترف يعلّم بعد الدوام</figcaption>
          </figure>
          <figure>
            <Photo src="group.jpg" label="جلسة تعليمية جماعية عبر الحاسوب" className="w-d" />
            <figcaption>جلسات جماعية لمن يتعلّم مع غيره</figcaption>
          </figure>
        </div>
      </section>

      <HowTabs />

      <section className="trust">
        <h2>الثقة هي منتجنا</h2>
        <p className="sub">نبني المنصة بحيث يكون الأمان هو الأساس لا الإضافة.</p>
        <div className="trust-list">
          {trust.map((c) => (
            <article key={c.t} className="trust-item">
              <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                <path d={icons[c.i]} />
              </svg>
              <h3>{c.t}</h3>
              <p>{c.d}</p>
            </article>
          ))}
        </div>
        <p className="note">
          خيار «معلمة لطالبة» متاح لمن يفضّله، وجلسات القاصرين مسجّلة وتحت إشراف ولي الأمر.
        </p>
      </section>

      <section className="founder" aria-label="كلمة المؤسسين">
        <div className="sadu" aria-hidden="true" />
        <div className="founder-in">
          <span className="watermark" aria-hidden="true">ع</span>
          <blockquote>
            <p>
              حولنا ناس كثير عندهم علم حقيقي: حافظة قرآن، معلم متقاعد، خطّاط، طبّاخة ماهرة.
              ما ينقصهم إلا طريق آمن يوصلهم بمن يحتاجهم، ويضمن لهم حقهم.
              بنينا عِلمك ليكون هذا الطريق.
            </p>
            <footer>
              <span className="mono" aria-hidden="true">ط</span>
              <span>
                <strong>طلال الزامل</strong>
                <br />
                مؤسس عِلمك، الرياض
              </span>
            </footer>
          </blockquote>
          <blockquote className="cofounder">
            <p>
              الأهل يسلّمون أولادهم لمعلّم في بيتهم، والمعلّم يسلّم وقته لعائلة ما يعرفها.
              هذي ثقة كبيرة، فما نتركها للحظ: هوية موثّقة، ومؤهلات مراجَعة، والمبلغ محفوظ حتى يتم الدرس.
              هذا اللي نبنيه، وهذا اللي نحاسب أنفسنا عليه.
            </p>
            <footer>
              <span className="mono" aria-hidden="true">خ</span>
              <span>
                <strong>خالد عبد الرحمن</strong>
                <br />
                الشريك المؤسس والرئيس التنفيذي
              </span>
            </footer>
          </blockquote>
        </div>
        <div className="sadu flip" aria-hidden="true" />
      </section>

      <section className="faq" aria-labelledby="faq-h">
        <h2 id="faq-h">أسئلة يسألها الجميع</h2>
        <div className="faq-list">
          {faq.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
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
            <RoleSelect />
          </label>
          <button className="btn primary" type="submit">
            سجّلني
          </button>
          <p className="fine">
            بإرسالك بياناتك توافق على تواصلنا معك بخصوص إطلاق المنصة فقط، ولن نشاركها مع أي طرف. <a href="/privacy">سياسة الخصوصية</a>
          </p>
        </form>
      </section>

      <footer>
        <img className="logo-foot" src="/images/logo-color.png" alt="عِلمك Ilmak" width={156} height={69} />
        <p>قيد الإعداد</p>
        <p className="fine">الصور المعروضة توضيحية.</p>
        <p className="fine"><a href="/login">دخول تجريبي (بيانات وهمية)</a></p>
      </footer>
    </main>
  );
}
