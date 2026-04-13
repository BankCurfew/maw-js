/**
 * hello-as — minimal maw WASM plugin in AssemblyScript.
 *
 * Demonstrates: maw.print, maw.identity, maw.federation, readArgs.
 * Build: npm run asbuild:release  → build/release.wasm
 */

import { maw, readArgs } from "maw-plugin-sdk/assembly/index";

/**
 * Entry point called by the maw runtime.
 * ptr/len point to a JSON-encoded string[] of CLI arguments.
 * Return 0 for success.
 */
export function handle(ptr: i32, len: i32): i32 {
  const args = readArgs(ptr, len);

  maw.print("hello from assemblyscript!\n");

  const id = maw.identity();
  maw.print("  node:    " + id.node + "\n");
  maw.print("  version: " + id.version + "\n");
  if (id.agents.length > 0) {
    maw.print("  agents:  " + id.agents.join(", ") + "\n");
  }

  if (args.length > 0) {
    maw.print("  args:    " + args.join(" ") + "\n");
  }

  const fed = maw.federation();
  maw.print(
    "  peers:   " +
    fed.reachablePeers.toString() + "/" +
    fed.totalPeers.toString() + "\n"
  );

  return 0;
}

/**
 * Re-export the allocator — the maw runtime calls maw_alloc(size) to write
 * return data (identity JSON, fetch results, etc.) into our linear memory.
 */
export function maw_alloc(size: i32): i32 {
  return heap.alloc(size as usize) as i32;
}
