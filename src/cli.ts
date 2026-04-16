#!/usr/bin/env bun
process.env.MAW_CLI = "1";

import { cmdPeek, cmdSend } from "./commands/shared/comm";
import { logAudit } from "./core/fleet/audit";
import { usage } from "./cli/usage";
import { routeComm } from "./cli/route-comm";
import { routeTools } from "./cli/route-tools";
import { scanCommands, matchCommand, executeCommand } from "./cli/command-registry";
import { setVerbosityFlags } from "./cli/verbosity";
import { getVersionString } from "./cli/cmd-version";
import { runUpdate } from "./cli/cmd-update";
import { runBootstrap } from "./cli/plugin-bootstrap";
import { join } from "path";
import { homedir } from "os";

// Strip verbosity flags up-front so they don't collide with cmd detection or
// leak into plugin argv. Task #3 will flip call sites to honor these.
const VERBOSITY_FLAGS = new Set(["--quiet", "-q", "--silent", "-s"]);
const rawArgs = process.argv.slice(2);
const verbosity: { quiet?: boolean; silent?: boolean } = {};
if (rawArgs.some(a => a === "--quiet" || a === "-q")) verbosity.quiet = true;
if (rawArgs.some(a => a === "--silent" || a === "-s")) verbosity.silent = true;
setVerbosityFlags(verbosity);
const args = rawArgs.filter(a => !VERBOSITY_FLAGS.has(a));
const cmd = args[0]?.toLowerCase();

logAudit(cmd || "", args);

if (cmd === "--version" || cmd === "-v" || cmd === "version") {
  console.log(getVersionString());
} else if (cmd === "update" || cmd === "upgrade") {
  await runUpdate(args);
} else {
  // Auto-bootstrap: if ~/.maw/plugins/ is empty, symlink bundled + install from pluginSources
  const pluginDir = join(homedir(), ".maw", "plugins");
  await runBootstrap(pluginDir, import.meta.dir);

  // Load plugins from ~/.maw/plugins/ — the single source of truth
  await scanCommands(pluginDir, "user");

  if (!cmd || cmd === "--help" || cmd === "-h") {
    usage();
  } else {

  // Core routes: hey (transport) + plugin management + serve
  const handled =
    await routeComm(cmd, args) ||
    await routeTools(cmd, args);

  if (!handled) {
    // Try plugin commands (beta) — after core routes, before fallback
    const pluginMatch = matchCommand(args);
    if (pluginMatch) {
      await executeCommand(pluginMatch.desc, pluginMatch.remaining);
    } else {
      // Fallback: check plugin registry for bundled commands
      // #349/#351/#354 — prefix match MUST require word boundary. Loose
      // `startsWith(n)` lets alias "rest" of stop plugin match "restart --help"
      // and invoke destructive cmdSleep. Fix: require exact OR `n + " "` prefix.
      // Also: slice by the MATCHED name (alias or command), not always command,
      // so remaining args are computed correctly when an alias fires.
      const { discoverPackages, invokePlugin } = await import("./plugin/registry");
      const plugins = discoverPackages();
      const cmdName = args.join(" ").toLowerCase();
      let matched = false;
      for (const p of plugins) {
        if (!p.manifest.cli) continue;
        const names = [p.manifest.cli.command, ...(p.manifest.cli.aliases || [])];
        let matchedName: string | null = null;
        for (const n of names) {
          const lower = n.toLowerCase();
          if (cmdName === lower || cmdName.startsWith(lower + " ")) {
            matchedName = lower;
            break;
          }
        }
        if (matchedName) {
          matched = true;
          const remaining = cmdName.slice(matchedName.length).trim().split(/\s+/).filter(Boolean);
          const result = await invokePlugin(p, { source: "cli", args: remaining.length ? remaining : args.slice(1) });
          if (result.ok && result.output) console.log(result.output);
          else if (!result.ok) { console.error(result.error); process.exit(1); }
          process.exit(0);
        }
      }
      if (matched) { /* unreachable — kept for clarity */ }
      // Check for likely mistyped short commands before falling through to agent shorthand.
      // Heuristic: single arg, length <= 3, no hyphen (agent names are longer or hyphenated).
      // This catches `maw a`, `maw ls` typos, etc. without breaking `maw neo "hello"`.
      if (args.length === 1 && args[0].length <= 3 && !/[a-z]+-[a-z]+/.test(args[0])) {
        const knownCommands = plugins
          .map(p => p.manifest.cli?.command)
          .filter((c): c is string => Boolean(c));
        const suggestion = knownCommands.find(c => c.startsWith(args[0]));
        if (suggestion) {
          console.error(`\x1b[31munknown command\x1b[0m: '${args[0]}' — did you mean '${suggestion}'?`);
          process.exit(1);
        }
      }
      // Default: agent name shorthand (maw <agent> <msg> or maw <agent>)
      if (args.length >= 2) {
        const f = args.includes("--force");
        const m = args.slice(1).filter(a => a !== "--force");
        await cmdSend(args[0], m.join(" "), f);
      } else {
        await cmdPeek(args[0]);
      }
    }
  }
  }
}
