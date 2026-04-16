import { hostExec } from "../../sdk";

/** Resolve repo slug from git remote or --repo flag */
async function resolveRepo(repo?: string): Promise<string> {
  if (repo) return repo;
  try {
    const remote = await hostExec("git remote get-url origin 2>/dev/null");
    const m = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (m) return m[1];
  } catch { /* expected */ }
  throw new Error("Could not detect repo — pass --repo org/name");
}

/**
 * Fetch a GitHub issue or PR and build a prompt for claude -p.
 * One function, two modes: --issue and --pr both call this.
 */
export async function fetchGitHubPrompt(type: "issue" | "pr", num: number, repo?: string): Promise<string> {
  const repoSlug = await resolveRepo(repo);
  const cmd = type === "pr" ? "pr" : "issue";

  const json = await hostExec(
    `gh ${cmd} view ${num} --repo '${repoSlug}' --json title,body,labels` +
    (type === "pr" ? ",state,headRefName,files" : "")
  );
  const item = JSON.parse(json);
  const labels = (item.labels || []).map((l: { name: string }) => l.name).join(", ");

  if (type === "pr") {
    return [
      `Review PR #${num}: ${item.title}`,
      `Branch: ${item.headRefName} | State: ${item.state}`,
      labels ? `Labels: ${labels}` : "",
      item.files?.length ? `Files changed: ${item.files.length}` : "",
      "",
      item.body || "(no description)",
    ].filter(Boolean).join("\n");
  }

  return [
    `Work on issue #${num}: ${item.title}`,
    labels ? `Labels: ${labels}` : "",
    "",
    item.body || "(no description)",
  ].filter(Boolean).join("\n");
}

/** @deprecated Use fetchGitHubPrompt("issue", ...) */
export const fetchIssuePrompt = (num: number, repo?: string) => fetchGitHubPrompt("issue", num, repo);
