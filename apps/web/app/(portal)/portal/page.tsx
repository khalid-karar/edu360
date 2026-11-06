"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "../../../components/portal-ui";
import { api } from "../../../lib/api";
import { isStaffRole, useSession } from "../../../lib/session";

export default function Home() {
  const { user, ready } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    if (!user) return router.replace("/portal/login");
    if (user.status === "banned") return router.replace("/portal/account");
    if (user.status === "pending") return router.replace("/portal/verify");
    if (isStaffRole(user.role)) return router.replace(user.mfaVerified ? "/portal/staff" : "/portal/login");
    if (user.role !== "teacher") return router.replace("/portal/search");
    api<{ status: string }>("GET", "/teacher/me")
      .then((m) => router.replace(m.status === "approved" || m.status === "conditional" ? "/portal/bookings" : "/portal/apply"))
      .catch(() => router.replace("/portal/bookings"));
  }, [ready, user, router]);
  return <Spinner />;
}
