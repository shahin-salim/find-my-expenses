package com.findmyexpense.notify

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * The JavaScript side of the "what was this payment for" notification.
 *
 * Which payments get one, which categories are offered and what the lines
 * say are all decided in JavaScript, where the database and section 8.2's
 * categories are. This module only draws what it is handed.
 */
class CategoryPromptModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  init {
    // Registered for the sake of [onNewIntent] below, which is the only way
    // a tap reaches JavaScript while the app is already running.
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = "CategoryPrompt"

  /**
   * The payment a notification tap asked to open, when the tap is what
   * started the app.
   *
   * Read from the activity's own intent rather than remembered here,
   * because on a cold start this module is built after the intent has
   * already been delivered and there was nothing listening at the time.
   *
   * The extra is taken off once read. Android keeps the launch intent on
   * the activity for as long as it lives, so leaving it in place had every
   * later return to the app — from the recents list, from the launcher —
   * reopen a payment the user dealt with hours ago.
   */
  @ReactMethod
  fun takePendingTransaction(promise: Promise) {
    val intent = reactContext.currentActivity?.intent
    val transactionId = intent?.getIntExtra(CategoryPrompt.EXTRA_TRANSACTION_ID, 0) ?: 0
    if (transactionId <= 0) {
      promise.resolve(null)
      return
    }
    intent?.removeExtra(CategoryPrompt.EXTRA_TRANSACTION_ID)
    promise.resolve(transactionId)
  }

  /**
   * The same tap, when the app was already running and is merely being
   * brought forward. `takePendingTransaction` cannot answer this one: the
   * activity was alive the whole time and nothing asked it again.
   */
  override fun onNewIntent(intent: Intent) {
    val transactionId = intent.getIntExtra(CategoryPrompt.EXTRA_TRANSACTION_ID, 0)
    if (transactionId <= 0) {
      return
    }
    intent.removeExtra(CategoryPrompt.EXTRA_TRANSACTION_ID)
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_OPENED, transactionId)
  }

  override fun onActivityResult(
    activity: Activity,
    requestCode: Int,
    resultCode: Int,
    data: Intent?,
  ) {
    // Nothing here is started for a result.
  }

  /**
   * Whether anything posted would actually be seen.
   *
   * Checked from here rather than from the permissions module because the
   * user can leave POST_NOTIFICATIONS granted and still turn the app's
   * notifications off in system settings, and the two are different
   * questions with the same consequence.
   */
  @ReactMethod
  fun areNotificationsEnabled(promise: Promise) {
    promise.resolve(NotificationManagerCompat.from(reactContext).areNotificationsEnabled())
  }

  /**
   * `options` is an array of `{ categoryId, label, icon, color }`, in the
   * order they should appear. Anything past the sixth is dropped rather
   * than wrapped onto a second row, which the shade has no height for.
   */
  @ReactMethod
  fun show(transactionId: Int, title: String, body: String, options: ReadableArray) {
    val parsed = buildList {
      for (index in 0 until options.size()) {
        val entry = options.getMap(index) ?: continue
        add(
          CategoryPrompt.Option(
            categoryId = entry.getInt("categoryId"),
            label = entry.getString("label") ?: continue,
            // Parsed here rather than passed as a number so the colour can
            // stay the `#RRGGBB` string the theme already holds.
            color = runCatching { Color.parseColor(entry.getString("color")) }
              .getOrDefault(Color.GRAY),
          ),
        )
      }
    }
    if (parsed.isEmpty()) {
      return
    }
    CategoryPrompt.show(reactContext, transactionId, title, body, parsed)
  }

  /** Taken down when the payment is categorised from inside the app instead. */
  @ReactMethod
  fun dismiss(transactionId: Int) {
    CategoryPrompt.dismiss(reactContext, transactionId)
  }

  companion object {
    /**
     * Emitted on `RCTDeviceEventEmitter`, the global channel, rather than
     * through a `NativeEventEmitter` bound to this module — the same choice
     * `SmsReceiver` makes, and for the same reason: binding an emitter to a
     * module that implements no `addListener` throws.
     */
    const val EVENT_OPENED = "CategoryPrompt:open"
  }
}
