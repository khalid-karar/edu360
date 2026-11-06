"use client";
import { useEffect, useState, type ReactNode } from "react";
import "../../demo.css";
import { ROLES, type RoleKey } from "../../demo-data";
import Teacher from "./Teacher";
import { Learner, Guardian, Minor } from "./Family";
import { Vetting, Safety, Finance, Admin } from "./Ops";
import { clearSession, getSession, type Session } from "../../demo-session";



export default function Dash({ role }: { role: string }) {
  const [s, setS] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { setS(getSession()); setReady(true); }, []);
  if (!ready) return null;
  const meta = ROLES.find((r) => r.key === role);
  if (!meta) return <main className="demo-login"><p>دور غير معروف.</p><a href="/login">تسجيل الدخول</a></main>;
  if (!s || s.role !== meta.key) {
    return (
      <main className="demo-login">
        <div className="demo-banner">سجّل الدخول أولاً لعرض لوحة «{meta.ar}».</div>
        <a className="btn primary dark" href="/login">تسجيل الدخول</a>
      </main>
    );
  }
  return (
    <div className="dash">
      <header className="dbar">
        <div className="logo">عِلمك<span className="pill">تجريبي</span></div>
        <div className="sw">
          <a href="/login">تبديل الدور</a>
          <button onClick={() => { clearSession(); window.location.href = "/login"; }}>خروج</button>
        </div>
      </header>
      <div className="dwrap">
        <section className="hero">
          <div>
            <p className="hello">{new Date().getHours() < 12 ? "صباح الخير" : "مساء الخير"}</p>
            <h1>{s.name}</h1>
            <span className="rolechip">{meta.ar}</span>
          </div>
          <p className="blurb">{meta.blurb}</p>
        </section>
        <main className="dgrid">{VIEWS[meta.key]({ name: s.name })}</main>
        <p className="foot-demo">بيانات وهمية للعرض فقط: لا دفع حقيقي ولا رسائل ولا هوية حقيقية.</p>
      </div>
    </div>
  );
}

const VIEWS: Record<RoleKey, (p: { name: string }) => ReactNode> = {
  learner: () => <Learner />, guardian: () => <Guardian />, minor: () => <Minor />, teacher: () => <Teacher />,
  vetting: () => <Vetting />, safety: () => <Safety />, finance: () => <Finance />, admin: () => <Admin />,
};
