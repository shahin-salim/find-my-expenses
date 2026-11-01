package com.findmyexpense.sms

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Section 6.1: "When a transaction-related SMS arrives, the app should
 * receive the event in the background, extract the transaction details, and
 * associate the current device location with the transaction."
 *
 * The background part is what this class is for. `SmsReceiver` can only talk
 * to JavaScript that is already loaded, so with the app closed the message
 * waited until the app was next opened. That was acceptable while a payment
 * was only an amount and a payee — the catch-up scan would find it eventually
 * and the figures would be the same. It stopped being acceptable the moment a
 * location was attached to it, because by the time the app is next opened the
 * phone is somewhere else, and a payment stamped with the wrong place is
 * worse than one stamped with no place at all.
 *
 * So the work runs here, in the broadcast, while the phone is still where the
 * payment was made.
 *
 * It is a foreground service and not a plain one so that Android will let it
 * finish: a plain background service started from a broadcast is killed on
 * sight on anything recent. The notification that comes with it is set to the
 * lowest importance there is, and the service stops as soon as it has read.
 *
 * It does not, on its own, buy a location. That was the plan — a foreground
 * service of the `location` type is normally covered by the everyday "while
 * using the app" grant, which would have meant never asking the user to let
 * the app follow them around in general. Android refuses:
 *
 *   Foreground service started from background can not have location
 *   /camera/microphone access
 *
 * and refuses by throwing, which takes the service and the payment with it.
 * So the location type is claimed only when the user has granted background
 * location, and when they have not, this is a service that reads a message
 * and writes a row — which is most of what it was for.
 */
class SmsIngestService : HeadlessJsTaskService() {

  private val stopGuard = Handler(Looper.getMainLooper())

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Android gives a service started this way a few seconds to call
    // startForeground before it kills the process, so this comes first.
    goForeground()

    // If JavaScript never starts at all — a bundle that will not load, a
    // crash during startup — nothing would ever call stopSelf, and the
    // notification would sit in the shade for good. The task's own timeout
    // plus a margin is the longest this can legitimately take.
    stopGuard.removeCallbacksAndMessages(null)
    stopGuard.postDelayed({ stopSelf() }, TASK_TIMEOUT_MS + STOP_GUARD_SLACK_MS)

    return super.onStartCommand(intent, flags, startId)
  }

  override fun onDestroy() {
    stopGuard.removeCallbacksAndMessages(null)
    super.onDestroy()
  }

  /**
   * `isAllowedInForeground` is true, which looks wrong for a service the
   * receiver only starts when the app is not in the foreground. It is there
   * for the race in between: the user can open the app in the moment after
   * that decision and before this runs, and React Native answers a task that
   * is not allowed in the foreground by throwing, which would take the
   * process down. Running twice is harmless — section 3.1 drops a message
   * already read — and crashing is not.
   */
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), TASK_TIMEOUT_MS, true)

  private fun goForeground() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // IMPORTANCE_MIN: no sound, no heads-up, no badge. It is there to be
      // found, not to be noticed several times a day.
      val channel =
        NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_MIN)
      channel.description = "Shown for a few seconds while a new bank message is read."
      channel.setShowBadge(false)
      manager.createNotificationChannel(channel)
    }

    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION") Notification.Builder(this)
      }

    val notification =
      builder
        .setContentTitle("Recording a payment")
        .setContentText("Reading the bank message that just arrived.")
        .setSmallIcon(android.R.drawable.stat_notify_sync)
        .setOngoing(true)
        .build()

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification)
      return
    }

    val dataSync = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
    val wanted =
      if (canReadLocationFromBackground()) {
        dataSync or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
      } else {
        dataSync
      }

    try {
      startForeground(NOTIFICATION_ID, notification, wanted)
    } catch (error: Exception) {
      // The eligibility rules for the location type are not something an app
      // can fully check in advance — they take in how the service was
      // started and what the system thinks the app was doing at the time.
      // Reading the message is worth more than stamping it with a place, so
      // a refusal drops the location and keeps the service.
      Log.w(TAG, "Foreground service refused the location type", error)
      startForeground(NOTIFICATION_ID, notification, dataSync)
    }
  }

  /**
   * Whether a fix is available at all from here. Both grants, because the
   * foreground one stops applying the moment the app leaves the screen — see
   * the class comment.
   */
  private fun canReadLocationFromBackground(): Boolean {
    val foreground =
      checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED ||
        checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
          PackageManager.PERMISSION_GRANTED
    if (!foreground) {
      return false
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      return true
    }
    return checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
      PackageManager.PERMISSION_GRANTED
  }

  companion object {
    /** Matches `AppRegistry.registerHeadlessTask` in `index.js`. */
    const val TASK_KEY = "SmsIngest"

    /**
     * Long enough to start JavaScript, read a page of messages and wait on a
     * location fix; short enough that a stuck task cannot hold a wake lock
     * for any length of time.
     */
    const val TASK_TIMEOUT_MS = 45_000L
    private const val STOP_GUARD_SLACK_MS = 15_000L

    private const val TAG = "SmsIngestService"
    private const val CHANNEL_ID = "sms-ingest"
    private const val CHANNEL_NAME = "Recording payments"
    private const val NOTIFICATION_ID = 4201
  }
}
