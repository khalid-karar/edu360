/**
 * Thin client for the Ilmak API. Same-origin (the normal case, behind Caddy or the Netlify proxy) the session is an HttpOnly cookie
 * that scripts cannot read. Only when NEXT_PUBLIC_API_URL points at another origin is a bearer token kept in localStorage, because a
 * cross-site cookie would need weaker settings.
 */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
export const COOKIE_SESSION = BASE === "";
const KEY = "ilmak.token";
/** Tells the API this is the web app: it answers a login with a cookie, and cookie-authenticated changes must carry it. */
const CLIENT = { "x-ilmak-client": "web" };

// Tokens from before the cookie sessions are never needed again: drop them so nothing readable lingers.
if (COOKIE_SESSION && typeof localStorage !== "undefined") {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, public details?: unknown) {
    super(code);
  }
}

export const getToken = () => {
  if (COOKIE_SESSION) return null;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
export const setToken = (t: string | null) => {
  if (COOKIE_SESSION) return;
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
      headers: { ...CLIENT, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.error ?? "server_error", json?.details);
  return json as T;
}

/** Mirrors the server's limits so people hear about a bad file before a long upload, not after it. */
export const DOC_MAX_BYTES = 5_000_000;
export const VIDEO_MAX_BYTES = 50_000_000;
export const DOC_ACCEPT = "application/pdf,image/png,image/jpeg";
export const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime";
const DOC_TYPES = DOC_ACCEPT.split(",");
const VIDEO_TYPES = VIDEO_ACCEPT.split(",");

/** A message in Arabic when the file would be refused, otherwise null. */
export function fileProblem(file: File, kind: "doc" | "video"): string | null {
  const okTypes = kind === "video" ? VIDEO_TYPES : DOC_TYPES;
  if (!okTypes.includes(file.type)) return kind === "video" ? "الفيديو يجب أن يكون MP4 أو WebM أو MOV." : "المستند يجب أن يكون PDF أو صورة PNG أو JPEG.";
  const max = kind === "video" ? VIDEO_MAX_BYTES : DOC_MAX_BYTES;
  if (file.size > max) return `حجم الملف أكبر من ${max / 1_000_000} ميجا.`;
  if (file.size === 0) return "الملف فارغ.";
  return null;
}

export interface UploadedFile { id: string; fileKey: string; contentType: string; size: number }

/** Sends the file's raw bytes. XHR rather than fetch only because it reports progress, which matters for a video. */
export function uploadFile(file: File, onProgress?: (fraction: number) => void): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/api/teacher/uploads`);
    xhr.setRequestHeader("content-type", file.type);
    xhr.setRequestHeader("x-ilmak-client", "web");
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onerror = () => reject(new ApiError(0, "network"));
    xhr.onload = () => {
      let json: any = null;
      try { json = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && json?.fileKey) resolve(json as UploadedFile);
      else reject(new ApiError(xhr.status, xhr.status === 413 ? "too_large" : (json?.error ?? "server_error"), json?.details));
    };
    xhr.send(file);
  });
}

/** Opens a staff-only file in a new tab. The request carries the bearer token, so a plain link would not work. */
export async function openProtectedFile(path: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${BASE}/api${path}`, { headers: { ...CLIENT, ...(token ? { authorization: `Bearer ${token}` } : {}) } }).catch(() => null);
  if (!res) throw new ApiError(0, "network");
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.error ?? "server_error");
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}

/** Saves a protected file (a CSV, say) to the device. Same sign-in as every other call. */
export async function saveProtectedFile(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${BASE}/api${path}`, { headers: { ...CLIENT, ...(token ? { authorization: `Bearer ${token}` } : {}) } }).catch(() => null);
  if (!res) throw new ApiError(0, "network");
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.error ?? "server_error");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const MESSAGES: Record<string, string> = {
  category_exists: "هذا التخصص موجود في القائمة. اخترْه منها.",
  already_requested: "طلبتَ هذا التخصص من قبل وهو بانتظار القرار.",
  too_many_pending_requests: "لديك 3 طلبات بانتظار القرار. انتظر الرد عليها أولاً.",
  already_selected: "هذا التخصص ضمن تخصصاتك.",
  too_many_categories: "وصلت للحد الأقصى من التخصصات (3).",
  no_accepted_proof: "لا يمكن الاعتماد قبل قبول مستند واحد على الأقل لهذا التخصص.",
  file_infected: "رفضنا الملف لأن الفحص الأمني وجد فيه ما يشبه فيروساً.",
  scan_unavailable: "تعذّر فحص الملف الآن. حاول بعد دقائق.",
  invalid_month: "الشهر غير صحيح.",
  invalid_range: "المدة غير صحيحة: تأكد من التاريخين.",
  range_too_long: "المدة طويلة جداً: اختر سنة أو أقل.",
  empty_file: "الملف فارغ.",
  too_large: "حجم الملف أكبر من المسموح.",
  unsupported_file_type: "نوع الملف غير مدعوم أو محتواه لا يطابق امتداده.",
  too_many_uploads: "وصلت للحد الأقصى من الملفات المرفوعة (20).",
  too_many_videos: "وصلت للحد الأقصى من الفيديوهات (3).",
  unknown_upload: "الملف غير موجود. ارفعه من جديد.",
  wrong_file_kind: "نوع الملف لا يناسب هذا الحقل.",
  intro_video_required: "ارفع الفيديو التعريفي أولاً.",
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
  wait_for_answer: "أرسلت عدة رسائل. انتظر ردّ المعلّم قبل المتابعة.",
  too_many_inquiries: "وصلت الحد اليومي لفتح محادثات جديدة مع معلّمين. حاول غداً.",
  not_asked: "لا يمكن الرد قبل أن يصلك سؤال.",
  room_unavailable: "غرفة الدرس متاحة للحجوزات المؤكدة فقط.",
  room_not_open_yet: "لم تفتح غرفة الدرس بعد. تفتح قبل الموعد بـ10 دقائق.",
  room_closed: "أُغلقت غرفة هذا الدرس.",
  party_attended: "سجل الغرفة يُظهر أن الطرف الآخر دخل الدرس، فلا يمكن تسجيل غياب.",
  export_limit: "وصلت الحد اليومي لتصدير البيانات (3 مرات). حاول غداً.",
  deletion_already_requested: "طلب الحذف مسجّل مسبقاً.",
  staff_cannot_self_delete: "حسابات الموظفين تُحذف من مدير النظام فقط.",
  deletion_blocked: "لا يمكن طلب الحذف الآن، توجد أمور مفتوحة في حسابك.",
  guarantee_unavailable: "ضمان الدرس الأول غير متاح لهذا الدرس.",
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
  invalid_school_code: "رمز المدرسة غير صحيح أو غير معتمد.",
  school_already_applied: "يوجد طلب سابق لهذه المدرسة.",
  mobile_in_use: "رقم الجوال مستخدم في حساب آخر.",
};
export const errorText = (e: unknown) => (e instanceof ApiError ? (MESSAGES[e.code] ?? `تعذّر تنفيذ الطلب (${e.code})`) : MESSAGES.server_error!);
