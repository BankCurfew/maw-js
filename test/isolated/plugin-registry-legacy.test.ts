/**
 * Legacy-warning quieting (#341b) — the "N legacy plugins loaded without
 * artifact hash" warning must exclude dev-mode symlinks. Symlinked installs
 * are reloaded from source every CLI invocation, so hash verification would
 * be a no-op; counting them just spams `maw ls` on dev machines.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  existsSync, mkdirSync, mkdtempSync, rmSync,
  symlinkSync, writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { discoverPackages, __resetDiscoverStateForTests } from "../../src/plugin/registry";

const created: string[] = [];
let origPluginsDir: string | undefined;

function tmpDir(prefix = "maw-legacy-test-"): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  created.push(d);
  return d;
}
function pluginsDir(): string { return process.env.MAW_PLUGINS_DIR!; }

beforeEach(() => {
  origPluginsDir = process.env.MAW_PLUGINS_DIR;
  process.env.MAW_PLUGINS_DIR = join(tmpDir("maw-home-"), "plugins");
  mkdirSync(pluginsDir(), { recursive: true });
  __resetDiscoverStateForTests();
});

afterEach(() => {
  if (origPluginsDir !== undefined) process.env.MAW_PLUGINS_DIR = origPluginsDir;
  else delete process.env.MAW_PLUGINS_DIR;
  for (const d of created.splice(0)) {
    if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
});

/** Legacy manifest = no artifact field. Ships as an entry-only plugin. */
function legacyManifest(name: string): string {
  return JSON.stringify({
    name, version: "1.0.0", sdk: "*",
    target: "js", capabilities: [],
    entry: "./index.js",
  });
}

/** Plant a legacy plugin directly in the plugins dir (non-symlink). */
function plantLegacyDir(name: string): void {
  const dest = join(pluginsDir(), name);
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "plugin.json"), legacyManifest(name));
  writeFileSync(join(dest, "index.js"), "export default () => ({ ok: true });\n");
}

/** Plant a legacy plugin as a symlink into the plugins dir. */
function plantLegacySymlink(name: string): void {
  const sourceDir = tmpDir(`maw-legacy-src-${name}-`);
  writeFileSync(join(sourceDir, "plugin.json"), legacyManifest(name));
  writeFileSync(join(sourceDir, "index.js"), "export default () => ({ ok: true });\n");
  symlinkSync(sourceDir, join(pluginsDir(), name), "dir");
}

/** Capture console.warn output while running fn. */
async function captureWarn(fn: () => void | Promise<void>): Promise<string> {
  const orig = console.warn;
  const lines: string[] = [];
  console.warn = (...a: any[]) => lines.push(a.map(String).join(" "));
  try { await fn(); }
  finally { console.warn = orig; }
  return lines.join("\n");
}

describe("discoverPackages — legacy warning quieting (#341b)", () => {
  test("all symlinks → no legacy warning emitted", async () => {
    plantLegacySymlink("dev-a");
    plantLegacySymlink("dev-b");
    plantLegacySymlink("dev-c");
    const warn = await captureWarn(() => {
      const plugins = discoverPackages();
      expect(plugins.map(p => p.manifest.name).sort()).toEqual(["dev-a", "dev-b", "dev-c"]);
    });
    expect(warn).not.toContain("legacy plugin");
  });

  test("mix → warning counts only non-symlink legacy plugins", async () => {
    plantLegacySymlink("dev-a");
    plantLegacySymlink("dev-b");
    plantLegacyDir("real-legacy-1");
    plantLegacyDir("real-legacy-2");
    const warn = await captureWarn(() => {
      const plugins = discoverPackages();
      expect(plugins.map(p => p.manifest.name).sort())
        .toEqual(["dev-a", "dev-b", "real-legacy-1", "real-legacy-2"]);
    });
    // Expect "2 legacy plugins" (not 4) — symlinks excluded.
    expect(warn).toContain("2 legacy plugins loaded without artifact hash");
  });
});
