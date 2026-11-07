import type { ReactNode } from "react";
import PortalShell from "@/components/PortalShell";
import { requireRole } from "@/lib/auth/session";

/** Every student page: server-side role guard, then data scoped to the session user. Never takes a student id from the URL. */
export async function loadStudent(_options: { includeUnread?: boolean } = {}) {
  const user = await requireRole("student");
  return { user, unread: user.unread }; // the unread count arrives with the session query: no extra round trip
}

export default function StudentPage({ name, unread, children }: { name: string; unread: number; children: ReactNode }) {
  return (
    <PortalShell portal="student" name={name} unread={unread}>
      {children}
    </PortalShell>
  );
}
