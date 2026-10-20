import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { LifecycleBadge } from "../components/domain";
import EvidencePanel from "../components/EvidencePanel";
import { Badge, Card, ErrorState, LoadingBlock, PageHeader } from "../components/ui";
import { get } from "../lib/api";
import { relativeTime } from "../lib/format";
import type { HealthOverviewRow } from "../lib/types";

export default function HealthPage() {
  const overview = useQuery({ queryKey: ["health-overview"], queryFn: () => get<HealthOverviewRow[]>("/health-overview") });
  return (
    <>
      <PageHeader
        title="Health & tests"
        description="Reported status is what has been written down. Verified evidence is automated (CI) or measured by you, with a date. Active projects without recent verified evidence are flagged."
      />
      <Card title="Reported vs verified" className="mb-6">
        {overview.isPending ? (
          <LoadingBlock rows={4} />
        ) : overview.error ? (
          <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">Project</th>
                  <th className="px-2 py-2 font-medium">Reported status</th>
                  <th className="px-2 py-2 font-medium">Verified evidence</th>
                  <th className="px-4 py-2 font-medium">Latest verified result</th>
                </tr>
              </thead>
              <tbody>
                {overview.data.map((r) => (
                  <tr key={r.project_id} className="border-b border-line align-top last:border-0">
                    <td className="px-4 py-2">
                      <Link to={`/projects/${r.project_id}?tab=evidence`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      <div className="mt-1">
                        <LifecycleBadge value={r.lifecycle} />
                      </div>
                    </td>
                    <td className="max-w-xs px-2 py-2">
                      <p>{r.reported_status ?? "—"}</p>
                      {r.status_confidence && <p className="text-xs text-muted">{r.status_confidence}</p>}
                    </td>
                    <td className="px-2 py-2">
                      <p>{r.verified_count} records</p>
                      <p className="text-xs text-muted">Last: {r.last_verified_at ? relativeTime(r.last_verified_at) : "never"}</p>
                      {r.stale && <Badge tone="warn">No verified evidence in 30 days</Badge>}
                    </td>
                    <td className="px-4 py-2">
                      {r.last_result ? (
                        <>
                          <Badge tone={r.last_result === "pass" ? "ok" : r.last_result === "fail" ? "bad" : "warn"}>{r.last_result}</Badge>{" "}
                          <span className="text-xs">{r.last_title}</span>
                        </>
                      ) : (
                        <span className="text-xs text-muted">None</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <h2 className="mb-3 text-base font-semibold">All evidence</h2>
      <EvidencePanel />
    </>
  );
}
