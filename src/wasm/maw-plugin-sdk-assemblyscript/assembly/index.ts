/**
 * index.ts — SDK entry point.
 *
 * Re-exports everything a plugin author needs, plus the maw_alloc export
 * that the host calls to write return data into linear memory.
 *
 * Quick start:
 *
 *   import { maw, readArgs, writeResult } from "maw-plugin-sdk/assembly";
 *
 *   export function handle(ptr: i32, len: i32): i32 {
 *     const args = readArgs(ptr, len);
 *     maw.print("hello!\n");
 *     return 0;
 *   }
 *
 *   export { maw_alloc } from "maw-plugin-sdk/assembly";
 */

export { maw, Identity, Peer, FederationStatus, readArgs, writeResult } from "./api";
export { decodeHostString, encodeUTF8, utf8ByteLength } from "./memory";

/**
 * maw_alloc — exported allocator for the host.
 *
 * The host calls this before writing return data (identity, federation, async
 * results) into our linear memory. It must be re-exported from every plugin.
 */
export function maw_alloc(size: i32): i32 {
  return heap.alloc(size as usize) as i32;
}
