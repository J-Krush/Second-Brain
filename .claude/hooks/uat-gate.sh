#!/usr/bin/env bash
# Claude Code PreToolUse(Bash) hook: a PR may not leave draft (`gh pr create` without
# --draft, `gh pr ready`) until HEAD has a UAT receipt. Skipping, changing the mode, or
# recording a pass outside the uat-qa agent needs the user's approval.
# OMP twin: .omp/hooks/pre/uat-gate.ts.
set -euo pipefail

input=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
agent_type=$(jq -r '.agent_type // empty' <<<"$input")
agent_id=$(jq -r '.agent_id // empty' <<<"$input")
g=".claude/skills/uat/bin/uat-gate"

decide() {
  jq -n --arg d "$1" --arg r "$2" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: $d, permissionDecisionReason: $r}}'
  exit 0
}

# Gate controls belong to the user; the uat-qa agent may record its own pass.
if grep -Eq 'uat-gate[[:space:]]+(skip|mode)|git[[:space:]].*config.*uat\.gate|\.git/uat|git-common-dir' <<<"$cmd" ||
  { grep -Eq 'uat-gate[[:space:]]+pass' <<<"$cmd" && [ "$agent_type" != uat-qa ]; }; then
  decide ask "UAT gate: only you can skip UAT, change the gate mode, or record a pass outside the uat-qa agent."
fi

# A PR command at the start of any shell segment (not inside a commit message).
pr='(^|[;&|(]|\$\()[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*gh[[:space:]]+pr[[:space:]]+(create|ready)([[:space:]]|$)'
grep -Eq "$pr" <<<"$cmd" || exit 0
grep -Eq -- '--draft|--undo|(^|[[:space:]])-d([[:space:]]|$)' <<<"$cmd" && exit 0

cd "$(jq -r '.cwd // "."' <<<"$input")"
gate="$(git rev-parse --show-toplevel 2>/dev/null)/$g"
[ -x "$gate" ] || exit 0

# A receipt covers HEAD as it is now; commands chained before the PR command could move it.
start='^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*gh[[:space:]]+pr[[:space:]]+(create|ready)([[:space:]]|$)'
chained="UAT gate: run \`gh pr create\`/\`gh pr ready\` as its own command, with nothing chained before it, so the gate checks the commit the PR will open."
if state=$("$gate" check); then
  [[ $state == receipt* ]] || exit 0 # gate off or branch skipped: HEAD does not matter
  [[ $cmd =~ $start ]] && exit 0
  decide deny "$chained"
fi
[[ $cmd =~ $start ]] || decide deny "$chained"
read -r mode sha <<<"$state"

if [ -n "$agent_id" ]; then
  decide deny "UAT gate: subagents do not open ready-for-review PRs. Open it with --draft, or report back so the parent session decides about UAT."
fi
if [ "$mode" = auto ]; then
  decide deny "UAT gate (auto): HEAD ${sha:0:7} has no UAT receipt. Delegate to the \`uat-qa\` subagent now with the running app's URL, the diff range (<base>...HEAD), and the specs/ it touches. On 0 FAIL it records \`$g pass\`; retry this command after that. On FAIL, fix and re-run QA, or ask the user."
fi
decide deny "UAT gate: HEAD ${sha:0:7} has no UAT receipt, so this PR cannot leave draft yet. Ask the user (AskUserQuestion) which to do, then act on the answer. If no user can answer, take option 1 or 4 or stop; never skip on your own.
1. Run UAT: delegate to the \`uat-qa\` subagent with the running app's URL, the diff range (<base>...HEAD), and the specs/ it touches. On 0 FAIL it records \`$g pass\`; then retry.
2. Skip for this PR: \`$g skip \"<why>\"\` (the user approves it), then retry.
3. Skip for every commit on this branch: \`$g skip --branch\`, then retry.
4. Open as a draft instead: retry with --draft (drafts are not gated).
Turn the gate off with \`$g mode off\` (this clone) or \`$g mode off --global\`; \`$g mode auto\` runs QA without asking."
