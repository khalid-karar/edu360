const pillars = [
  {
    title: "معلمون موثّقون",
    body: "هوية عبر نفاذ، ومراجعة الشهادات، ومقابلة مباشرة قبل ظهور أي معلم على المنصة.",
  },
  {
    title: "دفع آمن",
    body: "المبلغ محجوز لدى مزوّد دفع مرخّص من البنك المركزي ولا يصل المعلم إلا بعد إتمام الدرس.",
  },
  {
    title: "جلسات مسجّلة وآمنة",
    body: "كل الدروس والمحادثات داخل المنصة، وولي الأمر يرى كل ما يخص ابنه.",
  },
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <p className="badge">قريباً</p>
        <h1>منصة التعليم</h1>
        <p className="lead">
          طريقة موثوقة ونظامية لأي شخص في بيته لديه مهارة يحتاجها الآخرون: يعلّم، ويكسب،
          والمنصة تحميه وتحمي المتعلّم.
        </p>
      </section>

      <section className="grid">
        {pillars.map((p) => (
          <article key={p.title} className="card">
            <h2>{p.title}</h2>
            <p>{p.body}</p>
          </article>
        ))}
      </section>

      <footer>
        <p>قيد الإعداد — مرحلة التجربة المغلقة قريباً.</p>
      </footer>
    </main>
  );
}
