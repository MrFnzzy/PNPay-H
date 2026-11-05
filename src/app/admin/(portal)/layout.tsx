import { requireRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Layout-level guard; every page/action inside must ALSO call requireRole("admin").
export default async function AdminPortalLayout({ children }: { children: React.ReactNode }) {
  await requireRole("admin");
  return children;
}
