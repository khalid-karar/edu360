"use client";
import { useState } from "react";

const AR = "٠١٢٣٤٥٦٧٨٩";
const ar = (n: number) =>
  Math.round(n).toLocaleString("en-US").replace(/\d/g, (d) => AR[Number(d)] ?? d).replace(/,/g, "٬");

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
      <h2 id="calc-h">كم يمكن أن يجيب لك علمك؟</h2>
      <p className="sub">حرّك الأشرطة وشوف دخلك التقريبي من بيتك.</p>

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
            onChange={(e) => setPrice(Number(e.target.value))}
          />
        </label>

        <div className="result" aria-live="polite">
          <p className="small">دخلك الشهري التقريبي</p>
          <p className="amount">
            {ar(round10(gross * NET_LOW))} – {ar(round10(gross * NET_HIGH))} <span>ريال</span>
          </p>
          <p className="small">
            من حوالي {ar(sessions)} ساعة شهرياً، بعد عمولة المنصة
          </p>
        </div>

        <a className="btn primary" href="#join">
          أبغى أبدأ
        </a>
        <p className="fine dark">
          تقدير توضيحي وليس وعداً بالدخل؛ يعتمد على عدد الحجوزات. العمولة ٢٠٪ لأول ٥ جلسات مع كل متعلّم ثم ١٢٪.
        </p>
      </div>
    </section>
  );
}
