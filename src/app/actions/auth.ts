"use server";

import { redirect } from "next/navigation";
import { authenticate, DuplicateError, homeFor, registerStudent, resendVerification, verifyEmailToken, type Role, type VerifyOutcome } from "@/lib/auth/service";
import { clientIp, endSession, startSession } from "@/lib/auth/session";
import { toSafeMessage } from "@/lib/errors";
import { fieldErrors, loginSchema, registerSchema, resendSchema } from "@/lib/validation";

export interface FormState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");

export async function registerAction(_prev: FormState, fd: FormData): Promise<FormState> {
  // Echo back everything except passwords. A submitted "role" is ignored by the schema.
  const values = { fullName: str(fd, "fullName"), studentId: str(fd, "studentId"), email: str(fd, "email"), course: str(fd, "course"), yearLevel: str(fd, "yearLevel") };
  const parsed = registerSchema.safeParse({ ...values, password: str(fd, "password"), confirmPassword: str(fd, "confirmPassword") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  try {
    const result = await registerStudent(parsed.data, await clientIp());
    return {
      ok: true,
      message: result.emailSent
        ? "Account created. We sent a verification link to your email. You must verify your email before you can log in."
        : "Account created, but we could not send the verification email. Use \"Resend verification email\" to try again.",
    };
  } catch (err) {
    if (err instanceof DuplicateError) return { fieldErrors: { [err.field]: err.message }, values };
    return { message: toSafeMessage(err), values };
  }
}

async function login(fd: FormData, role: Role): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: str(fd, "email"), password: str(fd, "password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: { email: str(fd, "email") } };
  const values = { email: parsed.data.email };
  try {
    const res = await authenticate(parsed.data.email, parsed.data.password, role, await clientIp());
    if (!res.ok) {
      const message =
        res.reason === "unverified"
          ? "Please verify your email address before logging in. You can request a new verification email."
          : res.reason === "rate_limited"
            ? "Too many failed attempts. Please wait a few minutes and try again."
            : "Invalid email or password.";
      return { message, values };
    }
    await startSession(res.userId, res.role);
  } catch (err) {
    return { message: toSafeMessage(err), values };
  }
  redirect(homeFor(role));
}

export const loginStudentAction = async (_p: FormState, fd: FormData) => login(fd, "student");
export const loginAdminAction = async (_p: FormState, fd: FormData) => login(fd, "admin");

export async function logoutAction(formData: FormData) {
  await endSession();
  redirect(formData.get("portal") === "admin" ? "/admin/login" : "/login");
}

export async function resendAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = resendSchema.safeParse({ email: str(fd, "email") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: { email: str(fd, "email") } };
  try {
    const { limited } = await resendVerification(parsed.data.email, await clientIp());
    if (limited) return { message: "Too many requests. Please wait before requesting another email.", values: { email: parsed.data.email } };
    // Same response whether or not the account exists.
    return { ok: true, message: "If an unverified account exists for that email, a new verification link has been sent." };
  } catch (err) {
    return { message: toSafeMessage(err) };
  }
}

export interface VerifyState {
  outcome?: VerifyOutcome;
}

export async function verifyEmailAction(_prev: VerifyState, fd: FormData): Promise<VerifyState> {
  try {
    return { outcome: await verifyEmailToken(str(fd, "token")) };
  } catch (err) {
    toSafeMessage(err);
    return { outcome: "invalid" };
  }
}
