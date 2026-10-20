import BusinessPanel from "../components/BusinessPanel";
import { PageHeader } from "../components/ui";

export default function BusinessPage() {
  return (
    <>
      <PageHeader title="Business" description="Costs, revenue, funding needs, investors, proposals and opportunities for your commercial projects." />
      <BusinessPanel />
    </>
  );
}
