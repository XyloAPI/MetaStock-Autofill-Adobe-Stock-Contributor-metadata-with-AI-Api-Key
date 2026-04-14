# MetaStock AI

A Chrome Extension (MV3) that helps automate Adobe Stock Contributor metadata generation and form filling.

## Features

- Floating automation panel on Adobe Stock upload pages.
- Popup controls: `Generate Current`, `Start Queue`, and `Stop`.
- Queue processing for multiple assets (with retry and skip on failure).
- Automatic form fill (replace mode) for:
  - `title`
  - `keywords`
  - `category` (when available)
- Optional Adobe toggles support:
  - Generative AI checkbox
  - No releases checkbox
- Provider support:
  - Gemini
  - Groq
- Multiple API keys per provider, with key fallback.
- Model refresh from provider endpoints.
- Language and metadata limits:
  - keyword limit toggle (default count: `49`)
  - title limit toggle
  - generate-by-AI toggle

## Project Structure

- `manifest.json` — Chrome extension MV3 configuration.
- `src/background.js` — provider API requests (Gemini/Groq), model listing, metadata normalization.
- `src/content.js` — Adobe page automation engine, queue flow, UI bridge.
- `src/content.css` — floating panel styles.
- `src/popup/*` — extension popup UI and settings logic.

## Installation (Unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder (for example: `E:\project\metastock`).
5. Reload the extension after any manifest or source updates.

## Usage

1. Open the Adobe Stock Contributor upload page (`/en/uploads`).
2. Open the extension popup.
3. Select provider (`Gemini` or `Groq`).
4. Add API key(s) (paste or import `.txt`).
5. (Optional) Click **Refresh** to load available models.
6. Configure language and limit toggles.
7. Click:
   - **Generate Current** to process only the selected asset, or
   - **Start Queue** to process all detected assets.
8. Wait until status is complete, then review and submit manually.

## Notes

- This tool depends on Adobe Stock DOM selectors. If Adobe changes the page structure, selectors in `src/content.js` may need updates.
- Keys are stored in `chrome.storage.local`.
- AI output should always be reviewed manually to comply with Adobe Stock policies.
- If queue stalls on a specific tile, the extension retries and can skip failed items to continue processing.
