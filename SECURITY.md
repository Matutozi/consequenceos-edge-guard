# Security

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Email the
repository owner with a description, reproduction steps, and potential impact.

## What Edge Guard enforces

- The agent supplies only a tool name, arguments and a reason. Sensitivity,
  reversibility, egress and fanout come from the tool registry, never from the agent.
- Rules run before any model: the egress rule, hard rules (restricted data that cannot
  be undone is blocked; unknown tools are the worst case), the fanout rule, the fast
  path, and a rule that sends any call addressing the assessor to a person. Model output cannot downgrade them.
- AI output is untrusted and schema-validated. A deterministic policy function, not the
  model, decides allow, approval or block.
- No cloud model sees a call on confidential or restricted data. Without Gemini Nano,
  such a call goes to a person. An allow from Gemini Nano needs a cloud second opinion.
- Anything that cannot be assessed (timeout, offline, missing model, invalid answer)
  goes to a person.
- Every decision is a receipt with a SHA-256 digest over canonical JSON, signed with a
  non-extractable ECDSA P-256 key. The executor refuses a missing, tampered, reused or
  wrongly signed receipt, a receipt for other arguments, a denied call, and an escalated
  call without a valid approval.
- Phone approvals are signed with a key in Android Keystore and accepted only from a
  phone paired in the console. The phone shows only what it signs: it recomputes the
  receipt's digest, checks the run's signature and that the call was escalated, and builds
  the screen from the receipt, never from the unsigned copies of the call beside it.
- The audit log in Cloud Firestore is append-only by security rule. Each entry's outcome
  and approval are signed by the run's key, and entries take random IDs, so an entry
  written first by someone else can neither block the genuine one nor pass verification.
  Verify reads every entry for a receipt ID, up to 1,000, so junk that sorts first cannot
  hide the genuine one; past 1,000 it fails the receipt as flooded rather than show a subset.
- The extension approves what a form will send, not just the button: a form changed while
  the person decides (values, hidden fields, where it sends) is not sent, and an allowance
  covers only the replayed click itself.
- The planner is told only that a call was refused, never which rule refused it. App Check is
  enforced for Firestore and Firebase AI Logic.
- Hosting sends a Content Security Policy, `frame-ancestors 'none'` and
  `X-Frame-Options: DENY`, so the approval controls cannot be framed.

## Known boundaries

- The extension's approval window is out of reach of the page and of an agent working
  through the page, not of an agent that drives the whole browser or computer: those can
  press Allow like a person. The window says so when Chrome reports automation.

- The planner, guard, signer and executor run in one page. The receipt signature
  proves the executor checks Edge Guard's receipts, not that the signer is isolated
  from the agent. Phone approvals are the exception: a page that holds the run's key can
  still ask the phone to approve a dangerous call, but the phone shows that call as it is.
- The phone's Keystore key does not require the user to unlock it or use a biometric to
  sign, and the console cannot check by key attestation that the key is in Keystore.
- There is no sign-in. The audit log, including call arguments, is readable by anyone,
  and anyone with an App Check token can append a run signed with their own key. The
  demo data is fictional.
- The Android app uses the App Check debug provider, with its token set at build time.
  Anyone holding a built APK can extract that token, so do not distribute the APK
  publicly, and revoke the token in the Firebase console when the demo period ends.
- Receipts do not expire; single use is tracked per run in memory.

See "Known limitations" in the README for the full list.

## Never commit

App Check debug tokens, `.env` files, `android/local.properties`, credentials, and
private keys.
