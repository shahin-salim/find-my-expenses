package com.findmyexpense.notify

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * What happens when one of the category buttons on the notification is
 * tapped.
 *
 * The category is written by JavaScript rather than here, for the same
 * reason the SMS ingest is: the database is op-sqlite's, opened in write
 * mode by the JavaScript side, and a second writer reaching into the same
 * WAL from Kotlin is a way to corrupt it. So this does what
 * `SmsIngestService` does — starts the bundle headless, hands it the two
 * numbers, and lets the ordinary DAO do the write.
 *
 * The notification is taken down from JavaScript once the write lands, not
 * here, so it stays up if the write fails and the tap is not silently lost.
 *
 * Starting a foreground service from the background is normally refused on
 * Android 12 and later. Acting on a notification the user just tapped is one
 * of the listed exemptions, which is what makes this legal where the same
 * call from a broadcast would not be.
 */
class CategoryActionService : HeadlessJsTaskService() {

  private val stopGuard = Handler(Looper.getMainLooper())

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    goForeground()

    // The same belt and braces as the SMS service: if the bundle never
    // starts, nothing would call stopSelf and the placeholder would sit in
    // the shade for good.
    stopGuard.removeCallbacksAndMessages(null)
    stopGuard.postDelayed({ stopSelf() }, TASK_TIMEOUT_MS + STOP_GUARD_SLACK_MS)

    return super.onStartCommand(intent, flags, startId)
  }

  override fun onDestroy() {
    stopGuard.removeCallbacksAndMessages(null)
    super.onDestroy()
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    val transactionId = extras.getInt(CategoryPrompt.EXTRA_TRANSACTION_ID, -1)
    val categoryId = extras.getInt(CategoryPrompt.EXTRA_CATEGORY_ID, -1)
    if (transactionId < 0 || categoryId < 0) {
      return null
    }

    // Taken down before the work rather than after it: the user has tapped,
    // and a notification that lingers for the second it takes the bundle to
    // start reads as a tap that did nothing, and gets tapped again.
    CategoryPrompt.dismiss(this, transactionId)

    val data = Arguments.createMap()
    data.putInt("transactionId", transactionId)
    data.putInt("categoryId", categoryId)

    // Allowed in the foreground as well, because the user can perfectly well
    // have the app open while they answer the notification over the top
    // of it, and React Native answers a task that is not allowed in the
    // foreground by throwing.
    return HeadlessJsTaskConfig(TASK_KEY, data, TASK_TIMEOUT_MS, true)
  }

  /**
   * A placeholder on the same quiet channel the ingest service uses. It is
   * on screen for about a second, and only because Android requires a
   * foreground service to show something.
   */
  private fun goForeground() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel =
        NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_MIN)
      channel.description = "Shown for a moment while a category you chose is saved."
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
        .setContentTitle("Saving the category")
        .setSmallIcon(android.R.drawable.stat_notify_sync)
        .setOngoing(true)
        .build()

    startForeground(NOTIFICATION_ID, notification)
  }

  companion object {
    /** Matches the key `index.js` registers the task under. */
    const val TASK_KEY = "CategoryAction"
    private const val TASK_TIMEOUT_MS = 20_000L
    private const val STOP_GUARD_SLACK_MS = 5_000L
    private const val CHANNEL_ID = "category-action"
    private const val CHANNEL_NAME = "Saving a category"
    private const val NOTIFICATION_ID = 2
  }
}
