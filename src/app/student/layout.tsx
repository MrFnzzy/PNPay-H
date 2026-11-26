import { requireRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Layout-level guard; every page/action inside must ALSO call requireRole("student").
export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  await requireRole("student");
  return children;
}
