#!/usr/bin/env bash
# Build and install the current TomeKeep iOS source on both paired iPhones.
# Usage: ./scripts/install-device.sh <DEVELOPMENT_TEAM> [--refresh]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/signing-profile-utils.sh"

TEAM="${1:?Usage: install-device.sh <DEVELOPMENT_TEAM> [--refresh]}"
REFRESH_MODE="${2:-}"
DERIVED_DATA="$ROOT/apple/DerivedData-Device"
APP="$DERIVED_DATA/Build/Products/Debug-iphoneos/TomeKeep Next.app"
RENEW_HOME="$HOME/Library/Application Support/TomeKeepRenew"
PROFILE_BACKUP="$RENEW_HOME/profile-backups/manual-$(date '+%Y%m%d-%H%M%S')-$$"

cd "$ROOT/apple"
if [ "$REFRESH_MODE" != "--refresh" ] && cached_profile="$(find_tomekeep_profile_for_all_devices "$TEAM" 86400)"; then
  echo "== 1/3 Reuse valid two-device profile =="
  echo "$cached_profile"
else
  echo "== 1/3 Refresh registration for both iPhones on Team $TEAM =="
  stage_tomekeep_profiles "$TEAM" -1 "$PROFILE_BACKUP"
  for device_udid in "${TOMEKEEP_DEVICE_UDIDS[@]}"; do
    echo "Preparing $device_udid"
    if ! xcodebuild -project TomeKeep.xcodeproj -scheme TomeKeepIOS \
      -configuration Debug -derivedDataPath "$DERIVED_DATA" \
      -destination "platform=iOS,id=$device_udid" \
      DEVELOPMENT_TEAM="$TEAM" -allowProvisioningUpdates \
      -allowProvisioningDeviceRegistration build -quiet; then
      restore_tomekeep_profiles "$PROFILE_BACKUP"
      exit 1
    fi
  done
fi

echo "== 2/3 Create one fresh signed build =="
if ! xcodebuild -project TomeKeep.xcodeproj -scheme TomeKeepIOS \
  -sdk iphoneos -configuration Debug -derivedDataPath "$DERIVED_DATA" \
  DEVELOPMENT_TEAM="$TEAM" -allowProvisioningUpdates clean build -quiet; then
  restore_tomekeep_profiles "$PROFILE_BACKUP"
  exit 1
fi

[ -d "$APP" ] || { echo "Signed app was not produced: $APP"; exit 1; }
if ! validate_tomekeep_app_profile "$APP" 86400; then
  restore_tomekeep_profiles "$PROFILE_BACKUP"
  echo "The new profile is valid for less than 24 hours; installation cancelled."
  exit 1
fi

echo "== 3/3 Install on both paired iPhones =="
install_failed=0
for core_device_id in "${TOMEKEEP_CORE_DEVICE_IDS[@]}"; do
  echo "Installing on $core_device_id"
  if ! xcrun devicectl device install app --device "$core_device_id" "$APP"; then
    echo "Installation failed for $core_device_id; keep it unlocked and reachable over USB or Wi-Fi."
    install_failed=1
  fi
done

# launchd cannot reliably read a project under ~/Documents without interactive
# Files & Folders permission. Keep its private build snapshot current whenever
# a development build is distributed.
if [ -d "$RENEW_HOME/apple" ]; then
  echo "Refreshing the automatic-renewal source snapshot"
  rsync -a --delete \
    --exclude 'DerivedData*' \
    --exclude .build \
    --exclude .swiftpm \
    --exclude xcuserdata \
    "$ROOT/apple/" "$RENEW_HOME/apple/"
fi

exit "$install_failed"
