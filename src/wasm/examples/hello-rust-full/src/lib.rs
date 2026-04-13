//! hello-rust-full — full Rust WASM reference plugin.
//!
//! This is the idiomatic Rust port of the TypeScript `hello` command plugin.
//!
//! TypeScript original (`~/.oracle/commands/hello.ts`):
//! ```ts
//! export const command = {
//!   name: "hello",
//!   description: "Say hello from a plugin command",
//! };
//!
//! export default async function() {
//!   console.log("  \x1b[36m👋\x1b[0m Hello from a command plugin!");
//!   console.log("  \x1b[90mThis command lives in ~/.oracle/commands/hello.ts\x1b[0m");
//! }
//! ```
//!
//! # TS → Rust mapping
//!
//! | TypeScript                          | Rust                                  |
//! |-------------------------------------|---------------------------------------|
//! | `export const command = { name }` | `const COMMAND: CommandMeta`          |
//! | `console.log(...)`                  | `maw::print(...)`                     |
//! | `maw.fetch<Identity>('/api/…')`    | `maw::identity()` (SDK wraps fetch)   |
//! | `async/await`                       | synchronous (host resolves internally)|
//! | TypeScript interface                | Rust struct with `#[derive(serde)]`   |

use maw_plugin_sdk as maw;
use serde::Serialize;

// ---------------------------------------------------------------------------
// Plugin metadata — mirrors the TS `export const command = { ... }` object.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct CommandMeta {
    name: &'static str,
    description: &'static str,
}

const COMMAND: CommandMeta = CommandMeta {
    name: "hello",
    description: "Say hello from a plugin command",
};

// ---------------------------------------------------------------------------
// Entry point — called by the maw runtime.
//
// `ptr`/`len` point to a JSON-encoded `string[]` of CLI arguments written
// by the host into WASM linear memory before invoking `handle`.
//
// Return 0 for success (host exits cleanly); any non-zero value is an error
// code that the host reports to the user.
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn handle(ptr: *const u8, len: usize) -> i32 {
    let args = maw::read_args(ptr, len);

    // -----------------------------------------------------------------------
    // Greet — mirrors the two console.log lines in hello.ts.
    // ANSI codes are identical: \x1b[36m = cyan, \x1b[90m = bright-black.
    // -----------------------------------------------------------------------
    maw::print("  \x1b[36m👋\x1b[0m Hello from a command plugin! (Rust WASM)\n");
    maw::print(&format!(
        "  \x1b[90mThis command is compiled from src/wasm/examples/{}/src/lib.rs\x1b[0m\n",
        COMMAND.name
    ));

    // -----------------------------------------------------------------------
    // Identity — equivalent to `maw.fetch<Identity>('/api/identity')` in TS.
    // The SDK wraps the host's maw_identity() function so Rust code never
    // has to manually call fetch + await + JSON.parse.
    // -----------------------------------------------------------------------
    let id = maw::identity();
    maw::print(&format!("\n  \x1b[90mOracle identity:\x1b[0m\n"));
    maw::print(&format!("    node:    {}\n", id.node));
    maw::print(&format!("    version: {}\n", id.version));
    if !id.agents.is_empty() {
        maw::print(&format!("    agents:  {}\n", id.agents.join(", ")));
    }
    if !id.clock_utc.is_empty() {
        maw::print(&format!("    clock:   {}\n", id.clock_utc));
    }

    // -----------------------------------------------------------------------
    // Extra args — show anything the user passed after `maw hello`.
    // -----------------------------------------------------------------------
    if !args.is_empty() {
        maw::print(&format!("\n  \x1b[90margs:\x1b[0m {}\n", args.join(" ")));
    }

    // -----------------------------------------------------------------------
    // Federation status — shows peer connectivity (bonus over the TS version).
    // -----------------------------------------------------------------------
    let fed = maw::federation();
    maw::print(&format!(
        "\n  \x1b[90mfederation:\x1b[0m {}/{} peers reachable\n",
        fed.reachable_peers, fed.total_peers
    ));

    0
}

// Re-export the SDK allocator so the host can call `maw_alloc` on our module.
pub use maw_plugin_sdk::maw_alloc;
