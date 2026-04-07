#!/usr/bin/env bun
process.env.MAW_CLI = "1";

import { cmdList, cmdPeek, cmdSend } from "./commands/comm";
import { cmdView } from "./commands/view";
import { cmdCompletions } from "./commands/completions";
import { cmdOverview } from "./commands/overview";
import { cmdWake, fetchIssuePrompt } from "./commands/wake";
import { cmdPulseAdd, cmdPulseLs } from "./commands/pulse";
import { cmdPulseScan } from "./anti-patterns";
import { cmdBud } from "./commands/bud";
import { cmdOracleList, cmdOracleAbout } from "./commands/oracle";
import { cmdWakeAll, cmdSleep, cmdFleetLs, cmdFleetRenumber, cmdFleetValidate, cmdFleetSync } from "./commands/fleet";
import { cmdFleetInit } from "./commands/fleet-init";
import { cmdDone } from "./commands/done";
import { cmdSleepOne } from "./commands/sleep";
import { cmdLogLs, cmdLogExport, cmdLogChat } from "./commands/log";
import { cmdTokens } from "./commands/tokens";
import { cmdTab } from "./commands/tab";
import { cmdTalkTo } from "./commands/talk-to";

const args = process.argv.slice(2);
const cmd = args[0]?.toLowerCase();

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
  maw wake all --resume       Wake fleet + send /recap to active board items
  maw sleep <oracle> [window] Gracefully stop one oracle window
  maw stop                    Stop all fleet sessions
  maw about <oracle>           Oracle profile — session, worktrees, fleet
  maw oracle ls               Fleet status (awake/sleeping/worktrees)
  maw overview              War-room: all oracles in split panes
  maw overview neo hermes   Only specific oracles
  maw overview --kill       Tear down overview
  maw done <window>            Clean up finished worktree window
  maw sovereign status          Oracle-as-Sovereign ψ/ status
  maw sovereign migrate <oracle> Migrate ψ/ to sovereign layout
  maw sovereign migrate --all   Migrate all oracles
  maw sovereign rollback <oracle> Restore original layout
  maw sovereign verify          Health check all symlinks
  maw bud <name> [opts]        Spawn new child oracle (budding)
  maw bud <name> --from <oracle> --approved-by bank
  maw bud <name> --dry-run     Show plan without executing
  maw pulse add "task" [opts] Create issue + wake oracle
  maw pulse scan               Anti-pattern health check (Zombie/Island)
  maw pulse scan --json        JSON output for dashboard/API
  maw pulse cleanup [--dry-run] Clean stale/orphan worktrees
  maw board done #<issue> [msg] Mark board item Done + close issue
  maw view <agent> [window]   Grouped tmux session (interactive attach)
  maw create-view <agent> [w] Alias for view
  maw view <agent> --clean    Hide status bar (full screen)
  maw think                   Oracles scan work + propose ideas (GitHub issues)
  maw think --oracles hr,dev  Limit which oracles think
  maw review                  BoB reviews proposals → sends to inbox
  maw meeting "goal"          BoB holds a meeting — wakes agents, collects input
  maw meeting "goal" --dry-run  Show participants without waking
  maw meeting "goal" --oracles dev,qa  Limit participants
  maw task log <#> "msg"       Log activity on a task
  maw task log <#> --commit "hash msg"  Log a commit
  maw task log <#> --blocker "desc"     Log a blocker
  maw task comment <#> "msg"   Comment on task (cross-oracle)
  maw task ls                  Board + activity counts
  maw task show <#>            Full activity timeline
  maw project ls               List all projects
  maw project show <id>        Project tree view
  maw project create <id> "name"  Create a project
  maw project add <id> #<issue>   Add task to project
  maw project add <id> #<issue> --parent #<parent>  Add as subtask
  maw project auto-organize    Auto-group unassigned tasks
  maw project comment <id> "msg"  Comment on project
  maw project complete <id>    Mark project completed
  maw project archive <id>     Archive project
  maw tokens [--rebuild]      Token usage stats (from Claude sessions)
  maw tokens --json           JSON output for API consumption
  maw log chat [oracle]       Chat view — grouped conversation bubbles
  maw chat [oracle]           Shorthand for log chat
  maw tab                      List tabs in current session
  maw tab N                    Peek tab N
  maw tab N <msg...>           Send message to tab N
  maw talk-to <agent> <msg>    Thread + hey (persistent + real-time)
  maw <agent> <msg...>        Shorthand for hey
  maw loop                    Show loop status (scheduled tasks)
  maw loop history [id]       Loop execution history
  maw loop trigger <id>       Manually fire a loop
  maw loop add '{json}'       Add/update a loop definition
  maw loop remove <id>        Remove a loop
  maw loop enable|disable <id> Toggle a loop on/off
  maw loop on|off             Enable/disable loop engine
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

// --- Main Router ---

if (cmd === "--version" || cmd === "-v") {
  const pkg = require("../package.json");
  let hash = "";
  try { hash = require("child_process").execSync("git rev-parse --short HEAD", { cwd: import.meta.dir }).toString().trim(); } catch {}
  console.log(`maw v${pkg.version}${hash ? ` (${hash})` : ""}`);
} else if (!cmd || cmd === "--help" || cmd === "-h") {
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
} else if (cmd === "talk-to" || cmd === "talkto" || cmd === "talk") {
  const force = args.includes("--force");
  const msgArgs = args.slice(2).filter(a => a !== "--force");
  if (!args[1] || !msgArgs.length) { console.error("usage: maw talk-to <agent> <message> [--force]"); process.exit(1); }
  await cmdTalkTo(args[1], msgArgs.join(" "), force);
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
} else if (cmd === "log") {
  const sub = args[1]?.toLowerCase();
  if (sub === "export") {
    const logOpts: { date?: string; from?: string; to?: string; format?: string } = {};
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--date" && args[i + 1]) logOpts.date = args[++i];
      else if (args[i] === "--from" && args[i + 1]) logOpts.from = args[++i];
      else if (args[i] === "--to" && args[i + 1]) logOpts.to = args[++i];
      else if (args[i] === "--format" && args[i + 1]) logOpts.format = args[++i];
    }
    cmdLogExport(logOpts);
  } else if (sub === "chat") {
    const logOpts: { limit?: number; from?: string; to?: string; pair?: string } = {};
    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--limit" && args[i + 1]) logOpts.limit = +args[++i];
      else if (args[i] === "--from" && args[i + 1]) logOpts.from = args[++i];
      else if (args[i] === "--to" && args[i + 1]) logOpts.to = args[++i];
      else if (args[i] === "--pair" && args[i + 1]) logOpts.pair = args[++i];
      else if (!args[i].startsWith("--")) logOpts.pair = args[i]; // shorthand: maw log chat neo
    }
    cmdLogChat(logOpts);
  } else {
    const logOpts: { limit?: number; from?: string; to?: string } = {};
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--limit" && args[i + 1]) logOpts.limit = +args[++i];
      else if (args[i] === "--from" && args[i + 1]) logOpts.from = args[++i];
      else if (args[i] === "--to" && args[i + 1]) logOpts.to = args[++i];
    }
    cmdLogLs(logOpts);
  }
} else if (cmd === "task") {
  const sub = args[1]?.toLowerCase();
  if (sub === "log") {
    const { cmdTaskLog } = await import("./commands/task-log");
    await cmdTaskLog(args.slice(2));
  } else if (sub === "show") {
    const { cmdTaskShow } = await import("./commands/task-log");
    await cmdTaskShow(args.slice(2));
  } else if (sub === "comment") {
    const { cmdTaskComment } = await import("./commands/task-log");
    await cmdTaskComment(args.slice(2));
  } else if (sub === "ls" || sub === "list" || !sub) {
    const { cmdTaskLs } = await import("./commands/task-log");
    await cmdTaskLs();
  } else {
    console.error("usage: maw task <log|ls|show|comment> [opts]");
    process.exit(1);
  }
} else if (cmd === "project" || cmd === "proj") {
  const sub = args[1]?.toLowerCase();
  if (sub === "ls" || sub === "list" || !sub) {
    const { cmdProjectLs } = await import("./commands/project");
    await cmdProjectLs();
  } else if (sub === "show") {
    const { cmdProjectShow } = await import("./commands/project");
    await cmdProjectShow(args.slice(2));
  } else if (sub === "create" || sub === "new") {
    const { cmdProjectCreate } = await import("./commands/project");
    await cmdProjectCreate(args.slice(2));
  } else if (sub === "add") {
    const { cmdProjectAdd } = await import("./commands/project");
    await cmdProjectAdd(args.slice(2));
  } else if (sub === "remove" || sub === "rm") {
    const { cmdProjectRemove } = await import("./commands/project");
    await cmdProjectRemove(args.slice(2));
  } else if (sub === "auto-organize" || sub === "auto" || sub === "organize") {
    const { cmdProjectAutoOrganize } = await import("./commands/project");
    await cmdProjectAutoOrganize();
  } else if (sub === "comment") {
    const { cmdProjectComment } = await import("./commands/project");
    await cmdProjectComment(args.slice(2));
  } else if (sub === "complete" || sub === "done") {
    const { cmdProjectSetStatus } = await import("./commands/project");
    await cmdProjectSetStatus(args.slice(2), "completed");
  } else if (sub === "archive") {
    const { cmdProjectSetStatus } = await import("./commands/project");
    await cmdProjectSetStatus(args.slice(2), "archived");
  } else {
    console.error("usage: maw project <ls|show|create|add|remove|auto-organize|comment|complete|archive>");
    process.exit(1);
  }
} else if (cmd === "chat") {
  // Shorthand: maw chat [oracle] = maw log chat [oracle]
  const logOpts: { limit?: number; pair?: string } = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) logOpts.limit = +args[++i];
    else if (!args[i].startsWith("--")) logOpts.pair = args[i];
  }
  cmdLogChat(logOpts);
} else if (cmd === "tokens" || cmd === "usage") {
  const rebuild = args.includes("--rebuild") || args.includes("--reindex");
  const json = args.includes("--json");
  const topIdx = args.indexOf("--top");
  const top = topIdx >= 0 ? +args[topIdx + 1] : undefined;
  cmdTokens({ rebuild, json, top });
} else if (cmd === "done" || cmd === "finish") {
  if (!args[1]) { console.error("usage: maw done <window-name>\n       e.g. maw done neo-freelance"); process.exit(1); }
  await cmdDone(args[1]);
} else if (cmd === "stop" || cmd === "rest") {
  await cmdSleep();
} else if (cmd === "sleep") {
  if (!args[1]) {
    console.error("usage: maw sleep <oracle> [window]\n       maw sleep neo          # sleep neo-oracle\n       maw sleep neo mawjs    # sleep neo-mawjs worktree\n       maw stop               # stop ALL fleet sessions");
    process.exit(1);
  } else if (args[1] === "--all-done") {
    console.log("\x1b[90m(placeholder) maw sleep --all-done — sleep ALL agents. Not yet implemented.\x1b[0m");
  } else {
    await cmdSleepOne(args[1], args[2]);
  }
} else if (cmd === "wake") {
  if (!args[1]) { console.error("usage: maw wake <oracle> [task] [--new <name>]\n       maw wake all [--kill]"); process.exit(1); }
  if (args[1].toLowerCase() === "all") {
    await cmdWakeAll({ kill: args.includes("--kill"), all: args.includes("--all"), resume: args.includes("--resume") });
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
} else if (cmd === "sovereign" || cmd === "sov") {
  const { cmdSovereign } = await import("./commands/sovereign");
  await cmdSovereign(args.slice(1));
} else if (cmd === "bud") {
  const budName = args[1];
  if (!budName) { console.error("usage: maw bud <name> --approved-by <human> [--from <oracle>] [--dry-run]"); process.exit(1); }
  const budOpts: { from?: string; repo?: string; dryRun?: boolean; approvedBy?: string } = {};
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) budOpts.from = args[++i];
    else if (args[i] === "--repo" && args[i + 1]) budOpts.repo = args[++i];
    else if (args[i] === "--approved-by" && args[i + 1]) budOpts.approvedBy = args[++i];
    else if (args[i] === "--dry-run") budOpts.dryRun = true;
  }
  await cmdBud(budName, budOpts);
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
  } else if (subcmd === "scan" || subcmd === "health") {
    const json = args.includes("--json");
    cmdPulseScan({ json });
  } else if (subcmd === "cleanup" || subcmd === "clean") {
    const { scanWorktrees, cleanupWorktree } = await import("./worktrees");
    const worktrees = await scanWorktrees();
    const stale = worktrees.filter(wt => wt.status !== "active");
    if (!stale.length) { console.log("\x1b[32m✓\x1b[0m All worktrees are active. Nothing to clean."); process.exit(0); }
    console.log(`\n\x1b[36mWorktree Cleanup\x1b[0m\n`);
    console.log(`  \x1b[32m${worktrees.filter(w => w.status === "active").length} active\x1b[0m | \x1b[33m${worktrees.filter(w => w.status === "stale").length} stale\x1b[0m | \x1b[31m${worktrees.filter(w => w.status === "orphan").length} orphan\x1b[0m\n`);
    for (const wt of stale) {
      const color = wt.status === "orphan" ? "\x1b[31m" : "\x1b[33m";
      console.log(`${color}${wt.status}\x1b[0m  ${wt.name} (${wt.mainRepo}) [${wt.branch}]`);
      if (!args.includes("--dry-run")) {
        const log = await cleanupWorktree(wt.path);
        for (const line of log) console.log(`  \x1b[32m✓\x1b[0m ${line}`);
      }
    }
    if (args.includes("--dry-run")) console.log(`\n\x1b[90m(dry run — use without --dry-run to clean)\x1b[0m`);
    console.log();
  } else {
    console.error("usage: maw pulse <add|ls|cleanup> [opts]");
    process.exit(1);
  }
} else if (cmd === "board") {
  const subcmd = args[1];
  if (subcmd === "done" || subcmd === "complete") {
    const { cmdBoardDone } = await import("./commands/board-done");
    await cmdBoardDone(args.slice(2));
  } else {
    console.error("usage: maw board done #<issue> [\"message\"]");
    process.exit(1);
  }
} else if (cmd === "think") {
  const { cmdThink } = await import("./commands/think");
  const thinkOpts: { oracles?: string[]; dryRun?: boolean } = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--oracles" && args[i + 1]) { thinkOpts.oracles = args[++i].split(","); }
    else if (args[i] === "--dry-run") { thinkOpts.dryRun = true; }
  }
  await cmdThink(thinkOpts);
} else if (cmd === "review") {
  const { cmdReview } = await import("./commands/think");
  await cmdReview();
} else if (cmd === "meeting" || cmd === "meet") {
  const { cmdMeeting } = await import("./commands/meeting");
  const meetOpts: { oracles?: string[]; dryRun?: boolean; timeout?: number } = {};
  let goal = "";
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--oracles" && args[i + 1]) { meetOpts.oracles = args[++i].split(","); }
    else if (args[i] === "--dry-run") { meetOpts.dryRun = true; }
    else if (args[i] === "--timeout" && args[i + 1]) { meetOpts.timeout = +args[++i]; }
    else if (!goal) { goal = args[i]; }
  }
  if (!goal) { console.error('usage: maw meeting "goal" [--oracles dev,designer] [--dry-run] [--timeout 120]'); process.exit(1); }
  await cmdMeeting(goal, meetOpts);
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
  await cmdCompletions(args[1]);
} else if (cmd === "tab" || cmd === "tabs") {
  await cmdTab(args.slice(1));
} else if (cmd === "view" || cmd === "create-view" || cmd === "attach") {
  if (!args[1]) { console.error("usage: maw view <agent> [window] [--clean]"); process.exit(1); }
  const clean = args.includes("--clean");
  const viewArgs = args.slice(1).filter(a => a !== "--clean");
  await cmdView(viewArgs[0], viewArgs[1], clean);
} else if (cmd === "loop" || cmd === "loops") {
  const { cmdLoop } = await import("./commands/loop");
  await cmdLoop(args.slice(1));
} else if (cmd === "auth") {
  const { setupAuth } = await import("./auth");
  const sub = args[1];
  if (sub === "setup") {
    const user = args[2];
    const pass = args[3];
    if (!user || !pass) { console.error("usage: maw auth setup <username> <password>"); process.exit(1); }
    setupAuth(user, pass);
    console.log(`\x1b[32m✓\x1b[0m Auth enabled — user: ${user}`);
    console.log("  Restart maw server: pm2 restart maw");
  } else if (sub === "disable") {
    const { readFileSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const p = join(import.meta.dir, "../auth.json");
    try {
      const c = JSON.parse(readFileSync(p, "utf-8"));
      c.enabled = false;
      writeFileSync(p, JSON.stringify(c, null, 2), "utf-8");
      console.log("\x1b[33m⊘\x1b[0m Auth disabled");
    } catch { console.error("No auth config found"); }
  } else {
    console.log("usage: maw auth setup <username> <password>");
    console.log("       maw auth disable");
  }
} else if (cmd === "serve") {
  const { startServer } = await import("./server");
  startServer(args[1] ? +args[1] : 3456);
} else {
  // Default: agent name shorthand
  if (args.length >= 2) {
    const f = args.includes("--force");
    const m = args.slice(1).filter(a => a !== "--force");
    await cmdSend(args[0], m.join(" "), f);
  } else {
    await cmdPeek(args[0]);
  }
}
