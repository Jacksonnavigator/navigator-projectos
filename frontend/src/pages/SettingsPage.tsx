import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Card, ConfirmDialog, Field, InlineError, Input, PageHeader, Select } from "../components/ui";
import { patch, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { applyTheme, storedTheme, type Theme } from "../lib/theme";
import type { User } from "../lib/types";

const COMMON_ZONES = ["Africa/Dar_es_Salaam", "Africa/Nairobi", "Africa/Kampala", "Africa/Johannesburg", "Europe/London", "UTC"];

export default function SettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tz, setTz] = useState(user?.timezone ?? "Africa/Dar_es_Salaam");
  const [theme, setTheme] = useState<Theme>(storedTheme());
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [typed, setTyped] = useState("");
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? COMMON_ZONES;

  const saveTz = useMutation({
    mutationFn: () => patch<User>("/auth/me", { timezone: tz }),
    onSuccess: (u) => qc.setQueryData(["me"], u),
  });
  const wipe = useMutation({
    mutationFn: () => post("/account/delete-all", { confirm: "DELETE EVERYTHING" }),
    onSuccess: () => {
      qc.clear();
      window.location.assign("/login");
    },
  });

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-3xl gap-6">
        <Card title="Profile">
          <div className="space-y-4">
            <p className="text-sm">
              Signed in as <strong>@{user?.login}</strong> (GitHub id {user?.github_id ?? "—"}).
            </p>
            <Field label="Time zone" hint="Times are stored in UTC and shown in this time zone.">
              {(p) => (
                <div className="flex gap-2">
                  <Select {...p} value={tz} onChange={(e) => setTz(e.target.value)}>
                    {zones.map((z) => (
                      <option key={z}>{z}</option>
                    ))}
                  </Select>
                  <Button onClick={() => saveTz.mutate()} busy={saveTz.isPending} disabled={tz === user?.timezone}>
                    Save
                  </Button>
                </div>
              )}
            </Field>
            {saveTz.isSuccess && <p className="text-sm text-ok">Time zone saved.</p>}
            <InlineError error={saveTz.error} />
            <Field label="Theme">
              {(p) => (
                <Select
                  {...p}
                  value={theme}
                  onChange={(e) => {
                    const t = e.target.value as Theme;
                    setTheme(t);
                    applyTheme(t);
                  }}
                >
                  <option value="system">Match system</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </Select>
              )}
            </Field>
          </div>
        </Card>

        <Card title="Export your data">
          <p className="mb-3 text-sm text-muted">
            Keep a copy on your own computer. The free database has no backups of its own; the weekly backup workflow and these exports are your safety net.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href="/api/v1/export/json" className="inline-flex h-10 items-center rounded-md border border-line px-4 text-sm font-medium hover:bg-sunken">
              Download everything (JSON)
            </a>
            <a href="/api/v1/export/register.xlsx" className="inline-flex h-10 items-center rounded-md border border-line px-4 text-sm font-medium hover:bg-sunken">
              Download project register (Excel)
            </a>
          </div>
          <p className="mt-2 text-xs text-muted">The JSON export never includes your GitHub token or session data. Document files are not included; download them from Documents.</p>
        </Card>

        <Card title="Danger zone" className="border-bad/40">
          <p className="mb-3 text-sm">
            Delete every project, task, document and record, revoke GitHub access and sign out. This cannot be undone. Export your data first.
          </p>
          <Button variant="danger" onClick={() => setConfirmWipe(true)}>
            Delete all data
          </Button>
        </Card>
      </div>
      <ConfirmDialog
        open={confirmWipe}
        title="Delete all data?"
        message={
          <div className="space-y-3">
            <p>All data and stored files will be permanently deleted.</p>
            <label htmlFor="wipe-confirm" className="block font-medium">
              Type DELETE EVERYTHING to confirm
            </label>
            <Input id="wipe-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            <InlineError error={wipe.error} />
          </div>
        }
        confirmLabel="Delete all data"
        busy={wipe.isPending}
        onConfirm={() => typed === "DELETE EVERYTHING" && wipe.mutate()}
        onCancel={() => {
          setConfirmWipe(false);
          setTyped("");
        }}
      />
    </>
  );
}
