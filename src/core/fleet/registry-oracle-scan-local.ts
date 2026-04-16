/**
 * registry-oracle-scan-local — local ghq filesystem scan.
 *
 * Walks <ghqRoot>/<org>/<repo>/ detecting oracles by:
 *   - presence of ψ/ directory
 *   - fleet config lineage reference
 *   - -oracle suffix in repo name
 *
 * Also adds fleet-referenced repos not found on disk.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { FLEET_DIR } from "../paths";
import { loadConfig } from "../../config";
import type { OracleEntry } from "./registry-oracle-types";

// ---------- Fleet lineage parsing ----------

interface FleetLineage {
  repo: string;             // e.g. "Soul-Brews-Studio/mawjs-oracle"
  budded_from: string | null;
  budded_at: string | null;
}

/** @internal */
export function readFleetLineage(): Map<string, FleetLineage> {
  const map = new Map<string, FleetLineage>();
  try {
    for (const file of readdirSync(FLEET_DIR).filter(f => f.endsWith(".json"))) {
      try {
        const config = JSON.parse(readFileSync(join(FLEET_DIR, file), "utf-8"));
        const repos: string[] = config.project_repos || [];
        for (const r of repos) {
          map.set(r, {
            repo: r,
            budded_from: config.budded_from || null,
            budded_at: config.budded_at || null,
          });
        }
        // Also check windows for repo references
        for (const w of config.windows || []) {
          if (w.repo && !map.has(w.repo)) {
            map.set(w.repo, {
              repo: w.repo,
              budded_from: config.budded_from || null,
              budded_at: config.budded_at || null,
            });
          }
        }
      } catch { /* invalid fleet file, skip */ }
    }
  } catch { /* fleet dir may not exist */ }
  return map;
}

/** @internal */
export function deriveName(repo: string): string {
  return repo.replace(/-oracle$/, "");
}

// ---------- Local scan ----------

export function scanLocal(): OracleEntry[] {
  const config = loadConfig();
  const ghqRoot = config.ghqRoot;
  const now = new Date().toISOString();
  const fleetLineage = readFleetLineage();
  const entries: OracleEntry[] = [];
  const seen = new Set<string>();

  // Walk ghq root: <ghqRoot>/<org>/<repo>/
  try {
    for (const org of readdirSync(ghqRoot)) {
      const orgPath = join(ghqRoot, org);
      try {
        if (!statSync(orgPath).isDirectory()) continue;
      } catch { continue; }

      for (const repo of readdirSync(orgPath)) {
        const repoPath = join(orgPath, repo);
        try {
          if (!statSync(repoPath).isDirectory()) continue;
        } catch { continue; }

        const key = `${org}/${repo}`;
        const hasPsi = existsSync(join(repoPath, "ψ"));
        const fleetKey = fleetLineage.has(key) ? key : null;
        const endsWithOracle = repo.endsWith("-oracle");

        // Detection rule: ψ/ OR fleet-referenced OR -oracle suffix
        if (!hasPsi && !fleetKey && !endsWithOracle) continue;

        if (seen.has(key)) continue;
        seen.add(key);

        const lineage = fleetKey ? fleetLineage.get(fleetKey)! : null;

        entries.push({
          org,
          repo,
          name: deriveName(repo),
          local_path: repoPath,
          has_psi: hasPsi,
          has_fleet_config: !!fleetKey,
          budded_from: lineage?.budded_from || null,
          budded_at: lineage?.budded_at || null,
          federation_node: null, // populated below if maw.config.json exists
          detected_at: now,
        });
      }
    }
  } catch (e) {
    console.warn(`[oracle-registry] failed to walk ghq root ${ghqRoot}: ${e}`);
  }

  // Enrich with federation node from the current machine's config
  const localNode = config.node || null;
  const agents = config.agents || {};
  for (const entry of entries) {
    // If this oracle's name matches a known agent → use its node
    const agentNode = agents[entry.name];
    if (agentNode) {
      entry.federation_node = agentNode;
    } else if (localNode) {
      // Default: if the oracle is local, it's on this node
      entry.federation_node = localNode;
    }
  }

  // Also add fleet-referenced repos that aren't on disk
  for (const [key, lineage] of fleetLineage) {
    if (!seen.has(key)) {
      const [org, repo] = key.split("/");
      if (org && repo) {
        entries.push({
          org,
          repo,
          name: deriveName(repo),
          local_path: "",
          has_psi: false,
          has_fleet_config: true,
          budded_from: lineage.budded_from || null,
          budded_at: lineage.budded_at || null,
          federation_node: null,
          detected_at: now,
        });
      }
    }
  }

  return entries.sort((a, b) => {
    if (a.org !== b.org) return a.org.localeCompare(b.org);
    return a.name.localeCompare(b.name);
  });
}
