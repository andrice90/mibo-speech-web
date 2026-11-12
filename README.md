# Mibo: speech practice where the child's zone has no AI and the child's results stay on the device

Mibo is a friendly animated character who leads short speech-practice lessons for young children, with a grown-up sitting alongside. This is the web (PWA) version, built for the **#BuildHybridAI 2026** hackathon. All of its AI inference goes through **Firebase AI Logic**, split between the model inside the device and Gemini in the cloud.

Mibo is an educational practice companion. It does not diagnose or treat, and it is not a replacement for a speech-language pathologist.

## Two zones

**Kid zone (lessons): no AI at all.** Mibo's voice is audio already on the device. Each try is checked by deterministic signal processing in the browser and then dropped; a child's voice is never stored or sent. The lesson writes a small practice log (the word, how many goes it took, pass or not) with plain code.

**Grown-up zone (behind a PIN): where the models are.** The grown-up chooses a four-digit PIN at first use. Inside, they read Mibo's notes and make new lessons. "My child is ready" locks the zone again, and opening any lesson locks it too. The code enforces this, not only the screens: `src/ai/firebase.ts` refuses to create a model outside the grown-up zone.

## The hybrid split

A record of how a small child's speech practice is going should not leave the family's device, so the split is by sensitivity:

| Job | Where it runs | Firebase AI Logic | What goes in |
|---|---|---|---|
| **Mibo's notes**: how practice is going, where the child struggled, what to focus on next | On the device | `ONLY_ON_DEVICE` (Gemini Nano) | The practice log. It is not sent anywhere. |
| **Next lesson plan**, tuned by the notes | Cloud | `gemini-3.8-flash` | A short topic and the words to bring back, both shown to the grown-up first |
| **Mibo's voice** for the new lesson | Cloud | `gemini-3.1-flash-tts-preview` (voice Leda) | The lesson lines the grown-up approved |

The two halves form one loop. The on-device model reads the log and suggests lesson ideas ("s words about clothes"). Plain code picks the words that took more than one go. The grown-up reviews both and sends them to the cloud, which plans the lesson, writes a cheer for each word, and voices every line. All of that is saved on the device, with a template for each word, so the kid zone can play and check the new lesson with no AI.

On a device with no built-in model, the notes can fall back to the cloud (`PREFER_ON_DEVICE`), but only when the grown-up agrees each time, after seeing what would be sent: the counts, never audio and never a name. The notes are tagged with where they were actually written.

Code map: every model call is in [`src/ai/`](src/ai) (`report.ts`, `plan.ts`, `tts.ts`, setup in `firebase.ts`). The zones are in [`src/lib/zone.ts`](src/lib/zone.ts). The listening checks are in [`src/voice/`](src/voice) (`judge.ts`, `wordcheck.ts`).

## How listening works (no model)

- **s, th, sh, z sounds:** an acoustic check reads the opening or closing sound of each word (spectral centroid, flatness, duration) and tells the four apart.
- **Whole words** (the built-in long words and any word in a made lesson that does not start with those sounds): the try is compared by dynamic time warping over MFCC frames against a template made from Mibo's own clip of that word.
- **Rhyming pairs:** any speech passes; the picture games are scored by the tap.

The checks are set loose and the grown-up's ◀ ▶ arrows always override them.

## Set up

You need a Firebase project. Everything here works on the no-cost Spark plan; none of the three cloud models needs billing.

1. **Create the project** in the [Firebase console](https://console.firebase.google.com/) and add a **Web app** to it.
2. **Turn on AI Logic:** AI Services > AI Logic > Get started, and choose the **Gemini Developer API**. This also enforces App Check.
3. **Copy the web config:** `cp .env.example .env.local` and fill in the six `VITE_FIREBASE_*` values from Project settings > Your apps.
4. **App Check for local testing:** set `VITE_APPCHECK_DEBUG_TOKEN=true`, run the app, open the grown-up zone and ask for notes or a lesson, copy the debug token the browser console prints, and register it under App Check > Apps > Manage debug tokens. Then put that token in `.env.local` in place of `true`, so every device you test on uses the same one.
5. **App Check for the hosted app:** register the web app with **reCAPTCHA Enterprise** under App Check, add your hosting domain to the key, and set `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`. Leave the debug token out of a public build unless you accept that anyone can read it from the page.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check and build to dist/
npm run preview    # serve the built app
```

Without `.env.local` the app still runs: the five built-in lessons play in full, and the grown-up zone says that notes and new lessons need the setup.

### On-device AI (desktop Chrome)

On-device inference needs Chrome 139 or later on a desktop, with `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` enabled. The model is a large one-time download; the app starts it when you first ask for notes and shows progress.

### Hosting

The build is a static site with hash routing, so any static host works (Firebase Hosting, Cloudflare Pages): build command `npm run build`, output folder `dist`, with the `VITE_*` values set as build variables. `firebase.json` is included for Firebase Hosting. Microphone access needs HTTPS (or localhost).

## What was built for the hackathon

Mibo began as an iOS/Expo app for an earlier hackathon. Reused from it: the Mibo character and puppet code, the lesson content, the listening and lip-sync signal processing, and the bundled voice clips. Those clips were generated before this hackathon with Gemini TTS through a different API route; they are static audio files, and nothing in this app calls that route.

Built during the submission period (from Nov 11, 2026):

- This web app: a new React + Vite PWA, with every screen rebuilt for the browser.
- The kid zone / grown-up zone split, with the PIN gate and the code-level rule that models are only used in the grown-up zone.
- All inference moved to Firebase AI Logic, with no server. The earlier app wrote Mibo's replies live with other providers; lessons now use no model at all.
- The practice log, and Mibo's notes written from it on the device.
- The notes-to-next-lesson loop: lesson ideas, words to bring back, cloud planning and voicing, and per-word templates so made lessons are checked on the device.
- Browser audio: Web Audio playback with lip-sync, and microphone capture through an AudioWorklet.
- App Check, hosting config, and offline support.

## Third-party notices

- **Fredoka** typeface: SIL Open Font License 1.1.
- **CMU Pronouncing Dictionary** (via the `cmu-pronouncing-dictionary` package), used for lip-sync when a lesson is voiced: Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved. Redistribution and use in source and binary forms, with or without modification, are permitted under its BSD-style license; see http://www.speech.cs.cmu.edu/cgi-bin/cmudict.
- **Firebase JS SDK**, **React**, **Vite**, **Workbox**: Apache-2.0 / MIT.

## License

Apache-2.0. See [LICENSE](LICENSE).
