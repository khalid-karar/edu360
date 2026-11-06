"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, errorText } from "../lib/api";
import { timeLabel } from "../lib/format";

interface Msg { id: string; mine: boolean; body: string; createdAt: string }

/** Per-booking conversation. Polls every few seconds; contact details are refused by the server and explained here. */
export function Chat({ bookingId, open, base }: { bookingId?: string; open: boolean; base?: string }) {
  const root = base ?? `/bookings/${bookingId}`;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const last = useRef<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const pull = useCallback(async () => {
    try {
      const r = await api<{ items: Msg[] }>("GET", `${root}/messages${last.current ? `?after=${encodeURIComponent(last.current)}` : ""}`);
      if (r.items.length) {
        last.current = r.items[r.items.length - 1]!.createdAt;
        setMsgs((m) => {
          const seen = new Set(m.map((x) => x.id));
          return [...m, ...r.items.filter((x) => !seen.has(x.id))];
        });
      }
    } catch {
      /* transient: the next poll retries */
    }
  }, [root]);

  useEffect(() => {
    pull();
    const t = setInterval(pull, 5000);
    return () => clearInterval(t);
  }, [pull]);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [msgs]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setErr(null);
    try {
      await api("POST", `${root}/messages`, { body });
      setText("");
      await pull();
    } catch (e) {
      setErr(e instanceof ApiError && e.code === "message_blocked" ? errorText(e) : errorText(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card">
      <h2>المحادثة</h2>
      <div className="chat" ref={box} aria-live="polite">
        {msgs.length === 0 && <div className="empty" style={{ padding: 14 }}>لا رسائل بعد.</div>}
        {msgs.map((m) => (
          <div key={m.id} className={`msg${m.mine ? " mine" : ""}`}>
            {m.body}
            <time>{timeLabel(m.createdAt)}</time>
          </div>
        ))}
      </div>
      {err && <div className="note err" role="alert">{err}</div>}
      {open ? (
        <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="اكتب رسالتك" aria-label="رسالة" />
          <button className="btn" disabled={sending || !text.trim()}>إرسال</button>
        </form>
      ) : (
        <p className="muted small">المحادثة مغلقة.</p>
      )}
      <p className="muted small">لحمايتك، لا تُرسل أرقام الجوال أو الروابط. التواصل والدفع داخل المنصة فقط.</p>
    </div>
  );
}
