"use client";
import { useState } from "react";

const teacher = [
  { n: "١", t: "وثّق هويتك", d: "تسجيل سريع وتحقق من الهوية عبر نفاذ." },
  { n: "٢", t: "قدّم مهارتك", d: "أضف شهاداتك وفيديو تعريفياً قصيراً، ثم مقابلة مع فريقنا." },
  { n: "٣", t: "درّس واكسب", d: "ابدأ جلساتك من بيتك، واستلم أرباحك بعد كل درس." },
];
const learner = [
  { n: "١", t: "اختر معلمك", d: "معلمون موثّقون، وتقييمات حقيقية من دروس فعلية." },
  { n: "٢", t: "احجز وادفع", d: "المبلغ يُحفظ ولا يصل المعلم إلا بعد إتمام الدرس." },
  { n: "٣", t: "تعلّم بأمان", d: "جلسة داخل المنصة، وولي الأمر يرى كل ما يخص ابنه." },
];

export default function HowTabs() {
  const [tab, setTab] = useState<"teacher" | "learner">("teacher");
  const steps = tab === "teacher" ? teacher : learner;
  return (
    <section id="how" className="how">
      <h2>كيف تعمل؟</h2>
      <div className="tabs" role="tablist" aria-label="اختر دورك">
        <button
          role="tab"
          aria-selected={tab === "teacher"}
          className={tab === "teacher" ? "on" : ""}
          onClick={() => setTab("teacher")}
        >
          أنا معلّم
        </button>
        <button
          role="tab"
          aria-selected={tab === "learner"}
          className={tab === "learner" ? "on" : ""}
          onClick={() => setTab("learner")}
        >
          أبحث عن معلم
        </button>
      </div>
      <ol className="steps" role="tabpanel">
        {steps.map((s) => (
          <li key={s.n}>
            <span className="num">{s.n}</span>
            <div>
              <strong>{s.t}</strong>
              <p>{s.d}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
