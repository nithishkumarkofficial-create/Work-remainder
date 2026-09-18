# Work Reminder — Android / iOS app

A real mobile app (not a website wrapper) that schedules reminders **with the
phone's own operating system**. Once you add a task, Android/iOS itself holds
the alarm — the app doesn't need to be open, doesn't need a network connection,
and reminders survive the app being closed and the phone being restarted (they
only need the phone itself to be switched on).

Includes: task creation dates, and a **Reports** tab with completion stats
and a shareable text report.

---

## Get the APK without installing anything (recommended)

Building an Android app normally needs the Android SDK + Gradle installed on
your computer. Instead, this project includes a **GitHub Actions** workflow
that builds the APK entirely on GitHub's own servers — which already have
everything needed pre-installed. You only need a free GitHub account and a
web browser. No Node.js, no Android Studio, nothing to install locally.

### Steps

1. Go to **https://github.com** and sign up for a free account if you don't
   already have one.
2. Click the **+** icon (top right) → **New repository**. Name it anything,
   e.g. `work-reminder`. Leave it Public or Private, either works. Click
   **Create repository**.
3. On the new repo's page, click **uploading an existing file** (or
   **Add file → Upload files**).
4. Open the `project` folder from the zip you downloaded, select **all**
   files and folders inside it (including the hidden `.github` folder — on
   Windows, make sure "Show hidden items" is on in File Explorer's View tab
   so you can see and select it), and drag them into the GitHub upload box.
5. Scroll down, click **Commit changes**.
6. Click the **Actions** tab at the top of the repo. You should see a
   workflow run called "Build Android APK" already running (it starts
   automatically the moment you upload). If you don't see it start, click
   **Build Android APK** on the left, then **Run workflow** → **Run workflow**.
7. Wait 3–6 minutes. Refresh the page — when the run shows a green checkmark,
   click into it.
8. Scroll to the bottom **Artifacts** section and click **WorkReminder-apk**
   to download a zip containing your `app-debug.apk`.
9. Transfer that APK to your phone (email it to yourself, Google Drive,
   WhatsApp, USB cable — any method) and tap it to install. Android will warn
   about installing from outside the Play Store — allow it for this file.

That's the whole process — every future change you make to the `www/` folder
just needs to be re-uploaded (or pushed with `git` if you learn it later) and
GitHub rebuilds the APK automatically again.

**If the build fails:** click into the red ✕ run and open the failed step to
read the error — it's almost always a typo in an uploaded file. Feel free to
paste the error back to me and I'll fix it.

---

## Alternative: build it yourself locally

If you'd rather build on your own PC (e.g. no reliable internet for GitHub,
or you want faster iteration), see **[BUILD-LOCAL.md](BUILD-LOCAL.md)** for
the Android Studio route, and the iOS section below.

---

## iOS (best effort — needs a Mac)

Apple only allows building and signing iOS apps on **macOS with Xcode** —
there's no cloud shortcut for this the way GitHub Actions covers Android,
because Apple requires Apple-signed hardware for the build step. If you have
access to a Mac:

```bash
npm install
npx cap add ios
npx capacitor-assets generate --ios
npx cap sync ios
npx cap open ios
```

Then in Xcode: sign in with your Apple ID, select your device, click Run.
A free Apple ID installs the app on your own iPhone for 7 days at a time
(re-run from Xcode to renew); the paid Apple Developer Program ($99/year)
removes that limit. Without any Mac access, this path isn't available —
the Android APK above is the one to use.

---

## Using the app

| Feature | What it does |
|---|---|
| **+ button** | Add a task: title, due time, lead time, notes, priority, repeat |
| **Tap any task** | Edit it — shows when it was created, pre-fills the form |
| **Checkbox** | Mark done — cancels its pending native alarms, logs it to history |
| **Repeat: Every day / Weekdays** | Scheduled as a genuine recurring OS alarm |
| **Reports tab** | Completion stats and task list for Today / This week / This month / All time |
| **Share report** | Builds a plain-text summary and opens your phone's share sheet |
| **End-of-day log (Settings)** | Recurring nudge 30 min before your cut-off time, and at the time itself |
| **Send test notification** | Fires in 3 seconds — confirms permissions right after install |

### First launch

The app asks for notification permission immediately — allow it. On
Android 12+ it may also prompt about "exact alarms" — allow that too, or
reminders could arrive a few minutes late.

### Where your data lives

Everything (tasks, settings, history) is stored on-device via Capacitor's
Preferences API — nothing leaves your phone, no server, no account.

---

## Troubleshooting

**Notification doesn't arrive** — check Settings → Apps → Work Reminder →
Notifications is enabled, and that battery optimization isn't "restricted"
for the app (Xiaomi, Oppo, Vivo phones are aggressive about killing
background alarms — look for an "autostart" or "no restrictions" setting).

**GitHub Actions build fails on the Gradle step** — usually a transient
network hiccup on GitHub's side; click **Re-run all jobs** on the failed run.

**Want to change something later** — edit files under `www/`, re-upload them
to the same GitHub repo (drag the changed files into the repo page, commit),
and the workflow rebuilds automatically.
