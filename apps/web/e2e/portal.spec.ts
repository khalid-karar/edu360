import { expect, test } from "@playwright/test";
import { api, apiLogin, expectNoPageErrors, signIn, signInStaff, totp } from "./helpers";

// Seeded accounts (apps/api/src/dev/local.ts): learner Hind 500000302@ilmak.test and teacher Noura 500000102@ilmak.test share a lesson from 3 hours ago.

test("a learner signs in and finds teachers", async ({ page }) => {
  const clean = expectNoPageErrors(page);
  await signIn(page, "500000302@ilmak.test");
  await page.waitForURL("**/portal/search");
  await expect(page.locator("a.card").first()).toBeVisible();
  clean();
});

test("data rights: download, request deletion, cancel", async ({ page }) => {
  await signIn(page, "500000302@ilmak.test");
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
  await signIn(page, "500000302@ilmak.test");
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
  await signIn(teacher, "500000102@ilmak.test");
  await teacher.waitForURL("**/portal/bookings");
  await teacher.click("button:has-text('السابقة')");
  await teacher.click("a.card:has-text('هند')");
  await expect(teacher.locator("text=ضمان الدرس الأول")).toBeVisible();
});

test("vetting officer approves a teacher application", async ({ browser }) => {
  const p = await signInStaff(browser, "500000201@ilmak.test");
  await p.click("text=سارة الحربي");
  await p.click("button:has-text('قبول')");
  await expect(p.locator("text=مقبول")).toBeVisible();
  await p.click("text=بدء المقابلة");
  await expect(p.locator("text=تقييم المقابلة")).toBeVisible();
  await p.click("text=تسجيل القرار");
  await expect(p.locator("text=تم تسجيل القرار")).toBeVisible();
});

test("a banned teacher appeals; the issuer cannot decide it; a second officer reverses it", async ({ page, browser }) => {
  const safety = await apiLogin("500000202@ilmak.test");
  await api("POST", "/auth/mfa/verify", { code: totp("500000202@ilmak.test") }, safety);
  const teacherToken = await apiLogin("500000103@ilmak.test");
  const teacherId = (await api("GET", "/auth/me", undefined, teacherToken)).id;
  await api("POST", `/admin/safety/users/${teacherId}/strike`, { reason: "اشتباه بمخالفة جسيمة يحتاج مراجعة", zeroTolerance: true }, safety);

  await signIn(page, "500000103@ilmak.test");
  await page.waitForURL("**/portal/account");
  await expect(page.locator("text=حسابك محظور")).toBeVisible();
  await page.click("button:has-text('تقديم تظلّم')");
  await page.fill("textarea", "أعترض على الحظر، فالأمر كان سوء فهم وأرفقت ما يثبت ذلك في المحادثات السابقة.");
  await page.click("button:has-text('إرسال التظلّم')");
  await expect(page.locator("text=التظلّم قيد المراجعة")).toBeVisible();

  const issuer = await signInStaff(browser, "500000202@ilmak.test", 1);
  await issuer.click("button:has-text('التظلّمات')");
  await issuer.click("button.card");
  await expect(issuer.locator("text=أنت من أصدر هذه المخالفة")).toBeVisible();

  const other = await signInStaff(browser, "500000206@ilmak.test");
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

test("a learner asks a teacher a question before booking and the teacher answers", async ({ page, browser }) => {
  const sockets: string[] = [];
  page.on("websocket", (ws) => sockets.push(ws.url()));
  await signIn(page, "500000301@ilmak.test"); // Waleed
  await page.waitForURL("**/portal/search");
  await page.click("a.card:has-text('محمد القحطاني')");
  await expect(page.locator("text=معلّم مؤسس").first()).toBeVisible(); // a badge on the profile
  await page.click("button:has-text('اسأل')");
  await page.fill("textarea[aria-label='سؤالك']", "هل تدرّس الأطفال في سن السابعة؟");
  await page.click("button:has-text('إرسال السؤال')");
  await page.waitForURL("**/portal/inquiry**");
  await expect(page.locator(".msg.mine", { hasText: "سن السابعة" })).toBeVisible();

  // a phone number is refused and explained
  await page.fill("input[aria-label='رسالة']", "كلمني على 0555555555");
  await page.click("button:has-text('إرسال')");
  await expect(page.locator(".note.err")).toContainText("لا يمكن إرسال أرقام التواصل");

  const teacher = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar-SA" })).newPage();
  await signIn(teacher, "500000101@ilmak.test");
  await teacher.locator("a:has-text('الأسئلة'):visible").first().click();
  await teacher.click("a.card:has-text('وليد')");
  await expect(teacher.locator(".msg", { hasText: "سن السابعة" })).toBeVisible();
  await expect(teacher.locator("text=0555555555")).toHaveCount(0);
  await teacher.fill("input[aria-label='رسالة']", "نعم، أدرّس من سن السادسة بأسلوب مبسّط.");
  await teacher.click("button:has-text('إرسال')");
  await expect(teacher.locator(".msg.mine", { hasText: "السادسة" })).toBeVisible();

  // Pushed over the WebSocket: well inside the 5 s the polling fallback would take.
  await expect(page.locator(".msg:not(.mine)", { hasText: "السادسة" })).toBeVisible({ timeout: 3_500 });
  expect(sockets.some((u) => u.endsWith("/api/ws"))).toBe(true);
  await expect(page.locator("a:has-text('اطّلع على المواعيد واحجز')")).toBeVisible();
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
  await signIn(page, "500000301@ilmak.test");
  await page.waitForURL("**/portal/search");
  await page.goto("/portal/account");
  await expect(page.locator("text=بياناتي وخصوصيتي")).toBeVisible();
  expect(problems).toEqual([]);
});

test("a new teacher uploads an intro video and a certificate, and bad files are refused before sending", async ({ page }) => {
  const clean = expectNoPageErrors(page);
  await signIn(page, "500000106@ilmak.test");
  await page.goto("/portal/apply");
  await expect(page.locator("text=ينقصك")).toBeVisible();

  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(64)]);
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n");

  // Step 1: profile with the intro video. A text file in the video field is refused on the spot.
  await page.fill("textarea", "معلم رياضيات وفيزياء للمرحلة الثانوية، خبرة ثماني سنوات في التدريس الخصوصي والتحضير للاختبارات.");
  await page.fill("input.ltr", "FL-900100");
  const video = page.locator("input[type=file]").first();
  await video.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.locator("text=الفيديو يجب أن يكون")).toBeVisible();
  await expect(page.locator("button:has-text('حفظ')").first()).toBeDisabled();
  await video.setInputFiles({ name: "intro.mp4", mimeType: "video/mp4", buffer: mp4 });
  await page.locator("button:has-text('حفظ')").first().click();
  await expect(page.locator("text=تم الحفظ").first()).toBeVisible();
  await expect(page.locator("text=✓ مرفوع").first()).toBeVisible();
  await expect(page.locator("text=ينقصك").first()).not.toContainText("فيديو التعريف");

  // Step 2: pick a category, then step 3: upload a certificate scan for it.
  await page.locator("label:has-text('قرآن')").first().locator("input[type=checkbox]").check().catch(async () => {
    await page.locator("input[type=checkbox]").nth(7).check();
  });
  await page.click("button:has-text('حفظ التخصصات')");
  await expect(page.locator("h3:has-text('3. المستندات')")).toBeVisible();
  const scan = page.locator("h3:has-text('3. المستندات')").locator("xpath=..").locator("input[type=file]").first();
  await scan.setInputFiles({ name: "ijazah.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.locator("h3:has-text('3. المستندات')").locator("xpath=..").locator("button:has-text('إضافة')").click();
  await expect(page.locator("h3:has-text('3. المستندات')").locator("xpath=..").locator(".chip:has-text('شهادة جامعية')")).toBeVisible();
  clean();
});

test("the session is an HttpOnly cookie that scripts cannot read, and signing out ends it", async ({ page, context }) => {
  await signIn(page, "500000301@ilmak.test");
  await page.waitForURL("**/portal/search");
  const cookies = (await context.cookies()).filter((c) => c.name === "ilmak_session");
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/api" });
  // Nothing a script on the page can read holds the session.
  const visible = await page.evaluate(() => ({ cookie: document.cookie, storage: JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) }));
  expect(visible.cookie).not.toContain("ilmak_session");
  expect(visible.storage).not.toContain("ilmak.token");
  expect(visible.storage).not.toContain(cookies[0]!.value);

  // A reload keeps the user signed in, from the cookie alone.
  await page.reload();
  await expect(page.locator("a.card").first()).toBeVisible();

  const oldValue = cookies[0]!.value;
  await page.click("button:has-text('خروج')");
  await page.waitForURL("**/portal/login");
  expect((await context.cookies()).filter((c) => c.name === "ilmak_session")).toHaveLength(0);
  // The old cookie value is dead on the server too, not just removed from the browser.
  const replay = await fetch("http://127.0.0.1:3000/api/auth/me", { headers: { cookie: `ilmak_session=${oldValue}` } });
  expect(replay.status).toBe(401);
});

test("a school applies, the admin approves it, the school signs in and sees its code", async ({ page, browser }) => {
  const noErrors = expectNoPageErrors(page);
  await page.goto("/portal/school-apply");
  const inputs = page.locator(".card input");
  await inputs.nth(0).fill("مدارس الأفق الأهلية");
  await inputs.nth(1).fill("الرياض");
  await inputs.nth(2).fill("فهد العتيبي");
  await inputs.nth(3).fill("0500000701");
  await page.click("button:has-text('إرسال الطلب')");
  await expect(page.locator("text=وصلنا طلبك")).toBeVisible();

  const admin = await signInStaff(browser, "500000204@ilmak.test");
  await admin.click("button:has-text('المدارس')");
  await admin.locator("[data-testid^=school-]", { hasText: "مدارس الأفق الأهلية" }).locator("button:has-text('اعتماد')").click();
  await expect(admin.locator("text=معتمدة")).toBeVisible();
  const code = (await admin.locator("b.ltr").first().innerText()).trim();
  expect(code).toMatch(/^[A-Z2-9]{8}$/);

  await signIn(page, "500000701@ilmak.test");
  await page.waitForURL("**/portal/school**");
  await expect(page.locator("[data-testid=school-code]")).toHaveText(code);
  await expect(page.locator("text=نحمي خصوصية الأسر")).toBeVisible();
  noErrors();
});

test("the admin analytics tab shows the platform at a glance", async ({ browser }) => {
  const admin = await signInStaff(browser, "500000204@ilmak.test", 1);
  await expect(admin.locator("text=إجمالي المدفوعات")).toBeVisible();
  await expect(admin.locator("text=بانتظار قرار")).toBeVisible();
  await expect(admin.locator("[data-testid=gross]")).not.toBeEmpty();
});

test("a teacher reads the month statement and downloads it as CSV; finance exports payments", async ({ page, browser }) => {
  await signIn(page, "500000101@ilmak.test");
  await page.goto("/portal/earnings");
  // The seeded lessons are a few days old, so pick the month of five days ago whatever today's date is.
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit" }).format(new Date(Date.now() - 5 * 86_400_000)).slice(0, 7);
  await page.selectOption("select[aria-label=السنة]", month.slice(0, 4));
  await page.selectOption("select[aria-label=الشهر]", String(Number(month.slice(5))));
  await expect(page.locator("select[aria-label=الشهر] option:checked")).toHaveText(/[\u0600-\u06FF]/); // an Arabic month name
  await expect(page.locator("[data-testid=statement-net]")).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('تنزيل CSV')")]);
  expect(dl.suggestedFilename()).toBe(`ilmak-statement-${month}.csv`);

  const fin = await signInStaff(browser, "500000203@ilmak.test");
  await fin.click("button:has-text('تصدير')");
  const [dl2] = await Promise.all([fin.waitForEvent("download"), fin.click("button:has-text('تنزيل CSV')")]);
  expect(dl2.suggestedFilename()).toMatch(/^ilmak-finance-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
});

test("a teacher asks for a missing subject and the admin adds it", async ({ page, browser }) => {
  const noErrors = expectNoPageErrors(page);
  await signIn(page, "500000102@ilmak.test");
  await page.goto("/portal/apply");
  await page.fill("input[placeholder='مثال: الكيمياء']", "الكيمياء الحيوية");
  await page.click("button:has-text('إرسال الطلب')");
  await expect(page.locator("text=وصل طلبك")).toBeVisible();

  const admin = await signInStaff(browser, "500000207@ilmak.test");
  await admin.click("button:has-text('التخصصات')");
  const card = admin.locator("[data-testid^=catreq-]", { hasText: "الكيمياء الحيوية" });
  await card.locator("input.ltr").first().fill("Biochemistry");
  await card.locator("button:has-text('إضافة التخصص')").click();
  await expect(card).toHaveCount(0);

  await page.reload();
  await expect(page.locator("text=أُضيف")).toBeVisible();
  await expect(page.locator("select[aria-label='التخصص'] option", { hasText: "الكيمياء الحيوية" })).toHaveCount(1);
  noErrors();
});

test("the admin sets the commission and a discount code, and a learner uses it at booking", async ({ page, browser }) => {
  const noErrors = expectNoPageErrors(page);
  const admin = await signInStaff(browser, "500000207@ilmak.test", 1);
  await admin.click("button:has-text('الأسعار والخصومات')");
  await expect(admin.locator("[data-testid=founding-taken]")).toContainText("من 100");
  // 12 % for ordinary teachers in the first lessons, then save
  const std = admin.locator(".card", { hasText: "بقية المعلّمين" });
  await std.locator("input").first().fill("12");
  await admin.click("button:has-text('حفظ')");
  await expect(admin.locator("text=حُفظت الأسعار")).toBeVisible();

  await admin.locator("input[placeholder='FOUNDING26']").fill("YAUM-TASEES");
  await admin.locator("input[placeholder='يوم التأسيس']").fill("يوم التأسيس");
  await admin.locator("label", { hasText: "النسبة" }).locator("input").fill("20");
  await admin.click("button:has-text('إنشاء الكود')");
  await expect(admin.locator("[data-testid='code-YAUM-TASEES']")).toBeVisible();

  await signIn(page, "500000303@ilmak.test");
  await page.waitForURL("**/portal/search");
  await page.locator("a.card").first().click();
  await page.locator("button.slot").first().click();
  await page.fill("input[aria-label='كود الخصم']", "bad-code");
  await page.click("button:has-text('تطبيق')");
  await expect(page.locator("text=كود الخصم غير صحيح")).toBeVisible();
  await page.fill("input[aria-label='كود الخصم']", "yaum-tasees");
  await page.click("button:has-text('تطبيق')");
  await expect(page.locator("text=وفّرت")).toBeVisible();
  await expect(page.locator("[data-testid=pay-price]")).toBeVisible();
  noErrors();
});
