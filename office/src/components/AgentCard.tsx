import { memo, useState } from "react";
import { AgentAvatar } from "./AgentAvatar";
import { useDevice } from "../hooks/useDevice";
import type { AgentState } from "../lib/types";

interface AgentCardProps {
  agent: AgentState;
  accent: string;
  offline?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
}

export const AgentCard = memo(function AgentCard({ agent, accent, offline, onClick, onMouseEnter: onMouseEnterProp, onMouseLeave: onMouseLeaveProp }: AgentCardProps) {
  const { isNarrow } = useDevice();
  const [hovered, setHovered] = useState(false);
  const displayName = agent.name.replace(/-oracle$/, "").replace(/-/g, " ");
  return (
    <div
      className={`relative flex flex-col items-center gap-1 ${offline ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
      onClick={offline ? undefined : onClick}
      onMouseEnter={(e) => { !isNarrow && setHovered(true); onMouseEnterProp?.(e); }}
      onMouseLeave={(e) => { setHovered(false); onMouseLeaveProp?.(e); }}
    >
      <svg width={100} height={85} viewBox="-55 -55 110 88" style={{ overflow: "visible", filter: offline ? "grayscale(1) brightness(0.5)" : "none" }}>
        <AgentAvatar
          name={agent.name}
          target={agent.target}
          status={agent.status}
          preview={agent.preview}
          accent={accent}
          onClick={onClick}
        />
      </svg>
      <span
        className="text-[11px] font-bold tracking-wide truncate max-w-[100px] text-center"
        style={{ color: offline ? "rgba(255,255,255,0.3)" : accent }}
      >
        {displayName}
      </span>

      {/* HTML tooltip — positioned above card */}
      {hovered && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-30 px-4 py-2.5 rounded-xl border whitespace-nowrap pointer-events-none"
          style={{
            background: "rgba(8,8,16,0.95)",
            borderColor: `${accent}44`,
            boxShadow: `0 0 20px ${accent}25, 0 4px 12px rgba(0,0,0,0.5)`,
          }}
        >
          <div className="text-sm font-bold" style={{ color: accent }}>{displayName}</div>
          <div className="text-xs text-white/70 mt-0.5">
            {offline ? `offline · ${(agent as any).node || agent.target}` : `${agent.status} · ${agent.target}`}
          </div>
          {agent.preview && (
            <div className="text-[10px] text-white/50 mt-1 max-w-[250px] truncate">
              {agent.preview.slice(0, 60)}
            </div>
          )}
          {/* Arrow */}
          <div
            className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0"
            style={{
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderTop: "6px solid rgba(8,8,16,0.95)",
            }}
          />
        </div>
      )}
    </div>
  );
});
