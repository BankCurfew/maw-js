/**
 * maw loop — Manage recurring scheduled loops.
 *
 * Usage:
 *   maw loop                — list all loops with status
 *   maw loop add '{json}'   — add/update a loop
 *   maw loop trigger <id>   — manually trigger a loop now
 *   maw loop rm <id>        — remove a loop
 *   maw loop toggle <id> [on|off] — enable/disable a loop
 *   maw loop history [id]   — show execution history
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { InvokeContext } from "../../../plugin/types";

const LOOPS_PATH = join(homedir(), ".config", "maw", "loops.json");
const LOOPS_LOG_PATH = join(homedir(), ".config", "maw", "loops-log.json");

interface Loop {
  id: string;
  oracle: string;
  tmux: string;
  schedule: string;
  prompt: string;
  requireIdle: boolean;
  enabled: boolean;
  description?: string;
}

interface LoopsConfig {
  enabled: boolean;
  loops: Loop[];
}

function loadLoops(): LoopsConfig {
  try {
    if (existsSync(LOOPS_PATH)) {
      return JSON.parse(readFileSync(LOOPS_PATH, "utf-8"));
    }
  } catch {}
  return { enabled: true, loops: [] };
}

function saveLoops(config: LoopsConfig) {
  const dir = join(homedir(), ".config", "maw");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(LOOPS_PATH, JSON.stringify(config, null, 2));
}

export default async function (ctx: InvokeContext) {
  const args = ctx.args as string[];
  const sub = args[0]?.toLowerCase();

  // maw loop add '{json}'
  if (sub === "add") {
    const jsonStr = args.slice(1).join(" ");
    if (!jsonStr) {
      console.error("usage: maw loop add '{\"id\":\"...\",\"schedule\":\"...\", ...}'");
      process.exit(1);
    }
    let newLoop: Loop;
    try {
      newLoop = JSON.parse(jsonStr);
    } catch (e: any) {
      console.error(`invalid JSON: ${e.message}`);
      process.exit(1);
    }
    if (!newLoop.id || !newLoop.schedule) {
      console.error("id and schedule are required");
      process.exit(1);
    }
    const config = loadLoops();
    const idx = config.loops.findIndex(l => l.id === newLoop.id);
    if (idx >= 0) {
      config.loops[idx] = { ...config.loops[idx], ...newLoop };
      saveLoops(config);
      console.log(`\x1b[32m✓\x1b[0m updated loop: ${newLoop.id}`);
    } else {
      config.loops.push(newLoop);
      saveLoops(config);
      console.log(`\x1b[32m✓\x1b[0m added loop: ${newLoop.id}`);
    }
    console.log(`  schedule: ${newLoop.schedule}`);
    console.log(`  oracle: ${newLoop.oracle || "?"} → ${newLoop.tmux || "?"}`);
    console.log(`  enabled: ${newLoop.enabled !== false}`);
    return;
  }

  // maw loop trigger <id>
  if (sub === "trigger") {
    const id = args[1];
    if (!id) { console.error("usage: maw loop trigger <id>"); process.exit(1); }
    // Trigger via API since the loop engine runs in the server process
    try {
      const { loadConfig } = await import("../../../config");
      const port = loadConfig().port || 3456;
      const res = await fetch(`http://localhost:${port}/api/loops/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loopId: id }),
      });
      const data = await res.json() as any;
      if (data.ok !== false) {
        console.log(`\x1b[32m✓\x1b[0m triggered: ${id}`);
      } else {
        console.error(`\x1b[31m✗\x1b[0m ${data.error || "trigger failed"}`);
      }
    } catch (e: any) {
      console.error(`\x1b[31m✗\x1b[0m cannot reach maw server: ${e.message}`);
    }
    return;
  }

  // maw loop rm <id>
  if (sub === "rm" || sub === "remove" || sub === "delete") {
    const id = args[1];
    if (!id) { console.error("usage: maw loop rm <id>"); process.exit(1); }
    const config = loadLoops();
    const before = config.loops.length;
    config.loops = config.loops.filter(l => l.id !== id);
    if (config.loops.length < before) {
      saveLoops(config);
      console.log(`\x1b[32m✓\x1b[0m removed: ${id}`);
    } else {
      console.error(`loop not found: ${id}`);
    }
    return;
  }

  // maw loop toggle <id> [on|off]
  if (sub === "toggle") {
    const id = args[1];
    const state = args[2]?.toLowerCase();
    if (!id) { console.error("usage: maw loop toggle <id> [on|off]"); process.exit(1); }
    const config = loadLoops();
    const loop = config.loops.find(l => l.id === id);
    if (!loop) { console.error(`loop not found: ${id}`); process.exit(1); }
    loop.enabled = state === "on" ? true : state === "off" ? false : !loop.enabled;
    saveLoops(config);
    console.log(`\x1b[32m✓\x1b[0m ${loop.id}: ${loop.enabled ? "enabled" : "disabled"}`);
    return;
  }

  // maw loop history [id]
  if (sub === "history") {
    const id = args[1];
    try {
      const log = JSON.parse(readFileSync(LOOPS_LOG_PATH, "utf-8")) as any[];
      const filtered = id ? log.filter((e: any) => e.loopId === id) : log;
      const recent = filtered.slice(-15);
      if (recent.length === 0) {
        console.log("no execution history");
        return;
      }
      for (const e of recent) {
        const ts = new Date(e.ts).toLocaleString("en-GB", { timeZone: "Asia/Bangkok", hour12: false });
        const icon = e.status === "ok" ? "\x1b[32m✓\x1b[0m" : "\x1b[33m⊘\x1b[0m";
        console.log(`  ${icon} ${ts}  ${e.loopId}  ${e.status}${e.reason ? ` (${e.reason})` : ""}`);
      }
    } catch {
      console.log("no execution history");
    }
    return;
  }

  // Default: maw loop — list all loops
  const config = loadLoops();
  const engineStatus = config.enabled ? "\x1b[32menabled\x1b[0m" : "\x1b[31mdisabled\x1b[0m";
  console.log(`\n  Loop Engine: ${engineStatus}  (${config.loops.length} loops)\n`);

  if (config.loops.length === 0) {
    console.log("  no loops configured");
    console.log("  add one: maw loop add '{\"id\":\"...\",\"schedule\":\"...\",\"oracle\":\"...\",\"tmux\":\"...\",\"prompt\":\"...\"}'\n");
    return;
  }

  for (const l of config.loops) {
    const status = l.enabled !== false ? "\x1b[32m●\x1b[0m" : "\x1b[90m○\x1b[0m";
    console.log(`  ${status} ${l.id}`);
    console.log(`    schedule: ${l.schedule}  oracle: ${l.oracle || "?"}  tmux: ${l.tmux || "?"}`);
    if (l.description) console.log(`    ${l.description}`);
    console.log(`    prompt: ${(l.prompt || "").slice(0, 80)}${(l.prompt || "").length > 80 ? "..." : ""}`);
    console.log("");
  }
}
