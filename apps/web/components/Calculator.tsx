"use client";
import { useState } from "react";

const ar = (n: number) => Math.round(n).toLocaleString("en-US");

const WEEKS_PER_MONTH = 4.3;
const NET_LOW = 0.8; // 20% commission, first sessions with a learner
const NET_HIGH = 0.88; // 12% commission, returning learners

export default function Calculator() {
  const [hours, setHours] = useState(5);
  const [price, setPrice] = useState(80);

  const sessions = Math.round(hours * WEEKS_PER_MONTH);
  const gross = hours * WEEKS_PER_MONTH * price;
  const round10 = (n: number) => Math.round(n / 10) * 10;

  return (
    <section className="calc" id="earn" aria-labelledby="calc-h">
      <h2 id="calc-h" className="big">علمك يجيب دخل</h2>
      <p className="play">علمك… علّمك</p>
      <p className="sub">حرّك الأشرطة وشوف كم يمكن أن يجيب لك علمك من بيتك.</p>

      <div className="calc-card">
        <label className="range">
          <span>
            ساعات التدريس في الأسبوع <b>{ar(hours)}</b>
          </span>
          <input
            type="range"
            min={1}
            max={20}
            step={1}
            value={hours}
            style={{ "--p": `${((hours - 1) / 19) * 100}%` } as React.CSSProperties}
            onChange={(e) => setHours(Number(e.target.value))}
          />
        </label>
        <label className="range">
          <span>
            سعر الساعة (ريال) <b>{ar(price)}</b>
          </span>
          <input
            type="range"
            min={30}
            max={250}
            step={10}
            value={price}
            style={{ "--p": `${((price - 30) / 220) * 100}%` } as React.CSSProperties}
            onChange={(e) => setPrice(Number(e.target.value))}
          />
        </label>

        <div className="result" aria-live="polite" dir="rtl">
          <p className="small">دخلك الشهري التقريبي</p>
          <p className="amount">
            <bdi>{ar(round10(gross * NET_LOW))}</bdi> – <bdi>{ar(round10(gross * NET_HIGH))}</bdi> <span>ريال</span>
          </p>
          <p className="small">
            من حوالي {ar(sessions)} ساعة شهرياً، بعد عمولة المنصة
          </p>
        </div>

        <a className="btn primary" href="#join">
          أبغى أبدأ
        </a>
        <p className="fine dark">
          تقدير توضيحي وليس وعداً بالدخل؛ يعتمد على عدد الحجوزات. العمولة 20% لأول 5 جلسات مع كل متعلّم ثم 12%.
        </p>
      </div>
    </section>
  );
}
