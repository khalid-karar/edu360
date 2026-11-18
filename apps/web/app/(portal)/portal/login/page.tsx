"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorNote, Field } from "../../../../components/portal-ui";
import { ApiError, api, errorText } from "../../../../lib/api";
import { isStaffRole, useSession } from "../../../../lib/session";

type Step = "email" | "code" | "register" | "mfa";
const ROLES = [
  { key: "learner", title: "متعلّم", note: "أبحث عن معلّم لنفسي" },
  { key: "guardian", title: "ولي أمر", note: "أحجز لأبنائي وأتابعهم" },
  { key: "teacher", title: "معلّم", note: "أقدّم دروساً من بيتي" },
] as const;

/** Addresses are compared in lower case on the server too. */
const normalizeEmail = (raw: string) => raw.trim().toLowerCase();
const EMAIL_OK = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]{2,}$/;

export default function Login() {
  const { signIn, refresh } = useSession();
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [emailRaw, setEmailRaw] = useState("");
  const [code, setCode] = useState("");
  const [mock, setMock] = useState<string | null>(null);
  const [role, setRole] = useState<(typeof ROLES)[number]["key"]>("learner");
  const [name, setName] = useState("");
  const [schoolCode, setSchoolCode] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const email = normalizeEmail(emailRaw);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      if (!EMAIL_OK.test(email) || email.length > 254) throw "اكتب بريداً إلكترونياً صحيحاً، مثل name@example.com";
      const r = await api<{ mock_code?: string }>("POST", "/auth/otp/request", { email });
      setMock(r.mock_code ?? null);
      setCode("");
      setStep("code");
    });

  const verify = (withProfile: boolean) =>
    run(async () => {
      try {
        const r = await api<{ token?: string; next: "mfa" | "identity" | "appeal" | null }>("POST", "/auth/otp/verify", {
          email,
          code,
          ...(withProfile ? { role, displayName: name.trim(), ...(schoolCode.trim() ? { schoolCode: schoolCode.trim().toUpperCase() } : {}) } : {}),
        });
        const u = await signIn(r.token);
        if (r.next === "mfa") return setStep("mfa");
        if (r.next === "identity") return router.replace("/portal/verify");
        if (r.next === "appeal") return router.replace("/portal/account");
        router.replace(u && isStaffRole(u.role) ? "/portal/staff" : "/portal");
      } catch (e) {
        if (e instanceof ApiError && e.code === "registration_required") return setStep("register");
        throw e;
      }
    });

  const mfa = () =>
    run(async () => {
      await api("POST", "/auth/mfa/verify", { code });
      await refresh();
      router.replace("/portal/staff");
    });

  return (
    <div className="auth">
      <div className="auth-box">
        <div className="auth-brand">عِلمك<small>علمك يجيب دخل</small></div>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            if (step === "email") sendCode();
            else if (step === "code") verify(false);
            else if (step === "register") verify(true);
            else mfa();
          }}
        >
          {step === "email" && (
            <>
              <h2>ادخل أو أنشئ حسابك</h2>
              <Field label="البريد الإلكتروني" hint="سنرسل لك رمز تحقق من 6 أرقام">
                <input className="ltr" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" value={emailRaw} onChange={(e) => setEmailRaw(e.target.value)} autoFocus />
              </Field>
              <ErrorNote error={err} />
              <button className="btn block" disabled={busy}>إرسال الرمز</button>
            </>
          )}
          {(step === "code" || step === "mfa") && (
            <>
              <h2>{step === "mfa" ? "رمز تطبيق المصادقة" : "أدخل رمز التحقق"}</h2>
              {step === "code" && <p className="muted small">أرسلنا رمزاً إلى <span className="ltr">{email}</span> (تفقّد البريد غير الهام إن لم يصل)</p>}
              {mock && step === "code" && (
                <div className="note sand">
                  وضع تجريبي: لا يُرسل بريد حقيقي. رمزك <b className="ltr">{mock}</b>{" "}
                  <button type="button" className="btn ghost" style={{ padding: "2px 10px" }} onClick={() => setCode(mock)}>تعبئة</button>
                </div>
              )}
              <Field label={step === "mfa" ? "الرمز من التطبيق" : "الرمز"}>
                <input className="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
              </Field>
              <ErrorNote error={err} />
              <button className="btn block" disabled={busy || code.length !== 6}>تأكيد</button>
              {step === "code" && <button type="button" className="btn ghost block" onClick={() => { setStep("email"); setErr(null); }}>تغيير البريد</button>}
            </>
          )}
          {step === "register" && (
            <>
              <h2>حساب جديد</h2>
              <Field label="الاسم">
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
              </Field>
              <div className="roles" role="group" aria-label="نوع الحساب">
                {ROLES.map((r) => (
                  <button type="button" key={r.key} className="role" aria-pressed={role === r.key} onClick={() => setRole(r.key)}>
                    <b>{r.title}</b>
                    <small>{r.note}</small>
                  </button>
                ))}
              </div>
              {role !== "teacher" && (
                <Field label="رمز المدرسة (اختياري)" hint="إن أعطتك مدرستك رمزاً فاكتبه هنا">
                  <input className="ltr" value={schoolCode} maxLength={8} onChange={(e) => setSchoolCode(e.target.value)} />
                </Field>
              )}
              <p className="muted small">المعلّم وولي الأمر يوثّقان الهوية عبر نفاذ بعد التسجيل.</p>
              <ErrorNote error={err} />
              <button className="btn block" disabled={busy || name.trim().length < 2}>إنشاء الحساب</button>
            </>
          )}
        </form>
        <p className="muted small" style={{ textAlign: "center" }}>
          بالمتابعة توافق على <a href="/privacy">سياسة الخصوصية</a>
        </p>
      </div>
    </div>
  );
}
