/** Money is numeric(10,2) in the database; arithmetic here is done in integer centavos. */
export const toCents = (v: string | number): number => Math.round(Number(v) * 100);

export function formatPeso(cents: number): string {
  return "₱" + (cents / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Standard monthly installment under the current payment policy (LLD 8.3). It is only the DEFAULT offered when an
 * administrator creates a schedule and the amount that needs no justification note; it is never used to compute
 * totals (those always come from the stored installment amounts).
 */
export const STANDARD_INSTALLMENT_AMOUNT = "500.00";
