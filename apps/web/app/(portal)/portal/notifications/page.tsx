"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ErrorNote, Shell, Spinner } from "../../../../components/portal-ui";
import { api } from "../../../../lib/api";
import { dateTime } from "../../../../lib/format";

interface N { id: string; kind: string; title: string; body: string; link: string | null; read: boolean; createdAt: string }

export default function Notifications() {
  return (
    <Shell allowPending>
      <Body />
    </Shell>
  );
}

function Body() {
  const router = useRouter();
  const [data, setData] = useState<{ unread: number; items: N[] } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => {
    api<{ unread: number; items: N[] }>("GET", "/notifications?limit=50").then(setData).catch(setErr);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function open(n: N) {
    if (!n.read) await api("POST", "/notifications/read", { ids: [n.id] }).catch(() => {});
    window.dispatchEvent(new Event("ilmak:notifications"));
    if (n.link) router.push(n.link);
    else load();
  }
  async function readAll() {
    await api("POST", "/notifications/read", {}).catch(() => {});
    window.dispatchEvent(new Event("ilmak:notifications"));
    load();
  }
  return (
    <>
      <div className="row between"><h1>الإشعارات</h1>{data && data.unread > 0 && <button className="btn ghost" onClick={readAll}>تعليم الكل كمقروء</button>}</div>
      <ErrorNote error={err} />
      {!data && !err && <Spinner />}
      {data?.items.length === 0 && <div className="empty">لا إشعارات بعد.</div>}
      <div className="stack">
        {data?.items.map((n) => (
          <button key={n.id} className={`card tight click notice${n.read ? "" : " unread"}`} onClick={() => open(n)}>
            <div className="row between"><b>{n.title}</b><span className="muted small">{dateTime(n.createdAt)}</span></div>
            <span>{n.body}</span>
          </button>
        ))}
      </div>
    </>
  );
}
