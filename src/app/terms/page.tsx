import LegalPage from "@/components/landing/LegalPage";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms">
      <p className="body-3 lp-muted">The basic rules for using PNPay-H. The program owner should review this text before relying on it.</p>
      <h2 className="heading-6">What PNPay-H is</h2>
      <p className="body-3">A record keeping service for counterpart payments. You pay outside PNPay-H, then upload your receipt so your administrator can review it.</p>
      <h2 className="heading-6">Your part</h2>
      <ul className="body-3">
        <li>Give accurate details when you register.</li>
        <li>Upload only genuine receipts for payments you made.</li>
        <li>Keep your password private and use your own account only.</li>
      </ul>
      <h2 className="heading-6">Reviews</h2>
      <p className="body-3">Your administrator verifies receipts, rejects them, or asks for a correction. A status in PNPay-H reflects that review.</p>
      <h2 className="heading-6">Questions</h2>
      <p className="body-3">{"{{contact email}}"}</p>
    </LegalPage>
  );
}
