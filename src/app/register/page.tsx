import { redirect } from "next/navigation";
import AuthCard from "@/components/AuthCard";
import RegisterForm from "@/components/RegisterForm";
import { getCurrentUser } from "@/lib/auth/session";
import { getBatchOptions } from "@/lib/batch-window";
import { homeFor } from "@/lib/auth/service";

export const metadata = { title: "Register" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));
  const batches = await getBatchOptions();
  return (
    <AuthCard title="Create your account" subtitle="You will need to verify your email before logging in.">
      <RegisterForm batches={batches} />
    </AuthCard>
  );
}
