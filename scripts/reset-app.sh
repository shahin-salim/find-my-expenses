#!/bin/bash
#
# Puts the app back to a fresh install, so the next launch starts at the
# welcome screen instead of Home.
#
# Section 8.5 decides where the app opens, from the single profile row:
# onboarding_completed and import_status. `pm clear` deletes the database that
# row lives in, so both go back to their defaults.
#
# Usage:  npm run reset            full reset, SMS permission revoked too
#         npm run reset -- --keep-permissions
#
set -e

PACKAGE=com.findmyexpense
KEEP_PERMISSIONS=false
[ "$1" = "--keep-permissions" ] && KEEP_PERMISSIONS=true

# With more than one device attached, adb needs to be told which. Set
# ANDROID_SERIAL (the serial from `adb devices`) to pick one.
ADB="adb"
[ -n "$ANDROID_SERIAL" ] && ADB="adb -s $ANDROID_SERIAL"

if ! $ADB get-state >/dev/null 2>&1; then
  echo "No device or emulator is connected, or ANDROID_SERIAL names one that is not."
  echo "Attached devices:"
  adb devices -l | tail -n +2
  exit 1
fi

$ADB shell pm clear "$PACKAGE" >/dev/null
echo "Cleared app data."

# Debug builds reach Metro over the local network, and pm clear revokes that
# along with everything else. Without it the bundle will not load.
$ADB shell pm grant "$PACKAGE" android.permission.ACCESS_LOCAL_NETWORK 2>/dev/null || true
$ADB reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true

if [ "$KEEP_PERMISSIONS" = true ]; then
  $ADB shell pm grant "$PACKAGE" android.permission.READ_SMS
  $ADB shell pm grant "$PACKAGE" android.permission.RECEIVE_SMS
  echo "SMS access re-granted, so the system prompt will not appear."
else
  echo "SMS access revoked, so the real permission prompt will appear."
fi

$ADB shell am start -n "$PACKAGE/.MainActivity" >/dev/null
echo "Launched. The app should be on the welcome screen."
