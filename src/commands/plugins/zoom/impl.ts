import { listSessions, hostExec, tmuxCmd } from "../../../sdk";
import { resolveSessionTarget } from "../../../core/matcher/resolve-target";

export interface ZoomOpts {
  /** Pane index within the resolved window. Default: current/first. */
  pane?: number;
}

/**
 * maw zoom <target> [--pane N]
 *
 * Toggle zoom state of a pane (full-screen that pane within its window).
 * Wraps `tmux resize-pane -Z` — idempotent toggle, same key-binding
 * behavior as prefix + z in interactive tmux.
 */
export async function cmdZoom(target: string, opts: ZoomOpts = {}) {
  if (!target) {
    console.error("usage: maw zoom <target> [--pane N]");
    console.error("  e.g. maw zoom mawjs");
    console.error("       maw zoom neo:0 --pane 1");
    process.exit(1);
  }

  let resolved: string;
  if (target.includes(":")) {
    const [rawSession, rest] = target.split(":", 2);
    const sessions = await listSessions();
    const r = resolveSessionTarget(rawSession, sessions);
    if (r.kind === "ambiguous") {
      console.error(`  \x1b[31m✗\x1b[0m '${rawSession}' is ambiguous — matches ${r.candidates.length} sessions:`);
      for (const s of r.candidates) console.error(`  \x1b[90m    • ${s.name}\x1b[0m`);
      process.exit(1);
    }
    if (r.kind === "none") {
      console.error(`  \x1b[31m✗\x1b[0m session '${rawSession}' not found`);
      if (r.hints && r.hints.length > 0) {
        console.error(`  \x1b[90m  did you mean:\x1b[0m`);
        for (const s of r.hints) console.error(`  \x1b[90m    • ${s.name}\x1b[0m`);
      }
      process.exit(1);
    }
    resolved = `${r.match.name}:${rest}`;
  } else {
    const sessions = await listSessions();
    const r = resolveSessionTarget(target, sessions);
    if (r.kind === "ambiguous") {
      console.error(`  \x1b[31m✗\x1b[0m '${target}' is ambiguous — matches ${r.candidates.length} sessions:`);
      for (const s of r.candidates) console.error(`  \x1b[90m    • ${s.name}\x1b[0m`);
      process.exit(1);
    }
    if (r.kind === "none") {
      console.error(`  \x1b[31m✗\x1b[0m session '${target}' not found`);
      if (r.hints && r.hints.length > 0) {
        console.error(`  \x1b[90m  did you mean:\x1b[0m`);
        for (const s of r.hints) console.error(`  \x1b[90m    • ${s.name}\x1b[0m`);
      } else {
        console.error(`  \x1b[90m  try: maw ls\x1b[0m`);
      }
      process.exit(1);
    }
    resolved = `${r.match.name}:${r.match.windows[0]?.index ?? 0}`;
  }

  const paneSuffix = opts.pane !== undefined ? `.${opts.pane}` : "";
  const full = resolved + paneSuffix;
  const tmux = tmuxCmd();

  try {
    await hostExec(`${tmux} resize-pane -Z -t '${full}'`);
    console.log(`  \x1b[32m✓\x1b[0m toggled zoom on ${full}`);
  } catch (e: any) {
    console.error(`  \x1b[31m✗\x1b[0m zoom failed: ${e.message || e}`);
    process.exit(1);
  }
}
