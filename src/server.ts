import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { listSessions, capture, sendKeys, selectWindow } from "./ssh";
import { tmux } from "./tmux";
import { processMirror } from "./commands/overview";
import { FeedTailer } from "./feed-tail";
import { MawEngine } from "./engine";
import { LoopEngine } from "./loops";
import { isAuthenticated, handleLogin, handleLogout, getActiveSessions, LOGIN_PAGE, isAuthEnabled, generateQrToken, getQrTokenStatus, approveQrToken, QR_APPROVE_PAGE } from "./auth";
import type { WSData } from "./types";

const app = new Hono();

// Module-level engine reference (set by startServer)
let engine: MawEngine | null = null;

app.use("/api/*", async (c, next) => {
  await next();
  c.header("Access-Control-Allow-Private-Network", "true");
});
app.use("/api/*", cors());

// --- Auth routes (always accessible) ---
app.get("/auth/login", (c) => c.html(LOGIN_PAGE));
app.post("/auth/login", async (c) => {
  const { username, password } = await c.req.json();
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "direct";
  const result = handleLogin(username, password, c.req.header("user-agent") || "", ip);
  if (result.ok) {
    return c.json({ ok: true }, 200, {
      "Set-Cookie": `maw_session=${result.sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
    });
  }
  return c.json({ ok: false, error: result.error }, 401);
});
app.get("/auth/logout", (c) => {
  handleLogout(c.req.raw);
  return c.redirect("/auth/login", 302, {
    "Set-Cookie": "maw_session=; Path=/; HttpOnly; Max-Age=0",
  } as any);
});
app.post("/auth/logout", (c) => {
  handleLogout(c.req.raw);
  return c.json({ ok: true }, 200, {
    "Set-Cookie": "maw_session=; Path=/; HttpOnly; Max-Age=0",
  });
});
app.get("/auth/me", (c) => {
  const authed = isAuthenticated(c.req.raw);
  return c.json({ authenticated: authed, authEnabled: isAuthEnabled() });
});
app.get("/api/auth/sessions", (c) => {
  if (!isAuthenticated(c.req.raw)) return c.json({ error: "unauthorized" }, 401);
  return c.json(getActiveSessions());
});

// --- QR Code Login ---
app.get("/auth/qr-generate", (c) => {
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "direct";
  const ua = c.req.header("user-agent") || "";
  const result = generateQrToken(ua, ip);
  return c.json(result);
});

app.get("/auth/qr-approve", (c) => {
  const token = c.req.query("token");
  if (!token) return c.text("Missing token", 400);
  // Must be authenticated (logged in on phone)
  if (!isAuthenticated(c.req.raw)) {
    // Redirect to login, then back to approve page
    return c.redirect(`/auth/login?redirect=/auth/qr-approve?token=${encodeURIComponent(token)}`);
  }
  const ua = c.req.header("user-agent") || "Unknown device";
  return c.html(QR_APPROVE_PAGE(token, ua));
});

app.post("/auth/qr-approve", async (c) => {
  // Must be authenticated (logged in on phone)
  if (!isAuthenticated(c.req.raw)) {
    return c.json({ ok: false, error: "Not authenticated" }, 401);
  }
  const { token } = await c.req.json();
  if (!token) return c.json({ ok: false, error: "Missing token" }, 400);
  const cookie = c.req.header("cookie") || "";
  const match = cookie.match(/maw_session=([a-f0-9]+)/);
  const approverSession = match ? match[1] : "unknown";
  const result = approveQrToken(token, approverSession);
  if (!result.ok) return c.json(result, 400);
  return c.json({ ok: true });
});

app.get("/auth/qr-status", (c) => {
  const token = c.req.query("token");
  if (!token) return c.json({ error: "Missing token" }, 400);
  const result = getQrTokenStatus(token);
  if (result.status === "approved" && result.sessionId) {
    // Set HttpOnly cookie server-side (same as password login)
    return c.json({ status: "approved" }, 200, {
      "Set-Cookie": `maw_session=${result.sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`,
    });
  }
  return c.json(result);
});

// --- Auth middleware — protect everything except /auth/* ---
app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  // Skip auth for auth routes, static assets needed for login, and attachments (UUID-based, unguessable)
  if (path.startsWith("/auth/") || path.startsWith("/api/attachments/")) return next();

  if (!isAuthenticated(c.req.raw)) {
    // API calls get 401, pages get redirect
    if (path.startsWith("/api/") || path.startsWith("/ws")) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return c.redirect("/auth/login");
  }
  return next();
});

// API routes (keep for CLI compatibility)
app.get("/api/sessions", async (c) => c.json(await listSessions()));

app.get("/api/capture", async (c) => {
  const target = c.req.query("target");
  if (!target) return c.json({ error: "target required" }, 400);
  try {
    return c.json({ content: await capture(target) });
  } catch (e: any) {
    return c.json({ content: "", error: e.message });
  }
});

app.get("/api/mirror", async (c) => {
  const target = c.req.query("target");
  if (!target) return c.text("target required", 400);
  const lines = +(c.req.query("lines") || "40");
  const raw = await capture(target);
  return c.text(processMirror(raw, lines));
});

app.post("/api/send", async (c) => {
  const { target, text } = await c.req.json();
  if (!target || !text) return c.json({ error: "target and text required" }, 400);
  await sendKeys(target, text);
  return c.json({ ok: true, target, text });
});

app.post("/api/select", async (c) => {
  const { target } = await c.req.json();
  if (!target) return c.json({ error: "target required" }, 400);
  await selectWindow(target);
  return c.json({ ok: true, target });
});

// Serve React app from root (single entry point for all views)
app.get("/", serveStatic({ root: "./dist-office", path: "/index.html" }));

// Legacy redirects — old paths → hash routes in the React app
app.get("/dashboard", (c) => c.redirect("/#orbital"));
app.get("/office", (c) => c.redirect("/#office"));

// Serve React app assets
app.get("/assets/*", serveStatic({ root: "./dist-office" }));

// Keep /office/* for backward compat (deep-links, bookmarks)
app.get("/office/*", serveStatic({
  root: "./",
  rewriteRequestPath: (p) => p.replace(/^\/office/, "/dist-office"),
}));

// Serve 8-bit office (Bevy WASM)
app.get("/office-8bit", serveStatic({ root: "./dist-8bit-office", path: "/index.html" }));
app.get("/office-8bit/*", serveStatic({
  root: "./",
  rewriteRequestPath: (p) => p.replace(/^\/office-8bit/, "/dist-8bit-office"),
}));

// Serve War Room (Bevy WASM)
app.get("/war-room", serveStatic({ root: "./dist-war-room", path: "/index.html" }));
app.get("/war-room/*", serveStatic({
  root: "./",
  rewriteRequestPath: (p) => p.replace(/^\/war-room/, "/dist-war-room"),
}));

// Serve Race Track (Bevy WASM)
app.get("/race-track", serveStatic({ root: "./dist-race-track", path: "/index.html" }));
app.get("/race-track/*", serveStatic({
  root: "./",
  rewriteRequestPath: (p) => p.replace(/^\/race-track/, "/dist-race-track"),
}));

// Serve Superman Universe (Bevy WASM)
app.get("/superman", serveStatic({ root: "./dist-superman", path: "/index.html" }));
app.get("/superman/*", serveStatic({
  root: "./",
  rewriteRequestPath: (p) => p.replace(/^\/superman/, "/dist-superman"),
}));

// Oracle v2 proxy — search, stats
import { loadConfig, buildCommand, saveConfig, configForDisplay } from "./config";
const ORACLE_URL = process.env.ORACLE_URL || loadConfig().oracleUrl;

app.get("/api/oracle/search", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json({ error: "q required" }, 400);
  const params = new URLSearchParams({ q, mode: c.req.query("mode") || "hybrid", limit: c.req.query("limit") || "10" });
  const model = c.req.query("model");
  if (model) params.set("model", model);
  try {
    const res = await fetch(`${ORACLE_URL}/api/search?${params}`);
    return c.json(await res.json());
  } catch (e: any) {
    return c.json({ error: `Oracle unreachable: ${e.message}` }, 502);
  }
});

app.get("/api/oracle/traces", async (c) => {
  const limit = c.req.query("limit") || "10";
  try {
    const res = await fetch(`${ORACLE_URL}/api/traces?limit=${limit}`);
    return c.json(await res.json());
  } catch (e: any) {
    return c.json({ error: `Oracle unreachable: ${e.message}` }, 502);
  }
});

app.get("/api/oracle/stats", async (c) => {
  try {
    const res = await fetch(`${ORACLE_URL}/api/stats`);
    return c.json(await res.json());
  } catch (e: any) {
    return c.json({ error: `Oracle unreachable: ${e.message}` }, 502);
  }
});

// --- Rooms config (HR-managed) ---
import { readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from "fs";
import { join, basename } from "path";

const roomsPath = join(import.meta.dir, "../rooms.json");

app.get("/api/rooms", (c) => {
  try {
    if (!existsSync(roomsPath)) return c.json({ rooms: [] });
    return c.json(JSON.parse(readFileSync(roomsPath, "utf-8")));
  } catch {
    return c.json({ rooms: [] });
  }
});

app.post("/api/rooms", async (c) => {
  try {
    const body = await c.req.json();
    body.updatedAt = new Date().toISOString();
    writeFileSync(roomsPath, JSON.stringify(body, null, 2), "utf-8");
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

// --- UI State persistence (cross-device) ---

const uiStatePath = join(import.meta.dir, "../ui-state.json");

app.get("/api/ui-state", (c) => {
  try {
    if (!existsSync(uiStatePath)) return c.json({});
    return c.json(JSON.parse(readFileSync(uiStatePath, "utf-8")));
  } catch {
    return c.json({});
  }
});

app.post("/api/ui-state", async (c) => {
  try {
    const body = await c.req.json();
    writeFileSync(uiStatePath, JSON.stringify(body, null, 2), "utf-8");
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

// --- Asks persistence (inbox) ---
const asksPath = join(import.meta.dir, "../asks.json");

app.get("/api/asks", (c) => {
  try {
    if (!existsSync(asksPath)) return c.json([]);
    const asks = JSON.parse(readFileSync(asksPath, "utf-8"));
    // Filter out stale "waiting for input" noise
    const clean = asks.filter((a: any) => {
      const msg = (a.message || "").toLowerCase();
      return !msg.includes("waiting for input") && !msg.includes("waiting for your input");
    });
    return c.json(clean);
  } catch {
    return c.json([]);
  }
});

app.post("/api/asks", async (c) => {
  try {
    const body = await c.req.json();
    writeFileSync(asksPath, JSON.stringify(body, null, 2), "utf-8");
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

// --- Task Activity Log ---
import { readTaskLog, getAllLogSummaries, appendActivity } from "./task-log";
import { loadProjects, saveProjects, addTaskToProject, removeTaskFromProject, createProject, updateProject, autoOrganize, getProjectBoardData } from "./projects";

app.get("/api/task-log", (c) => {
  const taskId = c.req.query("taskId");
  if (!taskId) return c.json({ error: "taskId required" }, 400);
  return c.json({ taskId, activities: readTaskLog(taskId) });
});

app.get("/api/task-log/summaries", (c) => {
  return c.json(getAllLogSummaries());
});

app.post("/api/task-log", async (c) => {
  try {
    const body = await c.req.json();
    if (!body.taskId || !body.content) return c.json({ error: "taskId and content required" }, 400);
    const activity = appendActivity({
      taskId: body.taskId,
      type: body.type || "note",
      oracle: body.oracle || "api",
      content: body.content,
      meta: body.meta,
    });
    return c.json({ ok: true, activity });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

// --- Projects ---

app.get("/api/projects", (c) => {
  return c.json(loadProjects());
});

app.post("/api/projects", async (c) => {
  try {
    const body = await c.req.json();
    if (body.action === "create") {
      const project = createProject(body.id, body.name, body.description || "");
      return c.json({ ok: true, project });
    } else if (body.action === "update") {
      const project = updateProject(body.id, body.updates || {});
      return c.json({ ok: true, project });
    } else if (body.action === "add-task") {
      addTaskToProject(body.projectId, body.taskId, body.parentTaskId);
      return c.json({ ok: true });
    } else if (body.action === "remove-task") {
      removeTaskFromProject(body.projectId, body.taskId);
      return c.json({ ok: true });
    } else if (body.action === "auto-organize") {
      const { fetchBoardData: fetchBoard } = await import("./board");
      const items = await fetchBoard();
      const result = autoOrganize(items);
      return c.json({ ok: true, ...result });
    } else {
      return c.json({ error: "unknown action" }, 400);
    }
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

app.get("/api/project-board", async (c) => {
  try {
    const { fetchBoardData: fetchBoard } = await import("./board");
    const items = await fetchBoard(c.req.query("filter") || undefined);
    const data = getProjectBoardData(items);
    return c.json(data);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Fleet Config ---

const fleetDir = join(import.meta.dir, "../fleet");

app.get("/api/fleet-config", (c) => {
  try {
    const files = readdirSync(fleetDir).filter(f => f.endsWith(".json") && !f.endsWith(".disabled"));
    const configs = files.map(f => JSON.parse(readFileSync(join(fleetDir, f), "utf-8")));
    return c.json({ configs });
  } catch (e: any) {
    return c.json({ configs: [], error: e.message });
  }
});

// List all config files (maw.config.json + fleet/*.json + fleet/*.json.disabled)
app.get("/api/config-files", (c) => {
  const files: { name: string; path: string; enabled: boolean }[] = [
    { name: "maw.config.json", path: "maw.config.json", enabled: true },
  ];
  try {
    const entries = readdirSync(fleetDir).filter(f => f.endsWith(".json") || f.endsWith(".json.disabled")).sort();
    for (const f of entries) {
      const enabled = !f.endsWith(".disabled");
      files.push({ name: f, path: `fleet/${f}`, enabled });
    }
  } catch {}
  return c.json({ files });
});

// Read a single config file
app.get("/api/config-file", (c) => {
  const filePath = c.req.query("path");
  if (!filePath) return c.json({ error: "path required" }, 400);
  const fullPath = join(import.meta.dir, "..", filePath);
  if (!existsSync(fullPath)) return c.json({ error: "not found" }, 404);
  try {
    const content = readFileSync(fullPath, "utf-8");
    // For maw.config.json, mask env values
    if (filePath === "maw.config.json") {
      const data = JSON.parse(content);
      const display = configForDisplay();
      data.env = display.envMasked;
      return c.json({ content: JSON.stringify(data, null, 2) });
    }
    return c.json({ content });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Save a config file
app.post("/api/config-file", async (c) => {
  const filePath = c.req.query("path");
  if (!filePath) return c.json({ error: "path required" }, 400);
  // Only allow maw.config.json and fleet/ files
  if (filePath !== "maw.config.json" && !filePath.startsWith("fleet/")) {
    return c.json({ error: "invalid path" }, 403);
  }
  try {
    const { content } = await c.req.json();
    JSON.parse(content); // validate JSON
    const fullPath = join(import.meta.dir, "..", filePath);
    if (filePath === "maw.config.json") {
      // Handle masked env values
      const parsed = JSON.parse(content);
      if (parsed.env && typeof parsed.env === "object") {
        const current = loadConfig();
        for (const [k, v] of Object.entries(parsed.env as Record<string, string>)) {
          if (/\u2022/.test(v)) parsed.env[k] = current.env[k] || v;
        }
      }
      saveConfig(parsed);
    } else {
      writeFileSync(fullPath, content + "\n", "utf-8");
    }
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

// Toggle enable/disable a fleet file
app.post("/api/config-file/toggle", async (c) => {
  const filePath = c.req.query("path");
  if (!filePath || !filePath.startsWith("fleet/")) return c.json({ error: "invalid path" }, 400);
  const fullPath = join(import.meta.dir, "..", filePath);
  if (!existsSync(fullPath)) return c.json({ error: "not found" }, 404);
  const isDisabled = filePath.endsWith(".disabled");
  const newPath = isDisabled ? fullPath.replace(/\.disabled$/, "") : fullPath + ".disabled";
  const newRelPath = isDisabled ? filePath.replace(/\.disabled$/, "") : filePath + ".disabled";
  renameSync(fullPath, newPath);
  return c.json({ ok: true, newPath: newRelPath });
});

// Delete a fleet file
app.delete("/api/config-file", async (c) => {
  const filePath = c.req.query("path");
  if (!filePath || !filePath.startsWith("fleet/")) return c.json({ error: "cannot delete" }, 400);
  const fullPath = join(import.meta.dir, "..", filePath);
  if (!existsSync(fullPath)) return c.json({ error: "not found" }, 404);
  unlinkSync(fullPath);
  return c.json({ ok: true });
});

// Create a new fleet file
app.put("/api/config-file", async (c) => {
  const { name, content } = await c.req.json();
  if (!name || !name.endsWith(".json")) return c.json({ error: "name must end with .json" }, 400);
  const safeName = basename(name);
  const fullPath = join(fleetDir, safeName);
  if (existsSync(fullPath)) return c.json({ error: "file already exists" }, 409);
  try { JSON.parse(content); } catch { return c.json({ error: "invalid JSON" }, 400); }
  writeFileSync(fullPath, content + "\n", "utf-8");
  return c.json({ ok: true, path: `fleet/${safeName}` });
});

// --- Config API ---
app.get("/api/config", (c) => {
  if (c.req.query("raw") === "1") return c.json(loadConfig());
  return c.json(configForDisplay());
});

app.post("/api/config", async (c) => {
  try {
    const body = await c.req.json();
    // If env has masked values (bullet chars), keep originals for those keys
    if (body.env && typeof body.env === "object") {
      const current = loadConfig();
      const merged: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.env as Record<string, string>)) {
        merged[k] = /\u2022/.test(v) ? (current.env[k] || v) : v;
      }
      body.env = merged;
    }
    saveConfig(body);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

// --- Worktree Hygiene ---
import { scanWorktrees, cleanupWorktree } from "./worktrees";

app.get("/api/worktrees", async (c) => {
  try {
    return c.json(await scanWorktrees());
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.post("/api/worktrees/cleanup", async (c) => {
  const { path } = await c.req.json();
  if (!path) return c.json({ error: "path required" }, 400);
  try {
    const log = await cleanupWorktree(path);
    return c.json({ ok: true, log });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Hall of Fame ---
const hallOfFamePath = join(process.env.HOME || "/home/mbank", "repos/github.com/BankCurfew/HR-Oracle/hall-of-fame/data.json");

app.get("/api/hall-of-fame", (c) => {
  try {
    if (!existsSync(hallOfFamePath)) return c.json({ error: "data.json not found" }, 404);
    return c.json(JSON.parse(readFileSync(hallOfFamePath, "utf-8")));
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Token Usage ---
import { loadIndex, buildIndex, summarize, realtimeRate } from "./token-index";

app.get("/api/tokens", (c) => {
  const rebuild = c.req.query("rebuild") === "1";
  const index = rebuild ? buildIndex() : loadIndex();
  if (index.sessions.length === 0) return c.json({ error: "No index. GET /api/tokens?rebuild=1" }, 404);
  return c.json({ ...summarize(index), updatedAt: index.updatedAt });
});

app.get("/api/tokens/rate", (c) => {
  const mode = c.req.query("mode") || "hour"; // "hour" = current clock hour, "window" = sliding window
  if (mode === "window") {
    const window = Math.min(7200, Math.max(60, +(c.req.query("window") || "300")));
    return c.json(realtimeRate(window));
  }
  // Current clock hour: from XX:00:00 to now
  const now = new Date();
  const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0);
  const elapsed = Math.max(1, Math.round((now.getTime() - hourStart.getTime()) / 1000));
  const result = realtimeRate(elapsed);
  return c.json({ ...result, hour: now.getHours(), elapsed });
});

// --- Maw Log (Oracle chat history) ---
import { readLog } from "./maw-log";

app.get("/api/maw-log", (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const limit = Math.min(500, +(c.req.query("limit") || "200"));
  let entries = readLog();
  if (from) entries = entries.filter(e => e.from === from || e.to === from);
  if (to) entries = entries.filter(e => e.to === to || e.from === to);
  const total = entries.length;
  entries = entries.slice(-limit);
  return c.json({ entries, total });
});

// --- Oracle Progress ---
import { readProgress, getOracleProgress } from "./progress";

app.get("/api/progress", (c) => {
  return c.json(readProgress());
});

app.get("/api/progress/:oracle", (c) => {
  const oracle = c.req.param("oracle").toLowerCase();
  const progress = getOracleProgress(oracle);
  if (!progress) return c.json({ error: "no progress found" }, 404);
  return c.json(progress);
});

// --- Oracle Feed ---
const feedTailer = new FeedTailer();

app.get("/api/feed", (c) => {
  const limit = Math.min(200, +(c.req.query("limit") || "50"));
  const oracle = c.req.query("oracle") || undefined;
  let events = feedTailer.getRecent(limit);
  if (oracle) events = events.filter(e => e.oracle === oracle);
  const active = [...feedTailer.getActive().keys()];
  return c.json({ events: events.reverse(), total: events.length, active_oracles: active });
});

// --- Oracle Health API ---

app.get("/api/oracle-health", (c) => {
  if (!engine) {
    return c.json({ error: "Server not fully initialized", timestamp: new Date().toISOString() }, 503);
  }
  const summary = engine.getHealthSummary();
  if (!summary) {
    return c.json({ error: "Health data not yet available — check back in 30s", timestamp: new Date().toISOString() }, 503);
  }
  return c.json(summary);
});

// --- BoB Face SSE (WALL-E Eyes emotion state) ---
// Emotions: neutral, thinking, happy, alert, confused, working, sleeping, error
app.get("/api/bob/state", (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
      };

      let lastEmotion = "";
      let idleSince = Date.now();

      const tick = () => {
        const active = feedTailer.getActive();       // 5-min window
        const recent = feedTailer.getActive(15_000);  // 15s window for "live" activity
        const activeCount = active.size;
        const recentCount = recent.size;
        const hour = (new Date().getUTCHours() + 7) % 24; // Bangkok hour

        // Check for recent errors (PostToolUseFailure in last 30s)
        const recentEvents = feedTailer.getRecent(50);
        const now = Date.now();
        const hasRecentError = recentEvents.some(
          (e) => e.event === "PostToolUseFailure" && now - e.ts < 30_000,
        );

        // Check for recent task completions (last 10s)
        const hasRecentComplete = recentEvents.some(
          (e) => e.event === "TaskCompleted" && now - e.ts < 10_000,
        );

        // Derive emotion from real fleet state
        let emotion = "neutral";
        let message: string | null = null;

        if (hasRecentError) {
          // Error state — something just failed
          emotion = "error";
          const errEvent = recentEvents.find(
            (e) => e.event === "PostToolUseFailure" && now - e.ts < 30_000,
          );
          message = errEvent
            ? `${errEvent.oracle}: ${errEvent.message.slice(0, 60)}`
            : "Something went wrong";
        } else if (hasRecentComplete) {
          // Happy — task just completed
          emotion = "happy";
          const doneEvent = recentEvents.find(
            (e) => e.event === "TaskCompleted" && now - e.ts < 10_000,
          );
          message = doneEvent ? `${doneEvent.oracle} finished a task!` : "Task done!";
        } else if (activeCount === 0 && hour >= 0 && hour < 6) {
          // Late night + no activity → sleeping
          emotion = "sleeping";
          message = "zzZ...";
        } else if (activeCount === 0) {
          // No oracles active — check how long idle
          const idleDuration = now - idleSince;
          if (idleDuration > 5 * 60_000) {
            emotion = "sleeping";
            message = null;
          } else {
            emotion = "neutral";
            message = null;
          }
        } else if (recentCount >= 3) {
          // Many oracles actively working right now
          emotion = "working";
          const names = [...recent.keys()].slice(0, 3).join(", ");
          message = `${recentCount} oracles busy: ${names}`;
        } else if (recentCount >= 1) {
          // Oracles doing tool calls right now → thinking
          const latestOracle = [...recent.values()][0];
          const isToolUse = latestOracle?.event === "PreToolUse";
          if (isToolUse) {
            emotion = "thinking";
            message = `${latestOracle.oracle} is working...`;
          } else {
            emotion = "working";
            const names = [...recent.keys()].join(", ");
            message = `watching ${names}`;
          }
        } else if (activeCount >= 1) {
          // Oracles active but not in last 15s → alert (winding down)
          emotion = "alert";
          const names = [...active.keys()].slice(0, 3).join(", ");
          message = `${activeCount} oracle${activeCount > 1 ? "s" : ""} online: ${names}`;
        }

        // Track idle start
        if (activeCount > 0) idleSince = now;

        // Only send if emotion changed (reduce noise)
        const payload = { emotion, message, activeCount, timestamp: new Date().toISOString() };
        if (emotion !== lastEmotion) {
          send(payload);
          lastEmotion = emotion;
        } else {
          // Still send periodic heartbeat every 5 ticks (25s)
          send(payload);
        }
      };

      tick();
      const id = setInterval(tick, 5000);
      c.req.raw.signal.addEventListener("abort", () => clearInterval(id));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// --- Anti-Pattern Scan API ---
app.get("/api/anti-patterns", (c) => {
  const { runAntiPatternScan } = require("./anti-patterns");
  return c.json(runAntiPatternScan());
});

// --- Sovereign Status API ---
app.get("/api/sovereign", (c) => {
  const { getSovereignStatus, verifySovereignHealth } = require("./commands/sovereign");
  return c.json({ status: getSovereignStatus(), health: verifySovereignHealth() });
});

// --- Wake API (for health page restart when no tmux session exists) ---
app.post("/api/wake/:oracle", async (c) => {
  const oracle = c.req.param("oracle");
  try {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "wake", oracle], {
      cwd: import.meta.dir.replace(/\/src$/, ""),
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return c.json({ ok: true, oracle });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Loops API ---
const loopEngine = new LoopEngine();

app.get("/api/loops", (c) => {
  return c.json({ enabled: loopEngine.isEnabled(), loops: loopEngine.getStatus() });
});

app.get("/api/loops/history", (c) => {
  const loopId = c.req.query("loopId") || undefined;
  const limit = +(c.req.query("limit") || "50");
  return c.json(loopEngine.getHistory(loopId, limit));
});

app.post("/api/loops/trigger", async (c) => {
  const { loopId } = await c.req.json();
  if (!loopId) return c.json({ error: "loopId required" }, 400);
  const result = await loopEngine.triggerLoop(loopId);
  return c.json(result);
});

app.post("/api/loops/add", async (c) => {
  try {
    const newLoop = await c.req.json();
    if (!newLoop.id || !newLoop.schedule) return c.json({ error: "id and schedule required" }, 400);
    const { readFileSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const loopsPath = join(import.meta.dir, "../loops.json");
    const config = JSON.parse(readFileSync(loopsPath, "utf-8"));
    const idx = config.loops.findIndex((l: any) => l.id === newLoop.id);
    if (idx >= 0) {
      config.loops[idx] = { ...config.loops[idx], ...newLoop };
    } else {
      config.loops.push(newLoop);
    }
    writeFileSync(loopsPath, JSON.stringify(config, null, 2), "utf-8");
    return c.json({ ok: true, action: idx >= 0 ? "updated" : "added" });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

app.delete("/api/loops", async (c) => {
  const loopId = c.req.query("id");
  if (!loopId) return c.json({ error: "id required" }, 400);
  const { readFileSync, writeFileSync } = await import("fs");
  const { join } = await import("path");
  const loopsPath = join(import.meta.dir, "../loops.json");
  const config = JSON.parse(readFileSync(loopsPath, "utf-8"));
  const before = config.loops.length;
  config.loops = config.loops.filter((l: any) => l.id !== loopId);
  writeFileSync(loopsPath, JSON.stringify(config, null, 2), "utf-8");
  return c.json({ ok: config.loops.length < before });
});

app.post("/api/loops/toggle", async (c) => {
  const { loopId, enabled } = await c.req.json();
  if (loopId) {
    const ok = loopEngine.toggleLoop(loopId, enabled);
    return c.json({ ok });
  } else {
    loopEngine.toggleEngine(enabled);
    return c.json({ ok: true });
  }
});

// Jarvis API proxy — forward /api/jarvis/* to Admin-Oracle :3200
const JARVIS_API_URL = process.env.JARVIS_API_URL || "http://localhost:3200";
app.all("/api/jarvis/*", async (c) => {
  const path = c.req.path; // e.g. /api/jarvis/stats
  const qs = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "";
  const target = `${JARVIS_API_URL}${path}${qs}`;
  try {
    const res = await fetch(target, {
      method: c.req.method,
      headers: c.req.method !== "GET" ? { "Content-Type": "application/json" } : {},
      body: c.req.method !== "GET" ? await c.req.text() : undefined,
    });
    const data = await res.json();
    return c.json(data, res.status as any);
  } catch (e: any) {
    return c.json({ error: `Jarvis API unreachable: ${e.message}` }, 502);
  }
});

// --- File Attachments ---
import { mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { extname } from "path";

const attachDir = join(import.meta.dir, "../attachments");
mkdirSync(attachDir, { recursive: true });

app.post("/api/attach", async (c) => {
  try {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) return c.json({ error: "file required" }, 400);

    // Limit to 20MB
    if (file.size > 20 * 1024 * 1024) return c.json({ error: "file too large (max 20MB)" }, 400);

    const ext = extname(file.name) || "";
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
    const buf = await file.arrayBuffer();
    const fullPath = join(attachDir, id);
    writeFileSync(fullPath, Buffer.from(buf));

    const url = `/api/attachments/${id}`;
    const port = +(process.env.MAW_PORT || loadConfig().port || 3456);
    const localUrl = `http://localhost:${port}${url}`;
    return c.json({ ok: true, id, url, localUrl, name: file.name, size: file.size, mimeType: file.type });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

app.get("/api/attachments/:id", (c) => {
  const id = c.req.param("id");
  // Sanitize: only allow filename chars
  if (!id || /[/\\]/.test(id)) return c.json({ error: "invalid id" }, 400);
  const fullPath = join(attachDir, id);
  if (!existsSync(fullPath)) return c.json({ error: "not found" }, 404);
  const file = Bun.file(fullPath);
  return new Response(file, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

app.onError((err, c) => c.json({ error: err.message }, 500));

export { app };

// --- WebSocket + Server ---

import { handlePtyMessage, handlePtyClose } from "./pty";
import { installAutoReport } from "./auto-report";

export function startServer(port = +(process.env.MAW_PORT || loadConfig().port || 3456)) {
  engine = new MawEngine({ feedTailer });

  // LAW #7: Auto-report to Bob when oracle sessions end without /talk-to bob
  installAutoReport(feedTailer);

  const wsHandler = {
    open: (ws: any) => {
      if (ws.data.mode === "pty") return;
      engine.handleOpen(ws);
    },
    message: (ws: any, msg: any) => {
      if (ws.data.mode === "pty") { handlePtyMessage(ws, msg); return; }
      engine.handleMessage(ws, msg);
    },
    close: (ws: any) => {
      if (ws.data.mode === "pty") { handlePtyClose(ws); return; }
      engine.handleClose(ws);
    },
  };

  const fetchHandler = (req: Request, server: any) => {
    const url = new URL(req.url);
    // Protect WebSocket endpoints with auth
    if (url.pathname === "/ws/pty" || url.pathname === "/ws") {
      if (!isAuthenticated(req)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const mode = url.pathname === "/ws/pty" ? "pty" : undefined;
      const data = { target: null, previewTargets: new Set(), ...(mode ? { mode } : {}) } as WSData;
      if (server.upgrade(req, { data })) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return app.fetch(req);
  };

  // HTTP server (always)
  const server = Bun.serve({ port, fetch: fetchHandler, websocket: wsHandler });

  // Start Loop Engine
  loopEngine.start((msg) => engine.broadcast(msg));

  // Ensure a general-purpose "shell" tmux session with Claude Code exists
  tmux.hasSession("shell").then(async (exists) => {
    if (!exists) {
      await tmux.run("new-session", "-d", "-s", "shell", "-x", "200", "-y", "50").catch(() => {});
      // Auto-launch Claude Code in the shell session
      setTimeout(() => tmux.run("send-keys", "-t", "shell:0", "claude --dangerously-skip-permissions", "Enter").catch(() => {}), 1000);
    }
  });

  console.log(`maw serve → http://localhost:${port} (ws://localhost:${port}/ws)`);

  // HTTPS server (if mkcert certs exist)
  const certPath = join(import.meta.dir, "../white.local+3.pem");
  const keyPath = join(import.meta.dir, "../white.local+3-key.pem");
  if (existsSync(certPath) && existsSync(keyPath)) {
    const tlsPort = port + 1;
    const tls = { cert: readFileSync(certPath), key: readFileSync(keyPath) };
    Bun.serve({ port: tlsPort, tls, fetch: fetchHandler, websocket: wsHandler });
    console.log(`maw serve → https://localhost:${tlsPort} (wss://localhost:${tlsPort}/ws) [TLS]`);
  }

  return server;
}

// --- Auto Status Heartbeat (every 15 min) ---
import { appendFileSync } from "fs";
import { MAW_LOG_PATH } from "./maw-log";

import { describeActivity } from "./lib/feed";

function statusHeartbeat() {
  try {
    const cutoff = Date.now() - 15 * 60_000;
    const events = feedTailer.getRecent(500).filter(e => e.ts >= cutoff);
    if (events.length === 0) return;

    // Only count real work events (tool uses, prompts)
    const workEvents = events.filter(e =>
      e.event === "PreToolUse" || e.event === "PostToolUse" ||
      e.event === "UserPromptSubmit" || e.event === "SubagentStart"
    );
    if (workEvents.length === 0) return;

    // Group by parent oracle (neo-mawjs → neo, hermes-bitkub → hermes)
    const byParent = new Map<string, { tools: number; projects: Set<string>; lastActivity: string }>();
    for (const e of workEvents) {
      // Extract parent: "neo-oracle" → "neo", "hermes-bitkub" → "hermes", "neo-mawjs" → "neo"
      const parent = e.oracle.split("-")[0];
      const prev = byParent.get(parent) || { tools: 0, projects: new Set(), lastActivity: "" };
      prev.tools++;
      const proj = e.project.split("/").pop() || "";
      if (proj) prev.projects.add(proj);
      prev.lastActivity = describeActivity(e);
      byParent.set(parent, prev);
    }

    // Token rate for the same window
    const rate = realtimeRate(15 * 60);
    const fmt = (n: number) => n >= 1e9 ? `${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : `${n}`;

    // Build readable multiline
    const lines = [...byParent.entries()]
      .sort((a, b) => b[1].tools - a[1].tools)
      .map(([name, data]) => `${name}: ${data.tools} actions`);

    const msg = `${byParent.size} oracles, ${workEvents.length} actions\n${lines.join("\n")}\n${fmt(rate.totalPerMin)} tok/min (${fmt(rate.inputPerMin)} in, ${fmt(rate.outputPerMin)} out)`;

    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      from: "system",
      to: "all",
      msg,
      ch: "heartbeat",
    }) + "\n";

    appendFileSync(MAW_LOG_PATH, entry);
  } catch {}
}

// Auto-start unless imported by CLI (CLI sets MAW_CLI=1)
if (!process.env.MAW_CLI) {
  const server = startServer();
  // Start heartbeat after 1 min, then every 15 min
  setTimeout(() => {
    statusHeartbeat();
    setInterval(statusHeartbeat, 15 * 60 * 1000);
  }, 60_000);
}
