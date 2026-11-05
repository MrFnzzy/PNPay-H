/**
 * Real-browser end-to-end test against the PRODUCTION build (`npm run build` first).
 * Starts a throwaway PostgreSQL, a mock email provider and `next start`, then drives Chromium.
 *   npm run test:e2e
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { randomBytes } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import { hashPassword } from "../../src/lib/auth/passwords";

const results: { name: string; ok: boolean; detail?: string }[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    console.log(`  FAIL  ${name}: ${e instanceof Error ? e.message : e}`);
  }
}
const assert = (c: unknown, msg: string) => {
  if (!c) throw new Error(msg);
};

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "pnpay-e2e-"));
  const pgPort = 55000 + Math.floor(Math.random() * 500);
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port: pgPort, persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("pnpay_e2e");
  const dbUrl = `postgresql://postgres:postgres@localhost:${pgPort}/pnpay_e2e`;
  const pool = new Pool({ connectionString: dbUrl });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });

  // Mock Resend: captures emails.
  const mails: { to: string[]; subject: string; text: string; html: string; idem?: string }[] = [];
  let mockMode: "ok" | "permanent" | "transient" = "ok"; // Phase 4: lets the suite simulate provider outages
  let mockRejected = 0;
  const mock = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      if (mockMode !== "ok") {
        mockRejected++;
        res.writeHead(mockMode === "permanent" ? 422 : 503, { "content-type": "application/json" }).end('{"error":"mock outage"}');
        return;
      }
      mails.push({ ...JSON.parse(b), idem: String(req.headers["idempotency-key"] ?? "") });
      res.writeHead(200, { "content-type": "application/json" }).end('{"id":"mock"}');
    });
  });
  await new Promise<void>((r) => mock.listen(0, r));
  const mockPort = (mock.address() as { port: number }).port;

  const appPort = 3100 + Math.floor(Math.random() * 100);
  const base = `http://localhost:${appPort}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: dbUrl,
    AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-1234",
    APP_BASE_URL: "https://pnpay.example.test",
    EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_mock",
    RESEND_API_URL: `http://localhost:${mockPort}/emails`,
    PORT: String(appPort),
    CRON_SECRET: "e2e-cron-secret-e2e-cron-secret-0123456789",
    // Test-only: the production build normally requires Vercel Blob; the E2E run uses a throwaway local folder.
    RECEIPT_STORAGE: "local",
    RECEIPT_LOCAL_DIR: path.join(dir, "receipts"),
    ALLOW_NON_PRODUCTION_STORAGE: "1",
  };
  const server: ChildProcessWithoutNullStreams = spawn("npx", ["next", "start", "-p", String(appPort)], { env, stdio: ["ignore", "pipe", "pipe"] }) as unknown as ChildProcessWithoutNullStreams;
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));

  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
      if (i === 59) throw new Error("server did not start:\n" + serverLog);
    }

    // Controlled admin setup through the real script.
    const adminEnv: NodeJS.ProcessEnv = { ...env, ADMIN_FULL_NAME: "Miss Jean", ADMIN_EMAIL: "jean@example.test", ADMIN_PASSWORD: "AdminPassw0rd!" };
    await new Promise<void>((resolve, reject) => {
      const p = spawn("npx", ["tsx", "scripts/create-admin.ts"], { env: adminEnv, stdio: "inherit" });
      p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("admin setup failed"))));
    });

    const require = createRequire(import.meta.url);
    // Playwright is provided by the environment (global install); it is not a project dependency.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { chromium } = require("playwright") as any;
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ baseURL: base });
    const page = await ctx.newPage();
    const pw = "Str0ngPassw0rd";

    await check("unauthenticated /student/dashboard redirects to /login", async () => {
      await page.goto("/student/dashboard");
      assert(new URL(page.url()).pathname === "/login", page.url());
    });
    await check("unauthenticated /admin/dashboard redirects to /admin/login", async () => {
      await page.goto("/admin/dashboard");
      assert(new URL(page.url()).pathname === "/admin/login", page.url());
    });

    await check("registration form rejects mismatched passwords on the client", async () => {
      await page.goto("/register");
      await page.fill("#fullName", "Juan Dela Cruz");
      await page.fill("#studentId", "2024-0001");
      await page.fill("#email", "juan@example.test");
      await page.selectOption("#yearLevel", "2");
      await page.fill("#password", pw);
      await page.fill("#confirmPassword", pw + "x");
      await page.click("button[type=submit]");
      await page.getByText("Passwords do not match.").waitFor({ timeout: 5000 });
    });

    await check("valid registration shows verification-required message and sends one email", async () => {
      await page.fill("#confirmPassword", pw);
      await page.click("button[type=submit]");
      await page.getByText(/verify your email before you can log in/i).waitFor({ timeout: 15000 });
      assert(mails.length === 1 && mails[0].to[0] === "juan@example.test", "expected one verification email");
    });

    await check("duplicate registration (same email) is rejected in the UI", async () => {
      await page.goto("/register");
      await page.fill("#fullName", "Someone Else");
      await page.fill("#studentId", "2024-0002");
      await page.fill("#email", "juan@example.test");
      await page.selectOption("#yearLevel", "1");
      await page.fill("#password", pw);
      await page.fill("#confirmPassword", pw);
      await page.click("button[type=submit]");
      await page.getByText("An account with this email already exists.").waitFor({ timeout: 15000 });
    });

    await check("unverified student cannot log in", async () => {
      await page.goto("/login");
      await page.fill("#email", "juan@example.test");
      await page.fill("#password", pw);
      await page.click("button[type=submit]");
      await page.getByText(/verify your email address before logging in/i).waitFor({ timeout: 15000 });
      assert(new URL(page.url()).pathname === "/login", "should stay on login");
    });

    const token = decodeURIComponent(mails[0].text.match(/token=([A-Za-z0-9_%-]+)/)![1]);
    await check("invalid token shows an error", async () => {
      await page.goto("/verify-email?token=" + "z".repeat(43));
      await page.click("button[type=submit]");
      await page.getByText(/not valid/i).waitFor({ timeout: 15000 });
    });
    await check("opening the link alone does not consume the token; confirming verifies the email", async () => {
      await page.goto("/verify-email?token=" + encodeURIComponent(token));
      await page.click("button[type=submit]");
      await page.getByText(/Your email is verified/i).waitFor({ timeout: 15000 });
    });
    await check("reusing the token fails", async () => {
      await page.goto("/verify-email?token=" + encodeURIComponent(token));
      await page.click("button[type=submit]");
      await page.getByText(/already/i).waitFor({ timeout: 15000 });
    });

    await check("student with wrong password is rejected", async () => {
      await page.goto("/login");
      await page.fill("#email", "juan@example.test");
      await page.fill("#password", "WrongPassw0rd");
      await page.click("button[type=submit]");
      await page.getByText("Invalid email or password.").waitFor({ timeout: 15000 });
    });
    await check("student can log in with an HttpOnly cookie and reach the student dashboard", async () => {
      await page.fill("#password", pw);
      await page.click("button[type=submit]");
      await page.waitForURL("**/student/dashboard", { timeout: 15000 });
      await page.getByText("Welcome, Juan Dela Cruz").waitFor();
      const c = (await ctx.cookies()).find((x: { name: string }) => x.name === "pnpay_session");
      assert(c && c.httpOnly && c.sameSite === "Lax", "session cookie flags");
    });
    await check("student is redirected away from /admin/dashboard", async () => {
      await page.goto("/admin/dashboard");
      assert(new URL(page.url()).pathname === "/student/dashboard", page.url());
    });
    await check("logged-in student visiting /login is sent to the dashboard", async () => {
      await page.goto("/login");
      assert(new URL(page.url()).pathname === "/student/dashboard", page.url());
    });
    await check("student logout invalidates the session (old cookie no longer works)", async () => {
      const oldCookies = await ctx.cookies();
      await page.goto("/student/dashboard");
      await page.click("text=Log out");
      await page.waitForURL("**/login");
      await page.goto("/student/dashboard");
      assert(new URL(page.url()).pathname === "/login", "dashboard should require login");
      // Replay the pre-logout cookie: the server must reject it.
      await ctx.addCookies(oldCookies);
      await page.goto("/student/dashboard");
      assert(new URL(page.url()).pathname === "/login", "replayed cookie must be rejected: " + page.url());
      await ctx.clearCookies();
    });

    await check("student credentials do not work on the admin login page", async () => {
      await page.goto("/admin/login");
      await page.fill("#email", "juan@example.test");
      await page.fill("#password", pw);
      await page.click("button[type=submit]");
      await page.getByText("Invalid email or password.").waitFor({ timeout: 15000 });
    });
    await check("admin logs in through the controlled account and reaches the admin dashboard", async () => {
      await page.fill("#email", "jean@example.test");
      await page.fill("#password", "AdminPassw0rd!");
      await page.click("button[type=submit]");
      await page.waitForURL("**/admin/dashboard", { timeout: 15000 });
      await page.getByText("Administrator dashboard").waitFor();
    });
    await check("admin is redirected away from the student dashboard", async () => {
      await page.goto("/student/dashboard");
      assert(new URL(page.url()).pathname === "/admin/dashboard", page.url());
    });
    await check("admin logout returns to the admin login", async () => {
      await page.goto("/admin/dashboard");
      await page.click("text=Log out");
      await page.waitForURL("**/admin/login");
    });
    await check("security headers present", async () => {
      const r = await fetch(`${base}/login`);
      assert(r.headers.get("x-frame-options") === "DENY" && r.headers.get("x-content-type-options") === "nosniff", "headers");
      assert(!r.headers.get("x-powered-by"), "x-powered-by should be removed");
    });
    await check("server log does not contain the raw verification token", async () => {
      assert(!serverLog.includes(token), "token leaked to server log");
    });
    await check("health endpoint works and leaks nothing", async () => {
      const r = await (await fetch(`${base}/api/health`)).json();
      assert(JSON.stringify(r) === '{"status":"ok"}', JSON.stringify(r));
    });

    // ------------------------------------------------------------------ Phase 2: student portal
    const png = (size = 600) =>
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from("IHDR"), Buffer.alloc(17, 1), randomBytes(size)]);
    const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
    const pwHash = await hashPassword(pw);
    const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;
    const [maria] = await q(
      `INSERT INTO users (full_name, student_id, email, password_hash, email_verified_at, year_level) VALUES ('Maria Santos','2024-0099','maria@example.test',$1, now(), 1) RETURNING user_id`,
      [pwHash],
    );
    const [juan] = await q(`SELECT user_id FROM users WHERE email='juan@example.test'`);
    const ob = async (uid: string, due: string, label: string) =>
      (await q(`INSERT INTO payment_obligations (student_id, academic_year, period_label, amount_due, due_date) VALUES ($1,'2026-2027',$2,500.00,$3) RETURNING obligation_id`, [uid, label, due]))[0].obligation_id as string;
    const jPast = await ob(juan.user_id, day(-30), "Past month");
    const jNear = await ob(juan.user_id, day(10), "Near month");
    await ob(juan.user_id, day(40), "Far month");
    const mOnly = await ob(maria.user_id, day(5), "Maria month");

    async function login(pageX: typeof page, email: string, password: string) {
      await pageX.goto("/login");
      await pageX.fill("#email", email);
      await pageX.fill("#password", password);
      await pageX.click("button[type=submit]");
      await pageX.waitForURL("**/student/dashboard", { timeout: 15000 });
    }

    await check("P2: dashboard shows real totals from the database, overdue count and nothing paid yet", async () => {
      await login(page, "juan@example.test", pw);
      await page.getByText("₱1,500.00").first().waitFor();
      const stats = await page.locator(".stats").innerText();
      assert(/Total verified payments\s*₱0\.00/.test(stats), stats);
      assert(/Remaining balance\s*₱1,500\.00/.test(stats), stats);
      assert(/Overdue installments\s*1/.test(stats), stats);
      assert(!(await page.content()).includes("Maria"), "other student's data leaked");
    });
    await check("P2: tracker lists installments chronologically with statuses", async () => {
      await page.goto("/student/tracker");
      const rows = await page.locator("tbody tr").allInnerTexts();
      assert(rows.length === 3 && rows[0].includes("Past month") && rows[0].includes("Overdue") && rows[1].includes("Not Yet Due"), rows.join(" | "));
    });
    await check("P2: calendar shows items; selecting one shows details and never changes data", async () => {
      await page.goto("/student/calendar");
      const before = (await q(`SELECT count(*)::int n FROM payment_submissions`))[0].n;
      const btn = page.locator(".cal-grid button").first();
      // Navigate months until an item is visible (the calendar opens on the next upcoming month).
      for (let i = 0; i < 4 && !(await btn.count()); i++) await page.click("[aria-label='Next month']");
      await btn.click();
      const detail = await page.locator(".cal-detail").innerText();
      assert(/Amount\s*₱500\.00/.test(detail) && /Due date/.test(detail) && /Status/.test(detail), detail);
      assert((await q(`SELECT count(*)::int n FROM payment_submissions`))[0].n === before, "selecting changed data");
      assert((await q(`SELECT count(*)::int n FROM payment_submissions WHERE status='verified'`))[0].n === 0, "something was marked paid");
    });
    await check("P2: submit form shows read-only amount that is not part of the submitted form", async () => {
      await page.goto(`/student/submit?obligation=${jNear}`);
      const amount = page.locator("#amountDue");
      assert((await amount.inputValue()) === "₱500.00", "amount");
      assert((await amount.getAttribute("readonly")) !== null, "amount must be readonly");
      assert((await amount.getAttribute("name")) === null, "amount must not be a submitted field");
    });
    await check("P2: a non-image disguised as PNG is rejected by the server", async () => {
      await page.goto(`/student/submit?obligation=${jNear}`);
      await page.fill("#paymentDate", day(0));
      await page.selectOption("#paymentMethod", "gcash");
      await page.setInputFiles("#receipt", { name: "receipt.png", mimeType: "image/png", buffer: Buffer.from("<html>not an image</html>".repeat(20)) });
      await page.click("#submitReceipt");
      await page.getByText(/must be a PNG or JPEG/i).waitFor({ timeout: 15000 });
      assert((await q(`SELECT count(*)::int n FROM payment_submissions`))[0].n === 0, "submission saved");
    });
    await check("P2: oversized file is rejected before upload", async () => {
      await page.setInputFiles("#receipt", { name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(11 * 1024 * 1024, 1) });
      await page.click("#submitReceipt");
      await page.getByText(/too large/i).waitFor({ timeout: 15000 });
    });
    await check("P2: wrong file type (GIF) is rejected by the browser check", async () => {
      await page.setInputFiles("#receipt", { name: "x.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a" + "x".repeat(300)) });
      await page.click("#submitReceipt");
      await page.getByText(/PNG or JPEG/i).first().waitFor({ timeout: 15000 });
    });
    let submissionId = "";
    await check("P2: valid receipt is submitted, status Pending Review, and not counted as paid", async () => {
      await page.setInputFiles("#receipt", { name: "my-gcash.png", mimeType: "image/png", buffer: png() });
      await page.fill("#referenceNumber", "GC-20260101-0001");
      await page.click("#submitReceipt");
      await page.waitForURL("**/student/history**", { timeout: 20000 });
      await page.getByText(/pending review/i).first().waitFor();
      const rows = await q(`SELECT submission_id, status, amount_submitted, student_id, receipt_key FROM payment_submissions`);
      assert(rows.length === 1 && rows[0].status === "pending_review" && rows[0].amount_submitted === "500.00" && rows[0].student_id === juan.user_id, JSON.stringify(rows));
      assert(!/my-gcash/.test(rows[0].receipt_key), "user filename must not be used in the storage key");
      submissionId = rows[0].submission_id;
      await page.goto("/student/dashboard");
      assert(/Total verified payments\s*₱0\.00/.test(await page.locator(".stats").innerText()), "pending counted as paid");
    });
    await check("P2: the pending installment is no longer offered for submission", async () => {
      await page.goto("/student/submit");
      const opts = await page.locator("#obligationId option").allInnerTexts();
      assert(!opts.some((o: string) => o.includes("Near month")) && opts.some((o: string) => o.includes("Past month")), opts.join(" | "));
    });
    await check("P2: owner can view the receipt; response is private, non-cacheable and nosniff", async () => {
      const r = await page.request.get(`/api/receipts/${submissionId}`);
      assert(r.status() === 200 && r.headers()["content-type"] === "image/png", `status ${r.status()}`);
      assert(/no-store/.test(r.headers()["cache-control"]) && r.headers()["x-content-type-options"] === "nosniff", JSON.stringify(r.headers()));
    });
    await check("P2: unauthenticated receipt request is refused", async () => {
      const r = await fetch(`${base}/api/receipts/${submissionId}`);
      assert(r.status === 401, `status ${r.status}`);
    });
    await check("P2: API refuses an intent for another student's installment", async () => {
      const r = await page.request.post("/api/receipts/intent", { data: { obligationId: mOnly } });
      assert(r.status() === 404, `status ${r.status()}`);
    });
    await check("P2: API refuses cross-origin intent requests", async () => {
      const r = await page.request.post("/api/receipts/intent", { data: { obligationId: jPast }, headers: { Origin: "https://evil.example" } });
      assert(r.status() === 403, `status ${r.status()}`);
    });
    await check("P2: the direct-upload endpoint rejects a non-image body and no submission is created", async () => {
      const before = (await q(`SELECT count(*)::int n FROM payment_submissions`))[0].n;
      const intent = await (await page.request.post("/api/receipts/intent", { data: { obligationId: jPast } })).json();
      const up = await page.request.put(`/api/receipts/upload/${intent.intentId}`, { data: png() });
      assert(up.status() === 204, `upload status ${up.status()}`);
      // (Replaying an intent against another student's installment is covered by the integration tests.)
      const intent2 = await (await page.request.post("/api/receipts/intent", { data: { obligationId: jPast } })).json();
      const bad = await page.request.put(`/api/receipts/upload/${intent2.intentId}`, { data: Buffer.from("MZ" + "0".repeat(300)) });
      assert(bad.status() === 415, `bad upload status ${bad.status()}`);
      assert((await q(`SELECT count(*)::int n FROM payment_submissions`))[0].n === before, "forged request created a submission");
    });
    await check("P2: history shows the submission with installment, amount, status, reference and receipt link", async () => {
      await page.goto("/student/history");
      const row = await page.locator("tbody tr").first().innerText();
      assert(/Near month/.test(row) && /₱500\.00/.test(row) && /Pending Review/.test(row) && /GC-20260101-0001/.test(row) && /View/.test(row), row);
    });
    await check("P2: notification appears as unread, can be opened and marked read", async () => {
      await page.goto("/student/notifications");
      await page.getByText("Receipt received").waitFor();
      assert((await page.locator(".notif.unread").count()) === 1, "expected one unread");
      await page.click("text=Mark as read");
      await page.waitForFunction(() => document.querySelectorAll(".notif.unread").length === 0, null, { timeout: 10000 });
    });

    const ctx2 = await browser.newContext({ baseURL: base });
    const page2 = await ctx2.newPage();
    await check("P2: another student sees only their own data and cannot fetch Juan's receipt", async () => {
      await login(page2, "maria@example.test", pw);
      const body = await page2.locator("main").innerText();
      assert(/Total counterpart fee\s*₱500\.00/.test(body) && !body.includes("Near month") && !body.includes("Past month"), body);
      const r = await page2.request.get(`/api/receipts/${submissionId}`);
      assert(r.status() === 404, `status ${r.status()}`);
      await page2.goto("/student/history");
      assert(/not submitted any receipts/i.test(await page2.locator("main").innerText()), "history leaked");
      assert((await page2.request.post("/api/receipts/intent", { data: { obligationId: jNear } })).status() === 404, "intent for Juan's installment");
    });
    await check("P2->P3: admin can now read receipts (D-029) but still cannot use the student upload endpoints", async () => {
      const ctx3 = await browser.newContext({ baseURL: base });
      const p3 = await ctx3.newPage();
      await p3.goto("/admin/login");
      await p3.fill("#email", "jean@example.test");
      await p3.fill("#password", "AdminPassw0rd!");
      await p3.click("button[type=submit]");
      await p3.waitForURL("**/admin/dashboard");
      const rr = await p3.request.get(`/api/receipts/${submissionId}`);
      assert(rr.status() === 200 && /no-store/.test(rr.headers()["cache-control"]) && rr.headers()["x-content-type-options"] === "nosniff", `admin receipt read: ${rr.status()}`);
      assert((await p3.request.post("/api/receipts/intent", { data: { obligationId: jNear } })).status() === 401, "admin must not pass the student upload guard");
      await ctx3.close();
    });
    await check("P2: admin received an in-app notification for the new submission (email queued or already sent)", async () => {
      const rows = await q(`SELECT email_status, message FROM notifications n JOIN users u ON u.user_id=n.user_id WHERE u.role='admin'`);
      assert(rows.length >= 1 && ["queued", "sent"].includes(rows[0].email_status) && /Juan Dela Cruz/.test(rows[0].message), JSON.stringify(rows));
    });
    await check("P2: the Phase 1 session security still holds after Phase 2 (logout kills the session)", async () => {
      const old = await ctx2.cookies();
      await page2.goto("/student/dashboard");
      await page2.click("text=Log out");
      await page2.waitForURL("**/login");
      await ctx2.addCookies(old);
      await page2.goto("/student/tracker");
      assert(new URL(page2.url()).pathname === "/login", page2.url());
    });
    await check("P2: server log contains no receipt bytes or reference numbers", async () => {
      assert(!serverLog.includes("GC-20260101-0001") && !serverLog.includes("IHDR"), "sensitive data in server log");
    });
    await ctx2.close();


    // ------------------------------------------------------------------ Phase 3: admin portal and receipt verification
    const adminCtx = await browser.newContext({ baseURL: base });
    const ap = await adminCtx.newPage();
    const adminLogin = async () => {
      await ap.goto("/admin/login");
      await ap.fill("#email", "jean@example.test");
      await ap.fill("#password", "AdminPassw0rd!");
      await ap.click("button[type=submit]");
      await ap.waitForURL("**/admin/dashboard", { timeout: 15000 });
    };
    const rowsOf = async (url: string) => {
      await ap.goto(url);
      return (await ap.locator("table.grid tbody tr").allInnerTexts()) as string[];
    };
    const subCount = async () => (await q(`SELECT count(*)::int n FROM payment_submissions`))[0].n as number;
    const reviewCount = async () => (await q(`SELECT count(*)::int n FROM payment_reviews`))[0].n as number;
    const adminRoutes = (sid: string) => ["/admin/dashboard", "/admin/records", "/admin/schedules", "/admin/notifications", `/admin/submissions/${sid}`, `/admin/students/${juan.user_id}`, `/admin/schedules/${jNear}`];

    await check("P3: unauthenticated requests to every admin page are redirected to the admin login", async () => {
      for (const r of adminRoutes(submissionId)) {
        const res = await fetch(`${base}${r}`, { redirect: "manual" });
        assert(res.status >= 300 && res.status < 400 && new URL(res.headers.get("location")!, base).pathname === "/admin/login", `${r} -> ${res.status} ${res.headers.get("location")}`);
      }
    });
    await check("P3: a logged-in STUDENT is bounced from every admin page to the student dashboard", async () => {
      for (const r of adminRoutes(submissionId)) {
        await page.goto(r);
        assert(new URL(page.url()).pathname === "/student/dashboard", `${r} -> ${page.url()}`);
      }
    });
    await check("P3: a student session cannot read the admin-only data through the receipt API of another student", async () => {
      assert((await page.request.get(`/api/receipts/${randomBytes(16).toString("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5")}`)).status() === 404, "unknown id");
    });

    await check("P3: admin logs in and the dashboard shows real counts from the database", async () => {
      await adminLogin();
      const stats = await ap.locator(".stats").innerText();
      assert(/Total submissions\s*1/.test(stats) && /Pending receipt reviews\s*1/.test(stats) && /Verified submissions\s*0/.test(stats), stats);
      assert(/Needing correction\s*0/.test(stats) && /Rejected submissions\s*0/.test(stats), stats);
      assert(/Student payment records\s*4/.test(stats) && /Overdue installments\s*1/.test(stats) && /Unread notifications\s*1/.test(stats), stats);
      const body = await ap.locator("main").innerText();
      assert(/Receipts waiting for review/.test(body) && body.includes("Juan Dela Cruz") && body.includes("Near month"), "pending queue / upcoming");
      assert(/Upcoming deadlines[^\n]*\n[\s\S]*Maria month/.test(body), "upcoming deadlines should list Maria's installment due in 5 days");
    });

    await check("P3: search by name and by student ID", async () => {
      assert((await rowsOf("/admin/records?q=juan")).length === 3, "juan rows");
      const maria1 = await rowsOf("/admin/records?q=2024-0099");
      assert(maria1.length === 1 && maria1[0].includes("Maria Santos"), maria1.join("|"));
    });
    await check("P3: combined filters narrow results; empty results show a message", async () => {
      const hit = await rowsOf("/admin/records?submission=pending_review&yearLevel=2&month=" + day(10).slice(0, 7));
      // Near month may fall in the next calendar month; accept either 1 (same month) or 0 and then verify without the month filter.
      const hit2 = await rowsOf("/admin/records?submission=pending_review&yearLevel=2");
      assert(hit2.length === 1 && hit2[0].includes("Near month") && hit2[0].includes("Pending Review"), hit2.join("|"));
      assert(hit.length <= 1, "month narrowing");
      await ap.goto("/admin/records?submission=pending_review&yearLevel=1");
      await ap.getByText("No records match these filters.").waitFor();
      await ap.goto("/admin/records?installment=overdue");
      assert((await ap.locator("table.grid tbody tr").count()) === 1, "overdue filter");
    });
    await check("P3: sorting by student name works through the column links; invalid filter input is reported, not trusted", async () => {
      const before = await subCount();
      await ap.goto("/admin/records?sort=student_name&dir=asc");
      assert((await ap.locator("table.grid tbody tr").first().innerText()).includes("Juan"), "asc");
      await ap.goto("/admin/records?sort=student_name&dir=desc");
      assert((await ap.locator("table.grid tbody tr").first().innerText()).includes("Maria"), "desc");
      await ap.goto("/admin/records?yearLevel=99&sort=password");
      await ap.getByText(/Some filters were ignored/).waitFor();
      await ap.goto("/admin/records?q=%27%3B%20DROP%20TABLE%20users%3B%20--");
      await ap.getByText("No records match these filters.").waitFor();
      assert((await q(`SELECT count(*)::int n FROM users`))[0].n >= 3 && (await subCount()) === before, "filters changed data");
    });

    await check("P3: the review screen shows the full submission and the receipt (admin-authorized)", async () => {
      await ap.goto(`/admin/submissions/${submissionId}`);
      const body = await ap.locator("main").innerText();
      for (const t of ["Juan Dela Cruz", "2024-0001", "Near month", "₱500.00", "GCash", "GC-20260101-0001", "Pending Review", "Pending Verification"]) assert(body.includes(t), `missing ${t}`);
      const src = await ap.locator("img.receipt-frame").getAttribute("src");
      assert(src === `/api/receipts/${submissionId}` && !/^https?:/.test(src!), `receipt src ${src}`);
      const r = await ap.request.get(src!);
      assert(r.status() === 200 && r.headers()["content-type"] === "image/png", `receipt ${r.status()}`);
    });

    await check("P3: requesting a correction without remarks is refused and nothing is saved", async () => {
      await ap.click("text=Request correction");
      await ap.getByText(/Explain what the student needs to correct/).waitFor({ timeout: 10000 });
      const st = (await q(`SELECT status FROM payment_submissions WHERE submission_id=$1`, [submissionId]))[0].status;
      assert(st === "pending_review" && (await reviewCount()) === 0, `status ${st}`);
    });
    await check("P3: requesting a correction with remarks saves the decision, the review row and notifies the student", async () => {
      await ap.fill("#remarks", "Please upload the full screenshot including the reference number.");
      await ap.click("text=Request correction");
      await ap.getByText(/Decision saved: Needs Correction/).waitFor({ timeout: 15000 });
      const [s] = await q(`SELECT status, remarks, reviewed_at FROM payment_submissions WHERE submission_id=$1`, [submissionId]);
      assert(s.status === "needs_correction" && /full screenshot/.test(s.remarks) && s.reviewed_at, JSON.stringify(s));
      const rv = await q(`SELECT decision, admin_id, remarks FROM payment_reviews WHERE submission_id=$1`, [submissionId]);
      const [adm] = await q(`SELECT user_id FROM users WHERE role='admin'`);
      assert(rv.length === 1 && rv[0].decision === "needs_correction" && rv[0].admin_id === adm.user_id, JSON.stringify(rv));
      assert((await ap.locator("#remarks").count()) === 0, "review form must disappear after the decision");
    });
    await check("P3: the student sees the notification, the remarks and Requires Resubmission; nothing counted as paid", async () => {
      await page.goto("/student/notifications");
      await page.getByText("Correction requested").waitFor();
      await page.goto("/student/history");
      const row = await page.locator("tbody tr").first().innerText();
      assert(/Needs Correction/.test(row) && /full screenshot/.test(row), row);
      await page.goto("/student/tracker");
      assert((await page.locator("tbody tr").allInnerTexts()).some((r: string) => r.includes("Near month") && r.includes("Requires Resubmission")), "tracker");
      await page.goto("/student/dashboard");
      assert(/Total verified payments\s*₱0\.00/.test(await page.locator(".stats").innerText()), "counted as paid");
    });

    let secondId = "";
    await check("P3: the student submits a replacement; the old submission stays in history and is linked", async () => {
      await page.goto(`/student/submit?obligation=${jNear}`);
      await page.fill("#paymentDate", day(0));
      await page.selectOption("#paymentMethod", "gcash");
      await page.setInputFiles("#receipt", { name: "again.png", mimeType: "image/png", buffer: png() });
      await page.fill("#referenceNumber", "GC-20260101-0002");
      await page.click("#submitReceipt");
      await page.waitForURL("**/student/history**", { timeout: 20000 });
      const rows = await q(`SELECT submission_id, status, previous_submission_id FROM payment_submissions ORDER BY submitted_at`);
      assert(rows.length === 2 && rows[0].status === "needs_correction" && rows[1].status === "pending_review" && rows[1].previous_submission_id === rows[0].submission_id, JSON.stringify(rows));
      secondId = rows[1].submission_id;
      assert((await page.locator("tbody tr").count()) === 2, "history rows");
    });
    await check("P3: the review screen shows the previous attempt and its decision in the history", async () => {
      await ap.goto(`/admin/submissions/${secondId}`);
      const body = await ap.locator("main").innerText();
      assert(/Submission history/.test(body) && /Needs Correction by Miss Jean/.test(body) && /full screenshot/.test(body), body);
    });
    await check("P3: verifying the replacement marks it Verified and the student's paid total becomes ₱500", async () => {
      await ap.click("text=Verify payment");
      await ap.getByText(/Decision saved: Verified/).waitFor({ timeout: 15000 });
      assert((await q(`SELECT status FROM payment_submissions WHERE submission_id=$1`, [secondId]))[0].status === "verified", "status");
      await page.goto("/student/dashboard");
      const stats = await page.locator(".stats").innerText();
      assert(/Total verified payments\s*₱500\.00/.test(stats) && /Remaining balance\s*₱1,000\.00/.test(stats), stats);
      await page.goto("/student/notifications");
      await page.getByText("Payment verified").waitFor();
    });
    await check("P3: a verified or already-reviewed submission offers no review form and cannot be re-decided", async () => {
      for (const id of [secondId, submissionId]) {
        await ap.goto(`/admin/submissions/${id}`);
        assert((await ap.locator("#remarks").count()) === 0 && /already been reviewed/.test(await ap.locator("main").innerText()), "form still offered");
      }
      assert((await reviewCount()) === 2, "review rows");
    });

    await check("P3: rejection requires a reason; a valid rejection keeps the submission and is not counted as paid", async () => {
      await page.goto(`/student/submit?obligation=${jPast}`);
      await page.fill("#paymentDate", day(0));
      await page.selectOption("#paymentMethod", "maya");
      await page.setInputFiles("#receipt", { name: "x.png", mimeType: "image/png", buffer: png() });
      await page.click("#submitReceipt");
      await page.waitForURL("**/student/history**", { timeout: 20000 });
      const [{ submission_id: rid }] = await q(`SELECT submission_id FROM payment_submissions WHERE obligation_id=$1`, [jPast]);
      await ap.goto(`/admin/submissions/${rid}`);
      await ap.getByRole("button", { name: "Reject" }).click();
      await ap.getByText(/Enter the reason for rejecting/).waitFor({ timeout: 10000 });
      assert((await q(`SELECT status FROM payment_submissions WHERE submission_id=$1`, [rid]))[0].status === "pending_review", "saved without a reason");
      await ap.fill("#remarks", "This screenshot is not a payment to the school.");
      await ap.getByRole("button", { name: "Reject" }).click();
      await ap.getByText(/Decision saved: Rejected/).waitFor({ timeout: 15000 });
      assert((await q(`SELECT status, remarks FROM payment_submissions WHERE submission_id=$1`, [rid]))[0].status === "rejected", "status");
      await page.goto("/student/history");
      assert((await page.locator("tbody tr").allInnerTexts()).some((r: string) => /Rejected/.test(r) && /not a payment to the school/.test(r)), "student view");
      await page.goto("/student/dashboard");
      assert(/Total verified payments\s*₱500\.00/.test(await page.locator(".stats").innerText()), "rejection changed the paid total");
      assert((await rowsOf(`/admin/records?installment=overdue`)).length === 1, "rejected past-due installment is Overdue again");
    });

    await check("P3: admin dashboard counts follow the new data", async () => {
      await ap.goto("/admin/dashboard");
      const stats = await ap.locator(".stats").innerText();
      assert(/Total submissions\s*3/.test(stats) && /Pending receipt reviews\s*0/.test(stats) && /Verified submissions\s*1/.test(stats) && /Needing correction\s*1/.test(stats) && /Rejected submissions\s*1/.test(stats), stats);
    });

    await check("P3: admin notifications list new receipts and can be marked read", async () => {
      await ap.goto("/admin/notifications");
      await ap.getByText("New receipt to review").first().waitFor();
      await ap.click("text=Mark all as read");
      await ap.waitForFunction(() => document.querySelectorAll(".notif.unread").length === 0, null, { timeout: 10000 });
      assert((await q(`SELECT count(*)::int n FROM notifications n JOIN users u ON u.user_id=n.user_id WHERE u.role='admin' AND n.is_read=false`))[0].n === 0, "still unread");
    });

    await check("P3: schedule creation works from the UI and a duplicate is refused", async () => {
      await ap.goto("/admin/schedules");
      const fill = async () => {
        await ap.fill("#academicYear", "2027-2028");
        await ap.fill("#periodLabel", "Browser month");
        await ap.fill("#dueDate", day(120));
        await ap.fill("#amount", "500.00");
        await ap.selectOption("#scope", "all");
        await ap.click("text=Create installment");
      };
      await fill();
      await ap.getByText(/Installment created for 2 students/).waitFor({ timeout: 15000 });
      assert((await q(`SELECT count(*)::int n FROM payment_obligations WHERE period_label='Browser month' AND amount_due=500.00`))[0].n === 2, "rows");
      await ap.goto("/admin/schedules");
      await fill();
      await ap.getByText(/already has this installment period/).waitFor({ timeout: 15000 });
      assert((await q(`SELECT count(*)::int n FROM payment_obligations WHERE period_label='Browser month'`))[0].n === 2, "duplicate created");
      await page.goto("/student/tracker");
      assert((await page.locator("tbody tr").allInnerTexts()).some((r: string) => r.includes("Browser month")), "student does not see the new installment");
    });
    await check("P3: editing a schedule works; a Paid installment is locked in the UI and on the server", async () => {
      const [{ obligation_id: bm }] = await q(`SELECT obligation_id FROM payment_obligations WHERE period_label='Browser month' AND student_id=$1`, [maria.user_id]);
      await ap.goto(`/admin/schedules/${bm}`);
      await ap.fill("#dueDate", day(130));
      await ap.click("text=Save changes");
      await ap.getByText(/The change was saved and recorded/).waitFor({ timeout: 15000 });
      assert((await q(`SELECT due_date::text d FROM payment_obligations WHERE obligation_id=$1`, [bm]))[0].d === day(130), "due date");
      assert((await q(`SELECT count(*)::int n FROM admin_audit_events WHERE action='obligation_updated'`))[0].n === 1, "audit");
      await ap.goto(`/admin/schedules/${jNear}`);
      assert((await ap.locator("form[aria-label='Edit installment']").count()) === 0 && /Paid/.test(await ap.locator("main").innerText()), "paid installment is editable");
    });

    await check("P3: admin receipt access is private (no-store) and the old admin session dies at logout", async () => {
      const r = await ap.request.get(`/api/receipts/${secondId}`);
      assert(r.status() === 200 && /no-store/.test(r.headers()["cache-control"]), "receipt headers");
      assert((await fetch(`${base}/api/receipts/${secondId}`)).status === 401, "unauthenticated receipt");
      const old = await adminCtx.cookies();
      await ap.click("text=Log out");
      await ap.waitForURL("**/admin/login");
      await adminCtx.addCookies(old);
      await ap.goto("/admin/dashboard");
      assert(new URL(ap.url()).pathname === "/admin/login", "replayed admin cookie accepted: " + ap.url());
    });
    await check("P3: server log contains no receipt bytes, references or remarks", async () => {
      assert(!serverLog.includes("GC-20260101-0002") && !serverLog.includes("IHDR") && !serverLog.includes("full screenshot"), "sensitive data in server log");
    });
    await adminCtx.close();

    // ===================================================================== Phase 4: emails, retry, reminders, cron
    const waitFor = async (cond: () => Promise<boolean> | boolean, what: string, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await cond()) return;
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error("timed out waiting for " + what);
    };
    const ctx4 = await browser.newContext({ baseURL: base });
    const a4 = await ctx4.newPage();
    await a4.goto("/admin/login");
    await a4.fill("#email", "jean@example.test");
    await a4.fill("#password", "AdminPassw0rd!");
    await a4.click("button[type=submit]");
    await a4.waitForURL("**/admin/dashboard", { timeout: 15000 });

    await check("P4: the administrator was emailed about the new receipts (link to the review page, no reference number, idempotency key sent)", async () => {
      await waitFor(() => mails.some((m) => m.to[0] === "jean@example.test"), "admin email");
      const m = mails.filter((x) => x.to[0] === "jean@example.test");
      assert(m.some((x) => /New receipt to review/.test(x.subject)), m.map((x) => x.subject).join("|"));
      assert(m.every((x) => /https:\/\/pnpay\.example\.test\/admin\/submissions\//.test(x.text)), "review link");
      assert(m.every((x) => !x.text.includes("GC-20260101-0002") && !x.html.includes("GC-20260101-0002")), "reference number leaked into email");
      assert(m.every((x) => /^pnpay-notif-[0-9a-f-]{36}-r0$/.test(x.idem ?? "")), "idempotency key: " + m.map((x) => x.idem).join(","));
    });
    await check("P4: the student was emailed the correction, verification and rejection results - without the admin's remarks", async () => {
      await waitFor(() => ["Correction requested", "Payment verified", "Receipt rejected"].every((t) => mails.some((m) => m.to[0] === "juan@example.test" && m.subject.includes(t))), "student review emails");
      const remarks = (await q(`SELECT remarks FROM payment_reviews WHERE remarks IS NOT NULL AND remarks <> ''`)).map((r) => r.remarks as string);
      assert(remarks.length >= 2, "expected remarks in the database");
      const juanMails = mails.filter((m) => m.to[0] === "juan@example.test" && !/Verify your/.test(m.subject));
      for (const m of juanMails) for (const r of remarks) assert(!(m.text + m.html).includes(r), "remarks leaked into an email");
      assert((await q(`SELECT count(*)::int n FROM notifications WHERE email_pending=true`))[0].n === 0, "queue should be empty after delivery");
    });
    await check("P4: every notification email was delivered exactly once", async () => {
      const dupes = await q(`SELECT notification_id, count(*)::int n FROM email_deliveries WHERE status='sent' AND notification_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1`);
      assert(dupes.length === 0, JSON.stringify(dupes));
    });

    await check("P4: a provider outage does not break the page; the failed email shows in the admin screen and can be retried", async () => {
      await q(`INSERT INTO notifications (user_id, type, title, message, email_pending, email_status, email_next_attempt_at)
               SELECT user_id, 'payment_reminder', 'Payment due soon', 'Outage test notification.', true, 'queued', now() FROM users WHERE email='maria@example.test'`);
      mockMode = "permanent";
      await a4.goto("/admin/email");
      await a4.click("text=Send waiting emails now");
      await a4.getByText("Outage test").or(a4.getByText("Payment reminder")).first().waitFor({ timeout: 15000 });
      const body = await a4.locator("main").innerText();
      assert(/Failed/.test(body) && /Retry/.test(body) && body.includes("Maria Santos") && !body.includes("maria@example.test"), body.slice(0, 600));
      assert(mockRejected >= 1, "provider was not contacted");
      await a4.goto("/admin/dashboard");
      assert(/Emails needing attention\s*1/.test(await a4.locator(".stats").innerText()), "dashboard badge");
      mockMode = "ok";
      const before = mails.length;
      await a4.goto("/admin/email");
      await a4.getByRole("button", { name: "Retry", exact: true }).first().click();
      await a4.getByText(/queued for another attempt/).waitFor({ timeout: 15000 });
      await waitFor(() => mails.length > before, "retried email");
      await waitFor(async () => (await q(`SELECT count(*)::int n FROM notifications WHERE email_status='failed'`))[0].n === 0, "failed cleared");
      assert(mails.filter((m) => /Payment due soon/.test(m.subject) && m.to[0] === "maria@example.test").length === 1, "retried exactly once");
    });

    await check("P4: scheduled-job routes require the cron secret and only accept GET", async () => {
      const url = `${base}/api/cron/daily`;
      assert((await fetch(url)).status === 401, "no secret");
      assert((await fetch(url, { headers: { authorization: "Bearer wrong" } })).status === 401, "wrong secret");
      assert((await fetch(url, { method: "POST", headers: { authorization: "Bearer e2e-cron-secret-e2e-cron-secret-0123456789" } })).status === 405, "POST");
      for (const j of ["reminders", "email", "cleanup"]) assert((await fetch(`${base}/api/cron/${j}`)).status === 401, j);
    });
    await check("P4: the daily job creates each reminder once, queues the email, and the student sees it with a link to the installment", async () => {
      const auth = { authorization: "Bearer e2e-cron-secret-e2e-cron-secret-0123456789" };
      const r1 = await (await fetch(`${base}/api/cron/daily`, { headers: auth })).json();
      assert(r1.reminders?.ok === true && r1.reminders.summary.dueSoonCreated >= 1, JSON.stringify(r1));
      assert((await q(`SELECT count(*)::int n FROM payment_reminders WHERE obligation_id=$1 AND kind='due_soon'`, [mOnly]))[0].n === 1, "reminder row");
      const r2 = await (await fetch(`${base}/api/cron/daily`, { headers: auth })).json();
      assert(r2.reminders.summary.dueSoonCreated === 0, "second run must not create reminders: " + JSON.stringify(r2));
      assert((await q(`SELECT count(*)::int n FROM payment_reminders WHERE obligation_id=$1`, [mOnly]))[0].n === 1, "duplicate reminder row");
      assert((await q(`SELECT count(*)::int n FROM notifications WHERE obligation_id=$1 AND type='payment_reminder'`, [mOnly]))[0].n === 1, "duplicate notification");
      await waitFor(() => mails.some((m) => m.to[0] === "maria@example.test" && /Maria month/.test(m.text)), "reminder email");
      assert(mails.filter((m) => m.to[0] === "maria@example.test" && /Maria month/.test(m.text)).length === 1, "reminder emailed more than once");
      const mctx = await browser.newContext({ baseURL: base });
      const mp = await mctx.newPage();
      await login(mp, "maria@example.test", pw);
      await mp.goto("/student/notifications");
      await mp.getByText("Payment due soon").first().waitFor();
      const href = await mp.locator(`a[href*="/student/tracker#o-${mOnly}"]`).first().getAttribute("href");
      assert(Boolean(href), "no link to the installment");
      await mp.goto(href!);
      assert((await mp.locator(`#o-${mOnly}`).count()) === 1, "anchor missing in the tracker");
      // Another student's reminder is not visible to Maria, and Juan has none for Maria's installment.
      assert(!(await mp.content()).includes("Juan Dela Cruz"), "other student's data");
      await mctx.close();
      const jr = await q(`SELECT count(*)::int n FROM job_runs WHERE ok=true`);
      assert(jr[0].n >= 6, "job runs not recorded");
    });
    await check("P4: the email admin screen is administrator-only and shows the scheduled-job log", async () => {
      await a4.goto("/admin/email");
      assert(/Payment reminders/.test(await a4.locator("main").innerText()), "job log");
      const anon = await browser.newContext({ baseURL: base });
      const ap2 = await anon.newPage();
      await ap2.goto("/admin/email");
      assert(new URL(ap2.url()).pathname === "/admin/login", ap2.url());
      await login(ap2, "maria@example.test", pw);
      await ap2.goto("/admin/email");
      assert(new URL(ap2.url()).pathname === "/student/dashboard", "student reached the admin email page: " + ap2.url());
      await anon.close();
    });
    await check("P4: the error query parameter cannot inject text into the admin screen", async () => {
      await a4.goto("/admin/email?error=Call+555-0100+to+unlock+your+account");
      const body = await a4.locator("main").innerText();
      assert(!body.includes("555-0100"), "arbitrary text reflected");
    });
    await check("P4: baseline Content-Security-Policy directives are sent", async () => {
      const csp = (await fetch(`${base}/login`)).headers.get("content-security-policy") ?? "";
      assert(/frame-ancestors 'none'/.test(csp) && /form-action 'self'/.test(csp) && /object-src 'none'/.test(csp), csp);
    });
    await check("P4: the server log contains no cron secret, email bodies, remarks or idempotency keys", async () => {
      assert(!serverLog.includes("e2e-cron-secret") && !serverLog.includes("pnpay-notif-") && !serverLog.includes("Outage test") && !serverLog.includes("blurry"), "sensitive data in server log");
    });
    await ctx4.close();

    await browser.close();
  } finally {
    server.kill("SIGTERM");
    mock.close();
    await pool.end();
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nE2E: ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
