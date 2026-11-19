<p align="center">
  <img src="docs/mibo-wave.gif" alt="Mibo, a mint-colored friendly blob monster, waving" width="360">
</p>

<h1 align="center">Mibo</h1>

<p align="center"><strong>Short speech-practice games for young children, led by a friendly monster, with a grown-up alongside.</strong></p>

<p align="center">
  <a href="https://mibo-speech.web.app"><strong>Try it: mibo-speech.web.app</strong></a>
  ·
  Demo video: <em>link coming</em>
</p>

Mibo shows a child how to make a sound, listens to their try, and cheers them on. This is the web (PWA) version, built for the **#BuildHybridAI 2026** hackathon.

The lessons themselves use no AI. The AI is for the grown-up, and every call goes through **Firebase AI Logic**. Anything about the child's progress is handled by Gemini Nano on the device. The cloud only gets text the grown-up has read and approved. There is no server of our own.

Mibo is an educational practice companion. It does not diagnose or treat, and it is not a replacement for a speech-language pathologist.

## Try it

1. Open **https://mibo-speech.web.app** in **desktop Chrome**. To see the on-device half, turn on `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` first and restart Chrome (Chrome 139 or later).
2. Go through the three setup steps and choose **any four-digit PIN**. It is stored only in your browser.
3. **Play one lesson** (Lesson 1 is short). Say the words, or use the ▶ arrow to mark a try as done. This writes the practice log that the notes are made from; until then the notes are empty.
4. Open the **Grown-up Zone** with your PIN and ask for **Mibo's notes**. With Gemini Nano they are written on the device. The first time, Chrome has to download the model, and the app shows its progress. Without Nano, the app shows what would be sent and asks before writing the notes in the cloud. The notes say where they were written.
5. **Make a new lesson** from a suggested idea or your own words. Gemini plans it, you look it over, then Gemini voices every line. Voicing takes a minute or two on the free tier; the app waits and retries by itself when the service is busy.
6. Go back to Mibo. The new lesson is on the home screen and plays, listens and checks with no AI.

No account is needed, and the app works offline once it has loaded.

## How the AI is split

A record of how a small child's speech practice is going should stay on the family's device. So the split follows the data: the on-device model reads the practice log, and the cloud model only sees the topic and words the grown-up approves.

```
 KID ZONE (no AI)                     GROWN-UP ZONE (behind a PIN)
 ─────────────────                    ──────────────────────────────────────────────
 Lessons play bundled audio           Practice log ──▶ Gemini Nano, ON THE DEVICE
 Tries checked by signal processing                    (InferenceMode.ONLY_ON_DEVICE)
 Audio dropped after each try                          writes Mibo's notes + lesson ideas
 Practice log written by plain code                              │
        │                                                        ▼
        └──────────── log stays on the device ───▶  grown-up reviews topic + words
                                                                 │
                                                                 ▼
                                                     Gemini in the CLOUD
                                                     plans the lesson, writes cheers,
                                                     voices every line
                                                                 │
        ┌──────────── saved on the device ◀──────────────────────┘
        ▼
 New lesson plays with no AI
```

| Job | Where it runs | Firebase AI Logic | What goes in |
|---|---|---|---|
| **Mibo's notes**: how practice is going, where the child struggled, what to focus on next | On the device | `InferenceMode.ONLY_ON_DEVICE` (Gemini Nano via Chrome's Prompt API) | The practice log. It is not sent anywhere. |
| **Next lesson plan**, tuned by the notes | Cloud | `gemini-3.8-flash`, structured output with a `Schema` | A short topic and the words to bring back, both shown to the grown-up first |
| **Mibo's voice** for the new lesson | Cloud | `gemini-3.8-flash-lite-tts` (voice Leda), with `gemini-3.8-flash-tts` when the first is busy | The lesson lines the grown-up approved |

The on-device model reads the log and suggests lesson ideas, such as "s words about clothes". Plain code picks the words that took more than one go. The grown-up reviews both and sends them to the cloud, which plans the lesson, writes a cheer for each word and voices every line. The lesson is saved on the device with a listening template for each word, so the kid zone can play and check it with no AI.

If the device has no built-in model, the notes can be written in the cloud instead (`InferenceMode.PREFER_ON_DEVICE`). The app asks the grown-up every time and shows what would be sent first: counts only, with no audio and no name. Each set of notes records where it was written (`InferenceSource`).

The zones are checked in code as well as in the screens: `src/ai/firebase.ts` refuses to create a model unless the app is in the grown-up zone (`src/lib/zone.ts`). "My child is ready" locks the zone again, and so does opening any lesson.

App Check protects every AI Logic call, with reCAPTCHA Enterprise on the hosted app and a registered debug token for local testing.

## Project history

Mibo started as an iOS/Expo app and puppet animation I have been working on for a few weeks. For the #BuildHybridAI hackathon: the back-end was completely re-written to utilize Firebase hosting and AI inference. The front-end was ported to a PWA that runs best in the Chrome browser, along with multiple UI improvements and additional screens for the Lesson Review features that use on-device models.

Code map: every model call is in [`src/ai/`](src/ai): [`report.ts`](src/ai/report.ts) (notes, on device), [`plan.ts`](src/ai/plan.ts) (lesson plans), [`tts.ts`](src/ai/tts.ts) (voice), [`device.ts`](src/ai/device.ts) (Nano availability), setup and retries in [`firebase.ts`](src/ai/firebase.ts). The zones are in [`src/lib/zone.ts`](src/lib/zone.ts). The listening checks are in [`src/voice/`](src/voice) (`vad.ts`, `judge.ts`, `wordcheck.ts`).

## How listening works (no model)

- **s, th, sh, z sounds:** an acoustic check reads the opening or closing sound of each word (spectral centroid, flatness, duration) and tells the four apart.
- **Whole words** (the built-in long words, and any word in a made lesson that does not start with those sounds): the try is compared by dynamic time warping over MFCC frames against a template made from Mibo's own clip of that word.
- **Rhyming pairs:** any speech passes; the picture games are scored by the tap.

The checks are set loose, and the grown-up's ◀ ▶ arrows always override them. A child's voice is never stored or sent.

## Run it yourself

You need a Firebase project. Everything works on the no-cost Spark plan; none of the cloud models needs billing.

1. **Create the project** in the [Firebase console](https://console.firebase.google.com/) and add a **Web app** to it.
2. **Turn on AI Logic:** AI Services > AI Logic > Get started, and choose the **Gemini Developer API**.
3. **Copy the web config:** `cp .env.example .env.local` and fill in the six `VITE_FIREBASE_*` values from Project settings > Your apps.
4. **App Check for local testing:** set `VITE_APPCHECK_DEBUG_TOKEN=true`, run the app, open the grown-up zone and ask for notes or a lesson, copy the debug token the browser console prints, and register it under App Check > Apps > Manage debug tokens. Then put that token in `.env.local` in place of `true`, so every browser you test in uses the same one.
5. **App Check for the hosted app:**
   - In the Google Cloud console for the same project, enable the **reCAPTCHA Enterprise API** and create a **Website**, score-based key (no checkbox challenge) with your hosting domains.
   - Register the web app with **reCAPTCHA Enterprise** under App Check, using that key, and set `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`.
   - Once the hosted app works, turn on enforcement for Firebase AI Logic under App Check > APIs.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check and build to dist/
npm run preview    # serve the built app
npm test           # listening and WAV tests (Node 22 or later)
```

Without `.env.local` the app still runs: the five built-in lessons play in full, and the grown-up zone says that notes and new lessons need the setup.

### On-device AI (desktop Chrome)

On-device inference needs Chrome 139 or later on a desktop, with `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled. The model is a large one-time download; the app starts it when you first ask for notes and shows progress.

### Hosting (Firebase)

The build is a static site with hash routing. `firebase.json` serves `dist` with an SPA fallback to `index.html`, and makes sure `index.html`, the service worker (`sw.js`) and the manifest are never cached stale; the hashed files under `assets/` are cached for a year. Microphone access needs HTTPS, which Firebase Hosting gives you.

`.firebaserc` points at the hackathon project, `mibo-speech`. To deploy your own copy, run `firebase use --add` and pick your project instead.

Keep the App Check debug token out of the public build: put `VITE_APPCHECK_DEBUG_TOKEN=` (empty) in `.env.production.local`, which Vite reads only for `npm run build` and which overrides `.env.local`.

```bash
npm install -g firebase-tools
firebase login
npm run build
firebase deploy --only hosting
```

Before the first deploy, add both hosting domains, `YOUR-PROJECT.web.app` and `YOUR-PROJECT.firebaseapp.com`, to the reCAPTCHA Enterprise key (step 5 above). Without that, the cloud calls fail on the hosted app while the built-in lessons still play. The app does not use Firebase Auth, so there are no authorized domains to add.

`firebase emulators:start --only hosting` serves the same build locally with the same headers.

## What was built for the hackathon

Reused from the earlier iOS/Expo app (built before this hackathon): the Mibo character, puppet code and waving animation, the lesson content, the listening and lip-sync signal processing, and the bundled voice clips. Those clips were generated earlier with Gemini TTS through a different API route; they are static audio files, and nothing in this app calls that route.

Built during the submission period (from Nov 11, 2026):

- This web app: a new React + Vite PWA, with every screen rebuilt for the browser.
- The back end rewritten: the earlier app's server routes are gone, and all inference now runs through Firebase AI Logic in the browser.
- The kid zone / grown-up zone split, with the PIN gate and the code-level rule that models are only used in the grown-up zone. Lessons no longer use a model at all.
- The practice log, and Mibo's notes written from it by Gemini Nano on the device, with a cloud fallback only when the grown-up agrees.
- The notes-to-next-lesson loop: lesson ideas, words to bring back, cloud planning and voicing, and per-word templates so made lessons are checked on the device.
- Browser audio: Web Audio playback with lip-sync, and microphone capture through an AudioWorklet.
- App Check, Firebase Hosting, retries for a busy cloud, and offline support.

## Third-party notices

- **Fredoka** typeface: SIL Open Font License 1.1.
- **CMU Pronouncing Dictionary** (via the `cmu-pronouncing-dictionary` package), used for lip-sync when a lesson is voiced: Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved. Redistribution and use in source and binary forms, with or without modification, are permitted under its BSD-style license; see http://www.speech.cs.cmu.edu/cgi-bin/cmudict.
- **Firebase JS SDK**, **React**, **Vite**, **Workbox**: Apache-2.0 / MIT.

## License

Apache-2.0. See [LICENSE](LICENSE).
