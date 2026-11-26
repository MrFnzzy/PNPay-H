import Link from "next/link";
import AuthCard from "@/components/AuthCard";
import VerifyEmailPanel from "@/components/VerifyEmailPanel";

export const metadata = { title: "Verify email", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthCard title="Verify your email">
      {token ? (
        <VerifyEmailPanel token={token} />
      ) : (
        <p>
          This verification link is missing its token. <Link href="/resend-verification">Request a new link</Link>.
        </p>
      )}
    </AuthCard>
  );
}
