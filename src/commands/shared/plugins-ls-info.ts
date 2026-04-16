/**
 * plugins seam: doLs + doInfo implementations.
 */

import type { LoadedPlugin } from "../../plugin/types";
import { existsSync } from "fs";
import { surfaces, shortenHome, printTable } from "./plugins-ui";

export function doLs(json: boolean, showAll: boolean, discover: () => LoadedPlugin[]): void {
  const allPlugins = discover();

  if (json) {
    console.log(
      JSON.stringify(
        allPlugins.map(p => ({
          name: p.manifest.name,
          version: p.manifest.version,
          surfaces: surfaces(p),
          dir: p.dir,
        })),
        null,
        2,
      ),
    );
    return;
  }

  if (allPlugins.length === 0) {
    console.log("no plugins installed");
    return;
  }

  const { loadConfig } = require("../../config");
  const disabledSet = new Set((loadConfig().disabledPlugins ?? []) as string[]);

  const activeCount = allPlugins.filter(p => !disabledSet.has(p.manifest.name)).length;
  const disabledCount = allPlugins.length - activeCount;
  const plugins = showAll ? allPlugins : allPlugins.filter(p => !disabledSet.has(p.manifest.name));

  if (plugins.length === 0) {
    console.log(`no active plugins. Use --all to see ${disabledCount} disabled.`);
    return;
  }

  // Group by weight tier
  const tiers: { label: string; plugins: LoadedPlugin[] }[] = [
    { label: "core", plugins: [] },
    { label: "standard", plugins: [] },
    { label: "extra", plugins: [] },
  ];

  for (const p of plugins) {
    const w = p.manifest.weight ?? 50;
    if (w < 10) tiers[0].plugins.push(p);
    else if (w < 50) tiers[1].plugins.push(p);
    else tiers[2].plugins.push(p);
  }

  for (const tier of tiers) {
    if (tier.plugins.length === 0) continue;
    console.log(`\n\x1b[1m${tier.label}\x1b[0m (${tier.plugins.length})`);
    const rows = tier.plugins.map(p => {
      const w = p.manifest.weight ?? 50;
      const isDisabled = disabledSet.has(p.manifest.name);
      const icon = isDisabled ? "\x1b[90m○\x1b[0m" : (w < 10 ? "\x1b[32m●\x1b[0m" : w < 50 ? "\x1b[36m●\x1b[0m" : "\x1b[33m●\x1b[0m");
      const source = `${icon} ${isDisabled ? "disabled" : (w < 10 ? "core" : w < 50 ? "standard" : "extra")}`;
      return [
        p.manifest.name,
        p.manifest.version,
        source,
        surfaces(p),
        shortenHome(p.dir),
      ];
    });
    printTable(["name", "version", "source", "surfaces", "dir"], rows);
  }

  if (showAll) {
    console.log(`\n${allPlugins.length} total (${activeCount} active, ${disabledCount} disabled)`);
  } else if (disabledCount > 0) {
    console.log(`\n${activeCount} active. ${disabledCount} disabled — use 'maw plugin ls --all' to see them.`);
  } else {
    console.log(`\n${activeCount} active`);
  }
}

export function doInfo(name: string, discover: () => LoadedPlugin[]): void {
  const plugins = discover();
  const p = plugins.find(x => x.manifest.name === name);
  if (!p) {
    console.error(`plugin not found: ${name}`);
    process.exit(1);
  }

  const m = p.manifest;
  console.log(`\x1b[1m${m.name}\x1b[0m  ${m.version}`);
  if (m.description) console.log(`  desc:    ${m.description}`);
  if (m.author)      console.log(`  author:  ${m.author}`);
  console.log(`  sdk:     ${m.sdk}`);
  if (m.cli) {
    const help = m.cli.help ? `  — ${m.cli.help}` : "";
    console.log(`  cli:     ${m.cli.command}${help}`);
  }
  if (m.api) {
    console.log(`  api:     ${m.api.path}  [${m.api.methods.join(", ")}]`);
  }
  console.log(`  dir:     ${p.dir}`);

  const wasmExists = existsSync(p.wasmPath);
  const wasmMark = wasmExists ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗ missing\x1b[0m";
  console.log(`  wasm:    ${p.wasmPath}  ${wasmMark}`);
  if (!wasmExists) {
    console.warn(`\x1b[33mwarn:\x1b[0m wasm file missing — plugin will not execute`);
  }
}
