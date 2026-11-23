#!/bin/sh
# Orbit Uplink SessionStart hook: prints the one §8 block via `orbit status --hook`. Never fails the session.
# Finds the CLI, in this order: `orbit` on PATH; else the person's own folder, where setup installs it when Node's global folder needs
# admin rights (${ORBIT_HOME:-$HOME/.orbit}/npm/bin/orbit, V69: a session started before its PATH line was read still finds it);
# else the repo sibling uplink/cli (when run with --plugin-dir from a checkout); else the marketplace clone the plugin manager keeps
# (${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/marketplaces/orbit, §35.3): `status --hook` loads no npm dependency, so it runs from
# either with `node`. Each of the last three needs `node` on PATH (the person's folder's orbit starts with #!/usr/bin/env node), or
# it falls through (M31 call 17). With none of them: the no-CLI line, whose fix is /orbit:orbit-setup. Every path is quoted.
HERE=$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)
OWN="${ORBIT_HOME:-$HOME/.orbit}/npm/bin/orbit"
CLONE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/marketplaces/orbit/uplink/cli/bin/orbit.js"
ORBIT_BIN="orbit"
ORBIT_JS=""
if command -v orbit >/dev/null 2>&1; then
  ORBIT_JS=""
elif [ -f "$OWN" ] && [ -x "$OWN" ] && command -v node >/dev/null 2>&1; then
  ORBIT_BIN="$OWN"
elif [ -f "$HERE/../cli/bin/orbit.js" ] && command -v node >/dev/null 2>&1; then
  ORBIT_JS="$HERE/../cli/bin/orbit.js"
elif [ -f "$CLONE" ] && command -v node >/dev/null 2>&1; then
  ORBIT_JS="$CLONE"
else
  echo "Orbit: the orbit CLI is not installed on this machine, so this session is not an Orbit seat yet. Fix: run /orbit:orbit-setup (the orbit plugin, from the Airportels/orbit-uplink marketplace)."
  exit 0
fi
orbit_status() {
  if [ -n "$ORBIT_JS" ]; then node "$ORBIT_JS" status --hook; else "$ORBIT_BIN" status --hook; fi
}
# Streamed, not buffered: `orbit status --hook` writes the block first and then may update for up to 70 s, so the block must
# reach the session as it is written (a hook killed at its timeout would otherwise lose it). A copy goes to a temp file only
# to tell whether anything was printed.
TMP=$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/orbit-hook.$$")
{ orbit_status 2>&1; echo $? >"$TMP.rc"; } | tee "$TMP"
if [ ! -s "$TMP" ]; then
  echo "Orbit: orbit status --hook printed nothing (exit $(cat "$TMP.rc" 2>/dev/null || echo '?')). Fix: run \`orbit status\` in a terminal and read its error."
fi
rm -f "$TMP" "$TMP.rc"
exit 0
