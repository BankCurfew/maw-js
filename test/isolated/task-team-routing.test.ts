import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Regression tests for #393 Bug E — `maw team add/tasks/done/assign` were
// hardcoded to team="default" regardless of operator intent. Fix adds
// --team flag, positional arg (tasks), MAW_TEAM env var, and single-team
// auto-detection.
//
// Also implicitly exercises Bug H (case-preservation in CLI dispatcher)
// since we invoke the plugin handler directly with mixed-case args.

import handler from "../../src/commands/plugins/team";

let testConfigDir: string;
let testTeamsDir: string;

beforeEach(() => {
  testConfigDir = join(tmpdir(), `maw-bugE-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.MAW_CONFIG_DIR = testConfigDir;
  testTeamsDir = join(testConfigDir, "teams");
  mkdirSync(testTeamsDir, { recursive: true });
});

afterEach(() => {
  delete process.env.MAW_CONFIG_DIR;
  delete process.env.MAW_TEAM;
  try { rmSync(testConfigDir, { recursive: true, force: true }); } catch { /* ok */ }
});

async function runHandler(args: string[]) {
  return await handler({ source: "cli", args } as any);
}

describe("maw team task verbs — #393 Bug E (task-team routing)", () => {
  test("add: --team flag routes task to specified team", async () => {
    const r = await runHandler(["add", "my subject", "--team", "alpha-team"]);
    expect(r.ok).toBe(true);
    expect(existsSync(join(testTeamsDir, "alpha-team/tasks/1.json"))).toBe(true);
    expect(existsSync(join(testTeamsDir, "default/tasks"))).toBe(false); // NOT default
  });

  test("add: case-preserved team name (Bug H implicit check)", async () => {
    const r = await runHandler(["add", "case test", "--team", "MyTeamCASE"]);
    expect(r.ok).toBe(true);
    // Case preserved on disk
    const entries = readdirSync(testTeamsDir);
    expect(entries).toContain("MyTeamCASE");
  });

  test("add: MAW_TEAM env var selects the team", async () => {
    process.env.MAW_TEAM = "env-team";
    const r = await runHandler(["add", "env routing"]);
    expect(r.ok).toBe(true);
    expect(existsSync(join(testTeamsDir, "env-team/tasks/1.json"))).toBe(true);
  });

  test("add: --team overrides MAW_TEAM env var", async () => {
    process.env.MAW_TEAM = "env-team";
    const r = await runHandler(["add", "explicit wins", "--team", "flag-team"]);
    expect(r.ok).toBe(true);
    expect(existsSync(join(testTeamsDir, "flag-team/tasks/1.json"))).toBe(true);
    expect(existsSync(join(testTeamsDir, "env-team/tasks"))).toBe(false);
  });

  test("tasks: --team flag lists the specified team's tasks", async () => {
    // Seed two teams
    await runHandler(["add", "subject 1", "--team", "team-x"]);
    await runHandler(["add", "subject 2", "--team", "team-y"]);
    // List team-y's tasks — should show 1 task, not leakage from team-x
    const r = await runHandler(["tasks", "--team", "team-y"]);
    expect(r.ok).toBe(true);
    const tasks = readdirSync(join(testTeamsDir, "team-y/tasks")).filter(f => f !== "_counter.json");
    expect(tasks.length).toBe(1);
  });

  test("tasks: positional team arg still works (backward compat)", async () => {
    await runHandler(["add", "compat task", "--team", "bc-team"]);
    const r = await runHandler(["tasks", "bc-team"]);
    expect(r.ok).toBe(true);
  });

  test("done: --team flag targets correct team", async () => {
    await runHandler(["add", "pending task", "--team", "done-team"]);
    const r = await runHandler(["done", "1", "--team", "done-team"]);
    expect(r.ok).toBe(true);
    const task = JSON.parse(readFileSync(join(testTeamsDir, "done-team/tasks/1.json"), "utf-8"));
    expect(task.status).toBe("completed");
  });

  test("assign: --team flag targets correct team", async () => {
    await runHandler(["add", "to assign", "--team", "asn-team"]);
    const r = await runHandler(["assign", "1", "alice", "--team", "asn-team"]);
    expect(r.ok).toBe(true);
    const task = JSON.parse(readFileSync(join(testTeamsDir, "asn-team/tasks/1.json"), "utf-8"));
    expect(task.assignee).toBe("alice");
    expect(task.status).toBe("in_progress");
  });
});
