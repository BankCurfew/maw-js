import { Elysia, t} from "elysia";
import { getFederationStatus } from "../core/transport/peers";
import { loadConfig } from "../config";
import { listSnapshots, loadSnapshot, latestSnapshot } from "../core/fleet/snapshot";
import { hostedAgents } from "../commands/shared/federation-sync";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { FLEET_DIR } from "../core/paths";

// Re-export so existing importers (and any future code) can still reach
// hostedAgents via the API module. The canonical home is federation-sync.ts.
export { hostedAgents };

export const federationApi = new Elysia();

/**
 * POST /api/federation/send — receive a send from a remote peer.
 * Unlike /api/send which uses resolveTarget (cross-node routing), this
 * endpoint resolves the target locally via findWindow then sends directly.
 * This is the endpoint v1 peers expect, and what v2 peers call during
 * federation relay. HMAC-protected via federation-auth middleware.
 */
federationApi.post("/federation/send", async ({ body, set}) => {
  const { target, text, from: senderName } = body as { target: string; text: string; from?: string };
  if (!target || !text) { set.status = 400; return { error: "target and text required" }; }

  const { listSessions, sendKeys } = await import("../core/transport/ssh");
  const { findWindow } = await import("../core/runtime/find-window");
  const { resolveFleetSession } = await import("../commands/shared/wake");

  const sessions = await listSessions();
  // Resolve oracle name → tmux target (e.g. "bob" → "01-bob:0")
  let resolved = findWindow(sessions, target);
  if (!resolved) {
    // Try fleet config resolution (e.g. "bob" → session "01-bob")
    const fleetSession = resolveFleetSession(target) || resolveFleetSession(target.replace(/-oracle$/, ""));
    if (fleetSession) {
      const filtered = sessions.filter(s => s.name === fleetSession);
      resolved = findWindow(filtered, target) || (filtered.length ? `${fleetSession}:0` : null);
    }
  }
  if (!resolved) { set.status = 404; return { error: `target not found: ${target}` }; }

  await sendKeys(resolved, text);

  // Audit trail: log inbound federation message to feed.log + maw-log.jsonl
  try {
    const config = loadConfig();
    const node = config.node ?? "local";
    const ts = new Date().toISOString();
    const sender = senderName || "unknown";
    // feed.log entry
    const feedLine = `${ts.replace("T", " ").slice(0, 19)} | ${node} | ${require("os").hostname()} | Notification | federation | maw-hey » received from ${sender}: ${text.slice(0, 100)}\n`;
    const { appendFileSync } = await import("fs");
    appendFileSync(join(homedir(), ".oracle", "feed.log"), feedLine);
    // maw-log.jsonl entry
    const logEntry = JSON.stringify({ ts, from: sender, to: target, msg: text.slice(0, 500), host: node, route: "federation/send" }) + "\n";
    appendFileSync(join(homedir(), ".oracle", "maw-log.jsonl"), logEntry);
  } catch { /* non-fatal — don't block message delivery */ }

  return { ok: true, target: resolved, text };
});

// PUBLIC FEDERATION API (v1) — no auth. Shape is load-bearing for lens
// clients; `peers[].node` and `peers[].agents` are optional (commit 9a0546d+).
// See docs/federation.md before changing fields.
federationApi.get("/federation/status", async () => {
  const status = await getFederationStatus();
  return status;
});

/** Snapshots API — list and view fleet time machine snapshots */
federationApi.get("/snapshots", () => {
  return listSnapshots();
});

federationApi.get("/snapshots/:id", ({ params, set}) => {
  const snap = loadSnapshot(params.id);
  if (!snap) { set.status = 404; return { error: "snapshot not found" }; }
  return snap;
});

/** Node identity — public endpoint for federation dedup (#192) + clock health (#268). */
federationApi.get("/identity", async () => {
  const config = loadConfig();
  const node = config.node ?? "local";
  const agents = hostedAgents(config.agents || {}, node);
  const pkg = require("../../package.json");
  return {
    node,
    version: pkg.version,
    agents,
    uptime: Math.floor(process.uptime()),
    clockUtc: new Date().toISOString(),
  };
});

/** Message log — query maw-log.jsonl for federation link data */
federationApi.get("/messages", ({ query }) => {
  const from = query.from;
  const to = query.to;
  const limit = Math.min(parseInt(query.limit || "100"), 1000);
  const logFile = join(homedir(), ".oracle", "maw-log.jsonl");
  try {
    const lines = readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean);
    interface MawMessage { ts: string; from: string; to: string; msg: string; host?: string; route?: string }
    let messages: MawMessage[] = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (from) messages = messages.filter(m => m.from?.includes(from));
    if (to) messages = messages.filter(m => m.to?.includes(to));
    return { messages: messages.slice(-limit), total: messages.length };
  } catch {
    return { messages: [], total: 0 };
  }
}, {
  query: t.Object({
    from: t.Optional(t.String()),
    to: t.Optional(t.String()),
    limit: t.Optional(t.String()),
  }),
});

/** Fleet configs — serve fleet/*.json with lineage data */
federationApi.get("/fleet", () => {
  try {
    const files = readdirSync(FLEET_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".disabled"));
    const configs = files.map(f => {
      try { return { file: f, ...JSON.parse(readFileSync(join(FLEET_DIR, f), "utf-8")) }; } catch { return null; }
    }).filter(Boolean);
    return { fleet: configs };
  } catch {
    return { fleet: [] };
  }
});

/** Auth status — public diagnostic endpoint (never reveals the token) */
federationApi.get("/auth/status", () => {
  const config = loadConfig();
  const token = config.federationToken;
  return {
    enabled: !!token,
    tokenConfigured: !!token,
    tokenPreview: token ? token.slice(0, 4) + "****" : null,
    method: token ? "HMAC-SHA256" : "none",
    clockUtc: new Date().toISOString(),
    node: config.node ?? "local",
  };
});
