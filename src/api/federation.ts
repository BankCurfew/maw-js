import { Hono } from "hono";
import { getFederationStatus } from "../peers";
import { loadConfig } from "../config";

export const federationApi = new Hono();

federationApi.get("/federation/status", async (c) => {
  const status = await getFederationStatus();
  return c.json(status);
});

/** Auth status — public diagnostic endpoint (never reveals the token) */
federationApi.get("/auth/status", (c) => {
  const config = loadConfig();
  const token = config.federationToken;
  return c.json({
    enabled: !!token,
    tokenConfigured: !!token,
    tokenPreview: token ? token.slice(0, 4) + "****" : null,
    method: token ? "HMAC-SHA256" : "none",
    clockUtc: new Date().toISOString(),
    node: config.node || "local",
  });
});
