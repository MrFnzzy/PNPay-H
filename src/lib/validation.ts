import { z } from "zod";
import { isBatch } from "@/lib/batches";

export const PASSWORD_RULES = "At least 10 characters, with an uppercase letter, a lowercase letter and a number.";

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(128, "Password must be at most 128 characters.")
  .refine((v) => /[a-z]/.test(v), "Password needs a lowercase letter.")
  .refine((v) => /[A-Z]/.test(v), "Password needs an uppercase letter.")
  .refine((v) => /[0-9]/.test(v), "Password needs a number.");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long.")
  .email("Enter a valid email address.");

export const fullNameSchema = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(2, "Enter your full name.").max(150, "Name is too long."));

export const studentIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{2,29}$/, "Student ID must be 3-30 letters, numbers or dashes.");

/**
 * Registration input. NOTE: there is deliberately no `role` field. Unknown keys
 * (including a submitted `role`) are stripped by zod and never reach the database layer.
 */
export const registerSchema = z
  .object({
    fullName: fullNameSchema,
    studentId: studentIdSchema,
    email: emailSchema,
    course: z
      .string()
      .trim()
      .max(100, "Course is too long.")
      .optional()
      .transform((v) => (v ? v : undefined)),
    batch: z.string().trim().refine(isBatch, "Select a valid yearly batch."),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(128),
});

export const resendSchema = z.object({ email: emailSchema });

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
