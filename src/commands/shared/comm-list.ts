/**
 * comm-list.ts — cmdList + renderSessionName + orphan detection.
 */

import { listSessions, getPaneInfos, scanWorktrees } from "../../sdk";

/**
 * #359 — render a session header line for `maw ls`.
 * View sessions (`*-view` suffix or the `maw-view` meta-session — see
 * team/impl.ts:264) render dimmed with a trailing `[view]` tag; source
 * sessions stay bright cyan. Pure function, exported for tests.
 */
export function renderSessionName(name: string): string {
  const isView = /-view$/.test(name) || name === "maw-view";
  return isView
    ? `\x1b[90m${name}\x1b[0m \x1b[90m[view]\x1b[0m`
    : `\x1b[36m${name}\x1b[0m`;
}

export async function cmdList() {
  const sessions = await listSessions();

  // Batch-check process + cwd for each pane
  const targets: string[] = [];
  for (const s of sessions) {
    for (const w of s.windows) targets.push(`${s.name}:${w.index}`);
  }
  const infos = await getPaneInfos(targets);

  for (const s of sessions) {
    console.log(renderSessionName(s.name));
    for (const w of s.windows) {
      const target = `${s.name}:${w.index}`;
      const info = infos[target] || { command: "", cwd: "" };
      const isAgent = /claude|codex|node/i.test(info.command);
      const cwdBroken = info.cwd.includes("(deleted)") || info.cwd.includes("(dead)");

      let dot: string;
      let suffix = "";
      if (cwdBroken) {
        dot = "\x1b[31m●\x1b[0m"; // red — working dir deleted
        suffix = "  \x1b[31m(path deleted)\x1b[0m";
      } else if (w.active && isAgent) {
        dot = "\x1b[32m●\x1b[0m"; // green — active + agent running
      } else if (isAgent) {
        dot = "\x1b[34m●\x1b[0m"; // blue — agent running
      } else {
        dot = "\x1b[31m●\x1b[0m"; // red — dead (shell only)
        suffix = `  \x1b[90m(${info.command || "?"})\x1b[0m`;
      }
      console.log(`  ${dot} ${w.index}: ${w.name}${suffix}`);
    }
  }

  // Detect orphaned worktree directories (on disk but no tmux window)
  try {
    const worktrees = await scanWorktrees();
    const orphans = worktrees.filter(wt => wt.status === "stale" || wt.status === "orphan");
    if (orphans.length > 0) {
      console.log("");
      for (const wt of orphans) {
        const dirName = wt.path.split("/").pop() || wt.name;
        const label = wt.status === "orphan" ? "orphaned (prunable)" : "no tmux window";
        console.log(`  \x1b[33m⚠ orphaned:\x1b[0m ${dirName} \x1b[90m(${label})\x1b[0m`);
      }
    }
  } catch { /* worktree scan failed — non-critical */ }
}
