/**
 * Loop Executor Engine — runs scheduled loops for Oracle agents
 * Lives inside the maw-js server process (always-on via pm2)
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { join } from "path";

const LOOPS_PATH = join(import.meta.dir, "../../loops.json");
const LOOPS_LOG_PATH = join(import.meta.dir, "../../loops-log.json");
const FEED_LOG = join(process.env.HOME || "/home/mbank", ".oracle", "feed.log");
const CHECK_INTERVAL = 30_000; // check every 30 seconds

export interface LoopDef {
  id: string;
  oracle: string;
  tmux: string | null;
  schedule: string;
  prompt?: string;
  command?: string;
  requireIdle?: boolean;
  requireActiveOracles?: boolean;
  autoRestart?: boolean;
  restartDir?: string;
  enabled: boolean;
  description: string;
}

export interface LoopExecution {
  loopId: string;
  ts: string;
  status: "ok" | "skipped" | "error";
  reason?: string;
}

export interface LoopStatus {
  id: string;
  oracle: string;
  description: string;
  schedule: string;
  enabled: boolean;
  lastRun?: string;
  lastStatus?: "ok" | "skipped" | "error";
  lastReason?: string;
  nextRun?: string;
}

// --- Cron expression matching ---

function parseCronField(field: string, min: number, max: number): number[] {
  const values: number[] = [];
  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.push(i);
    } else if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2));
      for (let i = min; i <= max; i += step) values.push(i);
    } else if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      for (let i = a; i <= b; i++) values.push(i);
    } else {
      values.push(parseInt(part));
    }
  }
  return values;
}

function cronMatches(cron: string, date: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minF, hourF, domF, monF, dowF] = parts;
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1;
  const dow = date.getDay(); // 0=Sunday

  return (
    parseCronField(minF, 0, 59).includes(minute) &&
    parseCronField(hourF, 0, 23).includes(hour) &&
    parseCronField(domF, 1, 31).includes(dom) &&
    parseCronField(monF, 1, 12).includes(month) &&
    parseCronField(dowF, 0, 6).includes(dow)
  );
}

/** Calculate next matching time for a cron expression */
function nextCronMatch(cron: string, after: Date): string {
  const d = new Date(after);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  // Search up to 7 days ahead
  for (let i = 0; i < 7 * 24 * 60; i++) {
    if (cronMatches(cron, d)) return d.toISOString();
    d.setMinutes(d.getMinutes() + 1);
  }
  return "unknown";
}

// --- tmux interaction ---

async function exec(cmd: string): Promise<string> {
  const proc = Bun.spawn(["bash", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.trim();
}

async function isSessionAlive(tmuxTarget: string): Promise<boolean> {
  const session = tmuxTarget.split(":")[0];
  try {
    await exec(`tmux has-session -t '${session}' 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

async function isIdle(tmuxTarget: string): Promise<boolean> {
  try {
    const pane = await exec(`tmux capture-pane -t '${tmuxTarget}' -p 2>/dev/null | tail -5`);
    return pane.includes("❯");
  } catch {
    return false;
  }
}

async function hasActiveOracles(): Promise<boolean> {
  try {
    const now = Date.now();
    const feed = await exec(`tail -50 ${FEED_LOG} 2>/dev/null`);
    for (const line of feed.split("\n").reverse()) {
      const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
      if (match) {
        const ts = new Date(match[1]).getTime();
        if (now - ts < 600_000 && /PreToolUse|PostToolUse|cc:/.test(line)) {
          return true;
        }
      }
    }
  } catch {}
  return false;
}

async function restartSession(tmuxTarget: string, dir: string): Promise<boolean> {
  const session = tmuxTarget.split(":")[0];
  const expandedDir = dir.replace("~", process.env.HOME || "/home/mbank");
  try {
    // Create session if not exists
    await exec(`tmux new-session -d -s '${session}' -c '${expandedDir}' 2>/dev/null`);
    await new Promise(r => setTimeout(r, 2000));
    // Launch claude
    await exec(`tmux send-keys -t '${tmuxTarget}' 'claude --dangerously-skip-permissions' Enter`);
    // Wait up to 3 min for prompt
    for (let i = 0; i < 18; i++) {
      await new Promise(r => setTimeout(r, 10_000));
      if (await isIdle(tmuxTarget)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function sendPrompt(tmuxTarget: string, prompt: string): Promise<void> {
  // Use tmux send-keys with buffer for long text
  const escaped = prompt.replace(/'/g, "'\\''");
  await exec(`tmux set-buffer '${escaped}' && tmux paste-buffer -t '${tmuxTarget}' && tmux send-keys -t '${tmuxTarget}' Enter`);
}

async function runCommand(command: string): Promise<void> {
  await exec(command);
}

// --- Log management ---

function loadLog(): LoopExecution[] {
  try {
    if (existsSync(LOOPS_LOG_PATH)) {
      const data = JSON.parse(readFileSync(LOOPS_LOG_PATH, "utf-8"));
      // Keep last 500 entries
      return Array.isArray(data) ? data.slice(-500) : [];
    }
  } catch {}
  return [];
}

function appendLog(entry: LoopExecution) {
  const log = loadLog();
  log.push(entry);
  writeFileSync(LOOPS_LOG_PATH, JSON.stringify(log.slice(-500), null, 2), "utf-8");
}

function feedLog(message: string) {
  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const line = `${ts} | LoopEngine | ${require("os").hostname()} | Notification | LoopEngine | loop » ${message}\n`;
  try { appendFileSync(FEED_LOG, line); } catch {}
}

// --- Loop definitions ---

function loadLoops(): { enabled: boolean; loops: LoopDef[] } {
  try {
    return JSON.parse(readFileSync(LOOPS_PATH, "utf-8"));
  } catch {
    return { enabled: false, loops: [] };
  }
}

// --- Main executor ---

export class LoopEngine {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastFireMinute = new Map<string, string>(); // loopId -> "YYYY-MM-DD HH:mm"
  private broadcast: ((msg: string) => void) | null = null;

  start(broadcastFn?: (msg: string) => void) {
    if (this.interval) return;
    this.broadcast = broadcastFn || null;
    console.log("  ⏰ LoopEngine started — checking every 30s");
    feedLog("LoopEngine started");

    // Initial check after 5 seconds
    setTimeout(() => this.tick(), 5000);
    this.interval = setInterval(() => this.tick(), CHECK_INTERVAL);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async tick() {
    const config = loadLoops();
    if (!config.enabled) return;

    const now = new Date();
    const minuteKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    for (const loop of config.loops) {
      if (!loop.enabled) continue;
      if (!cronMatches(loop.schedule, now)) continue;

      // Don't fire same loop twice in the same minute
      if (this.lastFireMinute.get(loop.id) === minuteKey) continue;
      this.lastFireMinute.set(loop.id, minuteKey);

      // Execute in background (don't block other loops)
      this.executeLoop(loop).catch(() => {});
    }
  }

  private async executeLoop(loop: LoopDef) {
    const ts = new Date().toISOString();
    console.log(`  ⏰ Loop [${loop.id}] firing...`);

    try {
      // System command loops (no tmux target)
      if (loop.command && !loop.tmux) {
        await runCommand(loop.command);
        this.logExecution({ loopId: loop.id, ts, status: "ok" });
        feedLog(`[${loop.id}] ✓ executed command: ${loop.command}`);
        return;
      }

      if (!loop.tmux || !loop.prompt) {
        this.logExecution({ loopId: loop.id, ts, status: "skipped", reason: "no tmux target or prompt" });
        return;
      }

      // Check if active oracles required
      if (loop.requireActiveOracles) {
        const active = await hasActiveOracles();
        if (!active) {
          this.logExecution({ loopId: loop.id, ts, status: "skipped", reason: "no active oracles" });
          return;
        }
      }

      // Check session alive
      let alive = await isSessionAlive(loop.tmux);
      if (!alive && loop.autoRestart && loop.restartDir) {
        feedLog(`[${loop.id}] session down — auto-restarting ${loop.tmux}`);
        alive = await restartSession(loop.tmux, loop.restartDir);
        if (!alive) {
          this.logExecution({ loopId: loop.id, ts, status: "error", reason: "auto-restart failed" });
          feedLog(`[${loop.id}] ✗ auto-restart failed for ${loop.tmux}`);
          return;
        }
        feedLog(`[${loop.id}] ✓ session restarted successfully`);
      }

      if (!alive) {
        this.logExecution({ loopId: loop.id, ts, status: "skipped", reason: "session not running" });
        return;
      }

      // Check idle
      if (loop.requireIdle) {
        let idle = await isIdle(loop.tmux);
        if (!idle) {
          // Wait 2 min and retry once
          await new Promise(r => setTimeout(r, 120_000));
          idle = await isIdle(loop.tmux);
          if (!idle) {
            this.logExecution({ loopId: loop.id, ts, status: "skipped", reason: "oracle busy after retry" });
            feedLog(`[${loop.id}] skipped — ${loop.oracle} busy after retry`);
            return;
          }
        }
      }

      // Send the prompt
      await sendPrompt(loop.tmux, loop.prompt);
      this.logExecution({ loopId: loop.id, ts, status: "ok" });
      feedLog(`[${loop.id}] ✓ sent to ${loop.oracle}`);
      console.log(`  ⏰ Loop [${loop.id}] ✓ sent to ${loop.oracle}`);

    } catch (e: any) {
      this.logExecution({ loopId: loop.id, ts, status: "error", reason: e.message });
      feedLog(`[${loop.id}] ✗ error: ${e.message}`);
    }
  }

  private logExecution(entry: LoopExecution) {
    appendLog(entry);
    // Broadcast to dashboard
    if (this.broadcast) {
      this.broadcast(JSON.stringify({ type: "loop-execution", ...entry }));
    }
  }

  /** Manually trigger a loop (from dashboard) */
  async triggerLoop(loopId: string): Promise<LoopExecution> {
    const config = loadLoops();
    const loop = config.loops.find(l => l.id === loopId);
    if (!loop) {
      return { loopId, ts: new Date().toISOString(), status: "error", reason: "loop not found" };
    }
    // Force-fire regardless of schedule
    await this.executeLoop(loop);
    const log = loadLog();
    return log.filter(l => l.loopId === loopId).pop() || { loopId, ts: new Date().toISOString(), status: "error", reason: "unknown" };
  }

  /** Get status of all loops */
  getStatus(): LoopStatus[] {
    const config = loadLoops();
    const log = loadLog();
    const now = new Date();

    return config.loops.map(loop => {
      const lastExec = log.filter(l => l.loopId === loop.id).pop();
      return {
        id: loop.id,
        oracle: loop.oracle,
        description: loop.description,
        schedule: loop.schedule,
        enabled: loop.enabled,
        lastRun: lastExec?.ts,
        lastStatus: lastExec?.status,
        lastReason: lastExec?.reason,
        nextRun: loop.enabled ? nextCronMatch(loop.schedule, now) : undefined,
      };
    });
  }

  /** Get execution history */
  getHistory(loopId?: string, limit = 50): LoopExecution[] {
    const log = loadLog();
    const filtered = loopId ? log.filter(l => l.loopId === loopId) : log;
    return filtered.slice(-limit);
  }

  /** Toggle a loop on/off */
  toggleLoop(loopId: string, enabled: boolean): boolean {
    const config = loadLoops();
    const loop = config.loops.find(l => l.id === loopId);
    if (!loop) return false;
    loop.enabled = enabled;
    writeFileSync(LOOPS_PATH, JSON.stringify(config, null, 2), "utf-8");
    return true;
  }

  /** Toggle entire engine */
  toggleEngine(enabled: boolean) {
    const config = loadLoops();
    config.enabled = enabled;
    writeFileSync(LOOPS_PATH, JSON.stringify(config, null, 2), "utf-8");
    feedLog(enabled ? "LoopEngine enabled" : "LoopEngine disabled");
  }

  isEnabled(): boolean {
    return loadLoops().enabled;
  }
}
