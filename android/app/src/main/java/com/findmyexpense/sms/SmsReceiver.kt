package com.findmyexpense.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.provider.Telephony
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Section 1.2: "Whenever the user receives a new SMS, the app should detect
 * the message, extract the transaction details, and save the information in
 * transaction table."
 *
 * This only says that a message arrived. It deliberately does not carry the
 * message to JavaScript, for two reasons.
 *
 * The broadcast reaches every app at once, and the message is written to the
 * SMS provider by whichever app owns that job. Reading it here would be a
 * race against that write. More importantly, the catch-up scan on the other
 * side already reads new messages from the provider and puts them through the
 * gates, the deduplication and the categorisation in section 2. A second path
 * carrying a message straight across would be a second copy of those rules,
 * and section 2.3 is explicit about what copies of a rule do: "Copies of a
 * list like that drift apart, and the drift shows up as reminders and
 * one-time passwords being recorded as spending."
 *
 * So the signal says look, and the one reader looks.
 *
 * Which of the two ways it says it depends on whether anyone is there to
 * hear. With the app on screen the event is enough and costs nothing. With
 * the app closed or in the background there is no JavaScript to receive an
 * event, so the message used to wait until the app was next opened — fine
 * for an amount and a payee, which do not change while they wait, and no
 * longer fine now that section 6 attaches a place to them. By the time the
 * app is next opened the phone is somewhere else. `SmsIngestService` is what
 * closes that gap, and it is started here, while the phone is still standing
 * where the payment was made.
 */
class SmsReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
      return
    }

    // The sender is enough to decide whether this is worth waking the scan
    // for. The body is never read here; section 2.1's first gate is the only
    // place that decision is made, and it is made in one place.
    val senders =
      Telephony.Sms.Intents.getMessagesFromIntent(intent)
        ?.mapNotNull { it.originatingAddress }
        ?.distinct()
        ?: return

    val reactContext = currentReactContext(context)
    if (reactContext != null && reactContext.lifecycleState == LifecycleState.RESUMED) {
      // The app is on screen: the scan it already runs is cheaper than
      // standing up a service beside it, and it can show the result.
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_NAME, senders.firstOrNull() ?: "")
      return
    }

    val service = Intent(context, SmsIngestService::class.java)
    var wakeLock: PowerManager.WakeLock? = null
    try {
      // Held until the service is up, so the phone cannot fall asleep in
      // between and leave the broadcast half handled. Inside the guard, not
      // before it: a missing WAKE_LOCK permission surfaces here as a
      // SecurityException, and that is as fatal as anything below.
      //
      // Ours rather than `HeadlessJsTaskService.acquireWakeLockNow`, which is
      // what this used to call. That one takes a static, non reference
      // counted lock released only by the service's own `onDestroy` — so when
      // the start below threw, no service ever existed to release it and the
      // CPU stayed awake with nothing holding it but a lock nobody could
      // reach. Under background start restrictions that is every incoming
      // message. This one is released by hand when the start fails, and
      // carries a timeout so that no path can leave it held for good.
      wakeLock =
        (context.getSystemService(Context.POWER_SERVICE) as PowerManager)
          .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
          .apply {
            setReferenceCounted(false)
            acquire(WAKE_LOCK_TIMEOUT_MS)
          }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(service)
      } else {
        context.startService(service)
      }
      // From here the service takes over: it acquires its own lock as it
      // starts, and ours falls away on its timeout.
    } catch (error: Exception) {
      wakeLock?.let { held -> if (held.isHeld) held.release() }
      // Starting a service from the background is ordinarily forbidden;
      // receiving an SMS is one of the cases Android exempts, but the
      // exemption is a temporary allowance rather than a guarantee, and a
      // throw from a broadcast receiver takes the whole process with it.
      // Losing this costs a delay and a location, not a payment: the scan
      // still reads forward from its watermark next time the app is opened.
      Log.w(TAG, "Could not start background ingest", error)
    }
  }

  private fun currentReactContext(context: Context): ReactContext? {
    val application = context.applicationContext as? ReactApplication ?: return null
    // Both are null whenever JavaScript is not loaded, which is the ordinary
    // case for a message arriving while the app is closed.
    return application.reactHost?.currentReactContext
  }

  companion object {
    const val EVENT_NAME = "SmsReader:messageReceived"
    private const val TAG = "SmsReceiver"
    private const val WAKE_LOCK_TAG = "findmyexpense:sms-ingest-start"

    /**
     * Long enough to cover the gap between asking for the service and the
     * service running, short enough that a lock which somehow outlives that
     * costs a few seconds of CPU rather than a battery.
     */
    private const val WAKE_LOCK_TIMEOUT_MS = 30_000L
  }
}
