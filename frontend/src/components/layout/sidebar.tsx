import { Link, useLocation } from "wouter";
import {
  ChatBubbleLeftRightIcon,
  WrenchScrewdriverIcon,
  DocumentDuplicateIcon,
  FolderOpenIcon,
  Cog6ToothIcon,
  AdjustmentsHorizontalIcon,
  SunIcon,
  MoonIcon,
  ArrowRightStartOnRectangleIcon,
} from "@heroicons/react/24/outline";
import { Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppearance } from "@/components/appearance-provider";

interface NavItem {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const WORKSPACE_ITEMS: NavItem[] = [
  { href: "/chat", label: "Ask Questions", Icon: ChatBubbleLeftRightIcon },
  { href: "/tools", label: "Tools", Icon: WrenchScrewdriverIcon },
  { href: "/forms", label: "Forms", Icon: DocumentDuplicateIcon },
  { href: "/documents", label: "Documents", Icon: FolderOpenIcon },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/admin", label: "Admin", Icon: Cog6ToothIcon, adminOnly: true },
];

const SECONDARY_ITEMS: NavItem[] = [
  { href: "/settings", label: "Settings", Icon: AdjustmentsHorizontalIcon },
];

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-3 py-1.5 font-mono uppercase text-muted-foreground"
      style={{ fontSize: 10, letterSpacing: "0.08em" }}
    >
      {children}
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const { Icon } = item;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 rounded-sm px-3 py-1.5 text-[13px] text-muted-foreground transition-colors",
        "hover:bg-[var(--copper-soft)] hover:text-foreground",
        active &&
          "bg-[var(--copper-soft)] text-foreground font-medium shadow-[inset_2px_0_0_var(--accent)]"
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{item.label}</span>
    </Link>
  );
}

interface SidebarProps {
  username: string | undefined;
  role: string | undefined;
  isAdmin: boolean;
  onLogout: () => void;
}

export default function Sidebar({ username, role, isAdmin, onLogout }: SidebarProps) {
  const [location] = useLocation();
  const { theme, setTheme } = useAppearance();

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    return location === href || location.startsWith(href + "/");
  };

  const initial = username?.charAt(0).toUpperCase() ?? "?";

  return (
    <aside
      className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
      aria-label="Primary navigation"
    >
      {/* Header — brand + accent dot */}
      <div className="border-b border-sidebar-border px-5 pb-4 pt-5">
        <div
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: "0.08em" }}
        >
          Knowledge
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block"
            style={{
              width: 2,
              height: 20,
              backgroundColor: "var(--accent)",
              borderRadius: 1,
            }}
          />
          <Brain size={18} className="text-foreground" />
          <h1 className="font-display text-[18px] font-medium text-foreground">UMS Knowledge</h1>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        <SectionKicker>Workspace</SectionKicker>
        {WORKSPACE_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} />
        ))}

        {isAdmin && (
          <>
            <SectionKicker>Admin</SectionKicker>
            {ADMIN_ITEMS.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
          </>
        )}

        <div className="pt-3">
          <SectionKicker>Preferences</SectionKicker>
          {SECONDARY_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </div>
      </nav>

      {/* Footer — user card + theme toggle + logout */}
      <div className="border-t border-sidebar-border p-3">
        <div className="mb-2 flex items-center gap-2 rounded-sm border border-border bg-card px-2 py-1.5">
          <div
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-sm font-mono text-[13px] font-semibold"
            style={{
              backgroundColor: "var(--copper-soft)",
              color: "var(--accent)",
            }}
          >
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-foreground">
              {username ?? "Guest"}
            </div>
            {role && (
              <div
                className="truncate font-mono uppercase text-muted-foreground"
                style={{ fontSize: 10, letterSpacing: "0.06em" }}
              >
                {role}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground hover:text-foreground"
          >
            {theme === "dark" ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-sm border border-border bg-card px-2 py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <ArrowRightStartOnRectangleIcon className="h-4 w-4" />
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
