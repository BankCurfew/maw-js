/**
 * maw loop — CLI for managing oracle loops
 *
 * Usage:
 *   maw loop                      — show all loop status
 *   maw loop history [loopId]     — show execution history
 *   maw loop trigger <loopId>     — manually fire a loop
 *   maw loop add <json>           — add/update a loop definition
 *   maw loop remove <loopId>      — remove a loop
 *   maw loop enable <loopId>      — enable a loop
 *   maw loop disable <loopId>     — disable a loop
 *   maw loop on                   — enable the loop engine
 *   maw loop off                  — disable the loop engine
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const MAW_URL = process.env.MAW_URL || "http://localhost:3456";
const LOOPS_PATH = join(import.meta.dir, "../../loops.json");

interface LoopDef {
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

function loadLoops(): { enabled: boolean; loops: LoopDef[] } {
  try {
    return JSON.parse(readFileSync(LOOPS_PATH, "utf-8"));
  } catch {
    return { enabled: true, loops: [] };
  }
}

function saveLoops(config: { enabled: boolean; loops: LoopDef[] }) {
  writeFileSync(LOOPS_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export async function cmdLoop(args: string[]) {
  const sub = args[0];

  if (!sub) {
    // Show status
    try {
      const res = await fetch(`${MAW_URL}/api/loops`);
      const data = await res.json();
      console.log(`\n  \x1b[36mLoop Engine\x1b[0m — ${data.enabled ? "\x1b[32mENABLED\x1b[0m" : "\x1b[31mDISABLED\x1b[0m"}\n`);

      for (const l of data.loops) {
        const icon = l.enabled ? (l.lastStatus === "ok" ? "\x1b[32m✓\x1b[0m" : l.lastStatus === "error" ? "\x1b[31m✗\x1b[0m" : "\x1b[33m○\x1b[0m") : "\x1b[90m⊘\x1b[0m";
        const last = l.lastRun ? `last: ${l.lastRun.slice(0, 19).replace("T", " ")}` : "never ran";
        const next = l.nextRun ? `next: ${l.nextRun.slice(0, 16).replace("T", " ")}` : "";
        console.log(`  ${icon} \x1b[1m${l.id}\x1b[0m [${l.oracle}]`);
        console.log(`    ${l.description}`);
        console.log(`    \x1b[90m${l.schedule} | ${last}${l.lastReason ? ` (${l.lastReason})` : ""} | ${next}\x1b[0m`);
      }
      console.log();
    } catch (e: any) {
      console.error(`  \x1b[31mError:\x1b[0m ${e.message} — is maw server running?`);
    }
    return;
  }

  if (sub === "history") {
    const loopId = args[1] || "";
    const url = loopId ? `${MAW_URL}/api/loops/history?loopId=${loopId}` : `${MAW_URL}/api/loops/history`;
    const res = await fetch(url);
    const history = await res.json();
    console.log(`\n  \x1b[36mLoop History\x1b[0m${loopId ? ` — ${loopId}` : ""}\n`);
    if (history.length === 0) {
      console.log("  No executions yet.\n");
      return;
    }
    for (const h of history.slice(-20)) {
      const icon = h.status === "ok" ? "\x1b[32m✓\x1b[0m" : h.status === "error" ? "\x1b[31m✗\x1b[0m" : "\x1b[33m⊘\x1b[0m";
      console.log(`  ${icon} ${h.ts.slice(0, 19).replace("T", " ")} ${h.loopId}${h.reason ? ` — ${h.reason}` : ""}`);
    }
    console.log();
    return;
  }

  if (sub === "trigger") {
    const loopId = args[1];
    if (!loopId) { console.error("  Usage: maw loop trigger <loopId>"); return; }
    console.log(`  Triggering ${loopId}...`);
    const res = await fetch(`${MAW_URL}/api/loops/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loopId }),
    });
    const result = await res.json();
    const icon = result.status === "ok" ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`  ${icon} ${result.status}${result.reason ? ` — ${result.reason}` : ""}`);
    return;
  }

  if (sub === "add") {
    // Accept JSON inline or via pipe
    const jsonStr = args.slice(1).join(" ");
    if (!jsonStr) {
      console.log("  Usage: maw loop add '{\"id\":\"my-loop\",\"oracle\":\"dev\",\"tmux\":\"02-dev:0\",\"schedule\":\"0 9 * * *\",\"prompt\":\"...\",\"enabled\":true,\"description\":\"...\"}'");
      return;
    }
    try {
      const newLoop: LoopDef = JSON.parse(jsonStr);
      if (!newLoop.id || !newLoop.schedule) {
        console.error("  Error: id and schedule are required");
        return;
      }
      const config = loadLoops();
      const idx = config.loops.findIndex(l => l.id === newLoop.id);
      if (idx >= 0) {
        config.loops[idx] = { ...config.loops[idx], ...newLoop };
        console.log(`  \x1b[33m↻\x1b[0m Updated loop: ${newLoop.id}`);
      } else {
        config.loops.push(newLoop);
        console.log(`  \x1b[32m+\x1b[0m Added loop: ${newLoop.id}`);
      }
      saveLoops(config);
    } catch (e: any) {
      console.error(`  Error parsing JSON: ${e.message}`);
    }
    return;
  }

  if (sub === "remove") {
    const loopId = args[1];
    if (!loopId) { console.error("  Usage: maw loop remove <loopId>"); return; }
    const config = loadLoops();
    const before = config.loops.length;
    config.loops = config.loops.filter(l => l.id !== loopId);
    if (config.loops.length < before) {
      saveLoops(config);
      console.log(`  \x1b[31m-\x1b[0m Removed loop: ${loopId}`);
    } else {
      console.log(`  Loop not found: ${loopId}`);
    }
    return;
  }

  if (sub === "enable" || sub === "disable") {
    const loopId = args[1];
    const enabled = sub === "enable";
    if (!loopId) {
      // Toggle engine
      const res = await fetch(`${MAW_URL}/api/loops/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const result = await res.json();
      console.log(`  Loop engine ${enabled ? "\x1b[32menabled\x1b[0m" : "\x1b[31mdisabled\x1b[0m"}`);
    } else {
      const res = await fetch(`${MAW_URL}/api/loops/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loopId, enabled }),
      });
      console.log(`  ${loopId} ${enabled ? "\x1b[32menabled\x1b[0m" : "\x1b[31mdisabled\x1b[0m"}`);
    }
    return;
  }

  if (sub === "on") {
    await fetch(`${MAW_URL}/api/loops/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    console.log("  \x1b[32m✓\x1b[0m Loop engine enabled");
    return;
  }

  if (sub === "off") {
    await fetch(`${MAW_URL}/api/loops/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    console.log("  \x1b[31m⊘\x1b[0m Loop engine disabled");
    return;
  }

  console.log(`  Unknown subcommand: ${sub}`);
  console.log("  Usage: maw loop [history|trigger|add|remove|enable|disable|on|off]");
}
