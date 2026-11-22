import { motion } from "framer-motion";
import { Disc3, FolderOpen, Library, Moon, Printer, Settings, Sun } from "lucide-react";
import type { Page } from "../types";
import { BrandMark } from "./BrandMark";
import type { DriveInfo } from "../shared/api";
import { burners, discLabel, discState } from "../lib/drives";

const NAV: Array<{ id: Page; label: string; icon: typeof Disc3 }> = [
  { id: "disc", label: "New disc", icon: Disc3 },
  { id: "projects", label: "Saved projects", icon: FolderOpen },
  { id: "shelf", label: "Shelf", icon: Library },
  { id: "inserts", label: "Inserts", icon: Printer },
  { id: "settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  page: Page;
  onNavigate: (p: Page) => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  drives: DriveInfo[] | null;
}

export function Sidebar({ page, onNavigate, theme, onToggleTheme, drives }: SidebarProps) {
  const drive = burners(drives)[0];
  const state = drives === null ? "checking" : discState(drive);
  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandMark size={20} />
        <span>Romix</span>
      </div>
      <div className="nav-section">Library</div>
      <nav>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`nav-item ${page === id ? "is-active" : ""}`}
            onClick={() => onNavigate(id)}
            aria-current={page === id ? "page" : undefined}
          >
            {page === id && (
              <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
            )}
            <Icon size={15} className="nav-icon" />
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <span className={`drive-status is-${state}`} title={drive ? `${drive.name} (${drive.path.replace(/\\$/, "")})` : undefined}>
          <span className="drive-dot" />
          <span className="drive-text">{drives === null ? "Checking for a burner…" : discLabel(drive)}</span>
        </span>
        <button
          className="icon-btn theme-toggle"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </aside>
  );
}
