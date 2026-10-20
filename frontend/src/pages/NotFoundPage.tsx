import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui";

export default function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      description="This page doesn't exist or has moved."
      action={<Link className="text-sm font-medium text-accent underline" to="/">Go to the dashboard</Link>}
    />
  );
}
