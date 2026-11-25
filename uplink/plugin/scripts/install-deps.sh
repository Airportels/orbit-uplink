# install-deps.sh: /orbit:orbit-setup's step 1 on macOS (CONTRACT §39 N4, N5; v0.13.3). Run as
#   /bin/bash "${CLAUDE_PLUGIN_ROOT}/scripts/install-deps.sh" check|install
# It needs no Node (it decides whether Node is there). Written for /bin/bash 3.2: no associative arrays, no mapfile, no ${x,,}.
#
# Output: machine lines only, KEY=value, one fact per line (N4): NODE= NODE_OFF_PATH=1 GIT= GIT_OFF_PATH=1 OFFER_NODE=24 REPLACES=
# OFFER_GIT=1 MANAGED= MANUAL= FAILED= PENDING=clt BUSY=1. Any other line (a tool's last line before FAILED= or MANUAL=git_broken)
# is shown to the person as it is; every word the person reads is in orbit-setup.md (N8).
#
# check only reads: files, `pkgutil --pkg-info`, and --version calls on executables it already located; it never runs /usr/bin/git
# unless `xcode-select -p` succeeded and the folder it printed exists. install installs what check offered: Node.js 24's .pkg from
# nodejs.org (checksum, Gatekeeper, signer and receipt checked), and Apple's Command Line Tools through their own dialog. It never
# raises its own privileges, never skips a package check, opens the .pkg only in Apple's Installer, and keeps nothing afterwards.
#
# Every tool is called by its absolute path (a link-reading loop on `stat -f %Y` resolves links: `-f` resolution only exists from macOS
# 12.3). Tests (uplink/cli/test/install-deps-sh.test.mjs) run it with stubs: only when ORBIT_TEST_MODE is set, ORBIT_DEPS_ROOT
# prefixes every absolute path below (a fake filesystem root), ORBIT_DEPS_DIST replaces the download base, and
# ORBIT_DEPS_CLT_POLL / ORBIT_DEPS_CLT_LIMIT the Command Line Tools poll's interval and limit (seconds).

CURL=/usr/bin/curl
SHASUM=/usr/bin/shasum
PKGUTIL=/usr/sbin/pkgutil
SPCTL=/usr/sbin/spctl
OPEN=/usr/bin/open
SW_VERS=/usr/bin/sw_vers
MKTEMP=/usr/bin/mktemp
XCODE_SELECT=/usr/bin/xcode-select
RM=/bin/rm
SLEEP=/bin/sleep
PS=/bin/ps
STAT=/usr/bin/stat
DATE=/bin/date
MKDIR=/bin/mkdir
SYS_GIT=/usr/bin/git
PKG_NODE=/usr/local/bin/node
BREW=/usr/local/bin/brew
INSTALLER_APP=/System/Library/CoreServices/Installer.app
DIST=https://nodejs.org/dist
CLT_POLL=10
CLT_LIMIT=180
RECEIPT=org.nodejs.node.pkg
SIGNER="Developer ID Installer: Node.js Foundation (HX7739G8FX)"

if [ -n "$ORBIT_TEST_MODE" ]; then
  if [ -n "$ORBIT_DEPS_ROOT" ]; then
    CURL="$ORBIT_DEPS_ROOT$CURL"; SHASUM="$ORBIT_DEPS_ROOT$SHASUM"; PKGUTIL="$ORBIT_DEPS_ROOT$PKGUTIL"; SPCTL="$ORBIT_DEPS_ROOT$SPCTL"
    OPEN="$ORBIT_DEPS_ROOT$OPEN"; SW_VERS="$ORBIT_DEPS_ROOT$SW_VERS"; MKTEMP="$ORBIT_DEPS_ROOT$MKTEMP"
    XCODE_SELECT="$ORBIT_DEPS_ROOT$XCODE_SELECT"; RM="$ORBIT_DEPS_ROOT$RM"; SLEEP="$ORBIT_DEPS_ROOT$SLEEP"; PS="$ORBIT_DEPS_ROOT$PS"
    STAT="$ORBIT_DEPS_ROOT$STAT"; DATE="$ORBIT_DEPS_ROOT$DATE"; MKDIR="$ORBIT_DEPS_ROOT$MKDIR"; SYS_GIT="$ORBIT_DEPS_ROOT$SYS_GIT"
    PKG_NODE="$ORBIT_DEPS_ROOT$PKG_NODE"; BREW="$ORBIT_DEPS_ROOT$BREW"; INSTALLER_APP="$ORBIT_DEPS_ROOT$INSTALLER_APP"
  fi
  [ -n "$ORBIT_DEPS_DIST" ] && DIST="$ORBIT_DEPS_DIST"
  [ -n "$ORBIT_DEPS_CLT_POLL" ] && CLT_POLL="$ORBIT_DEPS_CLT_POLL"
  [ -n "$ORBIT_DEPS_CLT_LIMIT" ] && CLT_LIMIT="$ORBIT_DEPS_CLT_LIMIT"
fi

say() { printf '%s\n' "$1"; }

# The last non-empty line of $1.
last_line() {
  local line out=""
  while IFS= read -r line; do [ -n "$line" ] && out="$line"; done <<EOF
$1
EOF
  printf '%s\n' "$out"
}

# A path with its symlinks resolved, one link at a time (macOS before 12.3 has no one-step resolver): its folder first (`cd -P`,
# so Intel Homebrew's keg-only /usr/local/opt/node@18 -> ../Cellar/node@18/18.20.4 reads as the Cellar), then the file itself.
resolve() {
  local p="$1" n=0 t d
  while [ "$n" -lt 40 ]; do
    d="${p%/*}"
    [ -n "$d" ] || d=/
    d=$(CDPATH='' cd -P "$d" 2>/dev/null && pwd -P) && p="${d%/}/${p##*/}"
    [ -L "$p" ] || break
    t=$("$STAT" -f %Y "$p" 2>/dev/null) || break
    [ -n "$t" ] || break
    case "$t" in
      /*) p="$t" ;;
      *) p="${p%/*}/$t" ;;
    esac
    n=$((n + 1))
  done
  printf '%s\n' "$p"
}

# The major version in "v22.11.0" (0 when it isn't one).
major_of() {
  local v="${1#v}"
  v="${v%%.*}"
  case "$v" in ''|*[!0-9]*) printf '0\n' ;; *) printf '%s\n' "$v" ;; esac
}

# --version of an executable already located; empty when it fails.
version_of() {
  local out
  out=$("$1" --version 2>/dev/null) || return 0
  out=$(last_line "$out")
  case "$out" in v[0-9]*) printf '%s\n' "$out" ;; esac
}

has_receipt() { "$PKGUTIL" --pkg-info "$RECEIPT" >/dev/null 2>&1; }

# The macOS version gate: MAC_TOO_OLD (older than 11), else MAC_24 (13.5 or later: Node 24 runs) or not (11.0-13.4).
MAC_TOO_OLD=0
MAC_24=0
read_macos() {
  local v maj rest min
  v=$("$SW_VERS" -productVersion 2>/dev/null)
  v=$(last_line "$v")
  maj="${v%%.*}"
  rest="${v#*.}"
  [ "$rest" = "$v" ] && rest=0
  min="${rest%%.*}"
  case "$maj" in ''|*[!0-9]*) maj=0 ;; esac
  case "$min" in ''|*[!0-9]*) min=0 ;; esac
  if [ "$maj" -lt 11 ]; then MAC_TOO_OLD=1; return; fi
  if [ "$maj" -gt 13 ] || { [ "$maj" -eq 13 ] && [ "$min" -ge 5 ]; }; then MAC_24=1; fi
}

# Which version manager (or package manager) a node comes from, by its paths and the managers' variables.
under() { [ -n "$2" ] && case "$1" in "${2%/}"/*) return 0 ;; esac; return 1; }
manager_of() {
  local p="$1" r="$2"
  if under "$r" "$NVM_DIR" || under "$p" "$NVM_DIR"; then say nvm; return; fi
  if under "$r" "$VOLTA_HOME" || under "$p" "$VOLTA_HOME"; then say volta; return; fi
  if under "$r" "$FNM_DIR" || under "$p" "$FNM_DIR"; then say fnm; return; fi
  if under "$r" "$ASDF_DIR" || under "$p" "$ASDF_DIR"; then say asdf; return; fi
  if under "$r" "$MISE_DATA_DIR" || under "$p" "$MISE_DATA_DIR"; then say mise; return; fi
  if under "$r" "$N_PREFIX" || under "$p" "$N_PREFIX"; then say n; return; fi
  case "$r $p" in
    */.nvm/*) say nvm ;;
    */.volta/*) say volta ;;
    */fnm/*|*/fnm_multishells/*|*/.fnm/*) say fnm ;;
    */.asdf/*) say asdf ;;
    */mise/*) say mise ;;
    */n/versions/*) say n ;;
    */Cellar/*|/opt/homebrew/*|*/homebrew/*|*/Homebrew/*) say homebrew ;;
    *) say other ;;
  esac
}

# Node, N5's rules in their order. Sets NODE_OUT (the key lines) and N_OFFER (1 when OFFER_NODE=24 was given).
NODE_OUT=""
N_OFFER=0
add_node() { NODE_OUT="$NODE_OUT$1
"; }
by_gate() { # $1: REPLACES version, or empty
  if [ "$MAC_24" -eq 1 ]; then
    add_node "OFFER_NODE=24"; N_OFFER=1
    [ -n "$1" ] && add_node "REPLACES=$1"
  else
    add_node "MANUAL=node22_macos"
  fi
}
node_check() {
  NODE_OUT=""; N_OFFER=0
  read_macos
  if [ "$MAC_TOO_OLD" -eq 1 ]; then add_node "MANUAL=macos_too_old"; return; fi
  local p r v pkgv
  p=$(command -v node 2>/dev/null)
  case "$p" in /*) ;; *) p="" ;; esac
  if [ -n "$p" ]; then
    r=$(resolve "$p")
    v=$(version_of "$p")
    if [ "$(major_of "$v")" -ge 22 ]; then add_node "NODE=$p"; return; fi
    # v is empty when its --version failed: REPLACES= only with a real version, and MANAGED= says unknown (never none, which is
    # N4's "no node" form)
    # rule 3: the older node is the .pkg's own /usr/local/bin/node (a regular file, with the receipt)
    if [ "$r" = "$(resolve "$PKG_NODE")" ] && [ -f "$PKG_NODE" ] && [ ! -L "$PKG_NODE" ] && has_receipt; then
      if [ -e "$BREW" ]; then add_node "MANAGED=homebrew none"; else by_gate "$v"; fi
      return
    fi
    add_node "MANAGED=$(manager_of "$p" "$r") ${v:-unknown}"   # rule 2 (unknown when its --version failed, as install-deps.ps1)
    return
  fi
  # rule 4: no node on PATH, the .pkg's node 22 or newer
  if [ -f "$PKG_NODE" ] && has_receipt; then
    pkgv=$(version_of "$PKG_NODE")
    if [ "$(major_of "$pkgv")" -ge 22 ]; then add_node "NODE=${PKG_NODE#$ORBIT_DEPS_ROOT}"; add_node "NODE_OFF_PATH=1"; return; fi
  fi
  # rule 5
  if [ -e "$BREW" ]; then add_node "MANAGED=homebrew none"; return; fi
  pkgv=""
  if [ -f "$PKG_NODE" ] && has_receipt; then pkgv=$(version_of "$PKG_NODE"); fi
  by_gate "$pkgv"
}

# Git, N5's rules in their order. Sets GIT_OUT and G_OFFER.
GIT_OUT=""
G_OFFER=0
add_git() { GIT_OUT="$GIT_OUT$1
"; }
git_check() {
  GIT_OUT=""; G_OFFER=0
  local p sys out rc dir
  sys="${SYS_GIT#$ORBIT_DEPS_ROOT}"
  p=$(command -v git 2>/dev/null)
  case "$p" in /*) ;; *) p="" ;; esac
  if [ -n "$p" ] && [ "$p" != "$sys" ] && [ "$p" != "$SYS_GIT" ] && "$p" --version >/dev/null 2>&1; then add_git "GIT=$p"; return; fi
  dir=$("$XCODE_SELECT" -p 2>/dev/null)
  rc=$?
  dir=$(last_line "$dir")
  if [ "$rc" -eq 0 ] && [ -n "$dir" ]; then
    if [ ! -d "$dir" ]; then add_git "MANUAL=xcode_path"; return; fi
    out=$("$SYS_GIT" --version 2>&1)
    rc=$?
    if [ "$rc" -eq 0 ]; then
      add_git "GIT=$sys"
      [ "$p" = "$sys" ] || [ "$p" = "$SYS_GIT" ] || add_git "GIT_OFF_PATH=1"
      return
    fi
    if [ "$rc" -eq 69 ]; then add_git "MANUAL=xcode_license"; return; fi
    add_git "$(last_line "$out")"
    add_git "MANUAL=git_broken"
    return
  fi
  add_git "OFFER_GIT=1"; G_OFFER=1
}

TMP=""
LOCK=""
LOCK_ID=""
LOCK_ERR=""
OWN_LOCK=0

# The lock's "pid start" into LOCK_PID and LOCK_START; 1 when there is no lock file or it can't be read.
read_lock() {
  LOCK_PID=""; LOCK_START=""
  [ -f "$LOCK" ] && [ -r "$LOCK" ] || return 1
  { read -r LOCK_PID LOCK_START || [ -n "$LOCK_PID" ]; } < "$LOCK" 2>/dev/null || return 1
  return 0
}

# The lock just read names a live pid and is under 30 minutes old ($1: now).
lock_live() {
  case "$LOCK_PID" in ''|0|*[!0-9]*) return 1 ;; esac
  case "$LOCK_START" in ''|*[!0-9]*) return 1 ;; esac
  "$PS" -p "$LOCK_PID" >/dev/null 2>&1 && [ $(($1 - LOCK_START)) -lt 1800 ]
}

# Only this run's own lock is removed: one that still reads as the pid and start this run wrote.
cleanup() {
  [ -n "$TMP" ] && "$RM" -rf "$TMP"
  if [ "$OWN_LOCK" -eq 1 ] && read_lock && [ "$LOCK_PID $LOCK_START" = "$LOCK_ID" ]; then "$RM" -f "$LOCK"; fi
  return 0
}

# install's lock: <ORBIT_HOME or ~/.orbit>/install-deps.lock, "pid start". 0: taken. 1 (BUSY=1): a lock file is there, can be read,
# and names a live pid under 30 minutes old. 2: the lock can't be created (LOCK_ERR is the line that says why). A dead or stale
# lock is read again just before it is removed, so a run that took it over meanwhile keeps it.
take_lock() {
  local home="${ORBIT_HOME:-$HOME/.orbit}" now try=0 err seen
  "$MKDIR" -p "$home" 2>/dev/null
  LOCK="$home/install-deps.lock"
  while [ "$try" -lt 3 ]; do
    now=$("$DATE" +%s)
    if err=$( { set -C; printf '%s %s\n' "$$" "$now" > "$LOCK"; } 2>&1 ); then LOCK_ID="$$ $now"; OWN_LOCK=1; return 0; fi
    err=$(last_line "$err")
    err="${err##*: }"
    LOCK_ERR="can't create $LOCK${err:+: $err}"
    [ -e "$LOCK" ] || return 2
    if ! read_lock; then LOCK_ERR="can't read $LOCK"; return 2; fi
    if lock_live "$now"; then return 1; fi
    seen="$LOCK_PID $LOCK_START"
    if read_lock && [ "$LOCK_PID $LOCK_START" = "$seen" ]; then "$RM" -f "$LOCK" 2>/dev/null; fi
    try=$((try + 1))
  done
  return 2
}

fetch() { # $1 url, $2 file; prints curl's last line on failure
  local err
  err=$("$CURL" -fsSL --proto '=https' --tlsv1.2 --connect-timeout 20 --speed-limit 1024 --speed-time 60 -o "$2" "$1" 2>&1) && return 0
  say "$(last_line "${err:-curl failed: $1}")"
  return 1
}

node_install() {
  local sums="$TMP/SHASUMS256.txt" line sha file count=0 want="" ver pkg got out first rc rv nv re
  if ! fetch "$DIST/latest-v24.x/SHASUMS256.txt" "$sums"; then say "FAILED=node:download"; return; fi
  re='^node-v24\.[0-9]+\.[0-9]+\.pkg$'
  while read -r sha file; do
    if [[ $file =~ $re ]]; then count=$((count + 1)); want="$sha"; pkg="$file"; fi
  done < "$sums"
  if [ "$count" -ne 1 ]; then say "SHASUMS256.txt names $count node-v24 .pkg files, not one"; say "FAILED=node:bad_package"; return; fi
  ver="${pkg#node-}"; ver="${ver%.pkg}"
  if ! fetch "$DIST/$ver/$pkg" "$TMP/$pkg"; then say "FAILED=node:download"; return; fi
  pkg="$TMP/$pkg"
  got=$("$SHASUM" -a 256 "$pkg" 2>/dev/null); got="${got%% *}"
  if [ "$got" != "$want" ]; then say "SHA-256 of ${pkg##*/} doesn't match SHASUMS256.txt"; say "FAILED=node:bad_package"; return; fi
  out=$("$SPCTL" --assess --type install "$pkg" 2>&1)
  if [ $? -ne 0 ]; then say "$(last_line "${out:-spctl refused ${pkg##*/}}")"; say "FAILED=node:bad_package"; return; fi
  out=$("$PKGUTIL" --check-signature "$pkg" 2>&1)
  first=""
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in "1. "*) first="${line#1. }"; break ;; esac
  done <<EOF
$out
EOF
  if [ "$first" != "$SIGNER" ]; then say "signed by: ${first:-none}"; say "FAILED=node:bad_package"; return; fi
  out=$("$OPEN" -W -n -a "$INSTALLER_APP" "$pkg" 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ]; then say "$(last_line "${out:-open exited $rc}")"; say "FAILED=node:no_gui"; return; fi
  rv=""
  out=$("$PKGUTIL" --pkg-info "$RECEIPT" 2>/dev/null)
  while IFS= read -r line; do case "$line" in "version: "*) rv="${line#version: }" ;; esac; done <<EOF
$out
EOF
  nv=$(version_of "$PKG_NODE")
  if [ "$rv" = "$ver" ] && [ "$nv" = "$ver" ]; then
    say "NODE=${PKG_NODE#$ORBIT_DEPS_ROOT}"
    [ "$(command -v node 2>/dev/null)" = "${PKG_NODE#$ORBIT_DEPS_ROOT}" ] || [ "$(command -v node 2>/dev/null)" = "$PKG_NODE" ] || say "NODE_OFF_PATH=1"
    return
  fi
  say "Installer finished without Node.js $ver (receipt: ${rv:-none}, node: ${nv:-none})"
  say "FAILED=node:declined"
}

git_install() {
  local out waited=0
  out=$("$XCODE_SELECT" --install 2>&1)
  case "$out" in
    *"already installed"*) git_check; printf '%s' "$GIT_OUT"; return ;;
  esac
  while [ "$waited" -lt "$CLT_LIMIT" ]; do
    "$SLEEP" "$CLT_POLL"
    waited=$((waited + CLT_POLL))
    if "$XCODE_SELECT" -p >/dev/null 2>&1; then git_check; printf '%s' "$GIT_OUT"; return; fi
  done
  say "PENDING=clt"
}

case "$1" in
  check)
    node_check; git_check
    printf '%s%s' "$NODE_OUT" "$GIT_OUT"
    ;;
  install)
    trap cleanup EXIT
    trap 'exit 130' INT TERM HUP
    take_lock
    rc=$?
    if [ "$rc" -eq 1 ]; then say "BUSY=1"; exit 0; fi
    node_check; git_check
    if [ "$rc" -ne 0 ]; then # the lock can't be written: nothing is installed; each offered tool is FAILED=<tool>:other after the reason
      if [ "$N_OFFER" -eq 1 ]; then say "$LOCK_ERR"; say "FAILED=node:other"; else printf '%s' "$NODE_OUT"; fi
      if [ "$G_OFFER" -eq 1 ]; then say "$LOCK_ERR"; say "FAILED=git:other"; else printf '%s' "$GIT_OUT"; fi
      exit 0
    fi
    if [ "$N_OFFER" -eq 1 ]; then
      TMP=$("$MKTEMP" -d "${TMPDIR:-/tmp}/orbit-deps.XXXXXX") || TMP=""
      if [ -n "$TMP" ]; then node_install; else say "mktemp failed"; say "FAILED=node:other"; fi
    else
      printf '%s' "$NODE_OUT"
    fi
    if [ "$G_OFFER" -eq 1 ]; then git_install; else printf '%s' "$GIT_OUT"; fi
    ;;
  *)
    say "usage: /bin/bash install-deps.sh check|install"
    exit 2
    ;;
esac
exit 0
