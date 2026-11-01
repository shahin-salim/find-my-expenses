package com.findmyexpense.sms

import android.Manifest
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

/**
 * Reads the SMS inbox for the historical import described in section 1.1 of
 * TECHNICAL_IMPLEMENTATION.md.
 *
 * Two operations, both of which take a date window so the caller can honour
 * "scan SMS messages from the past year only":
 *
 *   countInbox(minDate, maxDate)                     -> Int
 *   readInbox(minDate, maxDate, offset, limit, order) -> [{ id, address, body, date }]
 *
 * Reading is done with a projection of four columns and a LIMIT/OFFSET, so a
 * page costs the same whether the inbox holds five hundred messages or fifty
 * thousand. The message body is handed to JavaScript and never stored here;
 * section 8.6 keeps only the provider id.
 */
class SmsReaderModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  private fun hasReadSmsPermission(): Boolean =
    ContextCompat.checkSelfPermission(
      reactApplicationContext,
      Manifest.permission.READ_SMS,
    ) == PackageManager.PERMISSION_GRANTED

  @ReactMethod
  fun countInbox(minDate: Double, maxDate: Double, promise: Promise) {
    if (!hasReadSmsPermission()) {
      promise.reject(E_PERMISSION, "READ_SMS has not been granted")
      return
    }

    try {
      reactApplicationContext.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        arrayOf(Telephony.Sms._ID),
        SELECTION,
        arrayOf(minDate.toLong().toString(), maxDate.toLong().toString()),
        null,
      ).use { cursor ->
        promise.resolve(cursor?.count ?: 0)
      }
    } catch (error: Exception) {
      promise.reject(E_QUERY, error)
    }
  }

  @ReactMethod
  fun readInbox(
    minDate: Double,
    maxDate: Double,
    offset: Int,
    limit: Int,
    order: String?,
    promise: Promise,
  ) {
    if (!hasReadSmsPermission()) {
      promise.reject(E_PERMISSION, "READ_SMS has not been granted")
      return
    }

    val messages: WritableArray = Arguments.createArray()

    // Newest first by default, which is the order the import reads in so a
    // reversal is seen before the payment it reverses. The catch-up scan asks
    // for the other end, because it moves a watermark over what it read and a
    // watermark can only describe a contiguous block — see `SmsPageOrder` in
    // `src/core/platform/smsReader.ts`.
    val direction = if (order == "OLDEST_FIRST") "ASC" else "DESC"

    // `_ID` is in the sort because `DATE` alone is not a total order, and
    // LIMIT/OFFSET paging over a partial order is not sound. Messages
    // delivered together when the phone comes back into coverage share one
    // timestamp, and the provider is free to return tied rows in a different
    // arrangement for the OFFSET 0 query and the OFFSET 100 one. A message in
    // the tie group then falls between two pages and is read by neither —
    // after which the catch-up scan advances its watermark over the timestamp
    // regardless, and that payment is never recorded at all. The id breaks
    // every tie, so the two queries describe one order and the pages tile it.
    val sortOrder =
      "${Telephony.Sms.DATE} $direction, ${Telephony.Sms._ID} $direction " +
        "LIMIT $limit OFFSET $offset"

    try {
      reactApplicationContext.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        PROJECTION,
        SELECTION,
        arrayOf(minDate.toLong().toString(), maxDate.toLong().toString()),
        sortOrder,
      ).use { cursor ->
        if (cursor == null) {
          promise.resolve(messages)
          return
        }

        val idColumn = cursor.getColumnIndexOrThrow(Telephony.Sms._ID)
        val addressColumn = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
        val bodyColumn = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
        val dateColumn = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)

        while (cursor.moveToNext()) {
          val message: WritableMap = Arguments.createMap()
          message.putDouble("id", cursor.getLong(idColumn).toDouble())
          message.putString("address", cursor.getString(addressColumn) ?: "")
          message.putString("body", cursor.getString(bodyColumn) ?: "")
          message.putDouble("date", cursor.getLong(dateColumn).toDouble())
          messages.pushMap(message)
        }
      }

      promise.resolve(messages)
    } catch (error: Exception) {
      promise.reject(E_QUERY, error)
    }
  }

  /**
   * Reads one message back by its provider id, for the unreadable messages
   * screen in section 11.1. Returns null when the user has deleted it, which
   * that screen shows as "no longer available".
   */
  @ReactMethod
  fun readMessageById(providerId: Double, promise: Promise) {
    if (!hasReadSmsPermission()) {
      promise.reject(E_PERMISSION, "READ_SMS has not been granted")
      return
    }

    try {
      reactApplicationContext.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        PROJECTION,
        "${Telephony.Sms._ID} = ?",
        arrayOf(providerId.toLong().toString()),
        null,
      ).use { cursor ->
        if (cursor == null || !cursor.moveToFirst()) {
          promise.resolve(null)
          return
        }
        val message: WritableMap = Arguments.createMap()
        message.putDouble("id", cursor.getLong(cursor.getColumnIndexOrThrow(Telephony.Sms._ID)).toDouble())
        message.putString("address", cursor.getString(cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)) ?: "")
        message.putString("body", cursor.getString(cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)) ?: "")
        message.putDouble("date", cursor.getLong(cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)).toDouble())
        promise.resolve(message)
      }
    } catch (error: Exception) {
      promise.reject(E_QUERY, error)
    }
  }

  companion object {
    const val NAME = "SmsReader"
    private const val E_PERMISSION = "E_SMS_PERMISSION"
    private const val E_QUERY = "E_SMS_QUERY"

    private val PROJECTION = arrayOf(
      Telephony.Sms._ID,
      Telephony.Sms.ADDRESS,
      Telephony.Sms.BODY,
      Telephony.Sms.DATE,
    )

    private const val SELECTION = "${Telephony.Sms.DATE} >= ? AND ${Telephony.Sms.DATE} <= ?"
  }
}
