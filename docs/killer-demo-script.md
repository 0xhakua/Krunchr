# Krunchr — 60-Second Killer Demo Script (Working Features)

**Setting:** Demo laptop already on the Krunchr login screen. Use seeded account `maria` / `Test1234!`.

**Total runtime:** ~55–60 seconds at a confident demo pace.

**Claims to avoid:** no PDF upload/OCR (2307s are typed in), no public QR verifier page, no automatic BIR submission, no live loan-officer scan.

---

## Script

**[00:00] Hook — the 8-return problem**

> Meet Maria, a freelance designer in Manila. On the 8% flat rate she owes the BIR <strong>eight separate returns a year</strong> — 2551Q, 1701Q, 1701A — each with its own deadline and rules.

**[ACTION]:** Log in as `maria` / `Test1234!` and land on the dashboard.

---

**[00:10] The dashboard — every return, in order**

> This is her tax-year roadmap. Every slot is already laid out in the exact legal sequence the BIR requires.

**[ACTION]:** Point to the 8 return slots and status badges on `/dashboard`.

---

**[00:17] One input, full-year recascade**

> Maria enters one Form 2307 withholding certificate. The engine doesn't just update one form — it <strong>recomputes the entire year</strong>.

**[ACTION]:** Go to `/income`, add a 2307 certificate, save it.

> Watch the dashboard: returns flip from Blocked → Pending → Generated as the cascade runs.

**[ACTION]:** Return to `/dashboard` and gesture through the status changes.

---

**[00:33] File — PDF + immutable receipt**

> Maria clicks File on her now-ready Q1 2551Q. Krunchr regenerates the BIR PDF, recomputes penalties under RA 11976, stores the filing package, and anchors a SHA-256 hash of that PDF on Stellar.

**[ACTION]:** Click File on the first generated return; show the filed-return card with the Stellar TX ID.

---

**[00:46] The trust unlock — verify on Stellar**

> Here's the payoff. Open `/stellar`: every filed return has a QR code that links straight to the Stellar explorer. The hash proves the PDF hasn't been altered.

**[ACTION]:** Navigate to `/stellar`, open the QR dialog, show the explorer link.

> No scanned PDF to trust. Just a cryptographic fingerprint anyone can check.

---

**[00:55] Close**

> Eight returns, one upload, handled — and every filing is backed by an immutable Stellar receipt.

**[ACTION]:** Freeze on the dashboard + Stellar receipt card. Cut to logo.

---

## One-line takeaway

Krunchr turns a full year of Philippine tax filing into one manual input, and anchors every filed return as a verifiable Stellar receipt.

## Working-feature checklist for the demo

- [ ] Seed account `maria` / `Test1234!` logs in and lands on `/dashboard`.
- [ ] Dashboard shows 8 return slots in legal sequence with status badges.
- [ ] `/income` lets you add a Form 2307 certificate manually.
- [ ] Saving the 2307 triggers recascade and updates return statuses.
- [ ] A return in `GENERATED` state can be filed.
- [ ] Filing generates the BIR PDF, stores the package, and creates a `StellarReceipt` entry.
- [ ] `/stellar` shows the receipt with a QR code linking to the Stellar explorer.
- [ ] `STELLAR_SECRET_KEY` is configured and the source account is funded (otherwise receipt status shows `FAILED`).

## Delivery tips

- Keep the mouse still after each save/file action so the state change is visible.
- Pause for 1 second after statuses flip and after the Stellar TX ID appears — these are the "ooh" moments.
- If anchoring fails on stage, note it gracefully: "Stellar is env-dependent; the filing succeeded and the receipt retries automatically."
- End with energy on the closing line; it's the phrase judges will remember.
