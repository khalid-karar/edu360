/** Thin client for the Ilmak API. The token lives in localStorage; every call is same-origin unless NEXT_PUBLIC_API_URL is set. */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const KEY = "ilmak.token";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public details?: unknown) {
    super(code);
  }
}

export const getToken = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
export const setToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the session simply will not persist */
  }
};

export async function api<T = any>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.error ?? "server_error", json?.details);
  return json as T;
}

const MESSAGES: Record<string, string> = {
  network: "تعذّر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.",
  server_error: "حدث خطأ غير متوقع. حاول مرة أخرى.",
  invalid_input: "بعض البيانات غير صحيحة. راجع الحقول.",
  unauthenticated: "انتهت الجلسة. سجّل الدخول من جديد.",
  forbidden: "ليست لديك صلاحية لهذا الإجراء.",
  not_found: "غير موجود.",
  invalid_code: "الرمز غير صحيح أو منتهي.",
  too_many_requests: "محاولات كثيرة. انتظر قليلاً ثم حاول.",
  account_banned: "هذا الحساب محظور.",
  account_suspended: "هذا الحساب موقوف مؤقتاً.",
  identity_required: "يلزم توثيق الهوية أولاً.",
  mfa_required: "أدخل رمز المصادقة.",
  invalid_national_id: "رقم الهوية غير صحيح.",
  national_id_in_use: "رقم الهوية مسجّل في حساب آخر.",
  already_verified: "الهوية موثّقة مسبقاً.",
  underage: "يجب أن يكون عمرك 18 سنة أو أكثر.",
  identity_mismatch: "الهوية المعتمدة لا تطابق الرقم المُدخل.",
  slot_taken: "هذا الموعد حُجز للتو. اختر موعداً آخر.",
  slot_unavailable: "الموعد خارج أوقات المعلّم.",
  learner_busy: "عندك درس آخر في نفس الوقت.",
  too_soon: "الحجز قبل الموعد بساعتين على الأقل.",
  too_far: "الحجز حتى 10 أيام قادمة فقط.",
  misaligned_start: "وقت البداية غير صحيح.",
  teacher_unavailable: "المعلّم غير متاح حالياً.",
  category_unavailable: "هذا التخصص غير متاح عند المعلّم.",
  teacher_not_approved: "يلزم أن تعتمد هذا المعلّم لطفلك أولاً.",
  cross_gender_not_approved: "لم تسمح بمعلّم من الجنس الآخر لطفلك.",
  adults_only_teacher: "هذا المعلّم يدرّس البالغين فقط.",
  category_not_for_minors: "هذا التخصص غير متاح للأطفال.",
  not_your_child: "هذا الحساب ليس من أبنائك.",
  request_expired: "انتهت مهلة الطلب.",
  lesson_not_finished: "الدرس لم ينتهِ بعد.",
  already_started: "الدرس بدأ بالفعل.",
  too_early: "لم يحن وقت هذا الإجراء بعد.",
  too_late: "انتهت مهلة هذا الإجراء.",
  invalid_state: "لا يمكن تنفيذ هذا الإجراء في حالة الحجز الحالية.",
  booking_not_payable: "هذا الحجز لم يعد يقبل الدفع.",
  payment_window_expired: "انتهت مهلة الدفع (15 دقيقة). احجز من جديد.",
  message_blocked: "لا يمكن إرسال أرقام التواصل أو الروابط. التواصل يتم داخل المنصة لحمايتك.",
  chat_closed: "المحادثة مغلقة لهذا الحجز.",
  slow_down: "رسائل كثيرة. انتظر قليلاً.",
  dispute_exists: "تم فتح اعتراض على هذا الدرس مسبقاً.",
  dispute_window_closed: "انتهت مهلة الاعتراض (48 ساعة من الخصم).",
  not_disputable: "لا يمكن الاعتراض على هذا الحجز.",
  already_reviewed: "قيّمت هذا الدرس مسبقاً.",
  not_reviewable: "التقييم متاح بعد اكتمال الدرس.",
  comment_blocked: "التعليق يحتوي على بيانات تواصل. احذفها.",
  report_exists: "لديك بلاغ مفتوح على هذا الحجز.",
  too_many_reports: "وصلت للحد اليومي من البلاغات.",
  window_overlaps: "يتداخل مع وقت آخر مضاف.",
  window_has_bookings: "فيه حجز ضمن هذا الوقت، لا يمكن حذفه.",
  misaligned_window: "اختر أوقاتاً بخطوات 15 دقيقة.",
  bad_window_length: "المدة بين ساعة و12 ساعة.",
  in_past: "الوقت في الماضي.",
  too_many_windows: "وصلت للحد الأعلى من الأوقات.",
  not_approved: "حسابك كمعلّم لم يُعتمد بعد.",
  too_many_children: "وصلت للحد الأعلى من الأبناء (6).",
  age_out_of_range: "عمر الطفل بين 4 و17 سنة.",
  not_payable: "لا يمكن دفع هذا الحجز الآن.",
};
export const errorText = (e: unknown) => (e instanceof ApiError ? (MESSAGES[e.code] ?? `تعذّر تنفيذ الطلب (${e.code})`) : MESSAGES.server_error!);
