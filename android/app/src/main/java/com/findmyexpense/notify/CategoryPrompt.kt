package com.findmyexpense.notify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.os.Build
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.findmyexpense.R

/**
 * The notification a payment gets when the app cannot work out what it was
 * for, with its categories on it.
 *
 * `screens/Notification · payment needs a category@1x.png`. The reason it is
 * a notification rather than a badge inside the app is timing: the only
 * person who knows what a ₹200 payment to a QR code was for is the user, and
 * they know it for about a minute. By the evening it is one of forty
 * uncategorised rows and the answer has gone.
 *
 * The pills carry the category's name and nothing else. Six marks drawn at
 * twenty points each were six things to read before the words under them
 * could be read, and the words were the answer.
 *
 * The collapsed card is the ordinary notification template. The expanded one
 * is a custom view wrapped in `DecoratedCustomViewStyle`, which keeps the app
 * name, the time and the expander chrome so the card matches the shade it
 * lands in on any version and in either theme. It does not, despite the
 * name, draw the title above the custom view — the custom view replaces the
 * content area outright — so the expanded layout carries its own copy of the
 * two lines.
 *
 * A tap on a pill goes to [CategoryActionService] rather than opening the
 * app: the whole value of asking here is that answering costs one tap and no
 * context switch. A tap on the card itself is the other answer — "not one of
 * these" — and that one does open the app, on the payment in question rather
 * than on Home.
 */
object CategoryPrompt {

  const val CHANNEL_ID = "payment-needs-category"
  const val EXTRA_TRANSACTION_ID = "transactionId"
  const val EXTRA_CATEGORY_ID = "categoryId"

  /**
   * Fixed slots, because `RemoteViews` cannot inflate a list. Three to a
   * row and two rows, which is what the mockup draws and what stops a name
   * being truncated.
   */
  private const val SLOTS = 6
  private const val PER_ROW = 3

  /**
   * How solid the tint behind a pill is, out of 255.
   *
   * Enough to read as a pill on either shade, little enough that the word
   * on top of it stays the brighter of the two.
   */
  private const val PILL_ALPHA = 56

  private val ROWS = intArrayOf(R.id.pill_row_0, R.id.pill_row_1)

  private val PILL = intArrayOf(
    R.id.pill_0, R.id.pill_1, R.id.pill_2,
    R.id.pill_3, R.id.pill_4, R.id.pill_5,
  )

  data class Option(
    val categoryId: Int,
    val label: String,
    /** The category's own colour, as `#RRGGBB`. */
    val color: Int,
  )

  /**
   * IMPORTANCE_LOW on purpose.
   *
   * This fires for every payment the rules cannot place, which on a normal
   * day is several. At DEFAULT that is a sound and a banner over whatever
   * the user is doing, five times a day, to ask a question that can wait
   * until they next look at the phone. It is its own channel, so anyone who
   * wants it louder can say so in system settings and nothing here has to
   * guess on their behalf.
   */
  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel =
      NotificationChannel(CHANNEL_ID, "Payments needing a category", NotificationManager.IMPORTANCE_LOW)
    channel.description =
      "Asks what a payment was for, while you still remember, with its categories on it."
    manager.createNotificationChannel(channel)
  }

  fun show(
    context: Context,
    transactionId: Int,
    title: String,
    body: String,
    options: List<Option>,
  ) {
    ensureChannel(context)

    val chips = RemoteViews(context.packageName, R.layout.notification_category_prompt)
    // Set here as well as on the builder: the builder's copy is what the
    // collapsed card shows, and this one is what the expanded card shows,
    // because the custom view replaces the content area rather than
    // appearing under it.
    chips.setTextViewText(R.id.prompt_title, title)
    chips.setTextViewText(R.id.prompt_body, body)

    for (slot in 0 until SLOTS) {
      val option = options.getOrNull(slot)
      if (option == null) {
        chips.setViewVisibility(PILL[slot], android.view.View.GONE)
        continue
      }
      chips.setViewVisibility(PILL[slot], android.view.View.VISIBLE)
      chips.setTextViewText(PILL[slot], option.label)
      chips.setTextColor(PILL[slot], option.color)
      tintPill(chips, PILL[slot], option.color)
      chips.setOnClickPendingIntent(
        PILL[slot],
        actionIntent(context, transactionId, option.categoryId),
      )
    }

    // A row with nothing in it still takes its margins, which on a card
    // with three categories left a band of empty shade under them.
    for (row in ROWS.indices) {
      chips.setViewVisibility(
        ROWS[row],
        if (options.size > row * PER_ROW) android.view.View.VISIBLE
        else android.view.View.GONE,
      )
    }

    val notification =
      NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_stat_rupee)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.DecoratedCustomViewStyle())
        .setCustomBigContentView(chips)
        .setContentIntent(openAppIntent(context, transactionId))
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
        .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
        .build()

    // Keyed by the payment, so the notification for one can be taken down
    // without touching another's, and a second prompt for the same payment
    // replaces the first rather than stacking.
    NotificationManagerCompat.from(context).notify(notificationId(transactionId), notification)
  }

  /**
   * The wash behind a pill: the category's own colour, mostly see-through.
   *
   * A background tint composites SRC_IN, so the alpha carried on the tint is
   * the alpha the pill ends up with — translucent against the shade itself,
   * which darkens it on a dark shade and pales it on a light one without
   * this having to know which it is in.
   *
   * Tinting a background from a RemoteViews only arrived in Android 12.
   * Below that the shape is taken off rather than left white, because an
   * opaque white pill on a dark shade is worse than no pill: the coloured
   * word on its own still reads, and still taps.
   */
  private fun tintPill(views: RemoteViews, viewId: Int, color: Int) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val wash = (color and 0x00FFFFFF) or (PILL_ALPHA shl 24)
      views.setColorStateList(viewId, "setBackgroundTintList", ColorStateList.valueOf(wash))
    } else {
      views.setInt(viewId, "setBackgroundResource", 0)
    }
  }

  fun dismiss(context: Context, transactionId: Int) {
    NotificationManagerCompat.from(context).cancel(notificationId(transactionId))
  }

  fun notificationId(transactionId: Int): Int = NOTIFICATION_TAG_BASE + transactionId

  private fun actionIntent(context: Context, transactionId: Int, categoryId: Int): PendingIntent {
    val intent =
      Intent(context, CategoryActionService::class.java)
        .putExtra(EXTRA_TRANSACTION_ID, transactionId)
        .putExtra(EXTRA_CATEGORY_ID, categoryId)

    // Distinct per button. A shared request code would have Android hand
    // every button the extras of whichever was built first, and every tap
    // would file the payment under the same category.
    val requestCode = (transactionId * 31 + categoryId) and 0x00FFFFFF

    // IMMUTABLE is required from Android 12 and is correct everywhere: the
    // extras are the whole instruction, and nothing outside this app has
    // any business editing them.
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      PendingIntent.getForegroundService(context, requestCode, intent, flags)
    } else {
      PendingIntent.getService(context, requestCode, intent, flags)
    }
  }

  /**
   * The card's body, which opens the payment it is asking about.
   *
   * It used to open the app and stop there, on the launcher intent and
   * nothing else, so the one tap that is not an answer landed the user on
   * Home with a page of figures and no sign of which payment had asked. The
   * id rides along and `CategoryPromptModule` hands it to the navigator.
   *
   * `SINGLE_TOP` so this reaches the running activity's `onNewIntent`
   * instead of standing a second copy of the app on top of the first; the
   * activity is `singleTask` already, and the flag is what makes the
   * delivery explicit rather than a property of the manifest.
   *
   * The request code is per payment for the same reason [actionIntent]'s is:
   * a shared one has Android hand every card the extras of whichever was
   * built first, and every tap would open the same payment.
   */
  private fun openAppIntent(context: Context, transactionId: Int): PendingIntent? {
    val launch =
      context.packageManager
        .getLaunchIntentForPackage(context.packageName)
        ?.putExtra(EXTRA_TRANSACTION_ID, transactionId)
        ?.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        ?: return null
    return PendingIntent.getActivity(
      context,
      notificationId(transactionId),
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /**
   * Keeps these clear of `SmsIngestService`'s own id, which is 1.
   */
  private const val NOTIFICATION_TAG_BASE = 100_000
}
