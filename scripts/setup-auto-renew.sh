#!/usr/bin/env bash
# Install the TomeKeep signing worker outside ~/Documents and register launchd.
# Usage: ./scripts/setup-auto-renew.sh <DEVELOPMENT_TEAM>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEAM="${1:?Usage: setup-auto-renew.sh <DEVELOPMENT_TEAM>}"
RENEW_HOME="$HOME/Library/Application Support/TomeKeepRenew"
AGENT="$HOME/Library/LaunchAgents/com.tomekeep.renew.plist"
TEMPLATE="$ROOT/scripts/launchd/com.tomekeep.renew.plist"

mkdir -p "$RENEW_HOME/apple" "$RENEW_HOME/scripts" "$HOME/Library/LaunchAgents"

rsync -a --delete \
  --exclude 'DerivedData*' \
  --exclude .build \
  --exclude .swiftpm \
  --exclude xcuserdata \
  "$ROOT/apple/" "$RENEW_HOME/apple/"

install -m 755 "$ROOT/scripts/auto-renew-device.sh" "$RENEW_HOME/scripts/auto-renew-device.sh"
install -m 755 "$ROOT/scripts/signing-profile-utils.sh" "$RENEW_HOME/scripts/signing-profile-utils.sh"
sed -e "s|__HOME__|$HOME|g" -e "s|__TEAM_ID__|$TEAM|g" "$TEMPLATE" > "$AGENT"
chmod 644 "$AGENT"

launchctl bootout "gui/$(id -u)" "$AGENT" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT"
launchctl enable "gui/$(id -u)/com.tomekeep.renew"

echo "TomeKeep automatic signing is installed."
echo "Source snapshot: $RENEW_HOME/apple"
echo "Log: /tmp/tomekeep-renew.log"
