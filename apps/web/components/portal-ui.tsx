"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
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

/** Bell with the unread count. Polls gently and refreshes when the notifications page changes something. */
function Bell() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => api<{ unread: number }>("GET", "/notifications/unread-count").then((r) => live && setN(r.unread)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    window.addEventListener("ilmak:notifications", load);
    return () => { live = false; clearInterval(t); window.removeEventListener("ilmak:notifications", load); };
  }, []);
  return (
    <Link href="/portal/notifications" className="pt-bell" aria-label={n > 0 ? `الإشعارات، ${n} غير مقروء` : "الإشعارات"}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>
      {n > 0 && <span className="pt-bell-n">{n > 9 ? "9+" : n}</span>}
    </Link>
  );
}

interface NavItem { href: string; label: string }
function navFor(u: User): NavItem[] {
  if (u.status === "banned") return [{ href: "/portal/account", label: "حسابي" }];
  if (u.role === "learner") return [{ href: "/portal/search", label: "ابحث عن معلّم" }, { href: "/portal/bookings", label: "حجوزاتي" }, { href: "/portal/inquiries", label: "الأسئلة" }, { href: "/portal/account", label: "حسابي" }];
  if (u.role === "guardian") return [{ href: "/portal/search", label: "ابحث عن معلّم" }, { href: "/portal/bookings", label: "الحجوزات" }, { href: "/portal/inquiries", label: "الأسئلة" }, { href: "/portal/children", label: "الأبناء" }, { href: "/portal/account", label: "حسابي" }];
  if (u.role === "teacher") return [{ href: "/portal/bookings", label: "الحجوزات" }, { href: "/portal/inquiries", label: "الأسئلة" }, { href: "/portal/availability", label: "أوقاتي" }, { href: "/portal/earnings", label: "أرباحي" }, { href: "/portal/apply", label: "ملفي" }, { href: "/portal/account", label: "حسابي" }];
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
    else if (user.status === "banned") {
      if (path !== "/portal/account" && path !== "/portal/notifications") router.replace("/portal/account");
    } else if (user.status === "pending" && !allowPending) router.replace("/portal/verify");
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
            <Bell />
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
