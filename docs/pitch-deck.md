# Krunchr — Pitch Deck Guide

> APAC Stellar Hackathon 2026 · Local Finance & Real World Access track
> One slide per section, `---` separates slides. Speaker notes follow each slide.
> A readable recording script and a judge/investor Q&A guide are included at the end.
>
> **This guide tracks `pitch-deck-v3.pptx` (12 slides).** v3 keeps the v1/v2 story
> (problem → solution → demo → how it works) and adds three sections requested for
> the investor cut: **Stellar ecosystem impact**, an **ecosystem integration roadmap**
> (Anchors, SEP standards, Soroban, DEX), and a **go-to-market plan** at Philippines /
> APAC / Global levels. The new content is sourced from the ecosystem research saved as
> GitHub issue [webnxt-2030/krunchr#191](https://github.com/webnxt-2030/krunchr/issues/191).
>
> **Generated outputs:**
> - `pitch-deck-v3.pptx` — the current investor deck. Fully brand-styled per `BRAND.md`
>   (ambient card shadows, the "Blockchain Status: Secured" chip, logo lockup, mint
>   "Stellar-Secured" verified chip) with embedded PPTX speaker notes on every slide.
> - `pitch-deck-Krunchr.pptx` — the earlier v2 deck (8 slides, hackathon cut).
> - `pitch-deck.html` — browser-based 16:9 slide deck with keyboard navigation and speaker notes.
> - `logo-{colored,white,dark}-pptx.png` — logo renders used inside the PPTX.
> - Build scripts: `scripts/build-pitch-deck-v3-pptx.py` (v3), `scripts/build-pitch-deck-pptx.py` (v2).

---

## Slide 1: Title

# Krunchr

**Compliance Engine — Philippine tax filing, anchored on Stellar.**

*v3: from hackathon demo to a Stellar-native compliance business.*

Track: Local Finance & Real World Access
Team: `[PLACEHOLDER: Team name / members]`
Contact: krunchr@artisam.xyz

**Speaker notes:** This is Krunchr — a compliance engine that takes one of the most anxious chores a Filipino freelancer faces, filing their BIR taxes, and turns it into something that just feels handled. This is v3 of the deck: everything from v2 still stands — the problem, the working product, the demo — but we've added three things investors and the Stellar community will want to see: our impact on the Stellar ecosystem specifically, our plan to integrate existing Stellar building blocks (Anchors, SEP standards, Soroban), and a concrete go-to-market plan from the Philippines outward to APAC and global. I'm `[name]`, and I'll walk through all of it in the next few minutes.

---

## Slide 2: Problem

- A freelancer on the 8% flat rate owes **up to 8 BIR returns a year** — 2551Q ×4, 1701Q ×3, 1701A — in strict legal order.
- The rules interact badly: the 8% election is **irrevocable**; mixed-income earners lose the ₱250,000 exemption; penalties changed under RA 11976; due dates roll past Philippine holidays.
- One wrong sequence or missed deadline → **surcharge, daily interest, compromise penalties**, and a black mark banks and embassies ask about.
- Once filed, all a freelancer has is a **scanned PDF** — no quick, trustworthy way for a third party to verify it.

**Speaker notes:** Here's the pain. A self-employed freelancer in the Philippines on the 8% flat rate isn't filing one form, they're filing up to eight, every year, in a legally-mandated order, each with a different deadline. The rules interact in nasty ways: the 8% election locks for the whole year, mixed-income earners lose a 250,000-peso exemption, and the penalty rates literally changed under new legislation. Get the sequence or a deadline wrong and you owe surcharge, interest, and a compromise penalty, and you carry a mark that banks and embassies will ask about. Once you do file, all you have to prove it is a scanned PDF that anyone could have edited.

---

## Slide 3: Solution

**Krunchr turns eight confusing returns into one upload.**

- **Upload Form 2307s** → the engine recomputes your entire tax year, every return, in the correct legal sequence.
- **Correct by construction** — 8%, graduated-rate + OSD, RA 11976 penalty rates, holiday-aware due dates, and mixed-income exemption rules are enforced in code.
- **Tamper-evident receipt** — every filed return is anchored on Stellar; banks, embassies, or auditors can verify it in seconds, not trust a PDF.
- **One-click filing package** — all return PDFs, the SAWT summary, and a cover sheet, bundled and ready.

**Speaker notes:** Our solution is one sentence: Krunchr turns eight confusing returns into one upload. You drop in your Form 2307 withholding certificates, and the engine recomputes your entire tax year, every return, in the exact order the BIR requires. Correctness is built into the engine: 8% rules, graduated-rate brackets with an optional 40% standard deduction, RA 11976 penalty rates, holiday-aware due dates, and the mixed-income exemption rule. Each filed return becomes a tamper-evident receipt anchored on Stellar. And the whole package downloads in one click.

---

## Slide 4: Demo — the single demo moment

*From onboarding to verified compliance in about 30 seconds.*

1. **Onboard** — a 3-minute setup: TIN, RDO, tax codes.
2. **Upload 2307s** — withholding certificates land in the dashboard.
3. **Returns compute** — all 8 run in sequence: Blocked → Pending → Generated → Filed.
4. **File & anchor** — a Stellar TX ID and a scannable QR appear on the receipt.
5. **Verify** — a loan officer scans it; compliance confirmed in ~30 seconds.

[PLACEHOLDER: Demo screen recording — onboarding → upload 2307 → returns compute → file one → QR / verification]

**Speaker notes:** Here's the moment the whole product is built around. Onboarding takes three minutes, then the user uploads Form 2307 certificates. The dashboard lights up: all eight returns compute in sequence, moving from Blocked to Pending to Generated to Filed. Filing one return produces a Stellar transaction ID and a scannable QR code. The punchline: hand your phone to a loan officer, they scan it, and compliance is confirmed in about thirty seconds. Play the recording here.

---

## Slide 5: How it works

- **One app, one engine, one immutable receipt.** Upload income → a pure computation engine figures out every return → the server generates the BIR PDF → a SHA-256 hash of that PDF is anchored on Stellar as a `manageData` operation per return.
- **Money is never floating-point** — all math runs through `decimal.js`.
- **Append-only audit trail** — elections, filings, retries, and dispositions are logged forever.
- **Failure is graceful** — if anchoring hiccups, the filing still succeeds and retries later.
- **Today: hash-only anchoring on testnet.** The next sections cover how we deepen this into a real Stellar-native stack.

**Speaker notes:** Here's the shape of it, without the buzzwords. One app, one database, one computation engine. A user uploads income, the engine figures out every return, the server generates the official BIR PDF, and a fingerprint of that PDF is anchored on-chain. We never do money in floating point, every meaningful action is written to an append-only audit log, and failure is graceful: if anchoring hiccups, filing still succeeds and retries later. Today this is hash-only anchoring on testnet — that's exactly what the next two slides build on.

---

## Slide 6: Stellar ecosystem impact  *(new in v3)*

**A real Real-World-Access use case — and ecosystem whitespace.**

- **Non-speculative use case:** every anchored receipt is a genuine compliance event, not a trade or DeFi transaction — the kind of "real world access" Stellar's own tracks are built to reward.
- **Whitespace:** ecosystem research (issue #191) found no shipped Stellar product specifically for tax filing or government compliance — Krunchr is credible whitespace, not a me-too dApp.
- **Existing PH traction:** Stellar already has payment-rail traction in the Philippines — Coins.ph (PHP anchor since ~2017) and MoneyGram Access's PHP/USDC corridor — so we build in a market where Stellar rails are already trusted.
- **From "a hash on a ledger" to on-chain infrastructure:** the roadmap moves toward a Soroban attestation registry and portable, privacy-preserving compliance credentials.
- **Fundable:** a strong Stellar Community Fund (SCF) Build Award candidate — SCF 7.0 grants run $15K–$150K+ for exactly this kind of novel, real-world-impact use case.

**Speaker notes:** Let's talk about impact on Stellar specifically, not blockchain in general. Every receipt we anchor is a real compliance event — not a trade, not a speculative transaction. We did a deep ecosystem research pass, saved as GitHub issue #191 in our repo, and found no other shipped Stellar product doing government tax compliance. That's whitespace. The Philippines already has Stellar traction through Coins.ph and MoneyGram's PHP/USDC corridor, so we're building in a market where Stellar rails are already trusted, not starting from zero. And our roadmap takes us from a simple hash-anchor today to genuine on-chain infrastructure — which is exactly the kind of project the Stellar Community Fund's Build Award exists to fund.

---

## Slide 7: Ecosystem integration roadmap  *(new in v3)*

**Building on Stellar's existing rails, not around them.**

- **Soroban smart contracts** — an on-chain receipt-registry contract: `verify(returnId, hash) → bool`, multi-party attestation via `require_auth`, and reusable OpenZeppelin RBAC for admin roles. Upgrades a flat hash into a queryable, tamper-proof registry.
- **Anchors · SEP-24 / SEP-31** — PHP settlement via a Coins.ph-style anchor; USDC income intake from foreign clients auto-drafts an income record; a MoneyGram Access partnership for off-ramp payouts.
- **SEP-12 / SEP-45 (KYC)** — Krunchr's TIN-verified `TaxpayerProfile` already matches SEP-12's KYC field set, so we can act as a **KYC source** for anchors, plus adopt SEP-45 passkey/smart-wallet login.
- **Stellar DEX · SEP-38** — for USD/USDC-paid freelancers, capture an auditable SEP-38 quote or DEX rate at income-declaration time, giving the peso figure a verifiable FX basis for a BIR audit.

> **Compliance caveat (carried through every integration):** BIR accepts neither crypto payment nor DEX-derived FX rates as statutory basis today. Every idea here is a *settlement / evidence / identity layer feeding the existing BIR channels*, not a replacement for them.

**Speaker notes:** Here's specifically how we plug into what Stellar already has. Soroban gives us a real on-chain receipt registry instead of a flat key-value hash, with multi-party attestation so a receipt isn't just self-signed by us. Anchors — SEP-24 and SEP-31 — are how freelancers actually settle: Coins.ph and MoneyGram Access already run PHP and USDC corridors in the Philippines, and we want to sit on top of those rather than build our own. SEP-12 is interesting because our taxpayer profile already collects the exact KYC fields an anchor needs — we could become a KYC source, not just a consumer. And the Stellar DEX with SEP-38 quotes solves a very specific pain: freelancers paid in USD need an auditable, third-party FX rate to convert to pesos for their tax filing, and the DEX can supply that. One caveat we're upfront about: BIR doesn't accept crypto payment or DEX rates as statutory basis today, so all of this is a settlement and evidence layer feeding existing BIR channels, not a replacement for them.

---

## Slide 8: The big idea — a portable Compliance Credential  *(new in v3)*

*The most differentiated, fundable idea from our ecosystem research — and likely genuine whitespace on Stellar.*

- **Prove compliance, not income** — "Taxpayer X filed all mandated returns for TY2026, receipts anchored at ledgers …", verifiable by a lender or embassy **without seeing the underlying returns**.
- **Selective disclosure (ZK)** — prove "declared income ≥ ₱X" or "compliant = true" without revealing exact figures, using Stellar's newer BN254/Poseidon primitives or an identity registry like Luminar.
- **Government-attested, eventually** — adopt the SEP-57 / T-REX attestation pattern so a future BIR/RDO signer can endorse a receipt on-chain, upgrading a self-anchored hash into a government-attested record.

**Speaker notes:** This is the single idea from our research we're most excited about. Instead of just anchoring a hash, we issue the taxpayer a portable Compliance Credential — proof that they filed everything correctly, verifiable by a bank or embassy without exposing the actual return contents. With zero-knowledge selective disclosure, using Stellar's newer BN254 and Poseidon primitives, a freelancer could prove "my declared income is above this threshold" or "I am fully compliant" without revealing exact numbers. And longer term, this credential could carry an actual BIR or RDO attestation on-chain. We searched hard and didn't find another Stellar project doing this for tax compliance — this is where we think the real differentiation and fundability is.

---

## Slide 9: Go-to-market · Level 1 — Philippines (now)  *(new in v3)*

**Win the home market first: 8%-flat-rate freelancers.**

- **Direct-to-consumer:** freemium SaaS — free computation, paid tier unlocks generation + anchored receipts + compliance credential.
- **Channel partnerships:** bookkeepers, accountants, and freelancer communities/platforms as referral and onboarding channels.
- **Payment-rail pilot:** integrate a PHP anchor (Coins.ph-style) and/or MoneyGram Access so freelancers can settle USDC income and pay BIR dues without leaving the app.
- **Funding:** apply for an SCF Build Award to finance the Soroban registry and compliance-credential work ahead of revenue.
- **Proof point to carry forward:** a verifiable receipt a Philippine bank or embassy can check in seconds — the trust unlock that sells the next two markets.

**Speaker notes:** Go-to-market starts at home. In the Philippines, we go direct-to-consumer with a freemium model: free tax computation, paid for generation, anchoring, and eventually the compliance credential. We partner with bookkeepers, accountants, and freelancer platforms as channels rather than trying to reach millions of freelancers one at a time. We pilot a real payment-rail partnership — Coins.ph or MoneyGram Access — so settling tax dues doesn't require leaving the app. And we fund the deeper Stellar work, the Soroban registry and the credential, through an SCF Build Award rather than burning runway on it. The output of this stage is a working, trusted proof point we can take to the next two markets.

---

## Slide 10: Go-to-market · Level 2 — APAC (next 12–18 months)  *(new in v3)*

**Replicate the engine, keep the Stellar spine.**

- **Target markets** with (a) large freelance/gig economies and (b) simplified or presumptive flat-tax regimes similar in shape to the Philippine 8% rate — the computation-engine pattern generalizes even though the tax law doesn't.
- **Localize the computation layer** per country (brackets, forms, due dates) while reusing the architecture: recascade engine, PDF dispatcher, audit trail, and Stellar anchoring unchanged.
- **The Stellar-anchored receipt is the cross-border constant** — a freelancer working across two APAC markets can carry one verifiable compliance history, not two incompatible paper trails.
- **Lean on Stellar's existing APAC anchor/remittance network** rather than negotiating new payment infrastructure market-by-market.
- **Motion:** SCF ecosystem grants + local RegTech/accounting-software partnerships in each new market.

**Speaker notes:** Once the Philippine engine is proven, APAC expansion is about replication, not reinvention. We look for markets with large freelance economies and similarly simplified flat-tax regimes, and we localize only the computation layer — brackets, forms, deadlines — while the architecture underneath stays the same: the recascade engine, PDF generation, audit trail, and Stellar anchoring. The Stellar receipt is what makes this genuinely cross-border: a freelancer working across two countries can carry one verifiable compliance history instead of two disconnected paper trails. And because Stellar's remittance and anchor network already spans APAC, we're not negotiating new payment rails from scratch in every market.

---

## Slide 11: Go-to-market · Level 3 — Global (long-term)  *(new in v3)*

**The Compliance Credential becomes the product.**

- Beyond a country-by-country tax app, the durable global asset is the **Verifiable Compliance Credential** itself — a portable, privacy-preserving, Stellar-anchored proof of "this person/entity is tax-compliant."
- **B2B2C model:** sell verification access to lenders, embassies, freelance marketplaces, and gig platforms who need to check a worker's compliance status — **the verifier pays, not only the taxpayer**.
- **Positioning:** Compliance-as-a-Service / RegTech-as-a-Service infrastructure for any platform with distributed, self-employed workers — the same problem exists worldwide.
- **Revenue mix at scale:** freemium subscriptions (consumer) + per-filing anchoring fees (high margin; Stellar network cost is negligible) + credential-verification fees (B2B, most defensible).
- **Credibility path:** SCF-funded Soroban infrastructure → proven Philippine + APAC deployments → credential-verification partnerships with international platforms.

**Speaker notes:** Long-term, we don't think of Krunchr as just a country-by-country tax app — the durable global asset is the Compliance Credential itself. Any platform with distributed, self-employed workers has the same underlying problem: how do you verify someone is compliant without exposing their full financial history? We can sell that verification to lenders, embassies, and gig platforms globally — a B2B2C model where the verifier pays. At scale, our revenue mix is freemium consumer subscriptions, a small high-margin fee per anchored filing, and credential-verification fees for B2B partners, which is the most defensible line because it depends on the on-chain attestation existing at all. The credibility path is straightforward: fund the Soroban infrastructure through SCF, prove it in the Philippines and APAC, then sell verification globally.

---

## Slide 12: Team / Thanks

**Eight returns. One upload. One Stellar-native compliance layer.**

| Name | Role | Contact |
|---|---|---|
| `[PLACEHOLDER: Name]` | `[PLACEHOLDER: Role]` | `[PLACEHOLDER: Contact]` |
| `[PLACEHOLDER: Name]` | `[PLACEHOLDER: Role]` | `[PLACEHOLDER: Contact]` |
| `[PLACEHOLDER: Name]` | `[PLACEHOLDER: Role]` | `[PLACEHOLDER: Contact]` |

Project links: app.krunchr.xyz · krunchr.xyz · krunchr@artisam.xyz
Ecosystem research & reference links: github.com/webnxt-2030/krunchr, issue #191

**Speaker notes:** I'm `[name]`, and this is the team — `[placeholder]`. You can try the app at app.krunchr.xyz, read more on our landing page, or reach us at krunchr@artisam.xyz. All the sourced research behind the Stellar ecosystem and go-to-market sections in this deck is saved as issue #191 on our GitHub repo, if you want to dig into the citations yourself. Thanks to the organizers, the Stellar community, and every Filipino freelancer who told us how filing actually feels. That's Krunchr — eight returns, one upload, one Stellar-native compliance layer. We'd love your questions.

---

# Recording script

> A continuous, readable script for recording the pitch — ~4.5 to 5 minutes at a calm pace. Each numbered line maps to one slide.

**1 — Title (≈15s):** This is Krunchr — a compliance engine that takes one of the most anxious chores a Filipino freelancer faces, filing their BIR taxes, and turns it into something that just feels handled. This is our investor cut: the working product, plus how it plugs into Stellar and how we take it to market. I'm `[name]`.

**2 — Problem (≈35s):** A self-employed freelancer on the 8% flat rate isn't filing one form, they're filing up to eight a year, in a legally-mandated order, each with a different deadline. The rules interact badly: the 8% election locks for the year, mixed-income earners lose a 250k exemption, penalty rates changed under new law. Get it wrong and you owe surcharge, interest, and a compromise penalty — and carry a mark banks and embassies ask about. And all you have to prove a filing is a scanned PDF anyone could edit.

**3 — Solution (≈35s):** Krunchr turns eight confusing returns into one upload. You drop in your 2307 certificates and the engine recomputes your whole tax year in the right order. Correctness is built in: 8%, graduated-rate with the 40% standard deduction, the new penalty rates, holiday-aware deadlines, the mixed-income rule. Every filed return becomes a tamper-evident receipt anchored on Stellar, and the whole filing package downloads in one click.

**4 — Demo (≈40s):** Here's the moment the product is built around. Three-minute onboarding, then upload your 2307s. All eight returns compute in sequence — Blocked, Pending, Generated, Filed. File one and you get a Stellar transaction ID and a QR code. The punchline: hand your phone to a loan officer, they scan it, compliance confirmed in about thirty seconds.

**5 — How it works (≈30s):** One app, one engine. Upload income, the engine computes every return, the server generates the official BIR PDF, and a fingerprint of that PDF is anchored on-chain. Money is never floating-point, every action hits an append-only audit log, and if anchoring hiccups the filing still succeeds and retries. Today that's a hash on testnet — which is the launch point for the next three slides.

**6 — Stellar ecosystem impact (≈35s):** On Stellar specifically: every receipt is a real compliance event, not a trade. We researched the ecosystem and found no shipped Stellar product doing tax compliance — that's whitespace. The Philippines already has Stellar rails through Coins.ph and MoneyGram, so we're not starting cold. And our roadmap goes from a hash to real on-chain infrastructure, which is exactly what the Stellar Community Fund's Build Award funds.

**7 — Integration roadmap (≈40s):** Here's how we build on what Stellar already has. Soroban gives us a real on-chain receipt registry with multi-party attestation. Anchors — SEP-24 and 31 — are how freelancers settle in pesos and USDC, on rails Coins.ph and MoneyGram already run here. SEP-12 is a nice twist: our taxpayer profile already has the KYC an anchor needs, so we can be a KYC source, not just a consumer. And the DEX with SEP-38 gives USD-paid freelancers an auditable peso conversion rate. Important caveat: BIR doesn't take crypto or DEX rates as statutory basis, so this is an evidence and settlement layer feeding BIR's own channels.

**8 — The big idea (≈30s):** The idea we're most excited about: a portable Compliance Credential. Instead of just a hash, the taxpayer gets a verifiable proof they filed everything, that a bank or embassy can check without seeing the actual returns — and with zero-knowledge disclosure, prove "income above X" or "compliant" without revealing the numbers. We couldn't find anyone else doing this on Stellar.

**9 — GTM Philippines (≈25s):** Go-to-market starts at home: freemium direct-to-consumer, channel partnerships with bookkeepers and freelancer platforms, a payment-rail pilot with a PHP anchor, and an SCF grant to fund the deeper Stellar work. The output is a trusted proof point.

**10 — GTM APAC (≈25s):** Then APAC by replication, not reinvention — same architecture, localize only the tax math for markets with big freelance economies and simplified flat-tax regimes. The Stellar receipt becomes the cross-border constant, on Stellar's existing APAC rails.

**11 — GTM Global (≈25s):** Long-term, the Compliance Credential is the product. We sell verification to lenders, embassies, and gig platforms globally — the verifier pays. Revenue is freemium subscriptions, per-filing anchoring fees, and B2B credential-verification, which is the most defensible line.

**12 — Team / Thanks (≈15s):** That's the team. Try it at app.krunchr.xyz; the research and citations are in issue #191 on our GitHub. Thanks to the organizers, the Stellar community, and the Filipino freelancers who told us how filing really feels. Eight returns, one upload, handled. We'd love your questions.

---

# Q&A guide — likely judge / investor questions

> Prepared answers grounded in the actual codebase and the ecosystem research (issue #191).
> Where an answer states a limitation, it's deliberate — honesty reads as credibility to judges.
> **Caveat used repeatedly:** BIR does not accept crypto payment or DEX-derived FX rates as a
> statutory basis today; our Stellar layer is an evidence/settlement/identity layer feeding BIR's
> existing channels, not a replacement for them.

### Product & technology

**1. Is this actually built, or slideware?**
Built and working end-to-end for the 8% path — the demo is live software, not mockups. The computation engine (2551Q, 1701Q, 1701A/1701), PDF generation, SAWT, filing-package ZIP, the admin console, and Stellar anchoring all exist in the repo, with 58+ automated test files. Graduated-rate brackets, the 40% OSD, mixed-income Form 1701, and self-service registration are also implemented.

**2. What exactly gets put on-chain? Is my tax data public?**
Only a **SHA-256 hash** of the finalized return PDF plus a timestamp — written as two Stellar `manageData` operations per return. No income figures, no TIN, no personal data ever touch the ledger. The hash proves a specific document existed and is unaltered; it reveals nothing about its contents.

**3. How does verification actually work?**
The stored PDF is re-hashed and compared against the on-chain `manageData` value via our verify endpoint (`lib/stellar/verify.ts`). A third party scans the receipt's QR, which resolves to the transaction; matching hashes prove the document is the exact one filed. It's tamper-evidence, not a claim you have to trust our server for.

**4. Why Stellar and not Ethereum, a database, or a notary?**
A plain database is what everyone already distrusts — it's editable by whoever runs it. Stellar gives public, independent verifiability at effectively zero cost per anchor (fractions of a cent), with fast finality and no gas-price volatility — which matters when the unit economics are "a small fee per filing." Ethereum's fees would swamp that model. And Stellar's Philippine anchor/remittance footprint (Coins.ph, MoneyGram) is real, which our later roadmap depends on.

**5. If your servers disappear, is the receipt still verifiable?**
The on-chain hash persists regardless. Today, re-verification also needs the original PDF (which the taxpayer can hold a copy of) to re-hash. The roadmap's Soroban registry + public verifier page removes even that dependency by making the registry and a verification UI self-standing.

**6. What's the single biggest gap in the current build?**
We're candid about it: **BR-17 isn't enforced at the API layer** — a graduated-rate-elected user could currently generate a 1701A that the spec says should be blocked. It's documented in code comments but not gated in `generate/route.ts`. It's a small, known fix, and we track it openly in the README's "Known Gaps" section. We'd rather you hear it from us than find it.

**7. How do you handle money/rounding correctly?**
All monetary math runs through `decimal.js` — never JavaScript floats — so peso amounts are exact. This is enforced as a project rule, and the computation engine is covered by unit tests against worked BIR examples.

**8. What happens if the Stellar anchoring fails at filing time?**
Anchoring is decoupled: the filing still succeeds, and a `StellarReceipt` is written with status `FAILED` and a retry action (which even regenerates the PDF if missing). The user never hits a dead end because the chain had a hiccup.

**9. You're on testnet. What's the mainnet story?**
Correct — we anchor on testnet today, which is honest for a hackathon build. Mainnet is a small config change plus funding the system account; the meaningful work is the public verifier page and the Soroban registry, which we've scoped in issue #191 and would fund via an SCF Build Award.

**10. How accurate is the tax logic? Who validated it?**
The engine encodes specific, cited legal rules (TRAIN Law, RR 8-2018, RMO 23-2018, RA 11976) and is tested against worked examples. It is not a substitute for a CPA's sign-off on edge cases, and we'd pursue a review with a Philippine tax professional before charging for filings at scale — which we'd position as a feature, not a liability.

### Stellar ecosystem & integration

**11. Right now this is just a hash on a ledger — isn't that a thin use of Stellar?**
Today, yes, deliberately — it's the minimum that delivers the trust unlock. The depth comes from the roadmap: a Soroban receipt-registry contract with a public `verify()` and multi-party attestation, anchor integration for real PHP/USDC settlement, and a verifiable compliance credential. Issue #191 lays out each with sources.

**12. What does a Soroban contract add over the current approach?**
A queryable, canonical registry instead of flat per-account key-values: a public `verify(returnId, hash) → bool`, contract-enforced immutability (reject rewrites of a returnId), consensus timestamps instead of our server clock, and `require_auth` multi-party attestation so a receipt can be co-signed by the taxpayer and, eventually, a BIR/RDO key. We'd reuse OpenZeppelin's audited Stellar contracts for RBAC rather than hand-rolling.

**13. Which Stellar Anchors would you integrate, concretely?**
Coins.ph is the natural PHP anchor (a Stellar PHP anchor since ~2017; supports XLM↔PHP and USDC payouts), and MoneyGram Access runs a USDC on/off-ramp over Stellar with the Philippines as an early corridor. We'd integrate via SEP-24 for interactive deposit/withdrawal. One honesty flag: we've confirmed their historical/there-today anchor roles but would validate live SEP-24 endpoint support before committing engineering time.

**14. Why would an Anchor or the ecosystem care about you?**
Because our `TaxpayerProfile` already collects TIN-verified KYC that maps directly onto **SEP-12** — so Krunchr can act as a *KYC source* for anchors, not just a consumer. "Your tax identity is your payment identity" reduces duplicate KYC for the whole ecosystem, which is a genuine value-add to anchors, not just to us.

**15. Many Filipino freelancers are paid in USD/USDC — does that help or hurt?**
It's an opportunity. We can pull an auditable USDC→PHP rate from a SEP-38 quote or the Stellar DEX at the moment income is recognized, and store it with the income record — giving the peso figure a verifiable, third-party FX basis for a BIR audit. (Caveat: BSP has official reference rates; we'd position the DEX rate as supporting evidence and a settlement path, not necessarily the statutory computation rate.)

**16. Is there really no other tax product on Stellar?**
Our research (issue #191) found none shipped in tax filing / government compliance — the ecosystem's real-world traction is in payments, remittance, and RWA tokenization. We flag this as "thorough but not exhaustive," but it's why we think this is fundable whitespace rather than a crowded space.

### Market & business model

**17. How big is the market?**
Millions of Filipino self-employed professionals and freelancers file under these regimes, and the freelance/gig economy is growing. Today they file manually, pay an accountant each quarter, or don't file and accrue penalties — all three are the wedge. The 8% flat-rate cohort is the beachhead; graduated-rate and mixed-income earners widen it.

**18. How do you make money?**
Freemium SaaS: free computation, paid tiers for generation + anchored receipts + the compliance credential. Plus a small, high-margin per-filing anchoring fee (Stellar cost is negligible), and — the most defensible line — B2B credential-verification fees where lenders/platforms/embassies pay to verify a worker's compliance. RegTech-as-a-Service is the reference model.

**19. Who's the most valuable customer — the freelancer or someone else?**
Both, sequentially. The freelancer is the acquisition wedge and the subscription base. But the durable, defensible revenue is B2B2C: the **verifier** — a lender, marketplace, or embassy — paying to check a compliance credential. That only exists because we put the attestation on-chain, so it's hard to disintermediate.

**20. What stops the BIR from building this and killing you?**
Government software moves slowly and rarely ships consumer-grade UX; our wedge is exactly the guided, correct-by-construction experience the BIR's own tools lack. And the ideal end-state is *partnership*, not competition — a BIR/RDO on-chain attestation (SEP-57/T-REX pattern) makes our credential official and makes us infrastructure, not a competitor.

**21. What stops Coins.ph, an accounting SaaS, or a big fintech from copying you?**
The moat isn't the tax math (that's table stakes we've already built) — it's the combination of a correct engine, the on-chain verifiable-credential layer, and being the KYC/compliance identity a freelancer carries across anchors and borders. A payments company would have to build the compliance engine; an accounting SaaS would have to build the Stellar identity layer. We're building both, and the credential gets more valuable as more verifiers accept it (a network effect).

### Go-to-market, funding & risk

**22. Why start in the Philippines, and why is that defensible?**
It's a genuinely hard, specific compliance problem (8 sequenced returns, irrevocable elections, changing penalty law) where we have depth, in a market where Stellar rails already exist. Winning a hard, narrow market first produces a trusted proof point and a defensible base of compliance logic before we generalize.

**23. Is the APAC/global plan realistic, or hand-waving?**
The tax *law* doesn't port, but the *architecture* does — recascade engine, PDF dispatcher, audit trail, and Stellar anchoring stay constant while we localize only the computation layer per country. We target markets with large freelance economies and simplified/presumptive flat-tax regimes, on Stellar's existing APAC anchor network. It's replication of a proven engine, not a rebuild each time.

**24. How would you use grant/investment money?**
Grants (SCF Build Award, $15K–$150K+) fund the Stellar-native infrastructure — the Soroban registry and the compliance credential — ahead of revenue, so we don't burn equity runway on ecosystem R&D. Investment funds go-to-market: the PH channel partnerships, the anchor-integration pilot, and a Philippine tax-professional review to harden the engine for paid filings.

**25. What's your single biggest risk?**
Regulatory/legal acceptance — that a Philippine institution treats the Stellar-anchored receipt (and later the credential) as trustworthy proof. We de-risk it in stages: first the receipt is *supplementary* evidence alongside the official BIR filing (no regulatory dependency to deliver value), then we pursue the BIR/RDO attestation partnership that makes it official. Technology risk is low; adoption-and-trust risk is the real work, and our whole GTM is sequenced to retire it.

**26. What traction / validation do you have so far?**
`[PLACEHOLDER: fill in — e.g. user interviews with N freelancers, pilot signups, waitlist, letters of intent from a bookkeeper/accountant channel, testnet filings anchored].` Be specific and honest; if pre-launch, lead with the working product, the depth of the compliance logic, and the research-backed roadmap.

**27. Why is this a hackathon project and not just a startup pitch?**
The hackathon (Local Finance & Real World Access) is exactly the right proving ground: it rewards real-world utility on Stellar, and it's our on-ramp to the SCF funnel. The working product is the hackathon deliverable; the ecosystem and GTM sections show we've thought past the demo to a fundable business.
