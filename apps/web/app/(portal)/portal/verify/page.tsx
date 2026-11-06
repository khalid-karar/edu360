"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorNote, Field, Shell, Spinner } from "../../../../components/portal-ui";
import { api } from "../../../../lib/api";
import { useSession } from "../../../../lib/session";

export default function Verify() {
  return (
    <Shell allowPending>
      <Body />
    </Shell>
  );
}

function Body() {
  const { user, refresh } = useSession();
  const router = useRouter();
  const [nid, setNid] = useState("");
  const [req, setReq] = useState<{ id: string; number: string } | null>(null);
  const [status, setStatus] = useState<string>("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);
  useEffect(() => {
    if (user && user.status !== "pending") router.replace("/portal");
  }, [user, router]);

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ requestId: string; number: string }>("POST", "/identity/nafath/start", { nationalId: nid });
      setReq({ id: r.requestId, number: r.number });
      setStatus("waiting");
      timer.current = setInterval(async () => {
        try {
          const s = await api<{ status: string }>("GET", `/identity/nafath/status/${r.requestId}`);
          if (s.status === "waiting") return;
          clearInterval(timer.current!);
          setStatus(s.status);
          if (s.status === "approved") {
            await refresh();
            router.replace("/portal");
          }
        } catch (e) {
          clearInterval(timer.current!);
          setStatus("failed");
          setErr(e);
        }
      }, 2000);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 480, margin: "0 auto", width: "100%" }}>
      <h1>توثيق الهوية</h1>
      <p className="muted">نتحقق من هويتك عبر «نفاذ». لا نحفظ رقم الهوية نفسه، بل بصمة مشفّرة منه تمنع تكرار الحساب.</p>
      {!req || status === "failed" || status === "rejected" || status === "expired" ? (
        <form className="card" onSubmit={(e) => { e.preventDefault(); start(); }}>
          <Field label="رقم الهوية الوطنية / الإقامة">
            <input className="ltr" inputMode="numeric" maxLength={10} value={nid} onChange={(e) => setNid(e.target.value.replace(/\D/g, ""))} autoFocus />
          </Field>
          {(status === "rejected" || status === "expired") && <div className="note err">لم يتم اعتماد الطلب في نفاذ. حاول مرة أخرى.</div>}
          <ErrorNote error={err} />
          <button className="btn" disabled={busy || nid.length !== 10}>بدء التوثيق</button>
          <p className="muted small">وضع تجريبي: أي رقم من 10 أرقام يبدأ بـ 1 ولا ينتهي بـ 0 أو 9.</p>
        </form>
      ) : (
        <div className="card">
          <h2>افتح تطبيق نفاذ</h2>
          <p>اختر الرقم التالي لتأكيد الطلب:</p>
          <div className="big-number">{req.number}</div>
          {status === "waiting" && <Spinner />}
          <p className="muted small" style={{ textAlign: "center" }}>بانتظار موافقتك في التطبيق…</p>
        </div>
      )}
    </div>
  );
}
