package com.findmyexpense.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Section 6: "associate the current device location with the transaction".
 *
 * Built on the platform's own LocationManager rather than Play Services. The
 * fused provider would be more accurate, but it arrives as a dependency that
 * merges its own permissions into the manifest, and the release manifest
 * having no INTERNET permission is what makes "your data stays on your phone"
 * something the OS enforces. GPS and the network provider are already on the
 * device and ask nothing of this app's own network access.
 *
 * Nothing here ever throws at JavaScript. A phone with location turned off,
 * a permission withdrawn in system settings, a provider that never answers:
 * all of them resolve to null, and a payment without a location is the
 * ordinary case — section 6 says so of every historical one.
 */
class LocationReaderModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /**
   * The phone's position now, or as near to now as `maxAgeMs` allows.
   *
   * A fix the system already has costs nothing to read, so it is preferred
   * whenever it is recent enough. Only when there is none does this turn a
   * radio on, and then for `timeoutMs` at most — a payment is worth a few
   * seconds of GPS, not a minute of it.
   */
  @ReactMethod
  fun currentFix(maxAgeMs: Double, timeoutMs: Double, promise: Promise) {
    val context = reactApplicationContext
    if (!hasPermission(context)) {
      promise.resolve(null)
      return
    }

    val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    if (manager == null) {
      promise.resolve(null)
      return
    }

    val known = bestLastKnown(manager)
    if (known != null && System.currentTimeMillis() - known.time <= maxAgeMs) {
      promise.resolve(describe(known))
      return
    }

    val provider = activeProvider(manager)
    if (provider == null) {
      // Location is switched off at the system level. Whatever was last
      // known is still the best answer there is, stale or not.
      promise.resolve(known?.let(::describe))
      return
    }

    requestOneFix(manager, provider, timeoutMs.toLong(), known, promise)
  }

  @Suppress("MissingPermission")
  private fun requestOneFix(
    manager: LocationManager,
    provider: String,
    timeoutMs: Long,
    fallback: Location?,
    promise: Promise,
  ) {
    // One of the two paths below settles this, never both: a fix can arrive
    // in the same instant the timeout fires, and resolving a promise twice
    // is a crash in release builds.
    val settled = AtomicBoolean(false)
    val handler = Handler(Looper.getMainLooper())

    val listener =
      object : LocationListener {
        override fun onLocationChanged(location: Location) {
          if (settled.compareAndSet(false, true)) {
            handler.removeCallbacksAndMessages(null)
            manager.removeUpdates(this)
            promise.resolve(describe(location))
          }
        }

        // Required below API 29, where they are still abstract.
        override fun onProviderEnabled(provider: String) = Unit

        override fun onProviderDisabled(provider: String) = Unit

        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
      }

    handler.postDelayed(
      {
        if (settled.compareAndSet(false, true)) {
          manager.removeUpdates(listener)
          // A fix from an hour ago is still roughly where the phone was, and
          // "roughly" is the whole of what section 6 asks for.
          promise.resolve(fallback?.let(::describe))
        }
      },
      timeoutMs,
    )

    try {
      manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
    } catch (error: SecurityException) {
      if (settled.compareAndSet(false, true)) {
        handler.removeCallbacksAndMessages(null)
        promise.resolve(fallback?.let(::describe))
      }
    }
  }

  /** The newest fix any provider still remembers. */
  @Suppress("MissingPermission")
  private fun bestLastKnown(manager: LocationManager): Location? {
    var best: Location? = null
    for (provider in enabledProviders(manager)) {
      val candidate =
        try {
          manager.getLastKnownLocation(provider)
        } catch (error: SecurityException) {
          null
        } ?: continue
      if (best == null || candidate.time > best.time) {
        best = candidate
      }
    }
    return best
  }

  /**
   * The network provider first. Indoors — which is where most shops are —
   * GPS can spend a minute looking at a ceiling, while the network provider
   * answers in seconds and to an accuracy that is ample for naming a place.
   */
  private fun activeProvider(manager: LocationManager): String? {
    val enabled = enabledProviders(manager)
    return listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
      .firstOrNull(enabled::contains)
  }

  private fun enabledProviders(manager: LocationManager): List<String> =
    try {
      manager.getProviders(true)
    } catch (error: SecurityException) {
      emptyList()
    }

  private fun hasPermission(context: Context): Boolean =
    context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED ||
      context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED

  private fun describe(location: Location): WritableMap {
    val map = Arguments.createMap()
    map.putDouble("latitude", location.latitude)
    map.putDouble("longitude", location.longitude)
    if (location.hasAccuracy()) {
      map.putDouble("accuracy", location.accuracy.toDouble())
    } else {
      map.putNull("accuracy")
    }
    // When the fix was taken, not when it was asked for. Section 8.1 stores
    // this as `location_captured_at`, and a fix the system had already is
    // older than the payment that borrowed it.
    map.putDouble("capturedAt", location.time.toDouble())
    return map
  }

  companion object {
    const val NAME = "LocationReader"
  }
}
