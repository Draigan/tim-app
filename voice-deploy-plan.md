# Voice Deployment Plan

## Goal

Let a user create a deployment from spoken words, while keeping the actual deployment write safe when customer names, asset labels, and rural addresses are uncertain.

Example command:

```text
Deploy bin 6 to 203 county rd 8 fenelon falls for the customer John Doe their number is 4162489812.
```

## Principle

Voice input should create a draft first. A draft can be saved locally while offline. A real `deployments` row should only be inserted after the app has confirmed:

- the asset exists and is still in the yard
- the customer has been matched or created
- the address has confirmed coordinates

This matters because `deployments.lat` and `deployments.lng` are required today, and Mapbox address matching cannot be trusted without an online validation step.

## Milestones

### 1. Audio capture proof - done

- Add a frontend-only recorder page.
- Use `navigator.mediaDevices.getUserMedia({ audio: true })`.
- Use `MediaRecorder` to create an audio blob.
- Save recordings locally in IndexedDB so they survive navigation.
- Let the user play back, download, and delete saved recordings.
- Do not upload audio or create deployments yet.

### 1.5. Upload and transcribe proof - done

- Add private Supabase Storage bucket `voice-deploy-audio`.
- Add `voice_deploy_drafts` table for uploaded recordings and processing status.
- Upload one saved local recording to Storage when online.
- Create a draft row for that upload.
- Invoke `process-voice-deploy` Edge Function.
- Transcribe the audio with OpenAI using the server-side `OPENAI_API_KEY`.
- Save the transcript and status back to the draft.
- Show the transcript on the Voice Deploy page.

Status as of July 10, 2026:

- Branch: `feature/voice-deploy-recorder`.
- Production route: `https://app.timberfell.ca/voice-deploy`.
- Audio recording works in the iOS PWA.
- Recordings are saved locally in IndexedDB and survive navigation.
- Uploads go to the private Supabase Storage bucket `voice-deploy-audio`.
- Processing runs through the deployed Supabase Edge Function `process-voice-deploy`.
- Transcription uses server-side `OPENAI_API_KEY` and `gpt-4o-transcribe`.
- The old transcription context prompt was removed because it biased short/quiet clips toward local terms like Fenelon Falls.
- Frontend blocks transcribing recordings under 2 seconds.
- Backend rejects very small audio files instead of returning a hallucinated transcript.

### 1.75. Parser and review draft - deployed for testing

- Use the transcript to create a structured `parse_result` on the existing `voice_deploy_drafts` row.
- Extract, but do not yet trust: asset text, customer name, customer phone, address text, and notes.
- Show an editable review panel on the Voice Deploy page.
- Suggest possible yard asset/customer matches when available.
- Run Mapbox address validation from the review step only when online.
- Do not insert into `deployments` yet.
- Do not create customers yet.
- Keep all final deployment writes behind a later explicit confirmation step.

Status as of July 10, 2026:

- `process-voice-deploy` now attempts transcript parsing after transcription.
- Parse output is stored in `voice_deploy_drafts.parse_result`.
- Parse failures keep the transcript and mark only the parse step as `parse_failed`.
- Parse uses the OpenAI Responses API with Structured Outputs and default model `gpt-5.5`.
- The Voice Deploy page now shows editable review fields for asset, customer, phone, address, and notes.
- The review page loads real `yard_assets` and `customers`; customer matches require an exact 10-digit phone match.
- The review page can check the parsed address against Mapbox and store the selected address candidate in the local reviewed draft.
- The review can be saved locally, and saved back to the Supabase draft when online.
- Existing drafts created before this deploy will not have `parse_result`; create a fresh recording to test parser output.
- Frontend access is intentionally limited to admin/superuser accounts only; owners and drivers should not see the More menu entry and should get the normal access-denied page if they manually open `/voice-deploy`.

### 2. Local pending drafts

- Store voice drafts in IndexedDB.
- Save raw transcript when speech-to-text is available.
- Save audio blob when speech-to-text is unavailable.
- Include client-generated IDs so sync can be retried safely.
- Show pending drafts in the app when the device reconnects.

Draft shape:

```json
{
  "id": "client-generated-uuid",
  "createdAt": "iso timestamp",
  "rawTranscript": "Deploy bin 6...",
  "audioBlobKey": "optional-indexeddb-key",
  "assetQuery": "bin 6",
  "addressText": "203 county rd 8 fenelon falls",
  "customerName": "John Doe",
  "customerPhone": "4162489812",
  "status": "needs_validation"
}
```

### 3. Parse command text

- Prefer deterministic parsing for the common deployment command shape.
- Extract asset text after `deploy`.
- Extract address text after `to` and before `for customer` / `for the customer`.
- Extract customer name after `customer`.
- Extract phone digits from the command.
- Preserve the raw transcript for correction.

### 4. Customer resolution

Resolve customer matches in this order:

- Exact normalized phone match: use existing customer.
- Exact phone with different spoken name: use existing customer and show a warning.
- Missing phone: block customer matching and require the user to enter a phone number.
- No phone match: create a new customer after reconnect.

Consider adding a normalized phone field such as `phone_digits` before enforcing uniqueness.

### 5. Asset resolution

- Cache yard assets locally for offline search.
- Match spoken asset text against asset label, type, size, and notes.
- Require confirmation if multiple assets match.
- Re-check `yard_assets` online before final deployment.
- If the asset was deployed by someone else while this device was offline, keep the draft pending and show the conflict.

### 6. Address resolution

- Run Mapbox geocoding only when online.
- Use the spoken address as a query, with the existing Canada/proximity settings.
- Auto-select only a high-confidence single result.
- If results are ambiguous, show the Mapbox options.
- If there is no match, keep the draft pending and allow manual correction or map pin placement.

### 7. Final deployment sync

When all required fields are confirmed:

- Insert into `deployments` with the draft's client-generated deployment ID.
- Insert or select the customer first.
- Delete active reservations for the asset if applicable.
- Send the same push notification as the current manual deploy flow.
- Mark the local draft as synced.

## Current Implementation Notes

- `src/pages/DeployAsset.jsx` currently blocks submit unless `selectedCoords` exists.
- `src/components/DeploySheet.jsx` currently disables deployment actions offline.
- `src/lib/mapbox.js` wraps Mapbox geocoding and returns candidate features.
- `src/components/CustomerPicker.jsx` already supports creating a customer, but it currently requires Supabase access.

## Open Decisions

- Whether to store pending voice drafts only on the device or also sync unresolved drafts to Supabase when online.
- Whether to add a dedicated `pending_deployments` table for admin visibility.
- Whether to transcribe uploaded audio with an Edge Function or a separate backend.
- Whether manual map pin placement is acceptable when Mapbox cannot find a rural address.
