import LegalPage from "@/components/landing/LegalPage";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy">
      <p className="body-3 lp-muted">A plain summary of what PNPay-H keeps and who can see it. The program owner should review this text before relying on it.</p>
      <h2 className="heading-6">What we keep</h2>
      <ul className="body-3">
        <li>Your name, ID, email, batch and optional course.</li>
        <li>Your monthly payment schedule, the receipts you upload and how each was reviewed.</li>
        <li>Notifications and emails sent to you about due dates and reviews.</li>
        <li>A sign in cookie that keeps you signed in on your device.</li>
      </ul>
      <h2 className="heading-6">Who can see it</h2>
      <p className="body-3">You and your administrator. Receipts are kept in private storage and are not shown to other people.</p>
      <h2 className="heading-6">Money</h2>
      <p className="body-3">PNPay-H records payments. It never processes or holds money and does not ask for card or wallet details.</p>
      <h2 className="heading-6">Deleting your data</h2>
      <p className="body-3">You can delete your account from your account page after signing in. This permanently removes your account, scheduled payments, receipts and notifications.</p>
      <h2 className="heading-6">Questions</h2>
      <p className="body-3">{"{{contact email}}"}</p>
    </LegalPage>
  );
}
