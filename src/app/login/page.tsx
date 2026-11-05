import { redirect } from "next/navigation";
import AuthCard from "@/components/AuthCard";
import LoginForm from "@/components/LoginForm";
import { getCurrentUser } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/service";

export const metadata = { title: "Student login" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));
  return (
    <AuthCard title="Student login">
      <LoginForm portal="student" />
    </AuthCard>
  );
}
