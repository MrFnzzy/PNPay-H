import net from "node:net";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { classifySmtpError, resetSmtpTransportForTests, sendViaProvider } from "@/lib/email";
import { getEnv, resetEnvCacheForTests } from "@/lib/env";

/** Minimal SMTP server (EHLO, AUTH PLAIN, MAIL, RCPT, DATA, QUIT) so the real Nodemailer transport is exercised. */
function fakeSmtp(opts: { rcptReply?: string; dataReply?: string; authReply?: string } = {}) {
  const messages: { from: string; to: string[]; data: string; authed: boolean }[] = [];
  const server = net.createServer((sock) => {
    let buf = "";
    let inData = false;
    let authed = false;
    let cur = { from: "", to: [] as string[], data: "" };
    const send = (l: string) => sock.write(l + "\r\n");
    send("220 fake ESMTP");
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end === -1) return;
          cur.data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          const reply = opts.dataReply ?? "250 queued";
          if (reply.startsWith("250")) messages.push({ ...cur, authed });
          cur = { from: "", to: [], data: "" };
          send(reply);
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl === -1) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const up = line.toUpperCase();
        if (up.startsWith("EHLO") || up.startsWith("HELO")) { sock.write("250-fake\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n"); }
        else if (up.startsWith("AUTH PLAIN")) {
          const reply = opts.authReply ?? "235 ok";
          authed = reply.startsWith("235");
          send(reply);
        }
        else if (up.startsWith("MAIL FROM")) { cur.from = line; send("250 ok"); }
        else if (up.startsWith("RCPT TO")) {
          const reply = opts.rcptReply ?? "250 ok";
          if (reply.startsWith("250")) cur.to.push(line);
          send(reply);
        }
        else if (up === "DATA") { inData = true; send("354 go"); }
        else if (up === "QUIT") { send("221 bye"); sock.end(); }
        else if (up === "RSET") send("250 ok");
        else send("250 ok");
      }
    });
    sock.on("error", () => {});
  });
  return new Promise<{ port: number; messages: typeof messages; close: () => Promise<void> }>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ port: (server.address() as net.AddressInfo).port, messages, close: () => new Promise((r) => { server.close(() => r()); (server as net.Server & { closeAllConnections?: () => void }).closeAllConnections?.(); }) }),
    ),
  );
}

const KEYS = ["EMAIL_PROVIDER", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS"] as const;
function useSmtp(port: number) {
  Object.assign(process.env, { EMAIL_PROVIDER: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_SECURE: "false", SMTP_USER: "sender@example.com", SMTP_PASS: "app-password" });
  resetEnvCacheForTests();
  resetSmtpTransportForTests();
}
beforeAll(() => resetEnvCacheForTests());
afterEach(() => {
  for (const k of KEYS) delete process.env[k];
  process.env.EMAIL_PROVIDER = "memory";
  resetEnvCacheForTests();
  resetSmtpTransportForTests();
});

const mail = { to: "student@example.com", subject: "PNPay-H: Payment verified", text: "Hello there", html: "<p>Hello there</p>" };

describe("SMTP (Nodemailer) email provider", () => {
  it("delivers a message through a real SMTP conversation with authentication", async () => {
    const smtp = await fakeSmtp();
    try {
      useSmtp(smtp.port);
      await sendViaProvider(mail);
      expect(smtp.messages).toHaveLength(1);
      expect(smtp.messages[0].authed).toBe(true);
      expect(smtp.messages[0].to[0]).toContain("student@example.com");
      expect(smtp.messages[0].data).toContain("Subject: PNPay-H: Payment verified");
    } finally {
      await smtp.close();
    }
  });

  it("a 5xx recipient rejection is permanent; a 4xx reply is retryable; bad credentials are permanent", async () => {
    for (const [opts, retryable] of [
      [{ rcptReply: "550 no such user" }, false],
      [{ dataReply: "451 try later" }, true],
      [{ authReply: "535 bad credentials" }, false],
    ] as const) {
      const smtp = await fakeSmtp(opts);
      try {
        useSmtp(smtp.port);
        const err = await sendViaProvider(mail).then(() => null, (e) => e);
        expect(err, JSON.stringify(opts)).toMatchObject({ name: "EmailSendError", retryable });
        expect(err.message).not.toContain("student@example.com"); // server text/addresses are never copied into errors
        expect(err.message).not.toContain("app-password");
      } finally {
        await smtp.close();
      }
    }
  });

  it("an unreachable server is a retryable failure", async () => {
    const smtp = await fakeSmtp();
    const port = smtp.port;
    await smtp.close();
    useSmtp(port);
    await expect(sendViaProvider(mail)).rejects.toMatchObject({ name: "EmailSendError", retryable: true });
  });

  it("classification helper", () => {
    expect(classifySmtpError({ code: "EAUTH" }).retryable).toBe(false);
    expect(classifySmtpError({ code: "EENVELOPE" }).retryable).toBe(false);
    expect(classifySmtpError({ code: "ETIMEDOUT" }).retryable).toBe(true);
    expect(classifySmtpError({ code: "EMESSAGE", responseCode: 554 }).retryable).toBe(false);
    expect(classifySmtpError({ code: "EMESSAGE", responseCode: 421 }).retryable).toBe(true);
  });

  it("configuration: smtp needs host/user/password; production accepts smtp and still refuses file/memory", () => {
    const base = { DATABASE_URL: "postgresql://x", AUTH_SECRET: "s".repeat(40), APP_BASE_URL: "https://x.example", EMAIL_PROVIDER: "smtp" };
    const run = (extra: Record<string, string>) => {
      const saved = { ...process.env };
      for (const k of [...KEYS, "NODE_ENV", "RECEIPT_STORAGE", "BLOB_READ_WRITE_TOKEN"]) delete process.env[k];
      Object.assign(process.env, base, extra);
      resetEnvCacheForTests();
      try {
        return getEnv();
      } finally {
        for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
        Object.assign(process.env, saved);
        resetEnvCacheForTests();
      }
    };
    expect(() => run({})).toThrow(/SMTP_HOST is required.*SMTP_USER is required.*SMTP_PASS is required/);
    expect(run({ SMTP_HOST: "smtp.gmail.com", SMTP_USER: "a@gmail.com", SMTP_PASS: "x" })).toMatchObject({ SMTP_PORT: 465, SMTP_SECURE: "true" });
    expect(() => run({ EMAIL_PROVIDER: "file", NODE_ENV: "production", RECEIPT_STORAGE: "vercel-blob", BLOB_READ_WRITE_TOKEN: "t" })).toThrow(/'resend' or 'smtp'/);
    expect(run({ NODE_ENV: "production", RECEIPT_STORAGE: "vercel-blob", BLOB_READ_WRITE_TOKEN: "t", SMTP_HOST: "smtp.gmail.com", SMTP_USER: "a@gmail.com", SMTP_PASS: "x" }).EMAIL_PROVIDER).toBe("smtp");
  });
});
