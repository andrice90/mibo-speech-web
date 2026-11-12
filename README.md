# Mibo (hybrid): speech practice that keeps a child's results on the device

Mibo is a friendly animated character who leads short speech-practice lessons for young children, with a grown-up sitting alongside. This is the web (PWA) version, built for the **#BuildHybridAI 2026** hackathon. All of its AI goes through **Firebase AI Logic**, split between the model inside the browser and Gemini in the cloud.

Mibo is an educational practice companion. It does not diagnose or treat, and it is not a replacement for a speech-language pathologist.

## Why hybrid

A record of how a small child's speech practice is going is exactly the kind of data that should not leave the family's device. So the split is by sensitivity:

| Job | Where it runs | Firebase AI Logic mode | What goes in |
|---|---|---|---|
| **Parent notes**: reads the practice log and writes how it is going | On the device (Gemini Nano) | `ONLY_ON_DEVICE` | The practice log. It is never sent anywhere. |
| **Mibo's reply** after each try | On the device where the browser has a model, cloud otherwise | `PREFER_ON_DEVICE`, fallback `gemini-3.5-flash-lite` | Lesson state only: target word, how the try went, attempt number |
| **New lesson plans** | Cloud | `gemini-3.8-flash` | The short topic the grown-up typed or accepted |
| **Mibo's voice** for new lines | Cloud | `gemini-3.1-flash-tts-preview` (voice Leda) | Mibo's own line, or a lesson line the grown-up approved |

The two halves meet in one loop: the on-device model turns private results into a few short, harmless lesson ideas ("th words about the body"); the grown-up taps one; only that topic goes to the cloud, which writes and voices a new lesson.

On a browser with no built-in model (phones, Safari, Firefox), replies fall back to the cloud automatically. The parent notes do not: the grown-up is shown what would be sent (words and counts; no audio, no name) and chooses each time.

Listening is not an AI call at all. Each try is checked by signal processing in the browser and dropped; a child's voice is never stored or sent. The app shows where each piece ran: a tag under Mibo's reply, a tag on the notes, and a status line on the home screen.

Code map: [`src/ai/`](src/ai) holds every model call (`reply.ts`, `report.ts`, `plan.ts`, `tts.ts`, with setup in `firebase.ts`).

## Set up

You need a Firebase project. Everything here works on the no-cost Spark plan; none of the three cloud models needs billing.

1. **Create the project** in the [Firebase console](https://console.firebase.google.com/) and add a **Web app** to it.
2. **Turn on AI Logic:** AI Services > AI Logic > Get started, and choose the **Gemini Developer API**. This also enforces App Check.
3. **Copy the web config:** `cp .env.example .env.local` and fill in the six `VITE_FIREBASE_*` values from Project settings > Your apps.
4. **App Check for local testing:** set `VITE_APPCHECK_DEBUG_TOKEN=true`, run the app, copy the debug token the browser console prints, and register it under App Check > Apps > Manage debug tokens. Then put that token in `.env.local` in place of `true`, so every device you test on uses the same one.
5. **App Check for the hosted app:** register the web app with **reCAPTCHA Enterprise** under App Check and set `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`. Leave the debug token out of a public build unless you accept that anyone can read it from the page.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check and build to dist/
npm run preview    # serve the built app
```

Without `.env.local` the app still runs: the five built-in lessons play with Mibo's bundled voice and bundled replies, and the AI features say they need setup.

### On-device AI (desktop Chrome)

On-device inference needs Chrome 139 or later on a desktop, with `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled. The model is a large one-time download; the app starts it the first time you tap a lesson or ask for notes, and shows progress on the notes screen.

### Deploy

`firebase.json` is set up for Firebase Hosting:

```bash
npm run build
npx firebase-tools deploy --only hosting --project <your-project-id>
```

Microphone access needs HTTPS (or localhost), so test phones against the hosted URL.

## How it works

- **Lessons:** five built-in lessons (s and th, sh, z, rhymes, long "twisty" words) plus lessons a grown-up makes. Each try goes: Mibo models the sound, "your turn", Mibo listens, a reaction, then a live reply. The grown-up's ◀ ▶ arrows always override the listening.
- **Listening:** an acoustic check for s / th / sh / z, a word-template check for twisty words, and for made lessons, on-device speech recognition where the browser offers it (never the server-based kind).
- **Mibo:** a code-drawn, hand-drawn-style puppet on a 2D canvas, lip-synced by a small forced aligner that runs in the browser.
- **Storage:** everything is in this browser (localStorage and IndexedDB). No accounts, no server database.
- **PWA:** installable, and the built-in lessons work offline once their voice clips have been played or cached.

## What was built for the hackathon

Mibo began as an iOS/Expo app for an earlier hackathon. Reused from it: the Mibo character and puppet code, the bundled voice clips, the lesson content, and the on-device listening and lip-sync code.

Built during the submission period (from Nov 11, 2026):

- This web app: a new React + Vite PWA, with every screen rebuilt for the browser.
- Browser audio: Web Audio playback with lip-sync, and microphone capture through an AudioWorklet.
- All inference moved to Firebase AI Logic. The earlier app used other providers through its own server; this one has no server.
- Hybrid inference: on-device replies with cloud fallback, and the on-device parent notes.
- The practice log and the "Mibo's notes" screen, including the notes-to-new-lesson loop.
- App Check, Firebase Hosting config, and offline support.

## License

Apache-2.0. See [LICENSE](LICENSE).
