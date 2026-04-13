/**
 * abort.ts — noop abort for maw plugins.
 *
 * AssemblyScript imports `env.abort` by default for runtime error handling.
 * The maw wasm-bridge does not provide this import, so plugins must override
 * it with a local noop using the `--use abort=assembly/abort/abort` asc flag.
 *
 * Usage in your plugin's asconfig.json:
 *
 *   {
 *     "entries": ["assembly/index.ts", "node_modules/maw-plugin-sdk/assembly/abort.ts"],
 *     "options": { "use": ["abort=maw-plugin-sdk/assembly/abort/abort"] }
 *   }
 *
 * Note: with `--runtime stub` and `--noAssert`, abort is rarely reachable in
 * production plugin code. This override is a safety measure for completeness.
 */

/** Noop abort — silently swallows all runtime errors in maw plugins. */
export function abort(
  message: string | null = null,
  fileName: string | null = null,
  lineNumber: u32 = 0,
  columnNumber: u32 = 0,
): void {
  // intentional noop — maw plugins run in a sandboxed host that does not
  // expose an abort import; errors are silently ignored rather than crashing
  // the instantiation step.
}
