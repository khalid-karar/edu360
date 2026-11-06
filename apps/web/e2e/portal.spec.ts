import { expect, test } from "@playwright/test";
import { api, apiLogin, expectNoPageErrors, signIn, signInStaff, totp } from "./helpers";

// Seeded accounts (apps/api/src/dev/local.ts): learner Hind +966500000302 and teacher Noura +966500000102 share a lesson from 3 hours ago.

test("a learner signs in and finds teachers", async ({ page }) => {
  const clean = expectNoPageErrors(page);
  await signIn(page, "+966500000302");
  await page.waitForURL("**/portal/search");
  await expect(page.locator("a.card").first()).toBeVisible();
  clean();
});

test("data rights: download, request deletion, cancel", async ({ page }) => {
  await signIn(page, "+966500000302");
  await page.waitForURL("**/portal/search");
  await page.goto("/portal/account");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('تنزيل نسخة')")]);
  expect(download.suggestedFilename()).toBe("ilmak-my-data.json");

  await page.click("button:has-text('طلب حذف حسابي')");
  await page.click("button:has-text('تأكيد طلب الحذف')");
  await expect(page.locator("text=طلب حذف حسابك مسجّل")).toBeVisible();
  await page.click("button:has-text('إلغاء طلب الحذف')");
  await expect(page.locator("button:has-text('طلب حذف حسابي')")).toBeVisible();
});

test("first-lesson guarantee: the learner is refunded and the teacher sees the platform credit", async ({ page, browser }) => {
  await signIn(page, "+966500000302");
  await page.waitForURL("**/portal/search");
  await page.goto("/portal/bookings");
  await page.click("button:has-text('السابقة')");
  await page.click("a.card:has-text('نورة')");
  await expect(page.locator("text=ضمان الدرس الأول")).toBeVisible();
  await page.click("button:has-text('استرداد مبلغ الدرس')");
  await page.selectOption("select", "technical");
  await page.click("button:has-text('تأكيد الاسترداد')");
  await expect(page.locator("text=استُرد مبلغ هذا الدرس")).toBeVisible();
  await expect(page.locator("text=ضمان الدرس الأول")).toHaveCount(0);

  const teacher = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar-SA" })).newPage();
  await signIn(teacher, "+966500000102");
  await teacher.waitForURL("**/portal/bookings");
  await teacher.click("button:has-text('السابقة')");
  await teacher.click("a.card:has-text('هند')");
  await expect(teacher.locator("text=ضمان الدرس الأول")).toBeVisible();
});

test("vetting officer approves a teacher application", async ({ browser }) => {
  const p = await signInStaff(browser, "+966500000201");
  await p.click("text=سارة الحربي");
  await p.click("button:has-text('قبول')");
  await expect(p.locator("text=مقبول")).toBeVisible();
  await p.click("text=بدء المقابلة");
  await expect(p.locator("text=تقييم المقابلة")).toBeVisible();
  await p.click("text=تسجيل القرار");
  await expect(p.locator("text=تم تسجيل القرار")).toBeVisible();
});

test("a banned teacher appeals; the issuer cannot decide it; a second officer reverses it", async ({ page, browser }) => {
  const safety = await apiLogin("+966500000202");
  await api("POST", "/auth/mfa/verify", { code: totp("+966500000202") }, safety);
  const teacherToken = await apiLogin("+966500000103");
  const teacherId = (await api("GET", "/auth/me", undefined, teacherToken)).id;
  await api("POST", `/admin/safety/users/${teacherId}/strike`, { reason: "اشتباه بمخالفة جسيمة يحتاج مراجعة", zeroTolerance: true }, safety);

  await signIn(page, "+966500000103");
  await page.waitForURL("**/portal/account");
  await expect(page.locator("text=حسابك محظور")).toBeVisible();
  await page.click("button:has-text('تقديم تظلّم')");
  await page.fill("textarea", "أعترض على الحظر، فالأمر كان سوء فهم وأرفقت ما يثبت ذلك في المحادثات السابقة.");
  await page.click("button:has-text('إرسال التظلّم')");
  await expect(page.locator("text=التظلّم قيد المراجعة")).toBeVisible();

  const issuer = await signInStaff(browser, "+966500000202", 1);
  await issuer.click("button:has-text('التظلّمات')");
  await issuer.click("button.card");
  await expect(issuer.locator("text=أنت من أصدر هذه المخالفة")).toBeVisible();

  const other = await signInStaff(browser, "+966500000206");
  await other.click("button:has-text('التظلّمات')");
  await other.click("button.card");
  await other.fill("textarea", "راجعنا المحادثات وتبيّن أن الحادثة سوء فهم.");
  await other.click("button:has-text('قبول التظلّم')");
  await expect(other.locator("text=لا تظلّمات")).toBeVisible();

  await page.goto("/portal");
  await page.waitForURL("**/portal/bookings");
  await page.goto("/portal/notifications");
  await expect(page.locator("text=قُبل تظلّمك")).toBeVisible();
});

test("pages load under the security headers without CSP violations or console errors", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  const res = await page.goto("/");
  expect(res?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(res?.headers()["x-frame-options"]).toBe("DENY");
  await page.waitForLoadState("networkidle");
  for (const path of ["/portal/login", "/privacy"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  await signIn(page, "+966500000301");
  await page.waitForURL("**/portal/search");
  await page.goto("/portal/account");
  await expect(page.locator("text=بياناتي وخصوصيتي")).toBeVisible();
  expect(problems).toEqual([]);
});
