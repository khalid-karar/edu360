"use client";
import { Shell } from "../../../../components/portal-ui";

export default function Staff() {
  return (
    <Shell roles={["vetting_officer", "safety_officer", "finance_officer", "super_admin"]}>
      <h1>لوحة الموظفين</h1>
      <div className="card"><p className="muted">شاشات التدقيق والأمان والمالية قيد البناء في الدفعة القادمة. الواجهات البرمجية لها جاهزة.</p></div>
    </Shell>
  );
}
