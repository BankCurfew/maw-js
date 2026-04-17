import { Elysia } from "elysia";
import { mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

const INBOX_DIR = join(homedir(), ".maw", "inbox");

const MIME_MAP: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf",
  txt: "text/plain", md: "text/markdown", json: "application/json",
  csv: "text/csv", html: "text/html", css: "text/css",
  js: "application/javascript", ts: "text/typescript",
};
function guessMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return MIME_MAP[ext] || "application/octet-stream";
}

/** Ensure inbox dir exists on first use */
function ensureInbox() {
  if (!existsSync(INBOX_DIR)) mkdirSync(INBOX_DIR, { recursive: true });
  return INBOX_DIR;
}

export const uploadApi = new Elysia();

/** Shared upload handler — used by both /attach and /upload */
async function handleUpload(body: any, set: any) {
  try {
    const file = (body as any)?.file;
    if (!file || !(file instanceof Blob)) {
      set.status = 400;
      return { error: "missing 'file' field — use: curl -F 'file=@image.png' /api/attach" };
    }
    const dir = ensureInbox();
    const rawName = (file as any).name || `upload-${Date.now()}`;
    const safeName = basename(rawName).replace(/[^a-zA-Z0-9._-]/g, "_");
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dest = join(dir, safeName);

    const buf = Buffer.from(await file.arrayBuffer());
    await Bun.write(dest, buf);

    const mimeType = (file as any).type || guessMime(safeName);

    return {
      ok: true,
      id,
      name: safeName,
      size: buf.length,
      mimeType,
      url: `/api/files/${encodeURIComponent(safeName)}`,
      localUrl: dest,
    };
  } catch (e: any) {
    set.status = 500;
    return { error: e.message };
  }
}

/** POST /attach — primary endpoint (frontend uses this) */
uploadApi.post("/attach", ({ body, set }) => handleUpload(body, set));

/** POST /upload — legacy alias */
uploadApi.post("/upload", ({ body, set }) => handleUpload(body, set));

/** GET /files — list inbox files */
uploadApi.get("/files", () => {
  const dir = ensureInbox();
  try {
    return readdirSync(dir).map((name) => {
      const st = statSync(join(dir, name));
      return { name, size: st.size, modified: st.mtime.toISOString() };
    });
  } catch {
    return [];
  }
});

/** GET /files/:name — download a file */
uploadApi.get("/files/:name", ({ params, set }) => {
  const filePath = join(ensureInbox(), basename(params.name));
  if (!existsSync(filePath)) { set.status = 404; return { error: "not found" }; }
  return Bun.file(filePath);
});

/** GET /attachments/:name — v1 compat alias for file serving */
uploadApi.get("/attachments/:name", ({ params, set }) => {
  const filePath = join(ensureInbox(), basename(params.name));
  if (!existsSync(filePath)) { set.status = 404; return { error: "not found" }; }
  return Bun.file(filePath);
});

/** DELETE /files/:name — remove a file (moves to /tmp) */
uploadApi.delete("/files/:name", ({ params, set }) => {
  const filePath = join(ensureInbox(), basename(params.name));
  if (!existsSync(filePath)) { set.status = 404; return { error: "not found" }; }
  const archive = `/tmp/maw-inbox-${basename(params.name)}-${Date.now()}`;
  Bun.write(archive, Bun.file(filePath));
  unlinkSync(filePath);
  return { ok: true, archived: archive };
});
