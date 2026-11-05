/** Student batches (graduating class). Alumni = already graduated. Each batch pays PLAN_MONTHS monthly installments (2 years). */
export const BATCHES = ["2026", "2027", "alumni"] as const;
export type Batch = (typeof BATCHES)[number];
export const PLAN_MONTHS = 24;

export const BATCH_LABEL: Record<Batch, string> = { "2026": "Batch 2026", "2027": "Batch 2027", alumni: "Alumni" };
export const isBatch = (v: unknown): v is Batch => typeof v === "string" && (BATCHES as readonly string[]).includes(v);
export const batchLabel = (v: string | null | undefined) => (isBatch(v) ? BATCH_LABEL[v] : "—");
