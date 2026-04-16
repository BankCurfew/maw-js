/**
 * install-impl seam: per-source-type install handlers.
 * installFromDir / installFromTarball / installFromUrl
 */

import { existsSync, mkdtempSync, rmSync, statSync, symlinkSync } from "fs";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import { basename, join } from "path";
import { formatSdkMismatchError, runtimeSdkVersion, satisfies } from "../../../plugin/registry";
import { installRoot, removeExisting } from "./install-source-detect";
import { extractTarball, downloadTarball, verifyArtifactHash } from "./install-extraction";
import { readManifest, printInstallSuccess } from "./install-manifest-helpers";

export async function installFromDir(srcDir: string): Promise<void> {
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

export async function installFromTarball(
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

export async function installFromUrl(url: string): Promise<void> {
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
