#!/usr/bin/env bash

# Shared helpers for Xcode-managed Personal Team provisioning profiles.
# Callers are expected to use `set -euo pipefail`.

TOMEKEEP_APP_ID="com.tomekeep.app.nativepreview"
TOMEKEEP_PROFILE_CACHE="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"

# Physical identifiers used by xcodebuild to keep both paired devices in the
# generated Personal Team provisioning profile.
TOMEKEEP_DEVICE_UDIDS=(
  "00008140-001874A2213B801C"
  "00008110-000174383692801E"
)

# CoreDevice identifiers used by devicectl for Wi-Fi or USB installation.
TOMEKEEP_CORE_DEVICE_IDS=(
  "C7485A18-8877-5509-A276-B9FB780E53C3"
  "FAF955F1-E802-52F6-9CCF-481BF776E6DC"
)

tomekeep_profile_field() {
  local profile="$1"
  local field="$2"
  openssl smime -inform der -verify -noverify -in "$profile" 2>/dev/null \
    | plutil -extract "$field" raw -o - - 2>/dev/null
}

tomekeep_profile_remaining_seconds() {
  local expiration
  local expiry
  expiration="$(tomekeep_profile_field "$1" ExpirationDate)" || return 1
  expiry="$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$expiration" '+%s' 2>/dev/null)" || return 1
  echo $((expiry - $(date '+%s')))
}

# Move only TomeKeep profiles out of Xcode's search path. A negative threshold
# forces refresh; otherwise only profiles within the threshold are staged.
stage_tomekeep_profiles() {
  local team="$1"
  local max_remaining="$2"
  local backup_dir="$3"
  local profile
  local app_id
  local remaining

  [ -d "$TOMEKEEP_PROFILE_CACHE" ] || return 0
  mkdir -p "$backup_dir"

  for profile in "$TOMEKEEP_PROFILE_CACHE"/*.mobileprovision; do
    [ -e "$profile" ] || continue
    app_id="$(tomekeep_profile_field "$profile" Entitlements.application-identifier)" || continue
    [ "$app_id" = "$team.$TOMEKEEP_APP_ID" ] || continue

    remaining="$(tomekeep_profile_remaining_seconds "$profile")" || remaining=0
    if [ "$max_remaining" -lt 0 ] || [ "$remaining" -le "$max_remaining" ]; then
      mv "$profile" "$backup_dir/"
      echo "Moved cached TomeKeep profile for refresh: $app_id"
    fi
  done
}

restore_tomekeep_profiles() {
  local backup_dir="$1"
  local profile
  [ -d "$backup_dir" ] || return 0
  mkdir -p "$TOMEKEEP_PROFILE_CACHE"
  for profile in "$backup_dir"/*.mobileprovision; do
    [ -e "$profile" ] || continue
    mv "$profile" "$TOMEKEEP_PROFILE_CACHE/"
  done
}

validate_tomekeep_app_profile() {
  local app="$1"
  local min_remaining="$2"
  local profile="$app/embedded.mobileprovision"
  local remaining
  local expiration

  if [ ! -f "$profile" ]; then
    echo "Missing provisioning profile: $profile"
    return 1
  fi
  remaining="$(tomekeep_profile_remaining_seconds "$profile")" || return 1
  expiration="$(tomekeep_profile_field "$profile" ExpirationDate)" || return 1
  echo "TomeKeep provisioning profile expires: $expiration ($remaining seconds remaining)"
  [ "$remaining" -ge "$min_remaining" ]
}

find_tomekeep_profile_for_all_devices() {
  local team="$1"
  local min_remaining="$2"
  local profile
  local app_id
  local remaining
  local payload
  local device_udid
  local includes_all

  [ -d "$TOMEKEEP_PROFILE_CACHE" ] || return 1
  for profile in "$TOMEKEEP_PROFILE_CACHE"/*.mobileprovision; do
    [ -e "$profile" ] || continue
    app_id="$(tomekeep_profile_field "$profile" Entitlements.application-identifier)" || continue
    [ "$app_id" = "$team.$TOMEKEEP_APP_ID" ] || continue
    remaining="$(tomekeep_profile_remaining_seconds "$profile")" || continue
    [ "$remaining" -ge "$min_remaining" ] || continue
    payload="$(openssl smime -inform der -verify -noverify -in "$profile" 2>/dev/null)" || continue
    includes_all=1
    for device_udid in "${TOMEKEEP_DEVICE_UDIDS[@]}"; do
      if ! printf '%s' "$payload" | grep -Fq "<string>$device_udid</string>"; then
        includes_all=0
        break
      fi
    done
    if [ "$includes_all" -eq 1 ]; then
      printf '%s\n' "$profile"
      return 0
    fi
  done
  return 1
}
