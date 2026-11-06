"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorNote, Shell, Spinner } from "../../../../components/portal-ui";
import { api } from "../../../../lib/api";
import { useParam } from "../../../../lib/session";
import type { BookingView } from "../bookings/page";

interface Ticket { url: string; token: string; room: string; as: "teacher" | "learner"; forChild: boolean; closesAt: string }
type Seg = [number, number, number, number, string]; // x0 y0 x1 y1 (0..1) and colour
const COLORS = ["#06303a", "#f2705a", "#0f5c6b"];

export default function RoomPage() {
  return (
    <Shell roles={["learner", "guardian", "teacher"]}>
      <Body />
    </Shell>
  );
}

function Body() {
  const id = useParam("id");
  const [b, setB] = useState<BookingView | null>(null);
  const [tk, setTk] = useState<Ticket | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (!id) return;
    api<BookingView>("GET", `/bookings/${id}`).then(setB).catch(setErr);
  }, [id]);
  async function enter() {
    setErr(null);
    try { setTk(await api<Ticket>("POST", `/bookings/${id}/room`)); } catch (e) { setErr(e); }
  }
  if (!id || (!b && !err)) return <Spinner />;
  const other = b ? (b.viewerRole === "teacher" ? b.learner.displayName : b.teacher.displayName) : "";
  return (
    <>
      <Link href={`/portal/booking?id=${id}`} className="small">← تفاصيل الحجز</Link>
      <h1>غرفة الدرس{other ? ` مع ${other}` : ""}</h1>
      <ErrorNote error={err} />
      {!tk && b && (
        <div className="card stack">
          <p>قبل الدخول: تأكد من الكاميرا والميكروفون وأنك في مكان هادئ. الدرس يجري داخل المنصة فقط، ويُسجَّل وقت دخول كل طرف.</p>
          {b.viewerRole !== "teacher" && b.learner.isChild && <div className="note info">الطالب طفل: ادخل أنت كوليّ أمر وابقَ بجانبه أثناء الدرس.</div>}
          <div><button className="btn" onClick={enter}>ادخل الدرس</button></div>
        </div>
      )}
      {tk && <Live tk={tk} />}
    </>
  );
}

function Live({ tk }: { tk: Ticket }) {
  const mock = tk.url.startsWith("mock://");
  const remote = useRef<HTMLDivElement>(null);
  const local = useRef<HTMLDivElement>(null);
  const roomRef = useRef<import("livekit-client").Room | null>(null);
  const [state, setState] = useState<"connecting" | "live" | "failed">(mock ? "live" : "connecting");
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [note, setNote] = useState("");
  const draw = useRef<((s: Seg[]) => void) | null>(null);
  const clear = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (mock) return;
    let off = false;
    (async () => {
      const lk = await import("livekit-client");
      const room = new lk.Room({ adaptiveStream: true });
      roomRef.current = room;
      room.on(lk.RoomEvent.TrackSubscribed, (track) => {
        const el = track.attach();
        el.setAttribute("playsinline", "true");
        remote.current?.appendChild(el);
      });
      room.on(lk.RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((e) => e.remove()));
      room.on(lk.RoomEvent.Disconnected, () => !off && setState("failed"));
      room.on(lk.RoomEvent.DataReceived, (payload, _p, _k, topic) => {
        if (topic === "wb") draw.current?.(JSON.parse(new TextDecoder().decode(payload)) as Seg[]);
        if (topic === "wb-clear") clear.current?.();
      });
      try {
        await room.connect(tk.url, tk.token);
        await room.localParticipant.enableCameraAndMicrophone();
        const v = room.localParticipant.getTrackPublication(lk.Track.Source.Camera)?.videoTrack;
        if (v && local.current) { const el = v.attach(); el.muted = true; local.current.appendChild(el); }
        if (!off) setState("live");
      } catch {
        if (!off) { setState("failed"); setNote("تعذّر الاتصال أو الوصول إلى الكاميرا والميكروفون. تأكد من الأذونات وأعد المحاولة."); }
      }
    })();
    return () => { off = true; roomRef.current?.disconnect(); };
  }, [mock, tk.url, tk.token]);

  const send = useCallback((topic: string, data: unknown) => {
    const r = roomRef.current;
    if (r) void r.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(data)), { reliable: true, topic });
  }, []);
  async function toggle(kind: "mic" | "cam") {
    const p = roomRef.current?.localParticipant;
    if (kind === "mic") { setMic(!mic); await p?.setMicrophoneEnabled(!mic); } else { setCam(!cam); await p?.setCameraEnabled(!cam); }
  }
  return (
    <>
      {mock && <div className="note">غرفة تجريبية: لا يوجد خادم فيديو متصل. السبورة تعمل محلياً فقط.</div>}
      {note && <div className="note err">{note}</div>}
      <div className="card stack">
        <div ref={remote} className="vid-remote">{state === "connecting" && <span className="muted">جاري الاتصال…</span>}</div>
        <div ref={local} className="vid-local" />
        {!mock && (
          <div className="row">
            <button className="btn ghost" onClick={() => toggle("mic")}>{mic ? "كتم الميكروفون" : "تشغيل الميكروفون"}</button>
            <button className="btn ghost" onClick={() => toggle("cam")}>{cam ? "إيقاف الكاميرا" : "تشغيل الكاميرا"}</button>
          </div>
        )}
      </div>
      <Board send={send} draw={draw} clear={clear} />
      <Link href="/portal/bookings" className="btn ghost" onClick={() => roomRef.current?.disconnect()}>مغادرة الدرس</Link>
    </>
  );
}

function Board({ send, draw, clear }: { send: (t: string, d: unknown) => void; draw: React.MutableRefObject<((s: Seg[]) => void) | null>; clear: React.MutableRefObject<(() => void) | null> }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[0]!);
  const pending = useRef<Seg[]>([]);
  const last = useRef<[number, number] | null>(null);
  const paint = (segs: Seg[]) => {
    const c = cv.current; const g = c?.getContext("2d");
    if (!c || !g) return;
    g.lineWidth = 3; g.lineCap = "round";
    for (const [x0, y0, x1, y1, col] of segs) { g.strokeStyle = col; g.beginPath(); g.moveTo(x0 * c.width, y0 * c.height); g.lineTo(x1 * c.width, y1 * c.height); g.stroke(); }
  };
  useEffect(() => {
    draw.current = paint;
    clear.current = () => { const c = cv.current; c?.getContext("2d")?.clearRect(0, 0, c.width, c.height); };
    const t = setInterval(() => { if (pending.current.length) { send("wb", pending.current); pending.current = []; } }, 50);
    return () => clearInterval(t);
  }, [send, draw, clear]);
  const pos = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as [number, number]; };
  return (
    <div className="card stack">
      <div className="row between">
        <h2>السبورة</h2>
        <div className="row">
          {COLORS.map((c) => <button key={c} aria-label="لون" onClick={() => setColor(c)} style={{ width: 28, height: 28, borderRadius: 14, background: c, border: color === c ? "3px solid var(--coral)" : "1px solid var(--line)" }} />)}
          <button className="btn ghost" onClick={() => { clear.current?.(); send("wb-clear", {}); }}>مسح</button>
        </div>
      </div>
      <canvas
        ref={cv} width={900} height={560}
        style={{ width: "100%", aspectRatio: "900/560", background: "#fff", border: "1px solid var(--line)", borderRadius: 12, touchAction: "none" }}
        onPointerDown={(e) => { cv.current!.setPointerCapture(e.pointerId); last.current = pos(e); }}
        onPointerMove={(e) => { if (!last.current) return; const p = pos(e); const s: Seg = [last.current[0], last.current[1], p[0], p[1], color]; paint([s]); pending.current.push(s); last.current = p; }}
        onPointerUp={() => { last.current = null; }}
        onPointerCancel={() => { last.current = null; }}
      />
    </div>
  );
}
