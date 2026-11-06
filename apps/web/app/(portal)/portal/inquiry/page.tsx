"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Chat } from "../../../../components/chat";
import { ErrorNote, Shell, Spinner } from "../../../../components/portal-ui";
import { api } from "../../../../lib/api";
import { useParam } from "../../../../lib/session";

export default function Inquiry() {
  return (
    <Shell roles={["learner", "guardian", "teacher"]}>
      <Body />
    </Shell>
  );
}

function Body() {
  const id = useParam("id");
  const [who, setWho] = useState<{ other: { id: string; displayName: string }; viewerRole: string } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (id) api<{ other: { id: string; displayName: string }; viewerRole: string }>("GET", `/inquiries/${id}/messages`).then(setWho).catch(setErr);
  }, [id]);
  if (!id || (!who && !err)) return <Spinner />;
  return (
    <>
      <Link href="/portal/inquiries" className="small">← الأسئلة</Link>
      <ErrorNote error={err} />
      {who && (
        <>
          <h1>{who.viewerRole === "payer" ? `سؤال إلى ${who.other.displayName}` : `سؤال من ${who.other.displayName}`}</h1>
          <Chat open base={`/inquiries/${id}`} />
          {who.viewerRole === "payer" && <Link href={`/portal/teacher?id=${who.other.id}`} className="btn">اطّلع على المواعيد واحجز</Link>}
          {who.viewerRole === "teacher" && <p className="muted small">الرد السريع يرفع فرص الحجز، ويمنحك شارة «سريع الرد» إن كان متوسط ردّك ضمن 3 ساعات.</p>}
        </>
      )}
    </>
  );
}
