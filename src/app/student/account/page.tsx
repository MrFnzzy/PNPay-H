import StudentPage, { loadStudent } from "@/components/student/StudentPage";
import DeleteAccountForm from "@/components/student/DeleteAccountForm";

export const metadata = { title: "My account" };
export const dynamic = "force-dynamic";

export default async function Account() {
  const { user, unread } = await loadStudent();
  return (
    <StudentPage name={user.fullName} unread={unread}>
      <h1>My account</h1>
      <div className="card">
        <p><strong>{user.fullName}</strong></p>
        <p className="muted">{user.email}</p>
      </div>
      <DeleteAccountForm />
    </StudentPage>
  );
}
