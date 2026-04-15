import { describe, it, expect, mock } from "bun:test";
import { join } from "path";
import type { InvokeContext } from "../src/plugin/types";

const root = join(import.meta.dir, "../src");

mock.module(join(root, "commands/plugins/panes/impl"), () => ({
  cmdPanes: async (target?: string) => {
    if (target === "ambi") {
      console.error("✗ 'ambi' is ambiguous");
      throw new Error("exit 1");
    }
    if (target === "nope-xyz") {
      console.error("✗ session 'nope-xyz' not found");
      throw new Error("exit 1");
    }
    console.log(`TARGET  SIZE  COMMAND  TITLE`);
    console.log(`${target ?? "current"}:0.0  80x24  zsh  ready`);
  },
}));

const { default: handler } = await import("../src/commands/plugins/panes/index");

describe("panes plugin", () => {
  it("CLI — no target lists current window panes", async () => {
    const ctx: InvokeContext = { source: "cli", args: [] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("TARGET");
    expect(result.output).toContain("current:0.0");
  });

  it("CLI — session target listed", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["mawjs-view"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("mawjs-view:0.0");
  });

  it("CLI — flag-looking arg rejected", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["--weird"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("looks like a flag");
  });

  it("CLI — target not found reports error", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["nope-xyz"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("CLI — ambiguous target errors", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["ambi"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ambiguous");
  });

  it("API — no target ok", async () => {
    const ctx: InvokeContext = { source: "api", args: {} };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("TARGET");
  });

  it("API — explicit target ok", async () => {
    const ctx: InvokeContext = { source: "api", args: { target: "mawjs-view" } };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("mawjs-view:0.0");
  });
});
