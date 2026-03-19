import { memo, useState, type ReactNode } from "react";

interface StatusBarProps {
  connected: boolean;
  agentCount: number;
  sessionCount: number;
  activeView?: string;
  askCount?: number;
  onInbox?: () => void;
  onJump?: () => void;
  muted?: boolean;
  onToggleMute?: () => void;
  children?: ReactNode;
}

const NAV_ITEMS = [
  { href: "#office", label: "Office", id: "office" },
  { href: "#fleet", label: "Fleet", id: "fleet" },
  { href: "#mission", label: "Mission", id: "mission" },
  { href: "#vs", label: "VS", id: "vs" },
  { href: "#overview", label: "Overview", id: "overview" },
  { href: "#config", label: "Config", id: "config" },
  { href: "#terminal", label: "Terminal", id: "terminal" },
  { href: "#orbital", label: "Orbital", id: "orbital" },
  { href: "#board", label: "Board", id: "board" },
  { href: "#loops", label: "Loops", id: "loops" },
  { href: "#jarvis", label: "Jarvis", id: "jarvis" },
  { href: "#fame", label: "Fame", id: "fame" },
];

const isNarrow = typeof window !== "undefined" && window.innerWidth < 768;

export const StatusBar = memo(function StatusBar({ connected, agentCount, sessionCount, activeView = "office", askCount = 0, onInbox, onJump, muted, onToggleMute, children }: StatusBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 mx-2 sm:mx-4 md:mx-6 mt-2 sm:mt-3 px-3 sm:px-4 md:px-6 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl bg-black/50 backdrop-blur-xl border border-white/[0.06] shadow-[0_4px_30px_rgba(0,0,0,0.4)]">
      {/* Top row — always visible */}
      <div className="flex items-center gap-2 sm:gap-3">
        <h1 className="text-sm sm:text-base md:text-lg font-bold tracking-[3px] sm:tracking-[4px] md:tracking-[6px] text-cyan-400 uppercase whitespace-nowrap">
          {activeView === "fleet" ? "Fleet" : activeView === "mission" ? "Mission" : activeView === "overview" ? "Overview" : activeView === "vs" ? "VS" : activeView === "config" ? "Config" : activeView === "terminal" ? "Terminal" : activeView === "board" ? "Board" : activeView === "orbital" ? "Orbital" : activeView === "loops" ? "Loops" : activeView === "jarvis" ? "Jarvis" : activeView === "fame" ? "Fame" : "Office"}
        </h1>

        <span className="flex items-center gap-1 text-xs sm:text-sm text-white/70">
          <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full flex-shrink-0 ${connected ? "bg-emerald-400 shadow-[0_0_6px_#4caf50]" : "bg-red-400 animate-pulse"}`} />
          <span className="hidden sm:inline">{connected ? "LIVE" : "..."}</span>
        </span>

        <span className="text-xs sm:text-sm text-white/70 whitespace-nowrap">
          <strong className="text-cyan-400">{agentCount}</strong><span className="hidden sm:inline"> agents</span>
        </span>
        <span className="hidden sm:inline text-sm text-white/70 whitespace-nowrap">
          <strong className="text-purple-400">{sessionCount}</strong> rooms
        </span>

        {/* View-specific controls injected by parent */}
        <div className="hidden md:flex items-center gap-2">
          {children}
        </div>

        {/* Right side actions */}
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {onToggleMute && (
            <button
              onClick={onToggleMute}
              className="min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-mono active:scale-95 transition-all flex items-center justify-center"
              style={{
                background: muted ? "rgba(239,83,80,0.15)" : "rgba(76,175,80,0.15)",
                color: muted ? "#ef5350" : "#4caf50",
                border: `1px solid ${muted ? "rgba(239,83,80,0.25)" : "rgba(76,175,80,0.25)"}`,
              }}
            >
              {muted ? "🔇" : "🔊"}
            </button>
          )}

          {onJump && !isNarrow && (
            <button
              onClick={onJump}
              className="hidden sm:inline-flex min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 px-2 sm:px-3 py-1.5 rounded-lg text-xs font-mono font-bold active:scale-95 transition-all items-center justify-center"
              style={{ background: "rgba(34,211,238,0.15)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.25)" }}
            >
              ⌘J
            </button>
          )}

          {onInbox && (
            <button onClick={onInbox} className="relative min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 px-2 sm:px-3 py-1.5 rounded-lg text-xs transition-colors text-white/50 hover:text-white/80 active:scale-95 flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              Inbox
              {askCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold text-white bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]">
                  {askCount}
                </span>
              )}
            </button>
          )}

          {/* Desktop nav — scrollable at xl, hidden below */}
          <nav className="hidden xl:flex items-center gap-2 text-xs ml-2 overflow-x-auto scrollbar-hide max-w-[50vw]" style={{ scrollbarWidth: "none" }}>
            {NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className={`transition-colors whitespace-nowrap px-1.5 py-0.5 rounded ${
                  activeView === item.id
                    ? "text-cyan-400 font-bold bg-cyan-500/10"
                    : "text-white/50 hover:text-white/80"
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Hamburger menu — visible below xl */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="xl:hidden min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-white/60 hover:text-white/90 active:scale-95 transition-all"
            style={{ background: menuOpen ? "rgba(34,211,238,0.15)" : "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {/* Nav dropdown (visible below xl) */}
      {menuOpen && (
        <nav className="xl:hidden flex flex-wrap gap-2 mt-2 pt-2 border-t border-white/[0.06]">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-all active:scale-95 ${
                activeView === item.id
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "bg-white/[0.04] text-white/60 border border-white/[0.06] hover:text-white/80"
              }`}
            >
              {item.label}
            </a>
          ))}
          {/* Show children (view controls) in mobile menu too */}
          {children && <div className="w-full flex flex-wrap gap-2 mt-1">{children}</div>}
        </nav>
      )}
    </header>
  );
});
