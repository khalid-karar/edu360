"use client";
import { Shell } from "../../../../components/portal-ui";
import { AdminConsole } from "../../../../components/staff/admin";
import { FinanceConsole } from "../../../../components/staff/finance";
import { SafetyConsole } from "../../../../components/staff/safety";
import { VettingConsole } from "../../../../components/staff/vetting";
import { useSession } from "../../../../lib/session";

const TITLE: Record<string, string> = { vetting_officer: "التدقيق", safety_officer: "الأمان", finance_officer: "المالية", super_admin: "الإدارة" };

export default function Staff() {
  return (
    <Shell roles={["vetting_officer", "safety_officer", "finance_officer", "super_admin"]}>
      <Body />
    </Shell>
  );
}

function Body() {
  const { user } = useSession();
  if (!user) return null;
  return (
    <>
      <h1>لوحة {TITLE[user.role]}</h1>
      {user.role === "vetting_officer" && <VettingConsole />}
      {user.role === "safety_officer" && <SafetyConsole meId={user.id} />}
      {user.role === "finance_officer" && <FinanceConsole meId={user.id} />}
      {user.role === "super_admin" && <AdminConsole />}
    </>
  );
}
