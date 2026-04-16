import { readdirSync, existsSync } from "fs";
import { join } from "path";
import { tmux } from "../../../sdk";
import { TEAMS_DIR, loadTeam } from "./team-helpers";
import { findZombiePanes } from "./team-cleanup-zombies";

// Re-export everything so index.ts and tests continue to import from "./impl"
export { _setDirs, loadTeam, writeShutdownRequest, writeMessage } from "./team-helpers";
export { cmdTeamShutdown, cmdTeamCreate, cmdTeamSpawn } from "./team-lifecycle";
export { cmdTeamSend } from "./team-comms";
export { cmdTeamResume, cmdTeamLives } from "./team-reincarnation";
export { cmdCleanupZombies } from "./team-cleanup-zombies";

// ─── maw team list ───

export async function cmdTeamList() {
  let teamDirs: string[] = [];
  try {
    teamDirs = readdirSync(TEAMS_DIR).filter(d =>
      existsSync(join(TEAMS_DIR, d, "config.json"))
    );
  } catch { /* expected: teams dir may not exist */ }

  if (!teamDirs.length) {
    console.log("\x1b[90mNo teams found in ~/.claude/teams/\x1b[0m");
    return;
  }

  const panes = await tmux.listPaneIds();

  console.log();
  console.log(`  \x1b[36;1mTEAM${" ".repeat(26)}MEMBERS  STATUS          ZOMBIES\x1b[0m`);

  for (const dir of teamDirs) {
    const team = loadTeam(dir);
    if (!team) continue;

    const teammates = team.members.filter(m => m.agentType !== "team-lead");
    const aliveMembers = team.members.filter(m =>
      m.tmuxPaneId && m.tmuxPaneId !== "in-process" && m.tmuxPaneId !== "" && panes.has(m.tmuxPaneId)
    );
    const deadPanes = teammates.filter(m =>
      m.tmuxPaneId && m.tmuxPaneId !== "in-process" && m.tmuxPaneId !== "" && !panes.has(m.tmuxPaneId)
    );

    const name = dir.padEnd(30);
    const memberCount = String(teammates.length).padEnd(9);
    const idle = aliveMembers.filter(m => m.agentType !== "team-lead").length;
    const status = aliveMembers.length > 0
      ? `\x1b[32m${idle} alive\x1b[0m`.padEnd(26)
      : `\x1b[90mno live panes\x1b[0m`.padEnd(26);

    console.log(`  ${name}${memberCount}${status}${deadPanes.length > 0 ? `\x1b[90m${deadPanes.length} exited\x1b[0m` : "0"}`);
  }

  // Check for orphan zombie panes (panes running claude with no matching team)
  const allPanes = await tmux.listPanes();
  const zombies = findZombiePanes(allPanes);
  if (zombies.length > 0) {
    console.log(`\n  \x1b[33m⚠ ${zombies.length} orphan zombie pane(s) detected\x1b[0m — run \x1b[36mmaw cleanup --zombie-agents\x1b[0m`);
  }

  console.log();
}
