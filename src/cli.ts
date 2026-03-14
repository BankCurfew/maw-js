#!/usr/bin/env bun
process.env.MAW_CLI = "1";

import { listSessions, findWindow, capture, sendKeys, getPaneCommand } from "./ssh";
import { cmdOverview } from "./overview";
import { cmdWake, fetchIssuePrompt } from "./wake";
import { cmdPulseAdd, cmdPulseLs } from "./pulse";
import { cmdOracleList, cmdOracleAbout } from "./oracle";
import { cmdWakeAll, cmdSleep, cmdFleetLs, cmdFleetRenumber, cmdFleetValidate, cmdFleetSync } from "./fleet";
import { cmdFleetInit } from "./fleet-init";
import { cmdDone } from "./done";

const args = process.argv.slice(2);
const cmd = args[0]?.toLowerCase();

async function cmdList() {
  const sessions = await listSessions();
  for (const s of sessions) {
    console.log(`\x1b[36m${s.name}\x1b[0m`);
    for (const w of s.windows) {
      const dot = w.active ? "\x1b[32m*\x1b[0m" : " ";
      console.log(`  ${dot} ${w.index}: ${w.name}`);
    }
  }
}

async function cmdPeek(query?: string) {
  const sessions = await listSessions();
  if (!query) {
    // Peek all — one line per agent
    for (const s of sessions) {
      for (const w of s.windows) {
        const target = `${s.name}:${w.index}`;
        try {
          const content = await capture(target, 3);
          const lastLine = content.split("\n").filter(l => l.trim()).pop() || "(empty)";
          const dot = w.active ? "\x1b[32m*\x1b[0m" : " ";
          console.log(`${dot} \x1b[36m${w.name.padEnd(22)}\x1b[0m ${lastLine.slice(0, 80)}`);
        } catch {
          console.log(`  \x1b[36m${w.name.padEnd(22)}\x1b[0m (unreachable)`);
        }
      }
    }
    return;
  }
  const target = findWindow(sessions, query);
  if (!target) { console.error(`window not found: ${query}`); process.exit(1); }
  const content = await capture(target);
  console.log(`\x1b[36m--- ${target} ---\x1b[0m`);
  console.log(content);
}

async function cmdSend(query: string, message: string, force = false) {
  const sessions = await listSessions();
  const target = findWindow(sessions, query);
  if (!target) { console.error(`window not found: ${query}`); process.exit(1); }

  // Detect active Claude session (#17)
  if (!force) {
    const cmd = await getPaneCommand(target);
    const isAgent = /claude|codex|node/i.test(cmd);
    if (!isAgent) {
      console.error(`\x1b[31merror\x1b[0m: no active Claude session in ${target} (running: ${cmd})`);
      console.error(`\x1b[33mhint\x1b[0m:  run \x1b[36mmaw wake ${query}\x1b[0m first, or use \x1b[36m--force\x1b[0m to send anyway`);
      process.exit(1);
    }
  }

  await sendKeys(target, message);
  console.log(`\x1b[32msent\x1b[0m → ${target}: ${message}`);
}

function usage() {
  console.log(`\x1b[36mmaw\x1b[0m — Multi-Agent Workflow

\x1b[33mUsage:\x1b[0m
  maw ls                      List sessions + windows
  maw peek [agent]            Peek agent screen (or all)
  maw hey <agent> <msg...>    Send message to agent (alias: tell)
  maw wake <oracle> [task]    Wake oracle in tmux window + claude
  maw wake <oracle> --issue N Wake oracle with GitHub issue as prompt
  maw fleet init              Scan ghq repos, generate fleet/*.json
  maw fleet ls                List fleet configs with conflict detection
  maw fleet renumber          Fix numbering conflicts (sequential)
  maw fleet validate          Check for problems (dupes, orphans, missing repos)
  maw fleet sync              Add unregistered windows to fleet configs
  maw wake all [--kill]       Wake fleet (01-15 + 99, skips dormant 20+)
  maw wake all --all          Wake ALL including dormant
  maw stop                    Stop all fleet sessions
  maw about <oracle>           Oracle profile — session, worktrees, fleet
  maw oracle ls               Fleet status (awake/sleeping/worktrees)
  maw overview              War-room: all oracles in split panes
  maw overview neo hermes   Only specific oracles
  maw overview --kill       Tear down overview
  maw done <window>            Clean up finished worktree window
  maw pulse add "task" [opts] Create issue + wake oracle
  maw view <agent> [window]   Grouped tmux session (interactive attach)
  maw create-view <agent> [w] Alias for view
  maw view <agent> --clean    Hide status bar (full screen)
  maw <agent> <msg...>        Shorthand for hey
  maw <agent>                 Shorthand for peek
  maw serve [port]            Start web UI (default: 3456)

\x1b[33mWake modes:\x1b[0m
  maw wake neo                Wake main repo
  maw wake hermes bitkub      Wake existing worktree
  maw wake neo --new free     Create worktree + wake
  maw wake neo --issue 5      Fetch issue #5 + send as claude -p prompt
  maw wake neo --issue 5 --repo org/repo   Explicit repo

\x1b[33mPulse add:\x1b[0m
  maw pulse ls                Board table (terminal)
  maw pulse ls --sync         + update daily thread checkboxes
  maw pulse add "Fix bug" --oracle neo
  maw pulse add "task" --oracle neo --wt oracle-v2

\x1b[33mEnv:\x1b[0m
  MAW_HOST=white.local        SSH target (default: white.local)

\x1b[33mExamples:\x1b[0m
  maw wake neo --new bitkub   Create worktree + start claude
  maw pulse add "Fix IME" --oracle neo --priority P1
  maw hey neo what is your status
  maw serve 8080`);
}

// --- Main ---

if (!cmd || cmd === "--help" || cmd === "-h") {
  usage();
} else if (cmd === "ls" || cmd === "list") {
  await cmdList();
} else if (cmd === "peek" || cmd === "see") {
  await cmdPeek(args[1]);
} else if (cmd === "hey" || cmd === "send" || cmd === "tell") {
  const force = args.includes("--force");
  const msgArgs = args.slice(2).filter(a => a !== "--force");
  if (!args[1] || !msgArgs.length) { console.error("usage: maw hey <agent> <message> [--force]"); process.exit(1); }
  await cmdSend(args[1], msgArgs.join(" "), force);
} else if (cmd === "fleet" && args[1] === "init") {
  await cmdFleetInit();
} else if (cmd === "fleet" && args[1] === "ls") {
  await cmdFleetLs();
} else if (cmd === "fleet" && args[1] === "renumber") {
  await cmdFleetRenumber();
} else if (cmd === "fleet" && args[1] === "validate") {
  await cmdFleetValidate();
} else if (cmd === "fleet" && args[1] === "sync") {
  await cmdFleetSync();
} else if (cmd === "fleet" && !args[1]) {
  await cmdFleetLs();
} else if (cmd === "done" || cmd === "finish") {
  if (!args[1]) { console.error("usage: maw done <window-name>\n       e.g. maw done neo-freelance"); process.exit(1); }
  await cmdDone(args[1]);
} else if (cmd === "stop" || cmd === "sleep" || cmd === "rest") {
  await cmdSleep();
} else if (cmd === "wake") {
  if (!args[1]) { console.error("usage: maw wake <oracle> [task] [--new <name>]\n       maw wake all [--kill]"); process.exit(1); }
  if (args[1].toLowerCase() === "all") {
    await cmdWakeAll({ kill: args.includes("--kill"), all: args.includes("--all") });
  } else {
    const wakeOpts: { task?: string; newWt?: string; prompt?: string } = {};
    let issueNum: number | null = null;
    let repo: string | undefined;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--new" && args[i + 1]) { wakeOpts.newWt = args[++i]; }
      else if (args[i] === "--issue" && args[i + 1]) { issueNum = +args[++i]; }
      else if (args[i] === "--repo" && args[i + 1]) { repo = args[++i]; }
      else if (!wakeOpts.task) { wakeOpts.task = args[i]; }
    }
    if (issueNum) {
      console.log(`\x1b[36m⚡\x1b[0m fetching issue #${issueNum}...`);
      wakeOpts.prompt = await fetchIssuePrompt(issueNum, repo);
      if (!wakeOpts.task) wakeOpts.task = `issue-${issueNum}`;
    }
    await cmdWake(args[1], wakeOpts);
  }
} else if (cmd === "pulse") {
  const subcmd = args[1];
  if (subcmd === "add") {
    const pulseOpts: { oracle?: string; priority?: string; wt?: string } = {};
    let title = "";
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--oracle" && args[i + 1]) { pulseOpts.oracle = args[++i]; }
      else if (args[i] === "--priority" && args[i + 1]) { pulseOpts.priority = args[++i]; }
      else if ((args[i] === "--wt" || args[i] === "--worktree") && args[i + 1]) { pulseOpts.wt = args[++i]; }
      else if (!title) { title = args[i]; }
    }
    if (!title) { console.error('usage: maw pulse add "task title" --oracle <name> [--wt <repo>]'); process.exit(1); }
    await cmdPulseAdd(title, pulseOpts);
  } else if (subcmd === "ls" || subcmd === "list") {
    const sync = args.includes("--sync");
    await cmdPulseLs({ sync });
  } else {
    console.error("usage: maw pulse <add|ls> [opts]");
    process.exit(1);
  }
} else if (cmd === "overview" || cmd === "warroom" || cmd === "ov") {
  await cmdOverview(args.slice(1));
} else if (cmd === "about" || cmd === "info") {
  if (!args[1]) { console.error("usage: maw about <oracle>"); process.exit(1); }
  await cmdOracleAbout(args[1]);
} else if (cmd === "oracle" || cmd === "oracles") {
  const subcmd = args[1]?.toLowerCase();
  if (!subcmd || subcmd === "ls" || subcmd === "list") {
    await cmdOracleList();
  } else {
    console.error("usage: maw oracle ls");
    process.exit(1);
  }
} else if (cmd === "completions") {
  // Internal: used by shell completion scripts
  const sub = args[1];
  if (sub === "commands") {
    console.log("ls peek hey wake fleet stop done overview about oracle pulse view create-view serve");
  } else if (sub === "oracles" || sub === "windows") {
    const { readdirSync, readFileSync } = await import("fs");
    const { join } = await import("path");
    const fleetDir = join(import.meta.dir, "../fleet");
    const names = new Set<string>();
    try {
      for (const f of readdirSync(fleetDir).filter(f => f.endsWith(".json") && !f.endsWith(".disabled"))) {
        const config = JSON.parse(readFileSync(join(fleetDir, f), "utf-8"));
        for (const w of (config.windows || [])) {
          if (sub === "oracles") {
            if (w.name.endsWith("-oracle")) names.add(w.name.replace(/-oracle$/, ""));
          } else {
            names.add(w.name);
          }
        }
      }
    } catch {}
    console.log([...names].sort().join("\n"));
  } else if (sub === "fleet") {
    console.log("init ls renumber validate sync");
  } else if (sub === "pulse") {
    console.log("add ls list");
  }
} else if (cmd === "view" || cmd === "create-view" || cmd === "attach") {
  if (!args[1]) { console.error("usage: maw view <agent> [window] [--clean]"); process.exit(1); }
  const clean = args.includes("--clean");
  const viewArgs = args.slice(1).filter(a => a !== "--clean");
  const agent = viewArgs[0];
  const windowHint = viewArgs[1]; // optional: window name or index

  // Find the session
  const sessions = await listSessions();
  const allWindows = sessions.flatMap(s => s.windows.map(w => ({ session: s.name, ...w })));

  // Resolve agent → session
  let sessionName: string | null = null;
  for (const s of sessions) {
    if (s.name.endsWith(`-${agent}`) || s.name === agent) { sessionName = s.name; break; }
    if (s.windows.some(w => w.name.toLowerCase().includes(agent.toLowerCase()))) { sessionName = s.name; break; }
  }
  if (!sessionName) { console.error(`session not found for: ${agent}`); process.exit(1); }

  // Generate unique view name
  const viewName = `${agent}-view${windowHint ? `-${windowHint}` : ""}`;

  // Kill existing view with same name
  const { Tmux } = await import("./tmux");
  const t = new Tmux();
  await t.killSession(viewName);

  // Create grouped session
  await t.newGroupedSession(sessionName, viewName, { cols: 200, rows: 50 });
  console.log(`\x1b[36mcreated\x1b[0m → ${viewName} (grouped with ${sessionName})`);

  // Select specific window if requested
  if (windowHint) {
    const win = allWindows.find(w =>
      w.session === sessionName && (
        w.name === windowHint ||
        w.name.includes(windowHint) ||
        String(w.index) === windowHint
      )
    );
    if (win) {
      await t.selectWindow(`${viewName}:${win.index}`);
      console.log(`\x1b[36mwindow\x1b[0m  → ${win.name} (${win.index})`);
    } else {
      console.error(`\x1b[33mwarn\x1b[0m: window '${windowHint}' not found, using default`);
    }
  }

  // Hide status bar if --clean
  if (clean) {
    await t.set(viewName, "status", "off");
  }

  // Attach interactively
  const { loadConfig: lc } = await import("./config");
  const host = process.env.MAW_HOST || lc().host || "white.local";
  const isLocal = host === "local" || host === "localhost";
  const attachArgs = isLocal
    ? ["tmux", "attach-session", "-t", viewName]
    : ["ssh", "-tt", host, `tmux attach-session -t '${viewName}'`];
  console.log(`\x1b[36mattach\x1b[0m  → ${viewName}${clean ? " (clean)" : ""}`);
  const proc = Bun.spawn(attachArgs, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;

  // Cleanup: kill grouped session after detach
  await t.killSession(viewName);
  console.log(`\x1b[90mcleaned\x1b[0m → ${viewName}`);
  process.exit(exitCode);

} else if (cmd === "serve") {
  const { startServer } = await import("./server");
  startServer(args[1] ? +args[1] : 3456);
} else {
  // Default: agent name
  if (args.length >= 2) {
    // maw neo what's up → send
    const f = args.includes("--force");
    const m = args.slice(1).filter(a => a !== "--force");
    await cmdSend(args[0], m.join(" "), f);
  } else {
    // maw neo → peek
    await cmdPeek(args[0]);
  }
}
