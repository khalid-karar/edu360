"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Avatar, ErrorNote, Shell, Spinner, StatusBadge } from "../../../../components/portal-ui";
import { api } from "../../../../lib/api";
import { dateTime, sar } from "../../../../lib/format";

export interface BookingView {
  id: string;
  status: string;
  viewerRole: "teacher" | "payer";
  startsAt: string;
  durationMin: number;
  priceHalalas: number;
  expiresAt: string | null;
  room: { opensAt: string; closesAt: string } | null;
  cancelledBy: string | null;
  teacher: { id: string; displayName: string };
  learner: { id: string; displayName: string; isChild: boolean };
  category: { id: number; nameAr: string };
  payment: { status: string; capturedHalalas: number; refundedHalalas: number; commissionHalalas?: number; platformCreditHalalas?: number; netHalalas?: number } | null;
}

const UPCOMING = ["awaiting_payment", "requested", "confirmed"];

export default function Bookings() {
  return (
    <Shell roles={["learner", "guardian", "teacher"]}>
      <Body />
    </Shell>
  );
}

function Body() {
  const [items, setItems] = useState<BookingView[] | null>(null);
  const [tab, setTab] = useState<"up" | "past">("up");
  const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => api<{ items: BookingView[] }>("GET", "/bookings?limit=100").then((r) => setItems(r.items)).catch(setErr), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const up = (items ?? []).filter((b) => UPCOMING.includes(b.status)).sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
  const past = (items ?? []).filter((b) => !UPCOMING.includes(b.status));
  const list = tab === "up" ? up : past;
  const needsAction = up.filter((b) => b.viewerRole === "teacher" && b.status === "requested");

  return (
    <>
      <h1>الحجوزات</h1>
      <ErrorNote error={err} />
      {needsAction.length > 0 && <div className="note sand"><b>{needsAction.length}</b> طلب بانتظار ردّك. الطلبات التي لا تُجاب تُرفض تلقائياً ويُفرج عن مبلغ المتعلّم.</div>}
      <div className="tabs" role="group">
        <button aria-pressed={tab === "up"} onClick={() => setTab("up")}>القادمة ({up.length})</button>
        <button aria-pressed={tab === "past"} onClick={() => setTab("past")}>السابقة ({past.length})</button>
      </div>
      {!items && !err && <Spinner />}
      {items && list.length === 0 && <div className="empty">{tab === "up" ? "لا حجوزات قادمة." : "لا حجوزات سابقة."}{tab === "up" && <div style={{ marginTop: 8 }}><Link href="/portal/search">ابحث عن معلّم</Link></div>}</div>}
      <div className="grid">
        {list.map((b) => {
          const other = b.viewerRole === "teacher" ? b.learner.displayName : b.teacher.displayName;
          return (
            <Link key={b.id} href={`/portal/booking?id=${b.id}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="row">
                <Avatar name={other} />
                <div style={{ flex: 1 }}>
                  <h3>{other}{b.learner.isChild && b.viewerRole === "payer" ? "" : ""}</h3>
                  <span className="muted small">{b.category.nameAr}{b.learner.isChild && b.viewerRole === "payer" ? ` · الطالب: ${b.learner.displayName}` : ""}</span>
                </div>
                <StatusBadge status={b.status} />
              </div>
              <div className="row between small"><span>{dateTime(b.startsAt)}</span><b>{sar(b.priceHalalas)}</b></div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
