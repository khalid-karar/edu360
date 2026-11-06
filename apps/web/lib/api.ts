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
  score_too_low: "المجموع أقل من حد القبول (16 من 20).",
  reason_required: "اكتب السبب.",
  no_accepted_credential: "لا يمكن الاعتماد بلا مستند مقبول واحد على الأقل.",
  wrong_status: "حالة الطلب لا تسمح بهذا الإجراء.",
  not_under_review: "الطلب ليس قيد المراجعة.",
  not_assigned_to_you: "هذا البلاغ مُسند لموظف آخر.",
  already_paid_out: "المبلغ حُوّل للمعلّم مسبقاً، لا يمكن استرداده من هنا.",
  already_decided: "سبق البتّ في هذا الاعتراض.",
  bad_refund_amount: "مبلغ الاسترداد غير صحيح.",
  payment_state_conflict: "حالة الدفع لدى المزوّد لا تسمح بهذا الإجراء.",
  second_approver_required: "أول تحويل لمعلّم يعتمده موظف غير الذي أنشأ الدفعة.",
  slug_taken: "هذا المعرّف مستخدم.",
  bad_price_band: "أقل سعر يجب ألا يتجاوز أعلى سعر.",
  profile_locked: "الملف مقفل أثناء المراجعة.",
  invalid_iban: "رقم الآيبان غير صحيح (آيبان سعودي).",
  iban_name_mismatch: "اسم صاحب الحساب لا يطابق اسمك في الهوية.",
  price_out_of_band: "السعر خارج النطاق المسموح لهذا التخصص.",
  duplicate_category: "تخصص مكرر.",
  unknown_category: "تخصص غير معروف.",
  category_not_selected: "اختر التخصص أولاً.",
  too_many_credentials: "وصلت للحد الأقصى من المستندات.",
  incomplete: "الطلب ناقص. راجع القائمة.",
  not_submittable: "لا يمكن تقديم الطلب في حالته الحالية.",
  reapply_too_soon: "يمكن إعادة التقديم بعد 90 يوماً من الرفض.",
  version_outdated: "نسخة الميثاق تغيّرت. حدّث الصفحة.",
  appeal_exists: "قدّمت تظلّماً على هذه المخالفة من قبل.",
  appeal_window_closed: "انتهت مهلة التظلّم (30 يوماً).",
  strike_already_voided: "هذه المخالفة أُلغيت أصلاً.",
  cannot_decide_own_strike: "لا تبتّ في تظلّم على مخالفة أصدرتها أنت.",
  already_banned: "الحساب محظور أصلاً.",
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
