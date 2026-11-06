"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { errorText } from "../lib/api";
import { STATUS_AR } from "../lib/format";
import { isStaffRole, useSession, type User } from "../lib/session";

export const Spinner = () => <div className="spin" role="status" aria-label="جارٍ التحميل" />;
export const ErrorNote = ({ error }: { error: unknown }) => (error ? <div className="note err" role="alert">{typeof error === "string" ? error : errorText(error)}</div> : null);
export const StatusBadge = ({ status }: { status: string }) => {
  const s = STATUS_AR[status] ?? { label: status, tone: "wait" as const };
  return <span className={`badge ${s.tone}`}>{s.label}</span>;
};
export const Avatar = ({ name, big }: { name: string; big?: boolean }) => <span className={`av${big ? " big" : ""}`} aria-hidden="true">{name.replace(/^(أ\.|د\.)\s*/, "").slice(0, 1)}</span>;

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

interface NavItem { href: string; label: string }
function navFor(u: User): NavItem[] {
  if (u.role === "learner") return [{ href: "/portal/search", label: "ابحث عن معلّم" }, { href: "/portal/bookings", label: "حجوزاتي" }, { href: "/portal/account", label: "حسابي" }];
  if (u.role === "guardian") return [{ href: "/portal/search", label: "ابحث عن معلّم" }, { href: "/portal/bookings", label: "الحجوزات" }, { href: "/portal/children", label: "الأبناء" }, { href: "/portal/account", label: "حسابي" }];
  if (u.role === "teacher") return [{ href: "/portal/bookings", label: "الحجوزات" }, { href: "/portal/availability", label: "أوقاتي" }, { href: "/portal/earnings", label: "أرباحي" }, { href: "/portal/apply", label: "ملفي" }, { href: "/portal/account", label: "حسابي" }];
  return [{ href: "/portal/staff", label: "لوحة الموظفين" }, { href: "/portal/account", label: "حسابي" }];
}

/** Requires a signed-in user (and optionally a role) and wraps the page in the navigation shell. */
export function Shell({ roles, children, allowPending }: { roles?: User["role"][]; allowPending?: boolean; children: ReactNode }) {
  const { user, ready, signOut } = useSession();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace("/portal/login");
    else if (isStaffRole(user.role) && !user.mfaVerified) router.replace("/portal/login");
    else if (user.status === "pending" && !allowPending) router.replace("/portal/verify");
    else if (roles && !roles.includes(user.role)) router.replace("/portal");
  }, [ready, user, roles, allowPending, router]);

  if (!ready || !user) return <Spinner />;
  const items = navFor(user);
  const here = (href: string) => (path.replace(/\/$/, "") === href ? "page" : undefined);
  return (
    <>
      <header className="pt-top">
        <div className="pt-top-in">
          <Link className="pt-brand" href="/portal">عِلمك</Link>
          <nav className="pt-nav" aria-label="التنقل">
            {items.map((i) => <Link key={i.href} href={i.href} aria-current={here(i.href)}>{i.label}</Link>)}
          </nav>
          <div className="pt-who">
            <span>{user.displayName}</span>
            <button onClick={() => signOut().then(() => router.replace("/portal/login"))}>خروج</button>
          </div>
        </div>
      </header>
      <main className="pt-main">{children}</main>
      <nav className="pt-tabs" aria-label="التنقل">
        {items.map((i) => <Link key={i.href} href={i.href} aria-current={here(i.href)}>{i.label}</Link>)}
      </nav>
    </>
  );
}
