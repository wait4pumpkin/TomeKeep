#!/usr/bin/env bash
# Build, validate and recoverably install the native Mac preview.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_ROOT="$PROJECT_ROOT/apple/DerivedData-MacInstall"
SOURCE_APP="$BUILD_ROOT/Build/Products/Debug/TomeKeep Next.app"
TARGET_APP="/Applications/TomeKeep Next.app"
EXPECTED_ID="com.tomekeep.app.nativepreview.macos"

if [ "$#" -ne 0 ]; then
  echo "Usage: ./scripts/install-mac.sh"
  exit 2
fi

cd "$PROJECT_ROOT/apple"
xcodebuild -project TomeKeep.xcodeproj -scheme TomeKeepMac \
  -configuration Debug -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$BUILD_ROOT" \
  CODE_SIGNING_ALLOWED=NO \
  build -quiet

source_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$SOURCE_APP/Contents/Info.plist")"
[ "$source_id" = "$EXPECTED_ID" ] || { echo "Unexpected source bundle ID; installation cancelled."; exit 1; }

if [ -L "$TARGET_APP" ]; then
  echo "Refusing to replace a symbolic link: $TARGET_APP"
  exit 1
fi
if [ -e "$TARGET_APP" ]; then
  target_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$TARGET_APP/Contents/Info.plist")"
  [ "$target_id" = "$EXPECTED_ID" ] || { echo "Unexpected installed bundle ID; preserving it."; exit 1; }
fi

STAGING_DIR="$(mktemp -d /Applications/.tomekeep-native-install.XXXXXX)"
trap 'rmdir "$STAGING_DIR" 2>/dev/null || true' EXIT
ditto "$SOURCE_APP" "$STAGING_DIR/TomeKeep Next.app"
# Existing local previews were built without signed sandbox entitlements.
# Preserve that baseline: enabling a sandbox during installation would redirect
# Application Support and make the existing SwiftData store appear missing.
codesign --force --deep --sign - --identifier "$EXPECTED_ID" "$STAGING_DIR/TomeKeep Next.app"
codesign --verify --deep --strict "$STAGING_DIR/TomeKeep Next.app"
signing_entitlements="$(codesign -d --entitlements :- "$STAGING_DIR/TomeKeep Next.app" 2>/dev/null)"
if [[ "$signing_entitlements" == *"com.apple.security.app-sandbox"* ]]; then
  echo "Unexpected sandbox entitlement; preserving the installed app and its storage baseline."
  exit 1
fi

backup_app=""
if [ -d "$TARGET_APP" ]; then
  backup_dir="$HOME/Library/Application Support/TomeKeepMacInstall/Backups/$(date '+%Y%m%d-%H%M%S')-$$"
  mkdir -p "$backup_dir"
  backup_app="$backup_dir/TomeKeep Next.app"
  mv "$TARGET_APP" "$backup_app"
  echo "Previous native app backed up: $backup_app"
fi
if ! mv "$STAGING_DIR/TomeKeep Next.app" "$TARGET_APP"; then
  if [ -n "$backup_app" ]; then mv "$backup_app" "$TARGET_APP"; fi
  echo "Install failed; previous native app restored when present."
  exit 1
fi
codesign --verify --deep --strict "$TARGET_APP"
"/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" -f "$TARGET_APP"
echo "Installed: $TARGET_APP ($EXPECTED_ID)"
echo "Existing Electron /Applications/TomeKeep.app and user data were not changed."
if pgrep -x 'TomeKeep Next' >/dev/null; then
  echo "A native app process is still running. Finish your work, quit it and reopen the installed app to use this build."
fi
