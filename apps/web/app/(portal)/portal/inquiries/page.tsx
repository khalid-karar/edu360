"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar, ErrorNote, Shell, Spinner } from "../../../../components/portal-ui";
import { api } from "../../../../lib/api";
import { dayLabel } from "../../../../lib/format";

interface Item { id: string; viewerRole: "payer" | "teacher"; other: { id: string; displayName: string }; lastAt: string; lastPreview: string; unread: boolean }

export default function Inquiries() {
  return (
    <Shell roles={["learner", "guardian", "teacher"]}>
      <Body />
    </Shell>
  );
}

function Body() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { api<{ items: Item[] }>("GET", "/inquiries").then((r) => setItems(r.items)).catch(setErr); }, []);
  return (
    <>
      <h1>الأسئلة</h1>
      <p className="muted small">أسئلة ما قبل الحجز بين أولياء الأمور والمتعلّمين والمعلّمين.</p>
      <ErrorNote error={err} />
      {!items && !err && <Spinner />}
      {items && items.length === 0 && <div className="empty">لا أسئلة بعد. افتح صفحة أي معلّم واسأله قبل الحجز.</div>}
      {items?.map((i) => (
        <Link key={i.id} href={`/portal/inquiry?id=${i.id}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="row">
            <Avatar name={i.other.displayName} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row between"><b>{i.other.displayName}</b><span className="muted small">{dayLabel(i.lastAt)}</span></div>
              <div className="muted small" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.lastPreview}</div>
            </div>
            {i.unread && <span className="badge wait">جديد</span>}
          </div>
        </Link>
      ))}
    </>
  );
}
