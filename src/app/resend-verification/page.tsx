import AuthCard from "@/components/AuthCard";
import ResendForm from "@/components/ResendForm";

export const metadata = { title: "Resend verification email" };

export default function ResendPage() {
  return (
    <AuthCard title="Resend verification email" subtitle="Enter the email you registered with.">
      <ResendForm />
    </AuthCard>
  );
}
