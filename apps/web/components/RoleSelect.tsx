"use client";
import { useEffect, useState } from "react";

const ROLES = ["teacher", "learner", "parent"] as const;

export default function RoleSelect() {
  const [role, setRole] = useState<string>("teacher");
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("role");
    if (r && (ROLES as readonly string[]).includes(r)) setRole(r);
  }, []);
  return (
    <select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
      <option value="teacher">معلّم أريد أن أدرّس</option>
      <option value="learner">متعلّم أبحث عن معلم</option>
      <option value="parent">ولي أمر</option>
    </select>
  );
}
