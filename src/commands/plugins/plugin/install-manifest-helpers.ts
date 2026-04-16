/**
 * install-impl seam: manifest reading + success printing helpers.
 */

import type { PluginManifest } from "../../../plugin/types";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseManifest } from "../../../plugin/manifest";
import { runtimeSdkVersion } from "../../../plugin/registry";

/**
 * Read + parse plugin.json from an unpacked dir. Returns null + logs if missing.
 */
export function readManifest(dir: string): PluginManifest | null {
  const manifestPath = join(dir, "plugin.json");
  if (!existsSync(manifestPath)) {
    console.error(`\x1b[31m✗\x1b[0m no plugin.json at ${dir}`);
    return null;
  }
  try {
    return parseManifest(readFileSync(manifestPath, "utf8"), dir);
  } catch (e: any) {
    console.error(`\x1b[31m✗\x1b[0m invalid plugin.json: ${e.message}`);
    return null;
  }
}

/** Short sha256 prefix for the label, e.g. "abc1234" from "sha256:abc1234def…". */
export function shortHash(sha256: string): string {
  const idx = sha256.indexOf(":");
  const hex = idx === -1 ? sha256 : sha256.slice(idx + 1);
  return hex.slice(0, 7);
}

/** Print the Phase A success label block. */
export function printInstallSuccess(
  manifest: PluginManifest,
  dest: string,
  mode: "linked (dev)" | { sha256: string },
  sourceNote?: string,
): void {
  const runtime = runtimeSdkVersion();
  const caps =
    manifest.capabilities && manifest.capabilities.length
      ? manifest.capabilities.join(", ")
      : "(none)";
  const modeLabel =
    typeof mode === "string" ? mode : `installed (sha256:${shortHash(mode.sha256)}…)`;
  const lines = [
    `\x1b[32m✓\x1b[0m ${manifest.name}@${manifest.version} installed${sourceNote ? " " + sourceNote : ""}`,
    `  sdk: ${manifest.sdk} ✓ (maw ${runtime})`,
    `  capabilities: ${caps}`,
    `  mode: ${modeLabel}`,
    `  dir: ${dest}`,
    `try: maw ${manifest.cli?.command ?? manifest.name}`,
  ];
  console.log(lines.join("\n"));
}
