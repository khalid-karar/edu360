"use client";
import type { ReactNode } from "react";

export const n = (v: number, d = 0) => v.toLocaleString("ar-SA", { maximumFractionDigits: d });
export const sar = (v: number) => `${n(v, 2)} ر.س`;

/** A card in the 12-column dashboard grid. span = 4..12. */
export function S({ span = 6, title, extra, cls = "", children }: { span?: number; title?: string; extra?: ReactNode; cls?: string; children: ReactNode }) {
  return (
    <section className={`tc s${span} ${cls}`}>
      {title && <h3>{title}{extra}</h3>}
      {children}
    </section>
  );
}
export const Count = ({ t }: { t: string }) => <span className="count">{t}</span>;
export const Tag = ({ t, tone = "" }: { t: string; tone?: string }) => <span className={"badge " + tone}>{t}</span>;
export const Stat = ({ v, l }: { v: string; l: string }) => <div className="kpi"><b>{v}</b><span>{l}</span></div>;

export function Chips<T extends string>({ items, value, onChange }: { items: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="chips" role="group">
      {items.map((c) => <button key={c} className={"chip" + (c === value ? " on" : "")} aria-pressed={c === value} onClick={() => onChange(c)}>{c}</button>)}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={"sw2" + (on ? " on" : "")} onClick={() => onChange(!on)}><i /></button>;
}

export function Meter({ pct, tone = "" }: { pct: number; tone?: string }) {
  return <div className={"meter " + tone}><i style={{ width: Math.min(100, pct) + "%" }} /></div>;
}

/** Vertical bars scaled to px so flex-shrink cannot flatten them. */
export function Bars({ data, hi, unit = "", max: m }: { data: { l: string; v: number }[]; hi?: number; unit?: string; max?: number }) {
  const max = m ?? Math.max(...data.map((d) => d.v));
  const last = hi ?? data.length - 1;
  return (
    <div className="bars" style={{ gridTemplateColumns: `repeat(${data.length}, 1fr)` }} role="img" aria-label="رسم بياني">
      {data.map((d, i) => (
        <div className="bar" key={d.l} title={`${d.l}: ${n(d.v)}${unit}`}>
          <span className="bar-v">{i === last ? n(d.v) : ""}</span>
          <i style={{ height: `${Math.max(8, Math.round((d.v / max) * 140))}px` }} className={i === last ? "now" : ""} />
          <em>{d.l}</em>
        </div>
      ))}
    </div>
  );
}

export function Av({ t, k = "" }: { t: string; k?: string }) { return <span className={"av2 " + k}>{t}</span>; }
