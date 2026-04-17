/**
 * Heartbeats API — /api/brain/hud endpoint.
 * Parses feed.log for HB: lines (Rule #9 heartbeat protocol) and returns
 * structured heartbeat data for the HeartbeatsWidget.
 */

import { Elysia } from "elysia";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const FEED_LOG = join(homedir(), ".oracle", "feed.log");

interface Heartbeat {
  oracle: string;
  taskId: string;
  progress: number;
  status: string;
  lastSeen: string;
  ageMinutes: number;
  color: "green" | "yellow" | "red";
}

/** Parse a feed.log HB line:
 * "2026-04-17 14:30:00 | Dev-Oracle | host | Notification | Dev-Oracle | heartbeat » HB: #task-1 60% doing stuff"
 */
function parseHBLine(line: string): Heartbeat | null {
  const hbIdx = line.indexOf("heartbeat » HB:");
  if (hbIdx === -1) return null;

  // Extract timestamp from start of line
  const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  if (!tsMatch) return null;
  const lastSeen = tsMatch[1];

  // Extract oracle name (first pipe-separated field after timestamp)
  const parts = line.split("|").map(s => s.trim());
  const oracle = parts[1] || "unknown";

  // Parse HB payload: "HB: <taskId> <progress%> <status>"
  const payload = line.slice(hbIdx + "heartbeat » HB:".length).trim();
  const tokens = payload.split(/\s+/);
  const taskId = tokens[0] || "unknown";
  const progressStr = tokens[1] || "0";
  const progress = parseInt(progressStr.replace("%", ""), 10) || 0;
  const status = tokens.slice(2).join(" ") || "running";

  // Calculate age
  const ts = new Date(lastSeen.replace(" ", "T"));
  const ageMs = Date.now() - ts.getTime();
  const ageMinutes = ageMs / 60_000;

  // Color per Rule #9 thresholds
  let color: "green" | "yellow" | "red" = "green";
  if (ageMinutes > 15) color = "red";
  else if (ageMinutes > 5) color = "yellow";

  return { oracle, taskId, progress, status, lastSeen, ageMinutes, color };
}

export const heartbeatsApi = new Elysia();

heartbeatsApi.get("/brain/hud", () => {
  if (!existsSync(FEED_LOG)) {
    return { heartbeats: [] };
  }

  try {
    const raw = readFileSync(FEED_LOG, "utf-8");
    const lines = raw.split("\n");

    // Only look at last 500 lines for performance
    const recent = lines.slice(-500);

    // Collect latest HB per oracle+taskId
    const latest = new Map<string, Heartbeat>();
    for (const line of recent) {
      const hb = parseHBLine(line);
      if (hb) {
        const key = `${hb.oracle}:${hb.taskId}`;
        latest.set(key, hb);
      }
    }

    // Only return heartbeats from last 24h
    const cutoff = 24 * 60; // 24h in minutes
    const heartbeats = [...latest.values()]
      .filter(hb => hb.ageMinutes < cutoff)
      .sort((a, b) => a.ageMinutes - b.ageMinutes);

    return { heartbeats };
  } catch {
    return { heartbeats: [] };
  }
});
