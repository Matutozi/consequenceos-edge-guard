# #BuildHybridAI submission checklist

Deadline: **Monday, November 30, 2026 at 11:00 PM WAT (Lagos)**. Internal target:
**Sunday, November 29**.

This file is deliberately tracked so collaborators and judges can see the build
status. Never put credentials, debug tokens, or private submission answers here.

## Build

- [x] Create a separate public repository.
- [x] Add a visible Apache 2.0 licence.
- [x] Build a Web/Chrome interface.
- [x] Call Firebase AI Logic from application code.
- [x] Prefer Gemini Nano on-device with Firebase cloud fallback.
- [x] Display the actual inference source.
- [x] Request structured output on both inference paths.
- [x] Add deterministic allow, approval, and deny policy decisions.
- [x] Produce a downloadable decision receipt with a verifiable SHA-256 digest.
- [x] Add automated policy tests.
- [ ] Create the Firebase project and register the Web app. **Owner action**
- [ ] Add local Firebase values to `.env.local`. **Owner action**
- [ ] Enable AI Logic with the Gemini Developer API. **Owner action**
- [ ] Register reCAPTCHA Enterprise and enforce App Check. **Owner action**
- [ ] Register the localhost App Check debug token. **Owner action**
- [ ] Confirm one `ON_DEVICE` request in Chrome 139+.
- [ ] Confirm automatic `IN_CLOUD` fallback.
- [ ] Add named human approval and signed ConsequenceOS receipt verification.

## Quality and security

- [x] Keep `.env` files and Firebase debug artifacts out of Git.
- [x] Validate the model response before policy evaluation.
- [x] Keep final enforcement deterministic rather than model-controlled.
- [ ] Test keyboard and mobile layouts in a real browser.
- [ ] Run `npm test`, `npm run lint`, and `npm run build` before every demo recording.
- [ ] Verify no secrets or App Check debug tokens are present in Git history.
- [ ] Review dependency audit output and resolve material findings.

## Deployment

- [ ] Create a Firebase Hosting site.
- [ ] Configure production reCAPTCHA Enterprise authorized domains.
- [ ] Deploy the production build.
- [ ] Test the public URL in a clean Chrome profile.
- [ ] Add the public URL to the repository About section.

## Demo video — maximum 3 minutes

- [ ] Write a concise script.
- [ ] Show the problem in the first 20 seconds.
- [ ] Demonstrate a routine action proceeding.
- [ ] Demonstrate a consequential action requiring approval.
- [ ] Demonstrate a dangerous action being blocked.
- [ ] Show `ON_DEVICE` and explain cloud fallback.
- [ ] Show the Firebase AI Logic call in source code.
- [ ] Show or mention enforced App Check.
- [ ] Upload publicly to YouTube with English audio or subtitles.

Suggested timing:

| Time | Segment |
| --- | --- |
| 0:00–0:20 | The unlimited-agent-authority problem |
| 0:20–0:45 | Edge Guard and the hybrid architecture |
| 0:45–1:45 | Live routine, consequential, and dangerous actions |
| 1:45–2:20 | On-device inference, cloud fallback, and App Check |
| 2:20–2:45 | Policy enforcement and decision receipt |
| 2:45–3:00 | Impact and next step |

## Devpost submission

- [ ] Select **Web (Chrome)** as the platform.
- [ ] Add the public GitHub repository URL.
- [ ] Add the hosted application URL.
- [ ] Add the public YouTube demo URL.
- [ ] Explain exactly how Firebase AI Logic is called.
- [ ] Explain the on-device benefit: privacy, latency, offline capability, and cost.
- [ ] Explain the cloud benefit: availability on unsupported devices.
- [ ] Include the existing-work disclosure from the README.
- [ ] Add screenshots showing proposal, decision, and inference source.
- [ ] Confirm the submission is visible before the deadline.

