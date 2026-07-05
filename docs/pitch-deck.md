# Krunchr — Hackathon Pitch Deck

> APAC Stellar Hackathon 2026 · Local Finance & Real World Access track
> One slide per section, `---` separates slides. Speaker notes follow each slide.
> A readable recording script is included at the end of this file.
>
> **Generated outputs:**
> - `pitch-deck.html` — browser-based 16:9 slide deck with keyboard navigation and speaker notes.
> - `pitch-deck-Krunchr.pptx` — PowerPoint version with brand styling and the SVG logo rendered inline.
> - `logo-{colored,white,dark}-pptx.png` — logo renders used inside the PPTX.

---

## Slide 1: Title

# Krunchr

**Compliance Engine — Philippine tax filing, automated.**

Track: Local Finance & Real World Access
Team: `[PLACEHOLDER: Team name / members]`
Contact: `[PLACEHOLDER: contact]`

![Placeholder: Krunchr logo on the brand teal-and-mint canvas, wordmark "Krunchr / Compliance Engine"](placeholder-image.png)

**Speaker notes:** This is Krunchr — a compliance engine that takes one of the most anxious chores a Filipino freelancer faces, filing their BIR taxes, and turns it into something that just feels handled. We're pitching in the Local Finance and Real World Access track because the problem we're solving is local first: the Philippine tax system. I'm `[name]`, and over the next few minutes I'll show you why this matters, what we built, and where it's going.

---

## Slide 2: Problem

- A Filipino freelancer on the 8% flat rate owes **up to 8 BIR returns a year** — 2551Q ×4, 1701Q ×3, 1701A — in a strict legal order, each with its own deadline.
- The rules interact badly: the 8% election is **irrevocable** for the year; mixed-income earners lose the ₱250,000 exemption; penalties changed under RA 11976; due dates roll past Philippine holidays.
- One wrong sequence or a missed deadline → **surcharge, daily interest, compromise penalties**, and a black mark that banks and embassies ask about later.
- Once filed, a freelancer just has a **scanned PDF**. There's no quick, trustworthy way for a bank, embassy, or auditor to confirm a return was actually filed and never altered. [confirmed: SPEC.md Overview & Business Rules BR-01–BR-18]

**Speaker notes:** Here's the pain. A self-employed freelancer in the Philippines on the 8% flat rate isn't filing one form — they're filing up to eight, every year, in a legally-mandated order, each with a different deadline. The rules interact in nasty ways: the 8% election locks for the whole year, mixed-income earners lose a 250,000-peso exemption, and the penalty rates literally changed under new legislation. Get the sequence or a deadline wrong and you owe surcharge, interest, and a compromise penalty — and you carry a mark that banks and embassies will ask about. And once you do file, all you have to prove it is a scanned PDF that anyone could have edited. This is a problem of complexity and trust, and it hits people who can't afford an accountant every quarter.

---

## Slide 3: Solution

**Krunchr turns eight confusing BIR returns into one upload.**

- Upload your Form 2307 withholding certificates → Krunchr **recomputes your whole tax year**, every return, in the correct legal sequence. [confirmed: recascade engine `lib/computation/recascade.ts`]
- **Correct by construction**: 8% rules, RA 11976 penalty rates, holiday-aware due dates, and the mixed-income exemption rule are all enforced in the engine — not left to the user. [confirmed: `lib/computation/*`, BR-13/BR-15]
- Every filed return becomes a **tamper-evident receipt** any bank, embassy, or auditor can verify in seconds. [confirmed: `lib/stellar/anchor.ts`, `lib/stellar/verify.ts`]
- One-click **filing package**: all return PDFs, the SAWT summary, and a cover sheet, bundled and ready. [confirmed: `/api/filing-package/download`]

**Speaker notes:** Our solution is one sentence: Krunchr turns eight confusing returns into one upload. You drop in your Form 2307 withholding certificates, and the engine recomputes your entire tax year — every return, in the exact order the BIR requires. The correctness is built into the engine, not left to the user: the 8% rules, the new RA 11976 penalty rates, holiday-aware due dates, and the rule that mixed-income earners lose the 250k exemption. Each filed return becomes a tamper-evident receipt that a bank or embassy can verify in seconds instead of trusting a scanned PDF. And the whole package — every form, the SAWT, a cover sheet — downloads in one click.

---

## Slide 4: Demo

**Core flow (the single demo moment):**

1. Maria finishes a 3-minute onboarding (TIN, RDO, tax codes).
2. She uploads her Form 2307 certificates → the dashboard lights up.
3. All 8 returns compute in sequence; statuses go Blocked → Pending → Generated → Filed.
4. She files a return → a Stellar transaction ID and a scannable QR appear.
5. She hands her phone to a "loan officer" who scans it → compliance confirmed in ~30 seconds.

![Placeholder: screen recording of the dashboard — filing roadmap all green, a 2307 upload, a filed return card showing a Stellar TX ID and QR](placeholder-image.png)

[PLACEHOLDER: Demo video — ~60–90 seconds: onboarding → upload 2307 → returns compute → file one → show QR / verification. End on the green dashboard and the on-chain receipt.]

**Speaker notes:** Here's the moment the whole product is built around. Maria finishes a three-minute onboarding, then uploads her Form 2307 certificates. The dashboard lights up — every one of her eight returns computes in sequence, and you can see statuses move from Blocked, to Pending, to Generated, to Filed. She files one return and gets a transaction ID plus a QR code. The punchline: she hands her phone to a loan officer, they scan it, and her compliance is confirmed in about thirty seconds. No BIR queue, no PDF hunting. We've left a placeholder for the screen recording — that's the flow you'll see.

---

## Slide 5: How it works

- **One app, one database, one engine.** A user uploads income; a pure computation engine figures out every return; the server generates the BIR PDF; a hash of that PDF is anchored on Stellar. [confirmed: README architecture diagram + `lib/computation/*`]
- **Money is never floating-point** — all monetary math runs through `decimal.js`, so a peso is always a peso. [confirmed: `decimal.js` dependency, AGENT.md rule]
- **Every state-changing action is logged** in an append-only audit trail — elections, filings, overpayment dispositions, anchoring retries. Nothing is silently edited or deleted. [confirmed: `AuditLog` model, `lib/audit-log/`]
- **Failure is graceful, not fatal**: if on-chain anchoring has a hiccup, the filing still succeeds and the receipt is retried later. [confirmed: SPEC.md "anchoring is decoupled", `StellarReceipt` status `FAILED` + retry]

**Speaker notes:** Here's the shape of it, without the buzzwords. It's one app with one database and one computation engine. A user uploads income, the engine figures out every return, the server generates the official BIR PDF, and a fingerprint of that PDF is anchored on-chain so it can be verified later. Two details we're proud of: we never do money in floating-point, so a peso is always a peso; and every meaningful action — an election, a filing, a retry — is written to an append-only audit log, so nothing is ever silently edited or deleted. And the design is forgiving: if the on-chain step has a hiccup, the filing still succeeds and the receipt is retried later. The user never sees a failure they have to fix.

---

## Slide 6: Impact / Market

- **Who needs this:** the millions of Filipino self-employed professionals and freelancers on the 8% flat rate who currently file manually, hire an accountant each quarter, or simply don't file and accumulate penalties. [confirmed: SPEC.md target users; market size inferred]
- **Why now:** the BIR's 8% regime, the Ease of Paying Taxes Act, and a growing freelance economy make a guided, correct-by-construction filing path genuinely useful for the first time. [inferred from SPEC.md legal citations]
- **The trust unlock:** the verifiable receipt turns a private chore into something a bank, embassy, or auditor can confirm in seconds — a real-world-access payoff, not just a developer convenience. [confirmed: SPEC.md "single demo moment"]
- **Built for the track:** local finance first (Philippine tax law done correctly), with real-world access via the verifiable receipt. [inferred: alignment with Local Finance & Real World Access track]

**Speaker notes:** Who needs this? Every Filipino freelancer on the 8% rate — there are millions of them — who today either file manually, pay an accountant every quarter, or just don't file and let penalties pile up. The timing is right: the 8% regime, the Ease of Paying Taxes Act, and a fast-growing freelance economy make a guided, correct-by-construction filing path genuinely useful for the first time. And the trust unlock is the part that fits this track: the verifiable receipt turns a private chore into something a bank, embassy, or auditor can confirm in seconds. That's real-world access, not just a developer convenience. It's local finance done correctly, with a payoff you can hand to a loan officer.

---

## Slide 7: What's next

Gaps between the SPEC and today's build, in priority order:

- **Graduated-rate path** — the 8% path is the finished demo; graduated bracket math is in the engine but the end-to-end user flow isn't. [confirmed partially built: `applyGraduatedBrackets` exists; CLAUDE.md notes 8% is the focus]
- **Mixed-income → Form 1701** — routing and the 1701 PDF template exist, but the full annual-return flow for mixed-income earners isn't complete. [confirmed partially built: `lib/pdf/templates/form-1701.tsx`]
- **VAT-threshold breach enforcement** — a warning is shown at the ₱3M line; a hard "you must register for VAT / 1701A is locked" block per BR-12/BR-17 is the next step. [confirmed partial: `lib/computation/vat-threshold.ts` warning exists; hard-block not enforced]
- **Self-serve registration** — today accounts are admin-seeded; a public sign-up flow is needed for real adoption. [confirmed: SPEC.md `/login` notes "No registration — admin account seeded only"]
- **OCR for Form 2307** — auto-read the certificate instead of typing figures. [inferred: income entry is currently manual per SPEC.md `/income` modal]
- **Mainnet anchoring + public verifier page** — move off testnet and give third parties a one-link verification page. [inferred: `STELLAR_NETWORK=testnet` in `.env.example`]

**Speaker notes:** A few honest gaps, because they're the roadmap. The 8% path is the finished demo, but the graduated-rate option — for users who don't pick 8% — only has the math in the engine; the full flow isn't done. Mixed-income earners route to a different annual form, Form 1701, and we have the template but not the finished flow. We warn at the 3-million-peso VAT threshold; the next step is a hard block that tells the user they must register for VAT. Accounts are admin-seeded today, so self-serve sign-up is on the list, and we'd love to auto-read the 2307 with a phone camera instead of typing figures. Finally, we anchor on testnet today — moving to mainnet with a public one-link verifier page is what makes the trust unlock real for banks and embassies.

---

## Slide 8: Team / Thanks

| Name | Role | Contact |
|---|---|---|
| `[PLACEHOLDER: Name]` | `[PLACEHOLDER: Role]` | `[PLACEHOLDER: Contact]` |
| `[PLACEHOLDER: Name]` | `[PLACEHOLDER: Role]` | `[PLACEHOLDER: Contact]` |
| `[PLACEHOLDER: Name]` | `[PLACEHOLDER: Role]` | `[PLACEHOLDER: Contact]` |

Project links:
- App: https://app.krunchr.xyz
- Landing page: https://krunchr.xyz `[inferred: landing page exists in repo, domain TBD]`
- Contact: krunchr@artisam.xyz

Thanks to the hackathon organizers, the Stellar community, and every Filipino freelancer who told us how filing actually feels.

![Placeholder: team photo or logo lockup](placeholder-image.png)

**Speaker notes:** I'm `[name]`, and this is the team — `[placeholder]`. You can try the app at app.krunchr.xyz, or read more on our landing page; the contact is krunchr@artisam.xyz. Thanks to the organizers, the Stellar community, and most of all the Filipino freelancers who patiently told us how filing actually feels in practice. That's Krunchr — eight returns, one upload, handled. We'd love your questions.

---

# Recording script

> A continuous, readable script for recording the pitch — ~3.5 to 4 minutes at a calm pace. Each numbered line maps to one slide. Read the lines; let the slide visuals do the rest.

**1 — Title (≈15s):**
This is Krunchr — a compliance engine that takes one of the most anxious chores a Filipino freelancer faces, filing their BIR taxes, and turns it into something that just feels handled. We're pitching in the Local Finance and Real World Access track, because the problem we're solving is local first: the Philippine tax system. I'm `[name]`, and over the next few minutes I'll show you why this matters, what we built, and where it's going.

**2 — Problem (≈35s):**
Here's the pain. A self-employed freelancer in the Philippines on the 8% flat rate isn't filing one form — they're filing up to eight, every year, in a legally-mandated order, each with a different deadline. The rules interact in nasty ways: the 8% election locks for the whole year, mixed-income earners lose a 250,000-peso exemption, and the penalty rates literally changed under new legislation. Get the sequence or a deadline wrong, and you owe a surcharge, daily interest, and a compromise penalty — and you carry a mark that banks and embassies ask about. And once you do file, all you have to prove it is a scanned PDF that anyone could have edited. This is a problem of complexity and trust, and it hits people who can't afford an accountant every quarter.

**3 — Solution (≈40s):**
Our solution is one sentence: Krunchr turns eight confusing returns into one upload. You drop in your Form 2307 withholding certificates, and the engine recomputes your entire tax year — every return, in the exact order the BIR requires. The correctness is built into the engine, not left to the user: the 8% rules, the new RA 11976 penalty rates, holiday-aware due dates, and the rule that mixed-income earners lose the 250k exemption. Each filed return becomes a tamper-evident receipt that a bank or embassy can verify in seconds instead of trusting a scanned PDF. And the whole package — every form, the SAWT, a cover sheet — downloads in one click.

**4 — Demo (≈45s):**
Here's the moment the whole product is built around. Maria finishes a three-minute onboarding, then uploads her Form 2307 certificates. The dashboard lights up — every one of her eight returns computes in sequence, and you can see statuses move from Blocked, to Pending, to Generated, to Filed. She files one return and gets a transaction ID plus a QR code. The punchline: she hands her phone to a loan officer, they scan it, and her compliance is confirmed in about thirty seconds. No BIR queue, no PDF hunting. On the slide you'll see the screen recording of exactly that flow.

**5 — How it works (≈35s):**
Here's the shape of it, without the buzzwords. It's one app with one database and one computation engine. A user uploads income, the engine figures out every return, the server generates the official BIR PDF, and a fingerprint of that PDF is anchored on-chain so it can be verified later. Two details we're proud of: we never do money in floating-point, so a peso is always a peso; and every meaningful action — an election, a filing, a retry — is written to an append-only audit log, so nothing is ever silently edited or deleted. And the design is forgiving: if the on-chain step has a hiccup, the filing still succeeds and the receipt is retried later. The user never sees a failure they have to fix.

**6 — Impact / Market (≈30s):**
Who needs this? Every Filipino freelancer on the 8% rate — there are millions of them — who today either file manually, pay an accountant every quarter, or just don't file and let penalties pile up. The timing is right: the 8% regime, the Ease of Paying Taxes Act, and a fast-growing freelance economy make a guided, correct-by-construction filing path genuinely useful for the first time. And the trust unlock is the part that fits this track: the verifiable receipt turns a private chore into something a bank, embassy, or auditor can confirm in seconds. That's real-world access, not just a developer convenience.

**7 — What's next (≈30s):**
A few honest gaps, because they're the roadmap. The 8% path is the finished demo, but the graduated-rate option only has the math in the engine; the full flow isn't done. Mixed-income earners route to a different annual form, Form 1701, and we have the template but not the finished flow. We warn at the 3-million-peso VAT threshold; the next step is a hard block telling the user they must register for VAT. Accounts are admin-seeded today, so self-serve sign-up is on the list, and we'd love to auto-read the 2307 with a phone camera. Finally, we anchor on testnet today — moving to mainnet with a public one-link verifier page is what makes the trust unlock real for banks and embassies.

**8 — Team / Thanks (≈15s):**
I'm `[name]`, and this is the team — `[placeholder]`. You can try the app at app.krunchr.xyz, or read more on our landing page; the contact is krunchr@artisam.xyz. Thanks to the organizers, the Stellar community, and most of all the Filipino freelancers who patiently told us how filing actually feels in practice. That's Krunchr — eight returns, one upload, handled. We'd love your questions.