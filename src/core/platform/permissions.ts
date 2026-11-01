/**
 * Section 7, required permissions, and section 8.5: "Permission states are not
 * stored here. Whether SMS or location access is actually granted is read from
 * the system every time it is needed."
 */

import { PermissionsAndroid, Platform } from 'react-native';
import type { Permission } from 'react-native';

export type PermissionOutcome = 'GRANTED' | 'DENIED' | 'NEVER_ASK_AGAIN';

const SMS_PERMISSIONS: Permission[] = [
  PermissionsAndroid.PERMISSIONS.READ_SMS,
  PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
];

function toOutcome(result: string): PermissionOutcome {
  if (result === PermissionsAndroid.RESULTS.GRANTED) {
    return 'GRANTED';
  }
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    return 'NEVER_ASK_AGAIN';
  }
  return 'DENIED';
}

export async function hasSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  const checks = await Promise.all(
    SMS_PERMISSIONS.map((permission) => PermissionsAndroid.check(permission)),
  );
  return checks.every(Boolean);
}

/** Opens the system prompt. The disclosure screen is shown before this. */
export async function requestSmsPermission(): Promise<PermissionOutcome> {
  if (Platform.OS !== 'android') {
    return 'DENIED';
  }
  const results = await PermissionsAndroid.requestMultiple(SMS_PERMISSIONS);
  const outcomes = SMS_PERMISSIONS.map((permission) => toOutcome(results[permission]));

  if (outcomes.every((outcome) => outcome === 'GRANTED')) {
    return 'GRANTED';
  }
  return outcomes.includes('NEVER_ASK_AGAIN') ? 'NEVER_ASK_AGAIN' : 'DENIED';
}

const BACKGROUND_LOCATION = 'android.permission.ACCESS_BACKGROUND_LOCATION' as Permission;

/**
 * Section 6, the ordinary grant: a location while the app is on screen.
 *
 * This is what onboarding asks for, and on its own it covers every payment
 * made with the app open. It does not cover section 6.1 — see
 * `hasBackgroundLocationPermission`.
 */
export async function hasLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
}

/**
 * Section 6.1, a location while the app is closed — which is when almost
 * every payment actually happens.
 *
 * This is a second grant, and there is no way round it. The app runs a
 * foreground service when a message arrives, which was supposed to be enough:
 * a service of the `location` type is normally covered by the everyday
 * "while using the app" permission. Android refuses that for a service the
 * app started while it was in the background, in as many words —
 *
 *   Foreground service started from background can not have location
 *   /camera/microphone access
 *
 * — and refuses it by throwing, which takes the service down with it. So the
 * only thing that lets a payment made with the app closed carry a place is
 * the user choosing "Allow all the time".
 *
 * Nothing breaks without it. The payment is still read and recorded in the
 * background; it is recorded without a location, the way every imported one
 * already is.
 */
export async function hasBackgroundLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  // Before Android 10 there was no separate background grant: one permission
  // covered both, and holding it is the whole answer.
  if (Number(Platform.Version) < 29) {
    return hasLocationPermission();
  }
  return PermissionsAndroid.check(BACKGROUND_LOCATION);
}

/**
 * Asks for it, which on Android 11 and later the system will not do in a
 * dialog: the "Allow all the time" choice exists only on the app's own
 * settings page. The request is made anyway, because it is the right call on
 * Android 10 and costs nothing above it, and the caller sends the user to
 * settings when it comes back refused.
 */
export async function requestBackgroundLocationPermission(): Promise<PermissionOutcome> {
  if (Platform.OS !== 'android') {
    return 'DENIED';
  }
  if (Number(Platform.Version) < 29) {
    return requestLocationPermission();
  }
  // Android only entertains this once the foreground grant is in hand.
  if (!(await hasLocationPermission())) {
    return 'DENIED';
  }
  const result = await PermissionsAndroid.request(BACKGROUND_LOCATION);
  return toOutcome(result);
}

/** Below Android 13 there is no prompt: notifications are on unless turned off. */
export async function hasNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  if (Number(Platform.Version) < 33) {
    return true;
  }
  return PermissionsAndroid.check(
    'android.permission.POST_NOTIFICATIONS' as Permission,
  );
}

export async function requestLocationPermission(): Promise<PermissionOutcome> {
  if (Platform.OS !== 'android') {
    return 'DENIED';
  }
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return toOutcome(result);
}

export async function requestNotificationPermission(): Promise<PermissionOutcome> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) {
    return 'GRANTED';
  }
  const result = await PermissionsAndroid.request(
    'android.permission.POST_NOTIFICATIONS' as Permission,
  );
  return toOutcome(result);
}
