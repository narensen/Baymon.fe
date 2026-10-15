package expo.modules.baymonagent

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** ISO-8601 UTC timestamp without java.time, which older supported Android versions lack. */
internal fun isoTime(millis: Long): String =
  SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
    .apply { timeZone = TimeZone.getTimeZone("UTC") }
    .format(Date(millis))
