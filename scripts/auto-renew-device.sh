#!/usr/bin/env bash
# Periodically refresh a Personal Team signature and reinstall on both iPhones.
# Usage: auto-renew-device.sh <DEVELOPMENT_TEAM> [log-path]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/signing-profile-utils.sh"

TEAM="${1:?Usage: auto-renew-device.sh <DEVELOPMENT_TEAM> [log-path]}"
LOG="${2:-/tmp/tomekeep-renew.log}"
DERIVED_DATA="$ROOT/apple/DerivedData-Device"
APP="$DERIVED_DATA/Build/Products/Debug-iphoneos/TomeKeep Next.app"
LOCK_DIR="/tmp/com.tomekeep.renew.lock"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "=== $(date) renewal already running; skipped ===" >> "$LOG"
  exit 0
fi

on_exit() {
  local status=$?
  rmdir "$LOCK_DIR" 2>/dev/null || true
  if [ "$status" -ne 0 ]; then
    echo "Renewal failed with status $status" >> "$LOG"
    /usr/bin/osascript -e 'display notification "Automatic signing failed; unlock both iPhones and check Xcode Accounts" with title "TomeKeep Signing"' >/dev/null 2>&1 || true
  fi
}
trap on_exit EXIT

echo "=== $(date) automatic signing check started ===" >> "$LOG"

# Avoid terminating/reinstalling a healthy app on every scheduled retry. The
# cached two-device profile or existing artifact mirrors the profile installed
# by the last successful run.
if cached_profile="$(find_tomekeep_profile_for_all_devices "$TEAM" 172800)"; then
  echo "More than 48 hours remain in $cached_profile; no reinstall needed." >> "$LOG"
  exit 0
fi
if [ -d "$APP" ] && validate_tomekeep_app_profile "$APP" 172800 >> "$LOG" 2>&1; then
  echo "More than 48 hours remain; no reinstall needed." >> "$LOG"
  exit 0
fi

PROFILE_BACKUP="$ROOT/profile-backups/$(date '+%Y%m%d-%H%M%S')-$$"
stage_tomekeep_profiles "$TEAM" 172800 "$PROFILE_BACKUP" >> "$LOG" 2>&1
cd "$ROOT/apple"

for device_udid in "${TOMEKEEP_DEVICE_UDIDS[@]}"; do
  echo "Refreshing device registration: $device_udid" >> "$LOG"
  if ! xcodebuild -project TomeKeep.xcodeproj -scheme TomeKeepIOS \
    -configuration Debug -derivedDataPath "$DERIVED_DATA" \
    -destination "platform=iOS,id=$device_udid" \
    DEVELOPMENT_TEAM="$TEAM" -allowProvisioningUpdates \
    -allowProvisioningDeviceRegistration build -quiet >> "$LOG" 2>&1; then
    restore_tomekeep_profiles "$PROFILE_BACKUP" >> "$LOG" 2>&1
    exit 1
  fi
done

if ! xcodebuild -project TomeKeep.xcodeproj -scheme TomeKeepIOS \
  -sdk iphoneos -configuration Debug -derivedDataPath "$DERIVED_DATA" \
  DEVELOPMENT_TEAM="$TEAM" -allowProvisioningUpdates clean build -quiet >> "$LOG" 2>&1; then
  restore_tomekeep_profiles "$PROFILE_BACKUP" >> "$LOG" 2>&1
  exit 1
fi

if ! validate_tomekeep_app_profile "$APP" 86400 >> "$LOG" 2>&1; then
  restore_tomekeep_profiles "$PROFILE_BACKUP" >> "$LOG" 2>&1
  exit 1
fi

install_failed=0
for core_device_id in "${TOMEKEEP_CORE_DEVICE_IDS[@]}"; do
  if xcrun devicectl device install app --device "$core_device_id" "$APP" >> "$LOG" 2>&1; then
    echo "Renewed and installed on $core_device_id" >> "$LOG"
  else
    echo "Installation failed for $core_device_id" >> "$LOG"
    install_failed=1
  fi
done
echo "=== $(date) automatic signing check finished ===" >> "$LOG"
exit "$install_failed"
