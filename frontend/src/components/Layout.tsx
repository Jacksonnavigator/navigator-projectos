import { type ReactNode, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { onWakeChange } from "../lib/api";
import { useAuth } from "../lib/auth";
import { applyTheme, storedTheme, type Theme } from "../lib/theme";
import { cx } from "./ui";

const NAV: { to: string; label: string; icon: ReactNode }[] = [
  { to: "/", label: "Dashboard", icon: <path d="M3 10.5 10 4l7 6.5V17H3z" /> },
  { to: "/projects", label: "Projects", icon: <path d="M3 5h5l2 2h7v9H3z" /> },
  { to: "/timeline", label: "Timeline", icon: <path d="M3 5h8M6 10h9M4 15h6" /> },
  { to: "/board", label: "Board", icon: <path d="M3 4h4v12H3zM8 4h4v8H8zM13 4h4v10h-4z" /> },
  { to: "/tasks", label: "Tasks", icon: <path d="M4 5h12M4 10h12M4 15h12" /> },
  { to: "/calendar", label: "Calendar", icon: <path d="M3 5h14v12H3zM3 8h14M7 3v4M13 3v4" /> },
  { to: "/github", label: "GitHub", icon: <path d="M10 3a7 7 0 0 0-2.2 13.6c.4 0 .5-.2.5-.4v-1.5c-2 .4-2.4-.9-2.4-.9-.3-.8-.8-1-.8-1-.7-.5 0-.5 0-.5.7.1 1.1.8 1.1.8.6 1.1 1.7.8 2.1.6 0-.5.2-.8.4-1-1.6-.2-3.2-.8-3.2-3.5 0-.8.3-1.4.7-1.9 0-.2-.3-.9.1-1.9 0 0 .6-.2 2 .7a6.8 6.8 0 0 1 3.6 0c1.4-.9 2-.7 2-.7.4 1 .1 1.7.1 1.9.5.5.7 1.1.7 1.9 0 2.7-1.6 3.3-3.2 3.5.3.2.5.7.5 1.3v2c0 .2.1.5.5.4A7 7 0 0 0 10 3z" /> },
  { to: "/health", label: "Health & tests", icon: <path d="M3 10h3l2-5 4 10 2-5h3" /> },
  { to: "/documents", label: "Documents", icon: <path d="M5 3h7l3 3v11H5zM12 3v3h3" /> },
  { to: "/business", label: "Business", icon: <path d="M3 16h14M5 13V9M9 13V6M13 13v-3M17 13V4" /> },
  { to: "/import", label: "Import register", icon: <path d="M10 3v9m0 0-3-3m3 3 3-3M4 14v3h12v-3" /> },
  { to: "/settings", label: "Settings", icon: <path d="M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" /> },
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

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(storedTheme());
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const cycleTheme = () => {
    const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
    applyTheme(next);
  };

  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-surface focus:p-2">
        Skip to content
      </a>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-surface transition-transform lg:static lg:translate-x-0",
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
        <nav className="flex-1 overflow-y-auto p-2">
          <ul className="space-y-0.5">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    cx(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                      isActive ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-sunken hover:text-ink",
                    )
                  }
                >
                  <NavIcon>{item.icon}</NavIcon>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
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
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={cycleTheme} className="flex-1 rounded-md border border-line px-2 py-1.5 text-xs text-muted hover:bg-sunken" aria-label={`Theme: ${theme}. Change theme`}>
              Theme: {theme}
            </button>
            <button type="button" onClick={() => void logout()} className="flex-1 rounded-md border border-line px-2 py-1.5 text-xs text-muted hover:bg-sunken">
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <WakeBanner />
        <header className="flex h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation" className="rounded p-1.5 hover:bg-sunken">
            <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
          <span className="font-semibold">ProjectOS</span>
        </header>
        <main id="main" className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
