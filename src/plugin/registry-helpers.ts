/** Runtime helpers: SDK version resolution, hash verification, dev-mode detection. */

import { createHash } from "crypto";
import { existsSync, lstatSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { warn } from "../cli/verbosity";

// Single scan dir — everything lives in ~/.maw/plugins/ (or MAW_PLUGINS_DIR
// if set). Resolved at call time so tests can override the root.
export function scanDirs(): string[] {
  return [process.env.MAW_PLUGINS_DIR || join(homedir(), ".maw", "plugins")];
}

/** Runtime SDK version — read from @maw/sdk package.json. Canonical per the plan. */
let _runtimeSdkVersion: string | null = null;
export function runtimeSdkVersion(): string {
  if (_runtimeSdkVersion) return _runtimeSdkVersion;
  // packages/sdk/package.json — resolved relative to this file at src/plugin/
  const pkgPath = join(import.meta.dir, "..", "..", "packages", "sdk", "package.json");
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (typeof pkg.version === "string") {
      _runtimeSdkVersion = pkg.version;
      return pkg.version;
    }
  } catch {
    // Fall through to maw-js root package.json.
  }
  try {
    const rootPkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf8"));
    _runtimeSdkVersion = String(rootPkg.version ?? "0.0.0");
    return _runtimeSdkVersion;
  } catch {
    _runtimeSdkVersion = "0.0.0";
    return _runtimeSdkVersion;
  }
}

/**
 * Compute sha256 of a file. Returns `sha256:<hex>` to match the manifest format.
 */
export function hashFile(path: string): string {
  const buf = readFileSync(path);
  const h = createHash("sha256").update(buf).digest("hex");
  return `sha256:${h}`;
}

/**
 * Is the install a symlink (dev mode)? Checked against the plugin's top-level
 * install dir — the path that lives in ~/.maw/plugins/<name>. Per the plan,
 * symlinked installs skip hash verification (the `linked (dev)` label mode).
 */
export function isDevModeInstall(pluginDir: string): boolean {
  try {
    return lstatSync(pluginDir).isSymbolicLink();
  } catch {
    return false;
  }
}

// ─── Legacy-manifest one-shot warning ────────────────────────────────────────

let _warnedLegacy = false;
export function warnLegacyOnce(count: number): void {
  if (_warnedLegacy) return;
  _warnedLegacy = true;
  if (count > 0) {
    warn(
      `${count} legacy plugin${count === 1 ? "" : "s"} loaded without artifact hash — build them to enforce integrity.`,
    );
  }
}

/** Test-only: reset cached module state (legacy-warn latch + SDK version cache). */
export function __resetDiscoverStateForTests(): void {
  _warnedLegacy = false;
  _runtimeSdkVersion = null;
}
