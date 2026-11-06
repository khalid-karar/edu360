/** Every notification the platform sends, in one place. Pure: no database, no clock. */
export type NoticeKind =
  | "booking_requested" | "booking_accepted" | "booking_declined" | "booking_cancelled" | "booking_expired_unpaid"
  | "booking_unanswered" | "lesson_completed" | "no_show" | "lesson_reminder" | "new_message"
  | "vetting_decision" | "strike" | "dispute_opened" | "dispute_decided" | "payout_update" | "report_update";

export interface Notice {
  title: string;
  body: string;
  /** Also sent as a text message: only what the person would be upset to miss. */
  sms: boolean;
}

export interface NoticeVars {
  who?: string;       // the other party's display name
  when?: string;      // lesson time, already formatted in Riyadh time
  amount?: string;    // already formatted
  note?: string;
  decision?: string;
  by?: "teacher" | "learner" | "system";
}

const t = (title: string, body: string, sms = false): Notice => ({ title, body, sms });

export function render(kind: NoticeKind, v: NoticeVars = {}): Notice {
  switch (kind) {
    case "booking_requested": return t("طلب حجز جديد", `${v.who ?? "متعلّم"} يطلب درساً ${v.when ?? ""}. أمامك وقت محدود للرد.`, true);
    case "booking_accepted": return t("تم قبول حجزك", `وافق ${v.who ?? "المعلّم"} على درسك ${v.when ?? ""}.`, true);
    case "booking_declined": return t("اعتذر المعلّم عن الدرس", `لم يتمكن ${v.who ?? "المعلّم"} من درس ${v.when ?? ""}. أُفرج عن المبلغ المحجوز ولم يُخصم منك شيء.`, true);
    case "booking_cancelled":
      return v.by === "system"
        ? t("أُلغي الدرس", `أُلغي درس ${v.when ?? ""} من المنصة. لم يُخصم منك شيء.`, true)
        : t("أُلغي الدرس", `ألغى ${v.who ?? "الطرف الآخر"} درس ${v.when ?? ""}.`, true);
    case "booking_expired_unpaid": return t("انتهت مهلة الدفع", "لم يكتمل الدفع في المهلة فأُلغي الحجز. يمكنك الحجز من جديد.");
    case "booking_unanswered": return t("لم يردّ المعلّم في الوقت", `انتهت مهلة الرد على درس ${v.when ?? ""} وأُفرج عن المبلغ المحجوز. جرّب معلّماً آخر.`, true);
    case "lesson_completed": return t("اكتمل الدرس", `سجّل ${v.who ?? "المعلّم"} اكتمال درسك. قيّم الدرس خلال 48 ساعة، ويمكنك الاعتراض إن كانت هناك مشكلة.`);
    case "no_show": return t("بلاغ غياب", `سُجّل غياب في درس ${v.when ?? ""}. إن كان هذا غير صحيح فارفع اعتراضاً خلال 48 ساعة.`, true);
    case "lesson_reminder": return t("درسك بعد قليل", `درس ${v.when ?? ""} مع ${v.who ?? ""} يبدأ قريباً.`, true);
    case "new_message": return t("رسالة جديدة", `وصلتك رسالة من ${v.who ?? "المعلّم"} بخصوص درس ${v.when ?? ""}.`);
    case "vetting_decision":
      return v.decision === "rejected"
        ? t("نتيجة طلب الانضمام", `لم يُقبل طلبك${v.note ? `: ${v.note}` : ""}. يمكنك إعادة التقديم بعد 90 يوماً.`, true)
        : t("تم اعتماد طلبك", v.decision === "conditional" ? "اعتُمدت معلّماً للكبار فقط حالياً. أضف أوقاتك لتظهر للمتعلّمين." : "اعتُمدت معلّماً على المنصة. أضف أوقاتك لتظهر للمتعلّمين.", true);
    case "strike": return t("مخالفة على حسابك", `سُجّلت مخالفة على حسابك${v.note ? `: ${v.note}` : ""}. راجع سجل المخالفات في حسابك.`, true);
    case "dispute_opened": return t("اعتراض على درس", `رُفع اعتراض على درس ${v.when ?? ""}. أُوقف تحويل المبلغ حتى البتّ فيه.`);
    case "dispute_decided": return t("صدر قرار الاعتراض", `${v.decision ?? "صدر القرار"}${v.amount ? ` (${v.amount})` : ""}.`, true);
    case "payout_update": return t("تحديث التحويل", `${v.decision ?? ""}${v.amount ? ` (${v.amount})` : ""}`, v.decision === "تم تحويل المبلغ إلى حسابك");
    case "report_update": return t("تحديث على بلاغك", `${v.decision ?? "تمت مراجعة بلاغك"}.`);
  }
}
