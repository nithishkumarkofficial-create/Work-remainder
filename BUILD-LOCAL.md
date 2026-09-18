# Building locally with Android Studio (optional)

Use this only if you'd rather build on your own PC instead of the GitHub
Actions route in the main README.

### Prerequisites (all free)

1. **Node.js** (v18+) — https://nodejs.org
2. **Android Studio** — https://developer.android.com/studio (its setup
   wizard installs the Android SDK and platform tools for you)

### Steps

```bash
npm install
npx cap add android
npx capacitor-assets generate --android
npx cap sync android
npx cap open android
```

The last command opens Android Studio with the project loaded. Once it
finishes indexing and Gradle syncing:

- **Build → Build Bundle(s) / APK(s) → Build APK(s)**
- Find the result at `android/app/build/outputs/apk/debug/app-debug.apk`

Or plug your phone in via USB (with Developer options → USB debugging on)
and click the green **Run ▶** button to install and launch directly.

### Making changes later

Edit files in `www/`, then re-run:

```bash
npx cap sync android
```

and rebuild in Android Studio. You don't need to repeat `npm install` or
`cap add android`.
