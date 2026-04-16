/**
 * fleet-doctor-checks-repo — check 6: missing ghq repos.
 *
 * Separated from fleet-doctor-checks.ts because it uses existsSync (fs I/O),
 * while the other 5 checks are fully in-memory.
 */

import { existsSync } from "fs";
import { join } from "path";
import type { DoctorFinding } from "./fleet-doctor-checks";

export interface FleetEntryLike {
  session: { name: string; windows: Array<{ repo?: string }> };
}

/**
 * Check 6 — Fleet entries whose primary repo is not in ghq.
 * #237 added clone-from-GitHub fallback, so this is informational, not fatal.
 */
export function checkMissingRepos(entries: FleetEntryLike[], ghqRoot: string): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  for (const e of entries) {
    const repo = e.session.windows[0]?.repo;
    if (!repo) continue;
    // detectGhqRoot() may return the github.com-rooted path OR the bare ghq root.
    // Probe both to avoid false positives across machines.
    const direct = join(ghqRoot, repo);
    const nested = join(ghqRoot, "github.com", repo);
    if (!existsSync(direct) && !existsSync(nested)) {
      findings.push({
        level: "info",
        check: "missing-repo",
        fixable: false,
        message: `fleet '${e.session.name}' references repo '${repo}' not present in ghq — wake will clone from GitHub (#237)`,
        detail: { session: e.session.name, repo, paths: [direct, nested] },
      });
    }
  }
  return findings;
}
