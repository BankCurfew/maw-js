import { memo, useMemo, useEffect, useState, useCallback, useRef } from "react";
import { AgentCard } from "./AgentCard";
import { HoverPreviewCard } from "./HoverPreviewCard";
import { MiniPreview } from "./MiniPreview";
import { OracleSheet } from "./OracleSheet";
import { useDevice } from "../hooks/useDevice";
import { useFederationData } from "../hooks/useFederationData";
import type { AgentState, Session } from "../lib/types";

const PREVIEW_CARD = { width: 480, maxHeight: 520 };

interface RoomConfig {
  id: string;
  label: string;
  emoji: string;
  description: string;
  lead: string;
  members: string[];
  accent: string;
  floor: string;
  wall: string;
}

interface RoomsData {
  version: string;
  updatedAt: string;
  updatedBy: string;
  rooms: RoomConfig[];
}

interface RoomGridProps {
  sessions: Session[];
  agents: AgentState[];
  onSelectAgent: (agent: AgentState) => void;
  send: (msg: object) => void;
}

function matchAgent(agent: AgentState, memberName: string): boolean {
  const a = agent.name.toLowerCase();
  const m = memberName.toLowerCase();
  const aBase = a.replace(/-oracle$/, "");
  const mBase = m.replace(/-oracle$/, "");
  return a === m || aBase === m || aBase === mBase || a === mBase || `${a}-oracle` === m;
}

export const RoomGrid = memo(function RoomGrid({ sessions, agents, onSelectAgent, send }: RoomGridProps) {
  const [roomsData, setRoomsData] = useState<RoomsData | null>(null);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [configData, setConfigData] = useState<{ node?: string; agents?: Record<string, string>; namedPeers?: Array<{name: string; url: string}> | Record<string, string> } | null>(null);
  const { isNarrow } = useDevice();
  const { peers } = useFederationData();

  // Check if an agent's node is offline (unreachable peer)
  const isNodeOffline = useCallback((agent: AgentState) => {
    if (!agent.source || agent.source === "local") return false;
    const node = (agent as any).node as string | undefined;
    if (!node) return false;
    // Match peer by node or name field (API returns "node", type has "name")
    const peer = peers.find(p => p.node === node || p.name === node);
    // Only gray out if we have peer data AND it's confirmed unreachable
    // No peer data = don't assume offline (health check may not have run yet)
    return peer ? !peer.reachable : false;
  }, [peers]);

  useEffect(() => {
    // Load cached rooms first for instant render
    try {
      const cached = localStorage.getItem("maw-rooms-cache");
      if (cached) {
        const data = JSON.parse(cached);
        if (data.rooms?.length > 0) setRoomsData(data);
      }
    } catch {}
    fetch("/api/rooms")
      .then((r) => r.json())
      .then((data) => {
        if (data.rooms && data.rooms.length > 0) {
          setRoomsData(data);
          try { localStorage.setItem("maw-rooms-cache", JSON.stringify(data)); } catch {}
        }
        setRoomsLoaded(true);
      })
      .catch(() => setRoomsLoaded(true));
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => setConfigData(data))
      .catch(() => {});
  }, []);

  // Merge federated agents (no local tmux session) as synthetic entries
  const allAgents = useMemo(() => {
    if (!configData?.agents || !configData?.node) return agents;
    // Build set of known names with -oracle suffix stripped for fuzzy matching
    const localNames = new Set<string>();
    for (const a of agents) {
      const n = a.name.toLowerCase();
      localNames.add(n);
      localNames.add(n.replace(/-oracle$/, ""));
    }
    const synthetic: AgentState[] = [];
    for (const [name, node] of Object.entries(configData.agents)) {
      if (node !== configData.node && !localNames.has(name.toLowerCase())) {
        // namedPeers can be array [{name,url}] or object {name: url}
        const peers = configData.namedPeers;
        const peerUrl = Array.isArray(peers)
          ? peers.find(p => p.name === node)?.url || node
          : peers?.[node] || node;
        synthetic.push({
          name,
          target: `${node}:${name}`,
          session: node,
          window: name,
          status: "idle" as const,
          lastActivity: "",
          context: "",
          node,
          peerUrl,
          source: "synthetic",
        } as AgentState);
      }
    }
    // Dedup: prefer local (source=local) over remote/synthetic for same base name (#420)
    // Prevents circular federation roundtrip duplicates (HQ→Echo→HQ "echo" appears twice)
    const merged = [...agents, ...synthetic];
    const deduped = new Map<string, AgentState>();
    for (const a of merged) {
      const key = a.name.toLowerCase().replace(/-oracle$/, "");
      const existing = deduped.get(key);
      const aIsLocal = !a.source || a.source === "local";
      const existingIsLocal = existing && (!existing.source || existing.source === "local");
      if (!existing || (aIsLocal && !existingIsLocal)) {
        deduped.set(key, a);
      }
    }
    return [...deduped.values()];
  }, [agents, configData]);

  // Power level counts local agents only — federation agents are informational
  const localAgents = allAgents.filter((a) => !a.source || a.source === "local");
  const busyCount = localAgents.filter((a) => a.status === "busy").length;
  const localCount = localAgents.length;

  // --- Preview state (same pattern as FleetGrid) ---
  type PreviewInfo = { agent: AgentState; accent: string; label: string; pos: { x: number; y: number } };
  const [hoverPreview, setHoverPreview] = useState<PreviewInfo | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout>>();
  const [pinnedPreview, setPinnedPreview] = useState<PreviewInfo | null>(null);
  const [pinnedAnimPos, setPinnedAnimPos] = useState<{ left: number; top: number } | null>(null);
  const pinnedRef = useRef<HTMLDivElement>(null);
  const [inputBufs, setInputBufs] = useState<Record<string, string>>({});
  const getInputBuf = useCallback((target: string) => inputBufs[target] || "", [inputBufs]);
  const setInputBuf = useCallback((target: string, val: string) => {
    setInputBufs(prev => ({ ...prev, [target]: val }));
  }, []);

  const showPreview = useCallback((agent: AgentState, accent: string, label: string, e: React.MouseEvent) => {
    if (pinnedPreview) return;
    clearTimeout(hoverTimeout.current);
    const cardW = PREVIEW_CARD.width;
    let x = e.clientX + 8;
    if (x + cardW > window.innerWidth - 8) x = e.clientX - cardW - 8;
    if (x < 8) x = 8;
    setHoverPreview({ agent, accent, label, pos: { x, y: e.clientY - 120 } });
  }, [pinnedPreview]);

  const hidePreview = useCallback(() => {
    hoverTimeout.current = setTimeout(() => setHoverPreview(null), 300);
  }, []);

  const keepPreview = useCallback(() => { clearTimeout(hoverTimeout.current); }, []);

  const onAgentClick = useCallback((agent: AgentState, accent: string, label: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (pinnedPreview && pinnedPreview.agent.target === agent.target) { setPinnedPreview(null); return; }
    setPinnedPreview({ agent, accent, label, pos: { x: e.clientX, y: e.clientY } });
    setHoverPreview(null);
    send({ type: "subscribe", target: agent.target });
  }, [pinnedPreview, send]);

  useEffect(() => {
    if (pinnedPreview) {
      setPinnedAnimPos({
        left: (window.innerWidth - PREVIEW_CARD.width) / 2,
        top: Math.max(40, (window.innerHeight - PREVIEW_CARD.maxHeight) / 2),
      });
    } else { setPinnedAnimPos(null); }
  }, [pinnedPreview]);

  const onPinnedFullscreen = useCallback(() => {
    if (pinnedPreview) { const a = pinnedPreview.agent; setPinnedPreview(null); setTimeout(() => onSelectAgent(a), 150); }
  }, [pinnedPreview, onSelectAgent]);
  const onPinnedClose = useCallback(() => setPinnedPreview(null), []);

  // Group agents by room config
  const rooms = useMemo(() => {
    if (!roomsData || roomsData.rooms.length === 0) {
      // Wait for rooms fetch before falling back to raw sessions
      if (!roomsLoaded) return [];
      // Fallback: group by tmux session (original behavior)
      const map = new Map<string, AgentState[]>();
      for (const a of allAgents) {
        const arr = map.get(a.session) || [];
        arr.push(a);
        map.set(a.session, arr);
      }
      return sessions.map((s) => ({
        id: s.name,
        label: s.name,
        emoji: "",
        description: "",
        accent: "#26c6da",
        floor: "#1a2228",
        wall: "#0e1a20",
        agents: map.get(s.name) || [],
      }));
    }

    // Map agents to rooms by member name matching
    const assigned = new Set<string>();
    const result = roomsData.rooms.map((room) => {
      const roomAgents: AgentState[] = [];
      for (const memberName of room.members) {
        const agent = allAgents.find((a) => matchAgent(a, memberName));
        if (agent) {
          roomAgents.push(agent);
          assigned.add(agent.target);
        }
      }
      return {
        id: room.id,
        label: room.label,
        emoji: room.emoji,
        description: room.description,
        accent: room.accent,
        floor: room.floor,
        wall: room.wall,
        agents: roomAgents,
      };
    });

    // Any unassigned agents go to an "Unassigned" room
    // Filter out infrastructure sessions and remote peer agents (remote → Federation room only)
    const INFRA_PATTERNS = /^(page-\d+|claude|shell|overview|0-overview|\d+\.\d+\.\d+)$/i;
    const unassigned = allAgents.filter((a) => !assigned.has(a.target) && !INFRA_PATTERNS.test(a.name) && !INFRA_PATTERNS.test(a.session) && !INFRA_PATTERNS.test(a.window || "") && (!a.source || a.source === "local"));
    if (unassigned.length > 0) {
      result.push({
        id: "unassigned",
        label: "Unassigned",
        emoji: "❓",
        description: "Not assigned to any room",
        accent: "#78909c",
        floor: "#1a1a1e",
        wall: "#121216",
        agents: unassigned,
      });
    }

    return result;
  }, [roomsData, roomsLoaded, sessions, allAgents]);

  return (
    <div className="max-w-[1200px] mx-auto px-3 sm:px-4 md:px-6 pt-4 sm:pt-6 md:pt-8 pb-8 sm:pb-12">
      {/* Power bar */}
      <div className="flex items-center gap-3 mb-5 px-1">
        <span className="text-[10px] text-white/50 tracking-widest uppercase">Power Level</span>
        <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(100, (busyCount / Math.max(1, localCount)) * 100)}%`,
              background: busyCount > 5 ? "#ef5350" : busyCount > 2 ? "#ffa726" : "#4caf50",
            }}
          />
        </div>
        <span className="text-[10px] text-white/50 tabular-nums">
          {busyCount}/{localCount}
        </span>
      </div>

      {/* Room info line */}
      {roomsData && (
        <div className="flex items-center gap-2 mb-4 px-1">
          <span className="text-[10px] text-white/30 tracking-wider uppercase">
            Room layout by {roomsData.updatedBy}
          </span>
          <span className="text-[10px] text-white/20 font-mono">
            {new Date(roomsData.updatedAt).toLocaleDateString("en-GB")}
          </span>
        </div>
      )}

      {/* Room grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {rooms.map((room) => {
          const hasBusy = room.agents.some((a) => a.status === "busy");
          const allOffline = room.agents.length > 0 && room.agents.every(a => isNodeOffline(a));

          return (
            <div
              key={room.id}
              className={`rounded-3xl border backdrop-blur-xl transition-all duration-300 hover:scale-[1.01]${allOffline ? " opacity-50" : ""}`}
              style={{
                background: `${room.floor}88`,
                borderColor: hasBusy ? `${room.accent}40` : `${room.accent}12`,
                boxShadow: hasBusy
                  ? `0 8px 32px ${room.accent}15, 0 0 60px ${room.accent}08, inset 0 1px 0 rgba(255,255,255,0.05)`
                  : `0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)`,
              }}
            >
              {/* Room header */}
              <div
                className="flex items-center justify-between px-5 py-3 rounded-t-3xl border-b"
                style={{ background: `${room.wall}dd`, borderColor: `${room.accent}15` }}
              >
                <div className="flex items-center gap-2">
                  {room.emoji && <span className="text-base">{room.emoji}</span>}
                  <span className="text-xs font-bold tracking-[2px] uppercase" style={{ color: room.accent }}>
                    {room.label}
                  </span>
                  {room.description && (
                    <span className="text-[10px] text-white/30 ml-1">{room.description}</span>
                  )}
                </div>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                  style={{ color: room.accent, background: `${room.accent}15` }}
                >
                  {room.agents.length}
                </span>
              </div>

              {/* Accent line */}
              <div className="h-[2px] opacity-50" style={{ background: room.accent }} />

              {/* Agent grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4 p-3 sm:p-4 md:p-5 min-h-[100px] sm:min-h-[140px]">
                {room.agents.map((agent) => (
                  <AgentCard key={agent.target} agent={agent} accent={room.accent}
                    offline={isNodeOffline(agent)}
                    onClick={(e: React.MouseEvent) => onAgentClick(agent, room.accent, room.label, e)}
                    onMouseEnter={(e: React.MouseEvent) => showPreview(agent, room.accent, room.label, e)}
                    onMouseLeave={hidePreview}
                  />
                ))}
                {room.agents.length === 0 && (
                  <div className="col-span-full text-center text-[10px] text-white/30 py-4">Empty room</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hover Preview — compact mini card */}
      {hoverPreview && !pinnedPreview && (
        <div className="fixed pointer-events-auto" style={{ zIndex: 30, left: hoverPreview.pos.x, top: hoverPreview.pos.y, animation: "fadeSlideIn 0.15s ease-out" }}
          onMouseEnter={keepPreview} onMouseLeave={hidePreview}
          onClick={(e) => onAgentClick(hoverPreview.agent, hoverPreview.accent, hoverPreview.label, e)}>
          <MiniPreview agent={hoverPreview.agent} accent={hoverPreview.accent} roomLabel={hoverPreview.label} />
        </div>
      )}

      {/* Mobile: OracleSheet bottom sheet */}
      {pinnedPreview && isNarrow && (
        <OracleSheet
          agent={pinnedPreview.agent}
          send={send}
          onClose={onPinnedClose}
          onFullscreen={onPinnedFullscreen}
          siblings={allAgents.filter(a => a.session === pinnedPreview.agent.session)}
          onSelectSibling={(a) => {
            const room = rooms.find(r => r.agents.some(ra => ra.target === a.target));
            setPinnedPreview({ agent: a, accent: room?.accent || "#26c6da", label: room?.label || "", pos: { x: 0, y: 0 } });
            send({ type: "subscribe", target: a.target });
          }}
        />
      )}

      {/* Desktop: Backdrop + Pinned Preview Card (centered in viewport) */}
      {pinnedPreview && !isNarrow && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 35, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)" }} onClick={onPinnedClose}>
          <div ref={pinnedRef} className="pointer-events-auto" style={{ maxWidth: PREVIEW_CARD.width, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <HoverPreviewCard key={pinnedPreview.agent.target} agent={pinnedPreview.agent} roomLabel={pinnedPreview.label} accent={pinnedPreview.accent}
              pinned send={send} onFullscreen={onPinnedFullscreen} onClose={onPinnedClose}
              externalInputBuf={getInputBuf(pinnedPreview.agent.target)}
              onInputBufChange={(val) => setInputBuf(pinnedPreview.agent.target, val)} />
          </div>
        </div>
      )}
    </div>
  );
});
