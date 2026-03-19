import {
  loadProjects,
  createProject,
  addTaskToProject,
  removeTaskFromProject,
  setTaskParent,
  updateProject,
  autoOrganize,
  getProjectTree,
  getProjectBoardData,
  type Project,
} from "../projects";
import { fetchBoardData, type BoardItem } from "../board";
import { readTaskLog, appendActivity, getTaskLogSummary } from "../task-log";

// --- Helpers ---

function statusIcon(status: string): string {
  if (status === "Done") return "\x1b[32m✓\x1b[0m";
  if (status === "In Progress") return "\x1b[33m●\x1b[0m";
  if (status === "Todo") return "\x1b[37m○\x1b[0m";
  return "\x1b[90m·\x1b[0m";
}

function projectStatusColor(status: string): string {
  if (status === "active") return "\x1b[32m";
  if (status === "completed") return "\x1b[36m";
  return "\x1b[90m";
}

/** Resolve #42 → board item by matching content.number */
async function resolveItem(ref: string): Promise<BoardItem | undefined> {
  const num = ref.replace(/^#/, "");
  if (/^\d+$/.test(num)) {
    const items = await fetchBoardData();
    return items.find((i) => i.content.number === +num);
  }
  return undefined;
}

// --- Commands ---

/** maw project ls — list all projects with task counts */
export async function cmdProjectLs() {
  const data = loadProjects();
  let items: BoardItem[] = [];
  try { items = await fetchBoardData(); } catch {}
  const boardMap = new Map(items.map((i) => [i.id, i]));

  if (data.projects.length === 0) {
    console.log("No projects yet. Use \x1b[36mmaw project create <id> \"Name\"\x1b[0m to create one.");
    console.log("Or use \x1b[36mmaw project auto-organize\x1b[0m to auto-group existing tasks.");
    return;
  }

  console.log(`\n\x1b[36mProjects\x1b[0m\n`);

  for (const project of data.projects) {
    const color = projectStatusColor(project.status);
    const taskCount = project.tasks.length;
    const topLevel = project.tasks.filter((t) => !t.parentTaskId);
    const subtaskCount = project.tasks.filter((t) => t.parentTaskId).length;

    // Status breakdown
    let done = 0, inProgress = 0, todo = 0;
    for (const t of project.tasks) {
      const item = boardMap.get(t.taskId);
      if (!item) continue;
      if (item.status === "Done") done++;
      else if (item.status === "In Progress") inProgress++;
      else todo++;
    }
    const progress = taskCount > 0 ? Math.round((done / taskCount) * 100) : 0;
    const progressBar = "█".repeat(Math.round(progress / 10)) + "░".repeat(10 - Math.round(progress / 10));

    console.log(`  ${color}${project.status.toUpperCase().padEnd(10)}\x1b[0m \x1b[1m${project.name}\x1b[0m \x1b[90m(${project.id})\x1b[0m`);
    console.log(`  ${" ".repeat(10)} ${taskCount} tasks (${topLevel.length} top + ${subtaskCount} sub) | \x1b[32m${done}\x1b[0m done \x1b[33m${inProgress}\x1b[0m wip \x1b[37m${todo}\x1b[0m todo`);
    console.log(`  ${" ".repeat(10)} [${progressBar}] ${progress}%`);
    if (project.description) console.log(`  ${" ".repeat(10)} \x1b[90m${project.description}\x1b[0m`);
    console.log();
  }

  // Show unassigned count
  const assigned = new Set<string>();
  for (const p of data.projects) for (const t of p.tasks) assigned.add(t.taskId);
  const unassigned = items.filter((i) => !assigned.has(i.id));
  if (unassigned.length > 0) {
    console.log(`  \x1b[33m${unassigned.length} unassigned task${unassigned.length !== 1 ? "s" : ""}\x1b[0m — use \x1b[36mmaw project auto-organize\x1b[0m or \x1b[36mmaw project add <project> #<issue>\x1b[0m`);
    console.log();
  }
}

/** maw project show <id> — show project with task tree */
export async function cmdProjectShow(args: string[]) {
  const projectId = args[0];
  if (!projectId) {
    console.error("usage: maw project show <project-id>");
    process.exit(1);
  }

  const tree = getProjectTree(projectId);
  if (!tree) {
    console.error(`Project "${projectId}" not found`);
    process.exit(1);
  }

  let items: BoardItem[] = [];
  try { items = await fetchBoardData(); } catch {}
  const boardMap = new Map(items.map((i) => [i.id, i]));

  const { project } = tree;
  console.log(`\n\x1b[36m${project.name}\x1b[0m \x1b[90m(${project.id})\x1b[0m`);
  if (project.description) console.log(`  ${project.description}`);
  console.log(`  Status: ${projectStatusColor(project.status)}${project.status}\x1b[0m | Tasks: ${project.tasks.length}`);
  console.log();

  for (const { task, subtasks } of tree.tree) {
    const item = boardMap.get(task.taskId);
    const num = item?.content.number ? `#${item.content.number}` : "";
    const title = item?.title || task.taskId;
    const oracle = item?.oracle ? `\x1b[36m${item.oracle}\x1b[0m` : "";
    const priority = item?.priority || "";
    const si = statusIcon(item?.status || "");
    const logSummary = getTaskLogSummary(task.taskId);
    const logBadge = logSummary ? ` \x1b[90m[${logSummary.count} logs]\x1b[0m` : "";

    console.log(`  ${si} ${num.padEnd(6)} ${title.slice(0, 50).padEnd(52)} ${oracle.padEnd(18)} ${priority}${logBadge}`);

    for (const sub of subtasks) {
      const subItem = boardMap.get(sub.taskId);
      const subNum = subItem?.content.number ? `#${subItem.content.number}` : "";
      const subTitle = subItem?.title || sub.taskId;
      const subOracle = subItem?.oracle ? `\x1b[36m${subItem.oracle}\x1b[0m` : "";
      const subSi = statusIcon(subItem?.status || "");
      const subLog = getTaskLogSummary(sub.taskId);
      const subBadge = subLog ? ` \x1b[90m[${subLog.count}]\x1b[0m` : "";

      console.log(`    └─ ${subSi} ${subNum.padEnd(6)} ${subTitle.slice(0, 46).padEnd(48)} ${subOracle.padEnd(18)} ${subBadge}`);
    }
  }
  console.log();
}

/** maw project create <id> "Name" ["description"] */
export async function cmdProjectCreate(args: string[]) {
  const id = args[0];
  const name = args[1];
  if (!id || !name) {
    console.error('usage: maw project create <id> "Name" ["description"]');
    process.exit(1);
  }
  try {
    const project = createProject(id, name, args[2] || "");
    console.log(`\x1b[32m✓\x1b[0m Created project: \x1b[1m${project.name}\x1b[0m (${project.id})`);
  } catch (e: any) {
    console.error(`\x1b[31m✗\x1b[0m ${e.message}`);
    process.exit(1);
  }
}

/** maw project add <project-id> #<issue> [--parent #<issue>] */
export async function cmdProjectAdd(args: string[]) {
  const projectId = args[0];
  const taskRef = args[1];
  if (!projectId || !taskRef) {
    console.error("usage: maw project add <project-id> #<issue> [--parent #<issue>]");
    process.exit(1);
  }

  let parentTaskId: string | undefined;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--parent" && args[i + 1]) {
      const parentItem = await resolveItem(args[++i]);
      if (parentItem) parentTaskId = parentItem.id;
    }
  }

  const item = await resolveItem(taskRef);
  if (!item) {
    // Try as raw taskId
    addTaskToProject(projectId, taskRef, parentTaskId);
    console.log(`\x1b[32m✓\x1b[0m Added ${taskRef} to project ${projectId}`);
    return;
  }

  try {
    addTaskToProject(projectId, item.id, parentTaskId);
    console.log(`\x1b[32m✓\x1b[0m Added #${item.content.number} "${item.title}" to project ${projectId}${parentTaskId ? " (as subtask)" : ""}`);
  } catch (e: any) {
    console.error(`\x1b[31m✗\x1b[0m ${e.message}`);
    process.exit(1);
  }
}

/** maw project remove <project-id> #<issue> */
export async function cmdProjectRemove(args: string[]) {
  const projectId = args[0];
  const taskRef = args[1];
  if (!projectId || !taskRef) {
    console.error("usage: maw project remove <project-id> #<issue>");
    process.exit(1);
  }

  const item = await resolveItem(taskRef);
  const taskId = item?.id || taskRef;

  try {
    removeTaskFromProject(projectId, taskId);
    const label = item ? `#${item.content.number}` : taskRef;
    console.log(`\x1b[32m✓\x1b[0m Removed ${label} from project ${projectId}`);
  } catch (e: any) {
    console.error(`\x1b[31m✗\x1b[0m ${e.message}`);
    process.exit(1);
  }
}

/** maw project auto-organize — auto-group unassigned board items */
export async function cmdProjectAutoOrganize() {
  let items: BoardItem[] = [];
  try { items = await fetchBoardData(); } catch (e: any) {
    console.error(`\x1b[31m✗\x1b[0m Could not fetch board: ${e.message}`);
    process.exit(1);
  }

  const result = autoOrganize(items);

  if (result.created.length > 0) {
    console.log(`\x1b[32m✓\x1b[0m Created ${result.created.length} project(s): ${result.created.join(", ")}`);
  }
  if (result.moved > 0) {
    console.log(`\x1b[32m✓\x1b[0m Organized ${result.moved} task(s) into projects`);
  }
  if (result.created.length === 0 && result.moved === 0) {
    console.log("All tasks are already organized into projects.");
  }
}

/** maw project comment <project-id> "message" — comment visible to all oracles */
export async function cmdProjectComment(args: string[]) {
  const projectId = args[0];
  const message = args[1];
  if (!projectId || !message) {
    console.error('usage: maw project comment <project-id> "message"');
    process.exit(1);
  }

  const oracle = process.env.MAW_ORACLE || "cli";

  // Log comment on the project itself (use project ID as task ID)
  appendActivity({
    taskId: `project:${projectId}`,
    type: "comment",
    oracle,
    content: message,
  });

  console.log(`\x1b[32m✓\x1b[0m Comment added to project ${projectId}`);
}

/** maw project archive <id> / maw project complete <id> */
export async function cmdProjectSetStatus(args: string[], status: "completed" | "archived") {
  const projectId = args[0];
  if (!projectId) {
    console.error(`usage: maw project ${status === "completed" ? "complete" : "archive"} <project-id>`);
    process.exit(1);
  }
  try {
    updateProject(projectId, { status });
    console.log(`\x1b[32m✓\x1b[0m Project "${projectId}" marked as ${status}`);
  } catch (e: any) {
    console.error(`\x1b[31m✗\x1b[0m ${e.message}`);
    process.exit(1);
  }
}
