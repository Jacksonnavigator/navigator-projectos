import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { get, onWakeChange } from "../lib/api";
import { useAuth } from "../lib/auth";
import { applyTheme, storedTheme, type Theme } from "../lib/theme";
import type { Dashboard } from "../lib/types";
import CommandPalette from "./CommandPalette";
import { IconButton, Toaster, cx } from "./ui";

type NavItem = { to: string; label: string; icon: ReactNode };

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Plan",
    items: [
      { to: "/", label: "Dashboard", icon: <path d="M3 10.5 10 4l7 6.5V17H3z" /> },
      { to: "/projects", label: "Projects", icon: <path d="M3 5h5l2 2h7v9H3z" /> },
      { to: "/timeline", label: "Timeline", icon: <path d="M3 5h8M6 10h9M4 15h6" /> },
      { to: "/calendar", label: "Calendar", icon: <path d="M3 5h14v12H3zM3 8h14M7 3v4M13 3v4" /> },
    ],
  },
  {
    title: "Work",
    items: [
      { to: "/board", label: "Board", icon: <path d="M3 4h4v12H3zM8 4h4v8H8zM13 4h4v10h-4z" /> },
      { to: "/tasks", label: "Tasks", icon: <path d="M4 5h12M4 10h12M4 15h12" /> },
      { to: "/health", label: "Health & tests", icon: <path d="M3 10h3l2-5 4 10 2-5h3" /> },
    ],
  },
  {
    title: "Records",
    items: [
      { to: "/documents", label: "Documents", icon: <path d="M5 3h7l3 3v11H5zM12 3v3h3" /> },
      { to: "/business", label: "Business", icon: <path d="M3 16h14M5 13V9M9 13V6M13 13v-3M17 13V4" /> },
      { to: "/github", label: "GitHub", icon: <path d="M7 15c-3 1-3-1.5-4-2m8 4v-2.5c0-.8.1-1.4-.4-1.9 2-.2 4.4-1 4.4-4.6a3.6 3.6 0 0 0-1-2.5 3.3 3.3 0 0 0-.1-2.5s-.8-.2-2.6 1a9 9 0 0 0-4.6 0C4.9 3.8 4.1 4 4.1 4a3.3 3.3 0 0 0-.1 2.5 3.6 3.6 0 0 0-1 2.5c0 3.6 2.4 4.4 4.4 4.6-.4.4-.6 1-.5 1.6V17" /> },
      { to: "/import", label: "Import & plans", icon: <path d="M10 3v9m0 0-3-3m3 3 3-3M4 14v3h12v-3" /> },
      { to: "/settings", label: "Settings", icon: <path d="M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" /> },
    ],
  },
];

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function WakeBanner() {
  const [waking, setWaking] = useState(false);
  useEffect(() => onWakeChange(setWaking), []);
  if (!waking) return null;
  return (
    <div role="status" className="border-b border-line bg-accent-soft px-4 py-2 text-center text-sm text-accent">
      Waking up the server… this can take up to a minute after it has been idle.
    </div>
  );
}

const THEME_NEXT: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };
const THEME_LABEL: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useState<Theme>(storedTheme());
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  // Shares the dashboard query (cached), so the counter costs no extra request on the dashboard.
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => get<Dashboard>("/dashboard"), staleTime: 60_000 });
  const overdue = dash.data?.counts.overdue ?? 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const changeTheme = () => {
    const next = THEME_NEXT[theme];
    setTheme(next);
    applyTheme(next);
  };
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-surface focus:p-2">
        Skip to content
      </a>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-surface transition-transform duration-200 ease-out lg:static lg:w-60 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-14 items-center gap-2 border-b border-line px-4">
          <span className="grid size-7 place-items-center rounded-md bg-accent text-accent-ink" aria-hidden="true">
            <svg viewBox="0 0 32 32" className="size-4"><path d="M16 4l8 23-8-6-8 6z" fill="currentColor" /></svg>
          </span>
          <span className="font-semibold tracking-tight">ProjectOS</span>
        </div>
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={() => setPalette(true)}
            className="flex h-9 w-full items-center gap-2 rounded-md border border-line bg-canvas px-3 text-sm text-muted hover:text-ink pointer-coarse:h-11"
            aria-keyshortcuts="Control+K Meta+K"
          >
            <NavIcon>
              <path d="M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM17 17l-3.5-3.5" />
            </NavIcon>
            <span className="flex-1 text-left">Search</span>
            <kbd className="rounded border border-line px-1.5 text-xs">{isMac ? "⌘K" : "Ctrl K"}</kbd>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {GROUPS.map((g) => (
            <div key={g.title} className="mb-4">
              <p className="mb-1 px-3 text-xs font-medium tracking-wide text-faint uppercase">{g.title}</p>
              <ul className="space-y-0.5">
                {g.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === "/"}
                      className={({ isActive }) =>
                        cx(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm pointer-coarse:py-3",
                          isActive ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-sunken hover:text-ink",
                        )
                      }
                    >
                      <NavIcon>{item.icon}</NavIcon>
                      <span className="flex-1">{item.label}</span>
                      {item.to === "/tasks" && overdue > 0 && (
                        <span className="rounded-full bg-bad px-1.5 text-xs font-medium text-white tabular-nums" aria-label={`${overdue} overdue`}>
                          {overdue}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" className="size-8 rounded-full" />
            ) : (
              <span className="grid size-8 place-items-center rounded-full bg-sunken text-sm font-medium" aria-hidden="true">
                {user?.login.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user?.name ?? user?.login}</p>
              <p className="truncate text-xs text-muted">@{user?.login}</p>
            </div>
            <IconButton label={`Switch theme (now ${THEME_LABEL[theme]})`} onClick={changeTheme} side="top">
              {theme === "dark" ? <path d="M15 12.5A6 6 0 0 1 7.5 5a6 6 0 1 0 7.5 7.5z" /> : theme === "light" ? <path d="M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.3 4.3l1 1M14.7 14.7l1 1M4.3 15.7l1-1M14.7 5.3l1-1" /> : <path d="M3 4h14v9H3zM7 17h6M10 13v4" />}
            </IconButton>
            <IconButton label="Sign out" onClick={() => void logout()} side="top" align="end">
              <path d="M8 4H4v12h4M12 14l4-4-4-4M16 10H8" />
            </IconButton>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <WakeBanner />
        <header className="flex h-14 items-center gap-2 border-b border-line bg-surface px-2 lg:hidden">
          <IconButton label="Open navigation" onClick={() => setOpen(true)}>
            <path d="M3 5h14M3 10h14M3 15h14" />
          </IconButton>
          <span className="flex-1 font-semibold">ProjectOS</span>
          <IconButton label="Search" onClick={() => setPalette(true)} align="end">
            <path d="M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM17 17l-3.5-3.5" />
          </IconButton>
        </header>
        <main id="main" className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <Toaster />
    </div>
  );
}
