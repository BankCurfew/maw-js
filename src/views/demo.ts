import { Hono } from "hono";
import { readFileSync } from "fs";
import { join } from "path";
import { MAW_ROOT } from "../paths";

export const demoView = new Hono();

const DEMO_DIR = join(MAW_ROOT, "demo");

demoView.get("/", (c) => {
  return c.html(readFileSync(join(DEMO_DIR, "index.html"), "utf-8"));
});

demoView.get("/:file", (c) => {
  const file = c.req.param("file");
  if (!file.endsWith(".html")) return c.text("Not found", 404);
  try {
    return c.html(readFileSync(join(DEMO_DIR, file), "utf-8"));
  } catch {
    return c.text("Not found", 404);
  }
});
