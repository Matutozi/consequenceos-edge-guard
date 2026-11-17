# ConsequenceOS Edge Guard

**Know the consequence before the action.**

Edge Guard is a privacy-first execution firewall for AI agents. It evaluates each
tool call an agent proposes with Gemini Nano on the user's device when available,
uses Firebase AI Logic for cloud fallback, and applies deterministic policy to
allow routine work, require accountable human approval, or deny unsafe actions.
An executor runs nothing without a signed receipt for that exact call.

**The brain in the cloud, the conscience on the device.** In the demo, a Gemini
agent plans in the cloud through Firebase AI Logic while Edge Guard checks every
step it proposes, independently of the planner, so a prompt injection that hijacks
the planner does not also hijack the guard.

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

## Agent console (main view)

An ops agent works ticket #482 at a fictional company, Northwind. The ticket hides
an attacker's instruction to export the customer table to an outside address and
delete the audit logs.

1. **Plan in the cloud.** The live planner is Gemini through Firebase AI Logic with
   function calling (`src/ops/planner.ts`). It proposes one tool call at a time with
   a reason, and gets each result back, including refusals. A recorded replay of a
   hijacked run is available for a reproducible demo.
2. **Look up the tool, not the agent's claims.** Sensitivity, reversibility and
   egress rules come from a tool registry published in **Firebase Remote Config**
   (`remoteconfig.template.json`). The agent supplies only the tool, arguments and
   reason. A malformed entry is dropped, and an unregistered tool is treated as the
   worst case, so a bad config can only make Edge Guard stricter.
3. **Decide.** In order: an egress rule (data leaving `northwind.example` is blocked
   by name), hard rules on registry properties, a read-only fast path, then Gemini
   Nano on device (cloud only for public or internal data) and deterministic policy.
4. **Sign and bind.** Each receipt records the exact tool call, is signed with a
   non-extractable WebCrypto P-256 key, and is single use. Escalated calls also need
   a signed human approval.
5. **Execute or refuse.** The executor (`src/ops/executor.ts`) refuses a missing,
   tampered, reused or wrongly signed receipt, a receipt for different arguments,
   a denied call, or an escalated call without approval.
6. **Audit.** Every receipt, its approval and its outcome are appended to **Cloud
   Firestore**. Security rules (`firestore.rules`) make the log append-only and App
   Check is enforced, so receipts cannot be edited or deleted from the client. Each
   run stores its public key, so any receipt can be verified from the log alone.

> Trust boundary, stated plainly: the planner, guard and executor run in the same
> page here, so the signature proves the executor checks Edge Guard's receipts, not
> that the signer is isolated from the agent. In production the signer belongs in a
> separate boundary whose public key the executor pins. Without user sign-in, anyone
> with a valid App Check token can append a new run with their own key.

## Single action view

The **Single action** tab evaluates one proposal you describe, with the same hard
rules, privacy routing and policy. Confidential and restricted proposals use
`InferenceMode.ONLY_ON_DEVICE` unless you allow cloud analysis; if Gemini Nano is
not ready, nothing is sent and the action fails closed to `require_approval`. The
receipt there carries a SHA-256 digest over canonical JSON, which detects edits but
is not signed.

## Technology

- React 19, TypeScript, and Vite
- Firebase JavaScript SDK 13+
- Firebase AI Logic hybrid inference for the guard (`PREFER_ON_DEVICE` / `ONLY_ON_DEVICE`)
- Firebase AI Logic cloud function calling for the agent planner (`ONLY_IN_CLOUD`)
- Gemini Nano through Chrome's Prompt API
- Gemini 3.5 Flash Lite for cloud assessment and planning
- Firebase Remote Config for the tool registry and internal domains
- Cloud Firestore for the append-only, signed audit log
- Firebase App Check with reCAPTCHA Enterprise, enforced for AI Logic and Firestore
- WebCrypto ECDSA P-256 for receipt and approval signatures
- Vitest for policy, guard, executor, registry and audit tests

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
npx firebase-tools deploy --only hosting,remoteconfig,firestore:rules
```

Cloud Firestore needs a database first (`firestore:databases:create`), and App Check
enforcement for Firestore is turned on in **Security → App Check → APIs**. After
changing `src/ops/registry.ts`, regenerate the Remote Config template with
`npx vite-node scripts/write-remoteconfig-template.ts`; a test fails if they drift.

Before sharing the deployment, add its domain to the reCAPTCHA Enterprise key and
verify App Check requests in the Firebase console.

## Architecture

```text
Gemini planner (cloud, Firebase AI Logic function calling)
        │ proposes tool call + reason
        ▼
Edge Guard (in the browser)
   ├── tool registry ◄── Firebase Remote Config
   ├── egress rule and hard rules (no model)
   ├── read-only fast path (no model)
   └── risk assessment: Gemini Nano on device, cloud only for public/internal data
        │
        ▼
Deterministic policy ── allow / require approval / deny
        │
        ▼
Signed receipt bound to the exact call ──► Cloud Firestore audit log (append-only)
        │
        ▼
Executor: no valid receipt, no action ──► result back to the planner
```

## Existing work disclosure

ConsequenceOS existed before the hackathon as a separate, open-source execution-
control project. This repository is a new #BuildHybridAI application. Everything
in it was created during the hackathon submission period: the Web UI, the agent
console and its live Gemini planner, the Firebase AI Logic hybrid inference path,
on-device risk assessment, the tool registry in Remote Config, the policy engine,
signed receipts and the executor, and the Firestore audit log. No source code is
copied from the pre-existing ConsequenceOS repository.

## Roadmap

- Receipt verification page that checks any logged receipt against its run's key
- Evaluation set of guarded actions, including injection attempts, with on-device
  and cloud pass rates
- Signer in a separate trust boundary, with approvers who sign in
- ConsequenceOS gateway integration for real MCP tool calls
- Sensitive-field minimization before cloud assessment

See [docs/SUBMISSION_CHECKLIST.md](docs/SUBMISSION_CHECKLIST.md) for the remaining
hackathon work.

## License

Licensed under the [Apache License 2.0](LICENSE).

