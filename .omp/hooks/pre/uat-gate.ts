/**
 * OMP pre-tool hook: a PR may not leave draft (`gh pr create` without --draft,
 * `gh pr ready`, or the github tool's non-draft `pr_create`) until HEAD has a UAT
 * receipt from `.claude/skills/uat/bin/uat-gate`. Asks in the TUI; blocks with
 * instructions where there is no UI. Skipping or changing the mode needs the user.
 * Claude Code twin: .claude/hooks/uat-gate.sh.
 * Types are declared locally so the repo needs no OMP dependency.
 */
interface ToolCallEvent {
  toolName: string;
  input: Record<string, unknown>;
}
interface HookContext {
  cwd: string;
  hasUI: boolean;
  agent?: { kind: "main" | "sub"; name: string };
  ui: {
    select(title: string, options: string[]): Promise<string | undefined>;
    confirm(title: string, message: string): Promise<boolean>;
  };
}
type HookResult = { block: true; reason: string } | { input: Record<string, unknown> } | undefined;
interface HookApi {
  exec(cmd: string, args: string[], opts: { cwd: string }): Promise<{ code: number; stdout: string }>;
  on(event: "tool_call", handler: (event: ToolCallEvent, ctx: HookContext) => Promise<HookResult>): void;
}

const GATE = ".claude/skills/uat/bin/uat-gate";
const ASSIGNMENTS = String.raw`(?:[A-Za-z_]\w*=\S*\s+)*`;
// A PR command at the start of any shell segment (not inside a commit message).
const PR_SEGMENT = new RegExp(String.raw`(?:^|[;&|(\n]|\$\()\s*${ASSIGNMENTS}gh\s+pr\s+(?:create|ready)(?:\s|$)`);
// The same command with nothing chained before it, so HEAD cannot move after the check.
const PR_STANDALONE = new RegExp(String.raw`^\s*${ASSIGNMENTS}gh\s+pr\s+(?:create|ready)(?:\s|$)`);
const PR_CREATE = /gh\s+pr\s+create/;
const DRAFT = /--draft|--undo|(^|\s)-d(\s|$)/;
const USER_CONTROL = /uat-gate\s+(skip|mode)|git\s.*config.*uat\.gate|\.git\/uat|git-common-dir/;
const RECORD_PASS = /uat-gate\s+pass/;

const RUN = "Run UAT first (uat-qa agent)";
const SKIP = "Skip UAT for this PR";
const SKIP_BRANCH = "Skip UAT for every commit on this branch";
const AS_DRAFT = "Open as a draft instead";

const RUN_REASON = (sha: string) =>
  `UAT gate: HEAD ${sha.slice(0, 7)} has no UAT receipt. Spawn the \`uat-qa\` task agent with the running ` +
  `app's URL, the diff range (<base>...HEAD), and the specs/ it touches. On 0 FAIL it records ` +
  `\`${GATE} pass\`; retry this call after that. On FAIL, fix and re-run QA, or ask the user.`;

export default function uatGate(pi: HookApi): void {
  pi.on("tool_call", async (event, ctx) => {
    const { toolName, input } = event;
    const command = toolName === "bash" && typeof input.command === "string" ? input.command : "";

    // Gate controls belong to the user; only the uat-qa subagent records its own pass.
    const isQa = ctx.agent?.kind === "sub" && ctx.agent.name === "uat-qa";
    if (USER_CONTROL.test(command) || (RECORD_PASS.test(command) && !isQa)) {
      if (!ctx.hasUI) {
        return {
          block: true,
          reason: "UAT gate: only the user can skip UAT, change the gate mode, or record a pass outside the uat-qa agent. Report that UAT is pending.",
        };
      }
      const ok = await ctx.ui.confirm("UAT gate", `The agent wants to run:\n${command}`);
      return ok ? undefined : { block: true, reason: "The user declined this UAT gate change." };
    }

    const viaBash = PR_SEGMENT.test(command) && !DRAFT.test(command);
    const viaTool = input.op === "pr_create" && input.draft !== true;
    if (!viaBash && !viaTool) return undefined;

    const cwd = typeof input.cwd === "string" ? input.cwd : ctx.cwd;
    const top = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
    if (top.code !== 0) return undefined;
    const root = top.stdout.trim();
    const check = await pi.exec(`${root}/${GATE}`, ["check"], { cwd: root });
    const state = check.stdout.trim();
    // A receipt covers HEAD as it is now; commands chained before the PR command could move it.
    // "off"/"branch-skip" (exit 0) and a missing gate (other codes) do not depend on HEAD.
    const gated = check.code === 1 || (check.code === 0 && state.startsWith("receipt"));
    if (!gated) return undefined;
    if (viaBash && !PR_STANDALONE.test(command)) {
      return {
        block: true,
        reason:
          "UAT gate: run `gh pr create`/`gh pr ready` as its own command, with nothing chained before it, " +
          "so the gate checks the commit the PR will open.",
      };
    }
    if (check.code === 0) return undefined;
    const [mode, sha = ""] = state.split(" ");

    if (ctx.agent?.kind === "sub") {
      return {
        block: true,
        reason:
          "UAT gate: subagents do not open ready-for-review PRs. Open it as a draft, or report back so the parent session decides about UAT.",
      };
    }
    if (mode === "auto" || !ctx.hasUI) {
      const how = "No user is available to approve a skip: run QA as below, open the PR as a draft, or stop and report.";
      return { block: true, reason: mode === "auto" ? RUN_REASON(sha) : `${RUN_REASON(sha)} ${how}` };
    }

    const canDraft = viaTool || PR_CREATE.test(command);
    const choice = await ctx.ui.select(
      `UAT gate: HEAD ${sha.slice(0, 7)} has not been acceptance-tested`,
      canDraft ? [RUN, SKIP, SKIP_BRANCH, AS_DRAFT] : [RUN, SKIP, SKIP_BRANCH],
    );
    if (choice === SKIP || choice === SKIP_BRANCH) {
      await pi.exec(`${root}/${GATE}`, choice === SKIP ? ["skip", "skipped at the PR gate"] : ["skip", "--branch"], {
        cwd: root,
      });
      return undefined;
    }
    if (choice === AS_DRAFT) {
      return { input: viaTool ? { ...input, draft: true } : { ...input, command: command.replace(PR_CREATE, "$& --draft") } };
    }
    if (choice === RUN) return { block: true, reason: `The user chose to run UAT first. ${RUN_REASON(sha)}` };
    return { block: true, reason: "The user cancelled opening this PR at the UAT gate." };
  });
}
