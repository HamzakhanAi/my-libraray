<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/b8d10263-9503-4072-97a9-4ef04830d2d5

## Run Locally

**Prerequisites:** Node.js, Python 3, and `espeak-ng`


1. Install dependencies:
   `npm install`
2. Install the local Kokoro worker dependencies:
   `python3 -m pip install -r requirements-kokoro.txt`
3. On macOS, install `espeak-ng` if it is not already available:
   `brew install espeak-ng`
4. Optional: set `GEMINI_API_KEY` in [.env.local](.env.local) if you want the AI study sidebar features.
5. Optional: set `KOKORO_PYTHON_BIN` in [.env.local](.env.local) if your Python executable is not `python3`.
6. Run the app:
   `npm run dev`

## Text To Speech

Text to speech now runs only through a local `hexgrad/kokoro` worker.

- The library `Generate Book Audio` button preloads the entire book into a persistent local audio cache.
- In the reader, clicking any paragraph moves the narration start point to that paragraph.
- Pressing play starts from the selected paragraph only after the matching Kokoro voice has been preloaded.
- There is no browser speech fallback or alternate TTS model in the playback path.

## Desktop App

The repo now includes an Electron desktop shell and a custom app icon source at `desktop/icons/icon.svg`.

1. Install the web app dependencies:
   `npm install`
2. Run the desktop shell locally:
   `npm run desktop`
3. Build the standalone macOS app bundle:
   `npm run desktop:dist`
4. Open the packaged app from:
   `release/mac-arm64/Lumen Reader.app`

Important notes:

- The packaged app still launches the local Kokoro Python worker, so Python 3, `espeak-ng`, and `requirements-kokoro.txt` are still required on the Mac where you run it.
- The current packaging target is macOS `arm64` directory output. It builds an `.app` bundle inside `release/mac-arm64/` rather than a signed installer.
