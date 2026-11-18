# Security

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Email the
repository owner with a description, reproduction steps, and potential impact.

## What Edge Guard enforces

- The agent supplies only a tool name, arguments and a reason. Sensitivity,
  reversibility, egress and fanout come from the tool registry, never from the agent.
- Rules run before any model: the egress rule, hard rules (restricted data that cannot
  be undone is blocked; unknown tools are the worst case), the fanout rule and the fast
  path. Model output cannot downgrade them.
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
  phone paired in the console.
- The audit log in Cloud Firestore is append-only by security rule. App Check is
  enforced for Firestore and Firebase AI Logic.
- Hosting sends a Content Security Policy, `frame-ancestors 'none'` and
  `X-Frame-Options: DENY`, so the approval controls cannot be framed.

## Known boundaries

- The planner, guard, signer and executor run in one page. The receipt signature
  proves the executor checks Edge Guard's receipts, not that the signer is isolated
  from the agent. Phone approvals are the exception.
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
