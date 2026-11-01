/**
 * Section 6: the device's position when a transaction-related message
 * arrives.
 *
 * Backed by the LocationReader native module in
 * `android/app/src/main/java/com/findmyexpense/location/`. The scan talks to
 * the `LocationFinder` interface rather than the module, so the rule about
 * which payments get a fix can be tested without a phone.
 */

import { NativeModules } from 'react-native';
import type { LocationFix } from '../transactions/ingest';

interface NativeFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: number;
}

interface LocationReaderNativeModule {
  currentFix(maxAgeMs: number, timeoutMs: number): Promise<NativeFix | null>;
}

export interface LocationFinder {
  /** The current fix, or null for every reason a phone has not to have one. */
  find(): Promise<LocationFix | null>;
}

/**
 * How old a fix the system already holds may be and still be called current.
 *
 * Five minutes is roughly how long it takes to walk somewhere else. A fix
 * from within that window describes the place the payment was made; an older
 * one is worth asking the hardware to improve on.
 */
export const MAX_FIX_AGE_MS = 5 * 60 * 1000;

/**
 * How long to wait for a better one. The service holding this open is also
 * holding a wake lock and showing a notification, and a payment is not worth
 * a minute of either.
 */
export const FIX_TIMEOUT_MS = 12 * 1000;

export const deviceLocation: LocationFinder = {
  async find(): Promise<LocationFix | null> {
    const module = (NativeModules as Record<string, unknown>).LocationReader as
      | LocationReaderNativeModule
      | undefined;
    if (!module) {
      return null;
    }

    try {
      const fix = await module.currentFix(MAX_FIX_AGE_MS, FIX_TIMEOUT_MS);
      if (!fix) {
        return null;
      }
      return {
        latitude: fix.latitude,
        longitude: fix.longitude,
        // Section 8.1 describes `location_label` as a reverse-geocoded name
        // like "Near Indiranagar, Bengaluru", and it is deliberately not
        // filled in. Turning coordinates into a place name means asking
        // Google to do it — through the system, but off the device all the
        // same — and this app's claim that nothing it holds leaves the phone
        // is worth more than a prettier line on a payment. The coordinates
        // are shown as they are, and tapping them hands them to a maps app,
        // which is the user's decision rather than one made for them.
        label: null,
        capturedAt: fix.capturedAt,
      };
    } catch {
      // A withdrawn permission, a provider that threw, a module that is not
      // there. A payment without a location is the ordinary case.
      return null;
    }
  },
};
