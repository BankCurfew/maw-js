import { readdirSync } from "fs";
import { tmux, FLEET_DIR, saveTabOrder, restoreTabOrder } from "../../sdk";
import { loadConfig, buildCommand, getEnvVars } from "../../config";
import { ensureSessionRunning } from "./wake";
import { loadFleet } from "./fleet-load";
import { respawnMissingWorktrees, resumeActiveItems } from "./fleet-resume";

export async function cmdSleep() {
  const sessions = loadFleet();
  let killed = 0;

  for (const sess of sessions) {
    // Save tab order before killing (so wake can restore positions)
    await saveTabOrder(sess.name);
    try {
      await tmux.killSession(sess.name);
      console.log(`  \x1b[90m●\x1b[0m ${sess.name} — sleep`);
      killed++;
    } catch {
      // Session didn't exist
    }
  }

  console.log(`\n  ${killed} sessions put to sleep.\n`);
}

export async function cmdWakeAll(opts: { kill?: boolean; all?: boolean; resume?: boolean } = {}) {
  const allSessions = loadFleet();
  // Skip dormant (20+) unless --all flag is passed
  const sessions = opts.all
    ? allSessions
    : allSessions.filter(s => {
        const num = parseInt(s.name.split("-")[0], 10);
        return isNaN(num) || num < 20 || num >= 99;
      });
  const skipped = allSessions.length - sessions.length;

  if (opts.kill) {
    console.log(`\n  \x1b[33mKilling existing sessions...\x1b[0m\n`);
    await cmdSleep();
  }

  const disabled = readdirSync(FLEET_DIR).filter(f => f.endsWith(".disabled")).length;
  const skipMsg = skipped > 0 ? `, ${skipped} dormant skipped` : "";
  console.log(`\n  \x1b[36mWaking fleet...\x1b[0m  (${sessions.length} sessions${disabled ? `, ${disabled} disabled` : ""}${skipMsg})\n`);

  let sessCount = 0;
  let winCount = 0;

  for (let si = 0; si < sessions.length; si++) {
    const sess = sessions[si];
    const progress = `[${si + 1}/${sessions.length}]`;

    // Check if session already exists
    if (await tmux.hasSession(sess.name)) {
      console.log(`  \x1b[33m●\x1b[0m ${progress} ${sess.name} — already awake`);
      continue;
    }

    process.stdout.write(`  \x1b[90m⏳\x1b[0m ${progress} ${sess.name}...`);

    // Create session with first window
    const first = sess.windows[0];
    const firstPath = `${loadConfig().ghqRoot}/${first.repo}`;
    await tmux.newSession(sess.name, { window: first.name, cwd: firstPath });
    // Set env vars on session (not visible in tmux output)
    for (const [key, val] of Object.entries(getEnvVars())) {
      await tmux.setEnvironment(sess.name, key, val);
    }

    if (!sess.skip_command) {
      await new Promise(r => setTimeout(r, 300));
      try { await tmux.sendText(`${sess.name}:${first.name}`, buildCommand(first.name)); } catch { /* ok */ }
    }
    winCount++;

    // Add remaining windows
    for (let i = 1; i < sess.windows.length; i++) {
      const win = sess.windows[i];
      const winPath = `${loadConfig().ghqRoot}/${win.repo}`;
      try {
        await tmux.newWindow(sess.name, win.name, { cwd: winPath });
        if (!sess.skip_command) {
          await new Promise(r => setTimeout(r, 300));
          await tmux.sendText(`${sess.name}:${win.name}`, buildCommand(win.name));
        }
        winCount++;
      } catch {
        // Window creation might fail (duplicate name, bad path)
      }
    }

    // Select first window
    await tmux.selectWindow(`${sess.name}:1`);
    sessCount++;
    console.log(` \x1b[32m✓\x1b[0m ${sess.windows.length} windows`);
  }

  // Scan disk for worktrees not covered by fleet configs and spawn them
  const wtExtra = await respawnMissingWorktrees(sessions);
  winCount += wtExtra;

  // Verify all windows actually started Claude (not stuck on zsh)
  if (sessCount > 0) {
    console.log("  \x1b[36mVerifying sessions...\x1b[0m");
    await new Promise(r => setTimeout(r, 3000)); // let shells init
    let totalRetried = 0;
    for (const sess of sessions) {
      if (sess.skip_command) continue;
      totalRetried += await ensureSessionRunning(sess.name);
    }
    if (totalRetried > 0) {
      console.log(`  \x1b[33m${totalRetried} window(s) retried.\x1b[0m`);
    } else {
      console.log("  \x1b[32m✓ All windows running.\x1b[0m");
    }
  }

  // Restore saved tab order (from previous sleep)
  let totalReordered = 0;
  for (const sess of sessions) {
    totalReordered += await restoreTabOrder(sess.name);
  }
  if (totalReordered > 0) {
    console.log(`  \x1b[36m↻ ${totalReordered} window(s) reordered to saved positions.\x1b[0m`);
  }

  console.log(`\n  \x1b[32m${sessCount} sessions, ${winCount} windows woke up.\x1b[0m\n`);

  if (opts.resume) {
    console.log("  \x1b[36mResuming active board items...\x1b[0m\n");
    await resumeActiveItems();
  }
}
