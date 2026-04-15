/**
 * maw plugin install <src>
 *
 * Accepts three source types (detected by prefix / extension):
 *   • Directory   — e.g. ./hello/            → symlink to ~/.maw/plugins/<name>/
 *                                              label: "linked (dev)"
 *   • Tarball     — e.g. ./hello-0.1.0.tgz  → extract + hash verify
 *                                              label: "installed (sha256:abc…)"
 *   • URL         — http(s)://...            → download → tarball flow
 *
 * Phase A gates (run BEFORE symlinking / extracting):
 *   • Semver check — plugin.json.sdk must satisfy the runtime SDK version.
 *     Mismatch → actionable error (exact format per plan §1), exit 1.
 *
 * Phase A labels output (per plan §Author-facing surface):
 *   ✓ <name>@<version> installed
 *     sdk: <range> ✓ (maw <version>)
 *     capabilities: <list>
 *     mode: linked (dev) | installed (sha256:<prefix>…)
 *     dir: ~/.maw/plugins/<name>
 *   try: maw <name>
 */

import { spawnSync } from "child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { homedir, tmpdir } from "os";
import { basename, join, resolve } from "path";
import { parseFlags } from "../../../cli/parse-args";
import { parseManifest } from "../../../plugin/manifest";
import {
  formatSdkMismatchError,
  hashFile,
  runtimeSdkVersion,
  satisfies,
} from "../../../plugin/registry";
import type { PluginManifest } from "../../../plugin/types";

// TODO(phase-b): trust-boundary enforcement. First tarball installed from a
// non-first-party URL should flip capability enforcement on for that plugin.
// Today we track the install source but don't gate on it.

/**
 * ~/.maw/plugins — resolved at call time. Honors `MAW_PLUGINS_DIR` override
 * for tests (and for advanced users who want a non-default install root).
 */
function installRoot(): string {
  return process.env.MAW_PLUGINS_DIR || join(homedir(), ".maw", "plugins");
}

type Mode =
  | { kind: "dir"; src: string }
  | { kind: "tarball"; src: string }
  | { kind: "url"; src: string };

function detectMode(src: string): Mode {
  if (/^https?:\/\//i.test(src)) return { kind: "url", src };
  if (src.endsWith(".tgz") || src.endsWith(".tar.gz")) {
    return { kind: "tarball", src: resolve(src) };
  }
  return { kind: "dir", src: resolve(src) };
}

/**
 * Run `tar -xzf <tarball> -C <destDir>` synchronously. Returns true on success.
 * We shell out to GNU tar rather than adding a `tar` npm dep — Bun ships without
 * streaming tar, and adding a dep for a single call is not worth it.
 */
function extractTarball(tarballPath: string, destDir: string): { ok: true } | { ok: false; error: string } {
  const r = spawnSync("tar", ["-xzf", tarballPath, "-C", destDir], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    return { ok: false, error: `tar extract failed: ${r.stderr || r.stdout || `exit ${r.status}`}` };
  }
  return { ok: true };
}

/**
 * Download a URL to a temp file. Verifies the content type looks like gzip/tar
 * before writing (per brief: "verify content-type is gzip/tar").
 */
async function downloadTarball(url: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e: any) {
    return { ok: false, error: `download failed: ${e.message}` };
  }
  if (!res.ok) {
    return { ok: false, error: `download failed: HTTP ${res.status} ${res.statusText}` };
  }
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const ctOk =
    ct.includes("gzip") ||
    ct.includes("x-gzip") ||
    ct.includes("x-tar") ||
    ct.includes("tar+gzip") ||
    ct.includes("octet-stream"); // many CDNs return generic binary
  if (!ctOk) {
    return { ok: false, error: `unexpected content-type ${JSON.stringify(ct)} — expected gzip/tar` };
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const tmp = mkdtempSync(join(tmpdir(), "maw-dl-"));
  const filename = basename(new URL(url).pathname) || "plugin.tgz";
  const outPath = join(tmp, filename);
  writeFileSync(outPath, buf);
  return { ok: true, path: outPath };
}

/**
 * Read + parse plugin.json from an unpacked dir. Returns null + logs if missing.
 */
function readManifest(dir: string): PluginManifest | null {
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

/** rm -rf then recreate parent to ensure a clean install target. */
function ensureInstallRoot(): void {
  const root = installRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
}

/** Remove an existing install (symlink or real dir). */
function removeExisting(dest: string): void {
  try {
    const st = lstatSync(dest);
    if (st.isSymbolicLink() || st.isFile()) unlinkSync(dest);
    else if (st.isDirectory()) rmSync(dest, { recursive: true, force: true });
  } catch {
    // ENOENT (no existing install) — nothing to remove. Other errors will
    // surface on the rename below if they matter.
  }
}

/** Verify sha256 of `artifactPath` (relative to dir) matches `expected`. */
function verifyArtifactHash(dir: string, manifest: PluginManifest): { ok: true } | { ok: false; error: string } {
  if (!manifest.artifact) {
    return { ok: false, error: "tarball manifest has no 'artifact' field — rebuild with `maw plugin build`" };
  }
  if (manifest.artifact.sha256 === null) {
    return { ok: false, error: "tarball manifest has artifact.sha256=null (unbuilt) — rebuild with `maw plugin build`" };
  }
  const artifactPath = join(dir, manifest.artifact.path);
  if (!existsSync(artifactPath)) {
    return { ok: false, error: `artifact missing at ${manifest.artifact.path}` };
  }
  const observed = hashFile(artifactPath);
  if (observed !== manifest.artifact.sha256) {
    return {
      ok: false,
      error:
        `artifact hash mismatch — refusing to install.\n` +
        `  expected: ${manifest.artifact.sha256}\n` +
        `  actual:   ${observed}`,
    };
  }
  return { ok: true };
}

/** Short sha256 prefix for the label, e.g. "abc1234" from "sha256:abc1234def…". */
function shortHash(sha256: string): string {
  const idx = sha256.indexOf(":");
  const hex = idx === -1 ? sha256 : sha256.slice(idx + 1);
  return hex.slice(0, 7);
}

/** Print the Phase A success label block. */
function printInstallSuccess(
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

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * cmdPluginInstall — parse args, dispatch by source type.
 *
 * Called by src/commands/plugins/plugin/index.ts dispatcher with the raw
 * args after the "install" verb (i.e. args = ["./hello/", "--link"] or
 * similar). Matches the convention of sibling init-impl.ts / build-impl.ts.
 */
export async function cmdPluginInstall(args: string[]): Promise<void> {
  const flags = parseFlags(args, { "--link": Boolean }, 0);
  const src = flags._[0];

  if (!src || src === "--help" || src === "-h") {
    console.error("usage: maw plugin install <dir | .tgz | URL> [--link]");
    process.exit(1);
  }

  ensureInstallRoot();
  const mode = detectMode(src);

  // Dispatch on source type.
  if (mode.kind === "dir") {
    await installFromDir(mode.src);
  } else if (mode.kind === "tarball") {
    await installFromTarball(mode.src, { source: `./${basename(mode.src)}` });
  } else {
    await installFromUrl(mode.src);
  }
}

async function installFromDir(srcDir: string): Promise<void> {
  if (!existsSync(srcDir)) {
    console.error(`\x1b[31m✗\x1b[0m source not found: ${srcDir}`);
    process.exit(1);
  }
  if (!statSync(srcDir).isDirectory()) {
    console.error(`\x1b[31m✗\x1b[0m not a directory: ${srcDir}`);
    process.exit(1);
  }
  const manifest = readManifest(srcDir);
  if (!manifest) process.exit(1);

  // Semver gate — before symlinking, so a broken plugin never lands.
  const runtime = runtimeSdkVersion();
  if (!satisfies(runtime, manifest!.sdk)) {
    console.error(formatSdkMismatchError(manifest!.name, manifest!.sdk, runtime));
    process.exit(1);
  }

  const dest = join(installRoot(), manifest!.name);
  removeExisting(dest);
  symlinkSync(srcDir, dest, "dir");

  printInstallSuccess(manifest!, dest, "linked (dev)");
}

async function installFromTarball(
  tarballPath: string,
  opts: { source: string },
): Promise<void> {
  if (!existsSync(tarballPath)) {
    console.error(`\x1b[31m✗\x1b[0m tarball not found: ${tarballPath}`);
    process.exit(1);
  }

  // Extract into a staging dir so we can read the manifest + verify hash
  // before any ~/.maw/plugins/ mutation.
  const staging = mkdtempSync(join(tmpdir(), "maw-install-"));
  const extractResult = extractTarball(tarballPath, staging);
  if (!extractResult.ok) {
    rmSync(staging, { recursive: true, force: true });
    console.error(`\x1b[31m✗\x1b[0m ${extractResult.error}`);
    process.exit(1);
  }

  const manifest = readManifest(staging);
  if (!manifest) {
    rmSync(staging, { recursive: true, force: true });
    process.exit(1);
  }

  const runtime = runtimeSdkVersion();
  if (!satisfies(runtime, manifest!.sdk)) {
    rmSync(staging, { recursive: true, force: true });
    console.error(formatSdkMismatchError(manifest!.name, manifest!.sdk, runtime));
    process.exit(1);
  }

  const hashResult = verifyArtifactHash(staging, manifest!);
  if (!hashResult.ok) {
    rmSync(staging, { recursive: true, force: true });
    console.error(`\x1b[31m✗\x1b[0m ${hashResult.error}`);
    process.exit(1);
  }

  // All gates passed — move staging into the install root.
  const dest = join(installRoot(), manifest!.name);
  removeExisting(dest);
  // Use rename when the staging dir is on the same fs; otherwise copy-then-rm.
  try {
    const { renameSync } = require("fs");
    renameSync(staging, dest);
  } catch {
    // Cross-device fallback (rare). Fall back to cp -a then rm -rf.
    spawnSync("cp", ["-a", staging + "/.", dest], { encoding: "utf8" });
    rmSync(staging, { recursive: true, force: true });
  }

  const sourceNote = opts.source.startsWith("http") ? `from ${opts.source}` : "";
  printInstallSuccess(
    manifest!,
    dest,
    { sha256: manifest!.artifact!.sha256! },
    sourceNote || undefined,
  );
}

async function installFromUrl(url: string): Promise<void> {
  const dl = await downloadTarball(url);
  if (!dl.ok) {
    console.error(`\x1b[31m✗\x1b[0m ${dl.error}`);
    process.exit(1);
  }
  try {
    await installFromTarball(dl.path, { source: url });
  } finally {
    // Clean up the downloaded temp file.
    try {
      rmSync(join(dl.path, ".."), { recursive: true, force: true });
    } catch {
      // Non-fatal.
    }
  }
}
