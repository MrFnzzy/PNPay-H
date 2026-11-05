import { z } from "zod";
import { addDays, isRealDate } from "./dates";

export const PAYMENT_METHODS = [
  { value: "gcash", label: "GCash" },
  { value: "maya", label: "Maya" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other payment app" },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];
export const paymentMethodLabel = (v: string) => PAYMENT_METHODS.find((m) => m.value === v)?.label ?? v;

/** Recommended, not required (D-016). When given: 6-40 letters/digits (spaces and dashes allowed, stripped for comparison). */
export function normalizeReference(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export const MAX_PAYMENT_AGE_DAYS = 366;

export function submissionSchema(today: string) {
  return z.object({
    obligationId: z.string().uuid("Select a valid installment."),
    intentId: z.string().uuid("Upload your receipt screenshot first."),
    paymentDate: z
      .string()
      .refine(isRealDate, "Enter a valid payment date.")
      .refine((d) => d <= today, "The payment date cannot be in the future.")
      .refine((d) => d >= addDays(today, -MAX_PAYMENT_AGE_DAYS), "The payment date is too far in the past."),
    paymentMethod: z.enum(["gcash", "maya", "bank_transfer", "other"], { errorMap: () => ({ message: "Select a payment method." }) }),
    referenceNumber: z
      .string()
      .trim()
      .max(60)
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => v === undefined || /^[A-Za-z0-9 -]+$/.test(v), "The reference number may contain only letters, numbers, spaces and dashes.")
      .refine((v) => v === undefined || (normalizeReference(v).length >= 6 && normalizeReference(v).length <= 40), "The reference number must be 6 to 40 characters."),
  });
}
export type SubmissionInput = z.infer<ReturnType<typeof submissionSchema>>;
