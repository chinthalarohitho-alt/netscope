package io.github.chinthalarohithoalt.netscope

import android.net.LocalServerSocket
import android.net.LocalSocket
import android.os.Process
import android.util.Log
import java.io.BufferedOutputStream
import java.io.IOException
import java.util.ArrayDeque
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

/**
 * Streams captured calls to the Netscope desktop app.
 *
 * Opens an abstract local socket named `netscope_<pid>`. The desktop app finds it over adb
 * (`adb forward tcp:0 localabstract:netscope_<pid>`) and reads one JSON object per line. Nothing
 * leaves the device unless a debugging host connects, and nothing is written to logcat.
 *
 * A short backlog is kept so calls made before Netscope connected still show up.
 */
object Netscope {
    private const val TAG = "Netscope"
    const val VERSION = "1.1.0"

    /** Keep at most this many events for late-connecting clients. */
    @JvmStatic var backlogEvents = 400

    /** …and at most this many bytes of them. */
    @JvmStatic var backlogBytes = 16L * 1024 * 1024

    private val ids = AtomicLong()
    private val queue = LinkedBlockingQueue<ByteArray>(2000)
    private val backlog = ArrayDeque<ByteArray>()
    private var backlogSize = 0L
    private val clients = ArrayList<BufferedOutputStream>()
    private val newClients = LinkedBlockingQueue<LocalSocket>()

    @Volatile private var started = false

    @JvmStatic
    fun start() {
        if (started) return
        synchronized(this) {
            if (started) return
            started = true
            thread(isDaemon = true, name = "netscope-accept") { acceptLoop() }
            thread(isDaemon = true, name = "netscope-writer") { writeLoop() }
        }
    }

    internal fun nextId(): Long = ids.incrementAndGet()

    /** Queue one event (a JSON object without a trailing newline). Never blocks the caller. */
    internal fun emit(json: String) {
        if (!started) start()
        val line = (json + "\n").toByteArray(Charsets.UTF_8)
        if (!queue.offer(line)) {
            // Writer can't keep up (no client, or a slow wireless link): drop the oldest.
            queue.poll()
            queue.offer(line)
        }
    }

    private fun acceptLoop() {
        val name = "netscope_${Process.myPid()}"
        val server = try {
            LocalServerSocket(name)
        } catch (e: IOException) {
            Log.w(TAG, "could not open $name", e)
            return
        }
        while (true) {
            try {
                val s = server.accept()
                newClients.offer(s)
                // Wake the writer so the backlog is replayed right away.
                queue.offer(ByteArray(0))
            } catch (e: IOException) {
                Log.w(TAG, "accept failed", e)
                return
            }
        }
    }

    private fun writeLoop() {
        val hello = "{\"t\":\"hello\",\"pid\":${Process.myPid()},\"version\":\"$VERSION\"}\n".toByteArray()
        while (true) {
            val line = queue.take()
            // Register clients that arrived since the last event: hello, then the backlog.
            while (true) {
                val s = newClients.poll() ?: break
                val out = BufferedOutputStream(s.outputStream, 64 * 1024)
                try {
                    out.write(hello)
                    for (b in backlog) out.write(b)
                    out.flush()
                    clients.add(out)
                    // A reader thread per client notices when the host goes away.
                    thread(isDaemon = true, name = "netscope-client") {
                        try {
                            while (s.inputStream.read() >= 0) { /* ignore */ }
                        } catch (_: IOException) {
                        } finally {
                            try { s.close() } catch (_: IOException) {}
                        }
                    }
                } catch (_: IOException) {
                    try { s.close() } catch (_: IOException) {}
                }
            }
            if (line.isEmpty()) continue
            backlog.addLast(line)
            backlogSize += line.size
            while (backlog.size > backlogEvents || backlogSize > backlogBytes) {
                backlogSize -= backlog.removeFirst().size
            }
            val it = clients.iterator()
            while (it.hasNext()) {
                val out = it.next()
                try {
                    out.write(line)
                    if (queue.isEmpty()) out.flush()
                } catch (_: IOException) {
                    it.remove()
                }
            }
        }
    }
}
