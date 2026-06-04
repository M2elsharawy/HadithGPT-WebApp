# Smart Audio Processor — معالج الصوت الذكي

> **This is Smart Audio Processor** — a browser-based audio enhancement tool specialized for
> Quran recitation, prayer recordings, and mosque audio.
> It is **not** a chatbot and has no connection to any HadithGPT conversational AI project.

---

## Overview

Smart Audio Processor cleans and enhances audio recordings directly in the browser.
All DSP (noise reduction, de-reverb, normalization, silence removal) runs **client-side**
via the Web Audio API — your audio never leaves your device.

---

## Current Release Mode: Client-Only Beta

The recommended way to run this project today is **client-only mode**.

| Feature area | Status |
|---|---|
| File upload + waveform display | ✅ Client-only |
| Playback + trimmer | ✅ Client-only |
| Silence remover | ✅ Client-only |
| Audio enhancer (noise reduction, de-reverb, normalization) | ✅ Client-only |
| Original / enhanced A–B comparison | ✅ Client-only |
| WAV and MP3 export | ✅ Client-only |
| Transcription (Web Speech API) | ✅ Client-only |
| Processing history | ✅ localStorage |
| User accounts / cloud storage | ⚠️ Backend not production-ready |
| S3 upload / cloud job queue | ⚠️ Backend not production-ready |

Backend features (authentication, cloud storage, job queue) exist in the codebase but are
**not release-ready** on Vercel. The Vercel deployment has no `api/` serverless directory,
so all `/api/*` routes return 404. Do not advertise backend capabilities in this release.

---

## Enabling Client-Only Mode

Set this environment variable before building or running the dev server:

```
VITE_CLIENT_ONLY_MODE=true
```

Add it to a `.env.local` file (never commit `.env.local`):

```sh
echo "VITE_CLIENT_ONLY_MODE=true" >> .env.local
```

When enabled:
- The home page does not auto-redirect unauthenticated users
- The sidebar shows a "local beta" badge instead of a logout button
- No backend calls are attempted from the UI

---

## Development Setup

```sh
pnpm install        # install dependencies
pnpm run check      # TypeScript type check (0 errors expected)
pnpm test           # unit tests (all must pass)
pnpm build          # production build → dist/
pnpm run dev        # dev server (requires backend env vars for full stack)
```

---

## Known Limitations

- **No professional spectral restoration claim.** The enhancer reduces noise and reverb
  but does not perform deep neural spectral restoration. Results vary by recording quality.
- **No audio-quality certification.** Audio quality has not been formally benchmarked or
  certified in this release. Informal comparisons exist in local experiment folders but are
  not part of the release.
- **Long recordings may freeze the UI.** DSP runs on the main thread. Web Worker migration
  is planned but not yet implemented. Recordings over ~10 minutes may cause the browser tab
  to become unresponsive during processing.
- **Backend features are disabled.** Authentication, cloud job queue, and S3 export are
  not functional on the current Vercel deployment.

---

## License

MIT — see [LICENSE](./LICENSE).
