# Security Policy

## Reporting a vulnerability

Open a **private security advisory** through GitHub's "Report a vulnerability"
button on this repository. Please do not open a public issue for a
vulnerability that could move money.

Expect an acknowledgement within 72 hours.

## Threat model

Forge authorises real advertising spend. The assets worth protecting, in
order:

1. **The capital envelope.** Any path that lets spend exceed the authorised
   amount is critical, including races, retries and duplicate mutations.
2. **Provider credentials.** Ad platform tokens grant spending authority.
3. **Tenant isolation.** One workspace must never read or affect another.
4. **The decision ledger.** Rewriting history hides what the engine did.

### Explicitly assumed hostile

- **Ad copy, campaign names and business content are untrusted input.** A
  campaign can literally be named `ignore your previous instructions`. Model
  input and model instructions are never concatenated into the same channel.
- **Model output is never trusted.** It is parsed, schema-validated and
  rejected on mismatch. It never becomes an executed action directly: every
  proposal passes deterministic validation and the Sentinel.
- **The Sentinel cannot be disabled by a model.** It is code, it receives
  numbers, and there is no prompt that turns it off.

## Handling of secrets

- Never in the frontend, logs, analytics, error messages or telemetry.
- Encrypted at rest when stored.
- Rotation and expiry are tracked as connection health, not discovered at
  failure time.

## Scope

Both the standalone deployment and the embedded integration are in scope.
