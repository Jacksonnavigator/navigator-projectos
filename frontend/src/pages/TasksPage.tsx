import { useSearchParams } from "react-router-dom";
import TaskList from "../components/TaskList";
import { PageHeader } from "../components/ui";

export default function TasksPage() {
  const [params] = useSearchParams();
  return (
    <>
      <PageHeader title="Tasks" description="All tasks across projects, including issues and pull requests synced from GitHub." />
      <TaskList
        initial={{
          status: params.get("status") ?? undefined,
          project_id: params.get("project") ?? undefined,
          sort: params.get("sort") ?? "due",
        }}
      />
    </>
  );
}
