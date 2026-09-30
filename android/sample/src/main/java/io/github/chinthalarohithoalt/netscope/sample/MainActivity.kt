package io.github.chinthalarohithoalt.netscope.sample

import android.app.Activity
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import io.github.chinthalarohithoalt.netscope.NetscopeInterceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.logging.HttpLoggingInterceptor
import kotlin.concurrent.thread

/** Makes a mix of calls so Netscope's library capture can be checked end to end. */
class MainActivity : Activity() {
    private val client = OkHttpClient.Builder()
        .addInterceptor(NetscopeInterceptor(redactHeaders = setOf("X-Secret")))
        // Also logs to logcat, to prove Netscope doesn't show these calls twice.
        .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BODY })
        .build()

    private lateinit var log: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        log = TextView(this).apply { textSize = 13f }
        val run = Button(this).apply { text = "Run sample calls"; setOnClickListener { runCalls() } }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 96, 48, 48)
            addView(run)
            addView(log)
        })
        runCalls()
    }

    private fun runCalls() {
        thread {
            val json = "application/json".toMediaType()
            val calls = listOf(
                Request.Builder().url("https://httpbingo.org/json").build(),
                Request.Builder().url("https://httpbingo.org/post?source=sample")
                    .header("X-Secret", "do-not-show")
                    .post("""{"order":{"id":42,"items":[{"sku":"A1","qty":2}]}}""".toRequestBody(json)).build(),
                // ~1.5 MB of JSON: logcat would cut this; the library sends it whole.
                Request.Builder().url("https://httpbingo.org/stream/3000").build(),
                Request.Builder().url("https://httpbingo.org/image/png").build(),
                Request.Builder().url("https://httpbingo.org/status/404").build(),
                Request.Builder().url("https://no-such-host.invalid/ping").build(),
            )
            for (r in calls) {
                val line = try {
                    client.newCall(r).execute().use { "${it.code} ${r.url.encodedPath} (${it.body?.bytes()?.size ?: 0} bytes)" }
                } catch (e: Exception) {
                    "failed ${r.url.host}: ${e.javaClass.simpleName}"
                }
                runOnUiThread { log.append("$line\n") }
            }
        }
    }
}
