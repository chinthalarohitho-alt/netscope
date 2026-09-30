package io.github.chinthalarohithoalt.netscope

import okhttp3.Headers
import okhttp3.Interceptor
import okhttp3.MediaType
import okhttp3.Response
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.nio.charset.Charset

/**
 * OkHttp interceptor that sends every call — full request and response bodies, headers and
 * timing — to the Netscope desktop app over adb. Add it as an application interceptor:
 *
 * ```
 * OkHttpClient.Builder()
 *     .addInterceptor(NetscopeInterceptor())
 *     .build()
 * ```
 *
 * It doesn't change requests or responses. Response bodies are read with `peekBody`, so the app
 * still gets the full stream. Only add it to builds you're happy to inspect (e.g. debug, or an
 * internal build): anyone with adb access to the device can read the captured traffic.
 */
class NetscopeInterceptor @JvmOverloads constructor(
    /** Bodies larger than this are cut and flagged as truncated. */
    private val maxBodyBytes: Long = 2L * 1024 * 1024,
    /** Header names whose values are replaced with "••••" (case-insensitive). */
    private val redactHeaders: Set<String> = emptySet(),
) : Interceptor {

    init {
        Netscope.start()
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val id = Netscope.nextId()
        val started = System.currentTimeMillis()
        val t0 = System.nanoTime()

        val req = JSONObject()
            .put("t", "req")
            .put("id", id)
            .put("ts", started)
            .put("method", request.method)
            .put("url", request.url.toString())
            .put("thread", Thread.currentThread().name)
        val reqHeaders = headersJson(request.headers)
        request.body?.let { body ->
            body.contentType()?.let { ct ->
                if (request.header("Content-Type") == null) reqHeaders.put(JSONArray().put("Content-Type").put(ct.toString()))
            }
            val len = try { body.contentLength() } catch (_: IOException) { -1L }
            if (len >= 0 && request.header("Content-Length") == null) reqHeaders.put(JSONArray().put("Content-Length").put(len.toString()))
            when {
                body.isDuplex() || body.isOneShot() -> req.put("bodyNote", "one-shot request body not captured")
                !isText(body.contentType()) -> req.put("bodyNote", "${body.contentType() ?: "binary"} body not captured").put("bodySize", len)
                len > maxBodyBytes -> req.put("bodyNote", "request body larger than ${maxBodyBytes} bytes not captured").put("bodySize", len)
                else -> try {
                    val buf = Buffer()
                    body.writeTo(buf)
                    req.put("bodySize", buf.size)
                    req.put("body", buf.readString(charsetOf(body.contentType())))
                } catch (e: Exception) {
                    req.put("bodyNote", "request body not captured: ${e.message}")
                }
            }
        }
        req.put("headers", reqHeaders)
        Netscope.emit(req.toString())

        val response = try {
            chain.proceed(request)
        } catch (e: IOException) {
            Netscope.emit(
                JSONObject()
                    .put("t", "err")
                    .put("id", id)
                    .put("ms", elapsed(t0))
                    .put("error", "${e.javaClass.name}: ${e.message}")
                    .toString(),
            )
            throw e
        }

        val resp = JSONObject()
            .put("t", "resp")
            .put("id", id)
            .put("status", response.code)
            .put("message", response.message)
            .put("protocol", response.protocol.toString())
            .put("ms", elapsed(t0))
            .put("headers", headersJson(response.headers))
        val body = response.body
        if (body != null) {
            val ct = body.contentType()
            val len = body.contentLength()
            when {
                ct != null && ct.subtype.equals("event-stream", ignoreCase = true) ->
                    resp.put("bodyNote", "event stream not captured")
                !isText(ct) && ct != null -> resp.put("bodyNote", "$ct body not captured").put("size", len)
                else -> try {
                    val peeked = response.peekBody(maxBodyBytes)
                    val bytes = peeked.bytes()
                    val text = String(bytes, charsetOf(ct))
                    resp.put("body", text)
                    resp.put("size", if (len >= 0) len else bytes.size.toLong())
                    if (bytes.size.toLong() >= maxBodyBytes && len != bytes.size.toLong()) {
                        resp.put("truncated", true)
                        resp.put("bodyNote", "body cut at $maxBodyBytes bytes")
                    }
                } catch (e: Exception) {
                    resp.put("bodyNote", "body not captured: ${e.message}")
                }
            }
        }
        Netscope.emit(resp.toString())
        return response
    }

    private fun headersJson(headers: Headers): JSONArray {
        val arr = JSONArray()
        for (i in 0 until headers.size) {
            val name = headers.name(i)
            val value = if (redactHeaders.any { it.equals(name, ignoreCase = true) }) "••••" else headers.value(i)
            arr.put(JSONArray().put(name).put(value))
        }
        return arr
    }

    private fun elapsed(t0: Long) = (System.nanoTime() - t0) / 1_000_000

    private fun isText(ct: MediaType?): Boolean {
        if (ct == null) return true
        if (ct.type.equals("text", ignoreCase = true)) return true
        val sub = ct.subtype.lowercase()
        return sub.contains("json") || sub.contains("xml") || sub.contains("html") ||
            sub.contains("javascript") || sub.contains("x-www-form-urlencoded") || sub.contains("graphql")
    }

    private fun charsetOf(ct: MediaType?): Charset = ct?.charset(Charsets.UTF_8) ?: Charsets.UTF_8
}
