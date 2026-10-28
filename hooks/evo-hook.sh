#!/usr/bin/env bash
# Claude Code hook -> Evo bridge. Reads the hook JSON on stdin and tells the
# bridge what this session is doing. Never fails and never blocks Claude Code:
# the HTTP call runs in the background and every error is swallowed.
#
# Environment:
#   EVO_URL        bridge address (default http://evo.local; an IP is faster)
#   EVO_TOKEN      shared secret (BRIDGE_TOKEN in the firmware's secrets.h), or
#   EVO_TOKEN_FILE file holding it (default ~/.config/evo-bridge/token)
#   EVO_HOOK_SYNC  1 = wait for the request (debugging)
#   EVO_HOOK_DEBUG 1 = print the URL instead of calling it

EVO_URL="${EVO_URL:-http://evo.local}"
EVO_TOKEN_FILE="${EVO_TOKEN_FILE:-$HOME/.config/evo-bridge/token}"
if [[ -z "${EVO_TOKEN:-}" && -r "$EVO_TOKEN_FILE" ]]; then
  EVO_TOKEN="$(tr -d '[:space:]' < "$EVO_TOKEN_FILE" 2>/dev/null)"
fi

input="$(cat 2>/dev/null || true)"
# Event time in ms. Requests run in the background and can arrive out of
# order; the bridge drops any event older than the newest it has seen.
stamp="$(date +%s%3N 2>/dev/null)"
[[ "$stamp" =~ ^[0-9]+$ ]] || stamp=0

field() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null
  else
    # Fallback for flat string fields only.
    local key="${1#.}"
    printf '%s' "$input" | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n1
  fi
}

event="$(field .hook_event_name)"
session="$(field .session_id)"
tool="$(field .tool_name)"

tool_state() {
  case "$tool" in
    AskUserQuestion|ExitPlanMode)                  echo needs_input ;;
    Bash|BashOutput|KillShell)                     echo working_bash ;;
    Edit|MultiEdit|Write|NotebookEdit)             echo working_edit ;;
    Read|Grep|Glob|LS|WebFetch|WebSearch)          echo working_read ;;
    *)                                             echo working ;;
  esac
}

case "$event" in
  SessionStart)       state=idle ;;
  UserPromptSubmit)   state=thinking ;;
  PreToolUse)         state="$(tool_state)" ;;
  PostToolUse)
    # Older Claude Code versions report failures here instead of in PostToolUseFailure.
    if [[ "$(field .tool_response.is_error)" == "true" ]]; then state=error
    else state="$(tool_state)"; fi ;;
  PostToolUseFailure) state=error ;;
  PermissionRequest)  state=needs_input ;;
  StopFailure)        state=error ;;
  Notification)
    # "Claude is waiting for your input" fires ~60 s after a finished turn;
    # keep showing done for that. Permission prompts etc. need you now.
    ntype="$(field .notification_type)"
    if [[ "$ntype" == idle_prompt || "$(field .message)" == *"waiting for your input"* ]]; then
      exit 0
    fi
    state=needs_input ;;
  # A subagent finishing does not mean the main agent is done.
  SubagentStop)       state=working ;;
  Stop)               state="done" ;;
  SessionEnd)         state=end ;;
  *)                  exit 0 ;;
esac

# Keep the session id URL-safe (the bridge strips anything else anyway).
session="${session//[^A-Za-z0-9_-]/}"
url="$EVO_URL/state/$state?session_id=${session:-default}&t=$stamp"

if [[ "${EVO_HOOK_DEBUG:-0}" == 1 ]]; then
  echo "$url"
  exit 0
fi

# The token goes to curl on stdin (-H @-), so it never shows up in `ps`.
send() {
  printf 'X-Evo-Token: %s\n' "${EVO_TOKEN:-}" |
    curl -fsS --connect-timeout 1 --max-time 1 -H @- "$url" >/dev/null 2>&1
}

if [[ "${EVO_HOOK_SYNC:-0}" == 1 ]]; then
  send || true
else
  (send &) || true
fi
exit 0
