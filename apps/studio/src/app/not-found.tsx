import Link from "next/link";

export default function NotFound() {
  return (
    <div className="signin-wrap">
      <div className="signin-card">
        <h1 className="signin-title">Document not found</h1>
        <p className="signin-sub">
          It may have been moved, renamed, or not yet committed.
        </p>
        <Link href="/" className="btn">
          Back to documents
        </Link>
        <Link href="/signin" className="btn btn-secondary" style={{ marginTop: "0.75rem" }}>
          Sign in with a different account →
        </Link>
      </div>
    </div>
  );
}
