# ConsequenceOS Edge Guard

**Know the consequence before the action.**

Edge Guard is a privacy-first execution firewall for AI agents. It evaluates an
agent's proposed action with Gemini Nano on the user's device when available,
uses Firebase AI Logic for cloud fallback, and applies deterministic policy to
allow routine work, require accountable human approval, or deny unsafe actions.

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/).

**Live demo:** <https://edge-guard-f1314.web.app> — best in Chrome Desktop 139+ with
Gemini Nano enabled; other browsers use the Firebase cloud fallback.

## Why hybrid inference matters

An execution-control system often sees sensitive intent: who will be contacted,
which account will be changed, or what production resource will be affected.
Edge Guard keeps that context on-device whenever Chrome's model is available.
Firebase AI Logic provides a consistent cloud fallback on devices where it is
not, while App Check protects the API from unauthorized clients.

The AI assesses ambiguous consequences. It never makes the final enforcement
decision. A deterministic policy engine turns the assessment and declared action
properties into one of three controls:

- `allow` — routine, reversible, low-impact work proceeds.
- `require_approval` — consequential work pauses for a human decision.
- `deny` — critical work, or work matching a hard policy rule, cannot proceed.

Some rules depend only on the declared properties, never on model output. For
example, an irreversible action on restricted data is always denied, whatever risk
the model reports.

## Current demo flow

1. Describe the agent, intended action, target, context, data class, and reversibility.
2. Firebase AI Logic requests structured risk output. Public and internal proposals
   use `InferenceMode.PREFER_ON_DEVICE`. Confidential and restricted proposals use
   `InferenceMode.ONLY_ON_DEVICE` unless the user explicitly allows cloud analysis;
   if Gemini Nano is unavailable, the analysis fails instead of falling back silently.
3. The interface reports `ON_DEVICE` or `IN_CLOUD` from the actual response.
4. The policy engine produces an execution decision.
5. The browser produces a downloadable SHA-256 decision receipt.

> The digest covers every receipt field except `digest`, serialized as JSON with
> sorted keys (`verifyReceipt` in `src/domain/receipt.ts` recomputes it). It detects
> accidental edits only: without a signature, anyone can change a receipt and
> recompute the digest. It is not a signed authorization token. Signed
> ConsequenceOS authorization receipts are listed in the roadmap and are not
> misrepresented in this prototype.

## Technology

- React 19, TypeScript, and Vite
- Firebase JavaScript SDK 13+
- Firebase AI Logic hybrid inference
- Gemini Nano through Chrome's Prompt API
- Gemini 3.5 Flash Lite as the configured cloud fallback
- Firebase App Check with reCAPTCHA Enterprise
- Vitest for deterministic policy tests

## Run locally

### Requirements

- Node.js 20+
- Chrome Desktop 139+
- A Firebase project with AI Logic enabled using the Gemini Developer API
- App Check enforced for Firebase AI Logic
- A reCAPTCHA Enterprise site key registered with the Firebase web app

### Configure Firebase

1. In the Firebase console, create or select a project.
2. Open **AI Services → AI Logic**, select **Get started**, and choose the Gemini
   Developer API.
3. Register a Web app.
4. Open **Security → App Check**, register the Web app with reCAPTCHA Enterprise,
   and confirm that App Check is enforced for Firebase AI Logic.
5. Copy `.env.example` to `.env.local` and add the Firebase web configuration and
   reCAPTCHA Enterprise site key.

Firebase configuration values identify the public Firebase project and are safe
to include in a client bundle. App Check, authorized domains, and API restrictions
provide the security boundary. Never commit an App Check debug token.

### Enable the local model

1. Update Chrome from `chrome://settings/help`.
2. Enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`.
3. Restart Chrome.
4. Confirm model availability in DevTools:

   ```js
   await LanguageModel.availability()
   ```

During local development the app asks Firebase to print an App Check debug token
in the browser console. Register that token under **App Check → Apps → Manage
debug tokens**. Do not commit or share it.

### Install and run

```bash
npm install
npm run dev
```

Open the displayed localhost URL in Chrome. The first on-device model download can
take several minutes. While it is downloading, `PREFER_ON_DEVICE` can use the
Firebase cloud fallback.

## Verify

```bash
npm test
npm run lint
npm run build
```

## Deploy to Firebase Hosting

```bash
npm run build
npx firebase-tools login
npx firebase-tools use --add
npx firebase-tools deploy --only hosting
```

Before sharing the deployment, add its domain to the reCAPTCHA Enterprise key and
verify App Check requests in the Firebase console.

## Architecture

```text
Agent action proposal
        │
        ▼
Firebase AI Logic hybrid model
   ├── Gemini Nano on device (preferred)
   └── Gemini cloud model (fallback)
        │ structured risk assessment
        ▼
Deterministic policy engine
   ├── allow
   ├── require accountable approval
   └── deny
        │
        ▼
SHA-256 decision receipt
```

## Existing work disclosure

ConsequenceOS existed before the hackathon as a separate, open-source execution-
control project. This repository is a new #BuildHybridAI application. The Web UI,
Firebase AI Logic hybrid inference path, on-device risk assessment, structured
output schema, policy adapter, and browser decision receipt in this repository
were created during the hackathon submission period. No source code is copied
from the pre-existing ConsequenceOS repository.

## Roadmap

- Human approval screen with named approver and expiry
- Signed authorization receipts verified by the receiving system
- ConsequenceOS gateway integration for real MCP tool calls
- Sensitive-field minimization before cloud fallback
- Firebase Hosting deployment and production App Check monitoring

See [docs/SUBMISSION_CHECKLIST.md](docs/SUBMISSION_CHECKLIST.md) for the remaining
hackathon work.

## License

Licensed under the [Apache License 2.0](LICENSE).

