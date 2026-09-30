# Netscope

A live, DevTools-style network inspector for Android apps, running on your Mac over `adb`.

- **OkHttp apps** — any app that logs through OkHttp's `HttpLoggingInterceptor` (typically debug builds) shows up with headers and bodies; `Level.BASIC` release builds show method, URL, status, time and size.
- **Chrome & debuggable WebViews** — captured through the DevTools protocol, no logging needed.
- **Browsers on your Mac** — launch Chrome, Edge, Brave or Chromium from Netscope (its own profile, so your everyday browser is untouched) and capture every tab from its first request; or attach to anything started with `--remote-debugging-port`.
- **Several devices at once** — phones (USB or Wi-Fi) and emulators, each tagged; one entry per physical device.
- **Filters** — funnels in the column headers (status, method, path, type, device, app) and a DevTools-style search: `mime:application/json`, `status:>=400`, `domain:*.example.com`, `-mime:image`, `larger-than:100k`, `is:slow` …
- **Raw logs** — the full logcat stream, or just the HTTP lines, plus a per-request Raw tab.
- **Wi-Fi pairing** — pair Android 11+ phones by QR code or pairing code, and reconnect nearby devices.
- **API client** — Postman-style collections and folders, pre-request / post-response **scripts** with the `pm` API (`pm.test`, `pm.expect`, `pm.environment.set`…, run in an isolated sandbox), Markdown **docs** per request, folder and collection, environments with `{{variables}}`, params / headers / JSON, form and raw bodies / Bearer, Basic and API-key auth (inherited from folders), a response viewer, and Postman v2.1 + cURL import/export. Any captured call opens in the client with one click.
- **Sessions & analysis** — save and open HAR files (works with Chrome DevTools, Proxyman, Charles), edit & resend a call, compare two responses line by line, a timing waterfall, and GraphQL / gRPC operation labels.
- **Built for big sessions** — 50,000+ calls stay smooth (only visible rows are drawn); old bodies are dropped past a 400 MB budget.

## Install

```bash
brew install --cask chinthalarohitho-alt/tap/netscope
```

Netscope needs `adb`. If you don't have it:

```bash
brew install --cask android-platform-tools
```

Apple Silicon Macs only. The app isn't notarized; the Homebrew cask clears the quarantine flag so it opens normally.

## Android library (optional)

Netscope works without touching your app. Add the tiny library when you want **complete** capture —
full request and response bodies with no logcat size limits, exact timings, and bodies even in builds
that don't log (for example an internal release build):

```kotlin
// settings.gradle.kts
dependencyResolutionManagement { repositories { maven("https://jitpack.io") } }

// app/build.gradle.kts — debugImplementation keeps it out of Play builds
debugImplementation("com.github.chinthalarohitho-alt:netscope:v1.1.0")
```

```kotlin
OkHttpClient.Builder()
    .addInterceptor(NetscopeInterceptor(redactHeaders = setOf("Authorization")))
    .build()
```

The interceptor opens a local socket (`netscope_<pid>`) that Netscope reads over `adb`; nothing is
sent anywhere else. If the app also logs through `HttpLoggingInterceptor`, Netscope shows each call
once. Anyone with adb access to the device can read what it captures, so only ship it in builds you're
happy to inspect.

## What it can't see

Apps that neither log their traffic nor use a debuggable WebView — most store-released apps — expose nothing over `adb`.

## Keyboard

| Keys | Action |
|---|---|
| `/` | search · `↑` `↓` move · `Esc` close |
| `⌘K` | clear · `⌘S` save HAR · `⌘O` open HAR · `R` edit & resend |
| API client: `⌘↵` | send · `⌘S` save · `⌘N` new request |

## Run from source

```bash
npm install
npm start          # Electron app
npm run serve      # or: plain server at http://localhost:9400
npm run dist       # build the DMG into dist/
npm test           # parser, library-event, HAR and API-client tests
```

## License

MIT
