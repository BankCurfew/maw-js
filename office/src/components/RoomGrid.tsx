import { memo, useMemo, useEffect, useState } from "react";
import { AgentCard } from "./AgentCard";
import type { AgentState, Session } from "../lib/types";

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
}

function matchAgent(agent: AgentState, memberName: string): boolean {
  const a = agent.name.toLowerCase();
  const m = memberName.toLowerCase();
  return a === m || a === m.replace(/-oracle$/, "") || `${a}-oracle` === m;
}

export const RoomGrid = memo(function RoomGrid({ sessions, agents, onSelectAgent }: RoomGridProps) {
  const [roomsData, setRoomsData] = useState<RoomsData | null>(null);

  useEffect(() => {
    fetch("/api/rooms")
      .then((r) => r.json())
      .then((data) => {
        if (data.rooms && data.rooms.length > 0) setRoomsData(data);
      })
      .catch(() => {});
  }, []);

  const busyCount = agents.filter((a) => a.status === "busy").length;

  // Group agents by room config
  const rooms = useMemo(() => {
    if (!roomsData || roomsData.rooms.length === 0) {
      // Fallback: group by tmux session (original behavior)
      const map = new Map<string, AgentState[]>();
      for (const a of agents) {
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
        const agent = agents.find((a) => matchAgent(a, memberName));
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
    const unassigned = agents.filter((a) => !assigned.has(a.target));
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
  }, [roomsData, sessions, agents]);

  return (
    <div className="max-w-[1200px] mx-auto px-6 pt-8 pb-12">
      {/* Power bar */}
      <div className="flex items-center gap-3 mb-5 px-1">
        <span className="text-[10px] text-white/50 tracking-widest uppercase">Power Level</span>
        <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(100, (busyCount / Math.max(1, agents.length)) * 100)}%`,
              background: busyCount > 5 ? "#ef5350" : busyCount > 2 ? "#ffa726" : "#4caf50",
            }}
          />
        </div>
        <span className="text-[10px] text-white/50 tabular-nums">
          {busyCount}/{agents.length}
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

          return (
            <div
              key={room.id}
              className="rounded-3xl border backdrop-blur-xl transition-all duration-300 hover:scale-[1.01]"
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
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 p-5 min-h-[140px]">
                {room.agents.map((agent) => (
                  <AgentCard key={agent.target} agent={agent} accent={room.accent} onClick={() => onSelectAgent(agent)} />
                ))}
                {room.agents.length === 0 && (
                  <div className="col-span-full text-center text-[10px] text-white/30 py-4">Empty room</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
