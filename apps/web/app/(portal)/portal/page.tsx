"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "../../../components/portal-ui";
import { isStaffRole, useSession } from "../../../lib/session";

export default function Home() {
  const { user, ready } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    if (!user) return router.replace("/portal/login");
    if (user.status === "pending") return router.replace("/portal/verify");
    if (isStaffRole(user.role)) return router.replace(user.mfaVerified ? "/portal/staff" : "/portal/login");
    router.replace(user.role === "teacher" ? "/portal/bookings" : "/portal/search");
  }, [ready, user, router]);
  return <Spinner />;
}
