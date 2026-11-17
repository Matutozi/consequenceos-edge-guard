# Security

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Email the
repository owner with a description, reproduction steps, and potential impact.

## Prototype boundaries

- AI output is untrusted and schema-validated before policy evaluation.
- The deterministic policy engine owns the final allow, approval, or deny result.
- The browser receipt currently uses a SHA-256 digest. It proves integrity only
  when compared with the original payload; it is not an identity signature.
- The prototype does not execute the proposed external action.
- Firebase App Check must be enforced before the AI feature is shared publicly.
- App Check debug tokens, environment files, credentials, and private keys must
  never be committed.
