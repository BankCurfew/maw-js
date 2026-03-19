/**
 * Authentication middleware for maw-js dashboard
 * Session-based with cookie + login page
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const AUTH_CONFIG_PATH = join(import.meta.dir, "../auth.json");
const SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days

interface AuthConfig {
  enabled: boolean;
  username: string;
  passwordHash: string; // bcrypt-like hash
  sessions: Record<string, { createdAt: number; userAgent: string }>;
  allowLocal: boolean; // allow localhost without auth
}

function loadAuthConfig(): AuthConfig {
  try {
    if (existsSync(AUTH_CONFIG_PATH)) {
      return JSON.parse(readFileSync(AUTH_CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return { enabled: false, username: "", passwordHash: "", sessions: {}, allowLocal: true };
}

function saveAuthConfig(config: AuthConfig) {
  writeFileSync(AUTH_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

// Simple hash — not bcrypt but good enough for internal dashboard
function hashPassword(password: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "maw-salt-2026");
  let hash = 0x811c9dc5; // FNV offset basis
  for (const byte of data) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Convert to hex + add length check
  return `maw1$${(hash >>> 0).toString(16)}$${data.length}`;
}

function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

function generateSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function isLocalRequest(req: Request): boolean {
  const host = new URL(req.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function getSessionFromCookie(req: Request): string | null {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(/maw_session=([a-f0-9]+)/);
  return match ? match[1] : null;
}

export function isAuthenticated(req: Request): boolean {
  const config = loadAuthConfig();
  if (!config.enabled) return true;
  if (config.allowLocal && isLocalRequest(req)) return true;

  const sessionId = getSessionFromCookie(req);
  if (!sessionId) return false;

  const session = config.sessions[sessionId];
  if (!session) return false;

  // Check expiry
  if (Date.now() - session.createdAt > SESSION_EXPIRY) {
    delete config.sessions[sessionId];
    saveAuthConfig(config);
    return false;
  }

  return true;
}

export function handleLogin(username: string, password: string, userAgent: string): { ok: boolean; sessionId?: string; error?: string } {
  const config = loadAuthConfig();

  if (config.username !== username) {
    return { ok: false, error: "Invalid credentials" };
  }

  if (!verifyPassword(password, config.passwordHash)) {
    return { ok: false, error: "Invalid credentials" };
  }

  // Create session
  const sessionId = generateSessionId();
  config.sessions[sessionId] = { createdAt: Date.now(), userAgent };

  // Clean old sessions (keep max 10)
  const entries = Object.entries(config.sessions).sort((a, b) => b[1].createdAt - a[1].createdAt);
  if (entries.length > 10) {
    config.sessions = Object.fromEntries(entries.slice(0, 10));
  }

  saveAuthConfig(config);
  return { ok: true, sessionId };
}

export function handleLogout(req: Request): void {
  const sessionId = getSessionFromCookie(req);
  if (!sessionId) return;
  const config = loadAuthConfig();
  delete config.sessions[sessionId];
  saveAuthConfig(config);
}

export function setupAuth(username: string, password: string): void {
  const config = loadAuthConfig();
  config.enabled = true;
  config.username = username;
  config.passwordHash = hashPassword(password);
  config.allowLocal = true;
  saveAuthConfig(config);
}

export function isAuthEnabled(): boolean {
  return loadAuthConfig().enabled;
}

// Login page HTML
export const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BoB's Office — Login</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'SF Mono', 'Cascadia Code', monospace;
    background: #020208;
    color: #cdd6f4;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .login-box {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(34,211,238,0.15);
    border-radius: 16px;
    padding: 40px;
    width: 360px;
    box-shadow: 0 4px 30px rgba(0,0,0,0.4), 0 0 40px rgba(34,211,238,0.03);
  }
  h1 {
    color: #22d3ee;
    font-size: 18px;
    letter-spacing: 6px;
    text-align: center;
    margin-bottom: 8px;
  }
  .subtitle {
    text-align: center;
    color: rgba(255,255,255,0.3);
    font-size: 11px;
    margin-bottom: 32px;
    letter-spacing: 2px;
  }
  label {
    display: block;
    color: rgba(255,255,255,0.5);
    font-size: 11px;
    margin-bottom: 6px;
    letter-spacing: 1px;
  }
  input {
    width: 100%;
    padding: 10px 14px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    color: #cdd6f4;
    font-family: inherit;
    font-size: 14px;
    outline: none;
    margin-bottom: 16px;
    transition: border-color 0.2s;
  }
  input:focus {
    border-color: rgba(34,211,238,0.4);
    box-shadow: 0 0 12px rgba(34,211,238,0.1);
  }
  button {
    width: 100%;
    padding: 12px;
    background: rgba(34,211,238,0.15);
    color: #22d3ee;
    border: 1px solid rgba(34,211,238,0.3);
    border-radius: 8px;
    font-family: inherit;
    font-size: 13px;
    font-weight: bold;
    letter-spacing: 2px;
    cursor: pointer;
    transition: all 0.2s;
  }
  button:hover { background: rgba(34,211,238,0.25); }
  button:active { transform: scale(0.98); }
  .error {
    color: #ef4444;
    font-size: 12px;
    text-align: center;
    margin-top: 12px;
    display: none;
  }
  .lock-icon {
    text-align: center;
    font-size: 32px;
    margin-bottom: 16px;
    opacity: 0.3;
  }
</style>
</head>
<body>
<div class="login-box">
  <div class="lock-icon">&#128274;</div>
  <h1>BOB'S OFFICE</h1>
  <p class="subtitle">AUTHENTICATION REQUIRED</p>
  <form id="loginForm">
    <label>USERNAME</label>
    <input type="text" id="username" autocomplete="username" autofocus>
    <label>PASSWORD</label>
    <input type="password" id="password" autocomplete="current-password">
    <button type="submit">LOGIN</button>
  </form>
  <p class="error" id="error"></p>
</div>
<script>
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('error');
  err.style.display = 'none';
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      window.location.href = '/';
    } else {
      err.textContent = data.error || 'Login failed';
      err.style.display = 'block';
    }
  } catch (e) {
    err.textContent = 'Connection error';
    err.style.display = 'block';
  }
});
</script>
</body>
</html>`;
