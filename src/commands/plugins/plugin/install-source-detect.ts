/**
 * install-impl seam: install root + source-type detection.
 */

import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { basename } from "path";
import { lstatSync, rmSync, unlinkSync } from "fs";

/**
 * ~/.maw/plugins — resolved at call time. Honors `MAW_PLUGINS_DIR` override
 * for tests (and for advanced users who want a non-default install root).
 */
export function installRoot(): string {
  return process.env.MAW_PLUGINS_DIR || join(homedir(), ".maw", "plugins");
}

export type Mode =
  | { kind: "dir"; src: string }
  | { kind: "tarball"; src: string }
  | { kind: "url"; src: string };

export function detectMode(src: string): Mode {
  if (/^https?:\/\//i.test(src)) return { kind: "url", src };
  if (src.endsWith(".tgz") || src.endsWith(".tar.gz")) {
    return { kind: "tarball", src: resolve(src) };
  }
  return { kind: "dir", src: resolve(src) };
}

/** Ensure ~/.maw/plugins exists. */
export function ensureInstallRoot(): void {
  const root = installRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
}

/** Remove an existing install (symlink or real dir). */
export function removeExisting(dest: string): void {
  try {
    const st = lstatSync(dest);
    if (st.isSymbolicLink() || st.isFile()) unlinkSync(dest);
    else if (st.isDirectory()) rmSync(dest, { recursive: true, force: true });
  } catch {
    // ENOENT (no existing install) — nothing to remove. Other errors will
    // surface on the rename below if they matter.
  }
}
