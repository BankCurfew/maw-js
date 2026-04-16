/**
 * Runtime guard: bud stem must NOT end with '-oracle'.
 *
 * The bud plugin auto-appends '-oracle' to produce the repo name, so a stem
 * like 'arra-oracle-v3-oracle' would create 'arra-oracle-v3-oracle-oracle'.
 * The guard throws before any filesystem/git side effects.
 */
import { describe, test, expect } from "bun:test";
import { cmdBud } from "../src/commands/plugins/bud/impl";

describe("bud stem runtime guard", () => {
  test("throws on stem ending with -oracle", async () => {
    await expect(cmdBud("arra-oracle-v3-oracle", {})).rejects.toThrow(
      /must NOT end with '-oracle'/,
    );
  });

  test("throws on single -oracle suffix", async () => {
    await expect(cmdBud("my-oracle", {})).rejects.toThrow(
      /must NOT end with '-oracle'/,
    );
  });

  test("accepts stem without -oracle suffix", async () => {
    // Guard must NOT fire — actual bud flow may fail for other reasons, that's fine
    try {
      await cmdBud("test-stem-only", {});
    } catch (e: any) {
      expect(e.message).not.toMatch(/must NOT end with '-oracle'/);
    }
  });
});
