import DocumentsPanel from "../components/DocumentsPanel";
import { PageHeader } from "../components/ui";

export default function DocumentsPage() {
  return (
    <>
      <PageHeader
        title="Documents"
        description="SRS documents, business plans, diagrams, wiring, research notes and decisions. Files are stored privately and only downloadable while you're signed in."
      />
      <DocumentsPanel />
    </>
  );
}
