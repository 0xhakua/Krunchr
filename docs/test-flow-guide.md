# Kuwenta — Test Flow Guide

A friendly, end-to-end walkthrough of the freelancer tax-compliance demo.
Use it yourself to verify the system, or hand it to a tester / stakeholder who
has never seen Kuwenta before. The whole flow takes about 20–30 minutes the
first time.

> **Who this is for:** anyone who wants to try the product, including
> non-technical reviewers, demo audiences, and the client. No prior
> knowledge of Philippine tax law, Stellar, or Next.js is needed.

---

## 0. Pre-flight: what you'll need

1. **A modern browser** (Chrome, Edge, Firefox, or Safari). The demo runs
   fully in the browser; nothing to install.
2. **A seeded login.** The demo ships with these accounts (password for
   all taxpayer accounts is `Test1234!`):

   | Username | Income type | Filing path | Notes |
   | --- | --- | --- | --- |
   | `admin` | — | — | Full admin access. Password comes from `ADMIN_PASSWORD` in `.env.local`. |
   | `maria` | Pure self-employment, COR includes 2551Q | **8 returns** | The primary demo persona. |
   | `juan` | Mixed income (salary + freelance), COR includes 2551Q | **8 returns**, but uses Form 1701 instead of 1701A | Good for showing the mixed-income flow. |
   | `anna` | Pure self-employment, COR does NOT include 2551Q | **4 returns** | Good for showing the short path. |

3. **A few test Form 2307 figures.** When you reach step 6 you'll add at
   least one 2307 certificate. You can use the demo data seeded for
   `maria`, or invent your own: pick a quarter (1–4), a payor TIN
   (`000-000-000-000` is fine for the demo), a payor name, an ATC code
   (`WI100` = professional fees is a safe default), and a quarterly
   gross amount + CWT.

If you don't have a running environment yet, ask the dev team to give
you the URL (e.g. `https://krunchr-staging.up.railway.app`) and the
admin password.

---

## 1. Sign in

1. Open the URL in your browser.
2. On the login page, enter `maria` and the password `Test1234!`.
3. Click **Sign in**.

**What you should see:** the browser redirects to the dashboard. Top
of the page shows Maria Dela Cruz's name and TIN. The sidebar lists the
main sections (Dashboard, Income, Returns, SAWT, Stellar, etc.).

**If sign-in fails:** see "Common problems" at the bottom. The most
common cause on the staging deployment is a stale build before the
Prisma client was generated — there's now a public health endpoint at
`/api/health` that the team can check.

---

## 2. Onboarding (first time only)

If you sign in as `maria` and she already has a tax year set up, you'll
land directly on the dashboard and can skip to step 3. To experience
the onboarding, sign in as a brand-new account (or, in dev, run
`pnpm tsx --env-file=.env.local prisma/seed.ts` to reset).

The wizard has four steps:

### 2a. Personal information
- Full name (as on the BIR registration)
- TIN — must be in the format `NNN-NNN-NNN-NNN` (e.g. `123-456-789-000`)
- RDO code (3 digits, e.g. `040`)
- Registered address
- ZIP code
- Nature of business / profession
- **Nature of income** — choose `Pure Self-Employment` for the standard
  demo, or `Mixed Income` to see the alternative 1701 path
- **Does your COR include 2551Q?** — Yes → 8 returns; No → 4 returns
- **Are you a new BIR registrant?** — Yes means the 8% election is
  pre-confirmed and you skip the in-app election step

Click **Check Eligibility** to advance.

### 2b. Eligibility check
The system evaluates the 5 conditions that decide whether the 8% flat
rate is available to you. Each line turns green (Pass) or red (Fail)
with a one-line explanation. The progress bars at the bottom show
current gross receipts vs. the VAT threshold.

Click **Next**.

### 2c. ATC codes
Pick the ATC code(s) that match the kind of work you do. The seeded
list includes:
- `WI071` — Insurance Agents & Adjusters (10% EWT)
- `WI100` — Professional fees (10% EWT)
- `WI140` — Agent/Broker's fees (10% EWT)

For the demo, check `WI100`. You can always edit this later.

Click **Next**.

### 2d. Tax year
Defaults to the current calendar year. The screen previews your
filing sequence ("8 returns" or "4 returns" depending on your COR).

Click **Complete Onboarding**.

**What you should see:** the dashboard, with the filing roadmap empty
(no 2307s yet, so all returns are Blocked).

**If you see "Validation failed"** in red at the top: the form rejected
your input. The most common trigger is a TIN that doesn't match
`NNN-NNN-NNN-NNN`, or a blank required field. The fix from #101
surfaces the actual field error in the toast, so read the red text
carefully and fix the named field. (Older builds just said "Validation
failed" with no detail — make sure you're on the latest build.)

---

## 3. Add your Form 2307 certificates

A Form 2307 is the slip a payor gives you when they pay you and
withhold tax on your behalf. The system needs at least one to compute
your taxes.

1. Click **Income** in the sidebar.
2. Click **Add 2307** (or whatever the current label says).
3. Fill in:
   - **Quarter:** 1, 2, 3, or 4
   - **Payor TIN:** any value (use `000-000-000-000` if you don't have a real one)
   - **Payor name:** anything (e.g. "Acme Corp")
   - **ATC code:** choose from the list
   - **Monthly amounts:** split your quarterly gross across the 3
     months (or all in month 1 — math is the same)
   - **CWT withheld:** typically 10% of the quarterly gross for `WI100`
4. Save.

**What you should see:** the income list now shows your certificate,
the VAT threshold progress bar ticks up by the gross amount, and the
dashboard's quick-stats update.

Repeat for a few quarters so the demo has something to work with.
For Maria's seeded data, there are already 4 quarters of 2307s.

---

## 4. Review the filing roadmap

On the dashboard, the **Filing Roadmap** section shows all your
returns in the legally-mandated order:

1. 2551Q Q1 → 2. 2551Q Q2 → 3. 2551Q Q3 → 4. 2551Q Q4
5. 1701Q Q1 → 6. 1701Q Q2 → 7. 1701Q Q3
8. 1701A (or 1701 for mixed-income earners)

Each row shows:
- **Status:** Blocked (red, predecessor not filed), Pending (green,
  ready to file), Filed (green, with the Stellar TX ID), or Generated
  (blue, draft saved).
- **Statutory due date** and how many days until it's due.
- **Action button:** Generate (compute the form), or View.

**What you should see:** for a freshly-onboarded user with 4 quarters
of 2307s, returns 1–4 (2551Q) become **Pending** as soon as the
quarter's certificates are added. Returns 5–7 (1701Q) are also
**Pending** because all four 2551Q slots are computable. Return 8
(1701A) is also **Pending** if 1701Q Q1–Q3 are computable.

---

## 5. Generate a return

1. On the dashboard (or the **Returns** page), find the first
   **Pending** return (2551Q Q1).
2. Click **Generate**.
3. The system computes the form using your 2307 data. The status moves
   to **Generated**.

**What you should see:** the return detail page shows the computed
figures — gross, CWT, percentage tax (3% of gross for 2551Q under
graduated, 0% for 2551Q under 8%), penalties (none if on time), and
the proposed PDF.

**Common gotchas:**
- The "Generate" button may be disabled if a predecessor hasn't been
  generated yet. Work strictly in sequence.
- If the computed tax looks wrong, double-check the ATC code's EWT
  rate and the CWT withheld on your 2307.

---

## 6. File a return

1. On the return detail page, click **File**.
2. The system re-checks the rules, recomputes penalties as of today,
   generates the final PDF, and submits a Stellar anchoring
   transaction.
3. The status moves to **Filed**.

**What you should see:**
- The return is now marked green/Filed with a **Stellar TX ID**.
- The row in the roadmap shows the transaction hash.
- The system also writes an entry to the **audit log** (visible to
  admins).
- The PDF is downloadable from the return detail page.

Repeat for every remaining return. With seeded data this is 8 clicks
in a row (or 4 for the no-2551Q path).

---

## 7. Verify the Stellar receipt

1. Click **Stellar** in the sidebar.
2. Pick any filed return. You'll see:
   - A QR code that encodes the Stellar transaction ID.
   - A button to copy the transaction hash.
   - A link to the Stellar Expert testnet explorer.
3. Scan the QR with any QR reader, or click the explorer link.

**What you should see:** the Stellar Expert page for the testnet
shows a `manageData` operation from the system keypair with key
`kuwenta:ph:{returnId}` and value `{sha256}:{timestamp}`. This is
the immutable proof that the return was filed.

**If the explorer shows nothing:** the transaction is still
confirming. Wait a few seconds and refresh.

---

## 8. Download the filing package

1. From the dashboard or the **Returns** page, click **Filing
   Package** (or hit `/api/filing-package/download` directly).
2. The browser downloads `filing-package-2026.zip`.

**What's inside the ZIP:**
- `cover-sheet.pdf` — a summary of the taxpayer, the year, and the
  filing summary.
- `2551Q-Q1-2026.pdf`, `2551Q-Q2-2026.pdf`, … — one PDF per filed
  return.
- `SAWT-2026.csv` — the BIR alphalist of payors (one row per 2307
  certificate), in the BIR eSubmission schema.

Open the CSV in Excel or any text editor. The header is
`Quarter,PayorTIN,PayorName,ATC,GrossIncome,CWTWithheld` and there
should be one row per 2307 you added.

---

## 9. Look at the journal (optional, for bookkeepers)

1. Click **Journal** in the sidebar.
2. The page lists every journal entry the system has auto-generated
   for your filings, grouped by BIR sub-section (9A income
   recognition, 9B 2551Q, 9C 1701Q, 9D prior-year credit, 9E 1701A,
   9F overpayment, 9G closing).
3. Each entry shows the account name, debit, and credit.
4. There's a button to **Export to XLSX**. The exported workbook has
   two sheets (entries + line items) with colour-coded backgrounds.

**Why this matters:** this is the audit trail a bookkeeper needs to
mirror the filings in the company's general ledger.

---

## 10. The admin view (optional)

If you have admin access:

1. Sign out and sign back in as `admin`.
2. Click **Admin** in the sidebar.
3. The user list shows every registered taxpayer with their TIN, RDO,
   income type, and onboarding date.
4. Click **Audit log** to see every state-changing action across all
   users: elections, filings, Stellar retries, overpayment
   dispositions. Use the date / actor / action filters to narrow
   down. There's a CSV export.
5. The **System Health** page (admin only) shows whether PostgreSQL,
   Stellar, and file storage are all reachable. Bookmark this for
   the first thing to check when "something looks broken".

---

## Common problems

| What you see | Most likely cause | What to do |
| --- | --- | --- |
| `Objects are not valid as a React child…` on the onboarding form | Stale build before #97 fix | Pull the latest build. The fix returns a flat error string. |
| Top-level toast just says "Validation failed" with no detail | Stale build before #101 fix | Pull the latest build. The fix surfaces the first field error in the toast. |
| `500 (Internal Server Error)` on `POST /api/auth/login` | Missing env var (typically `JWT_SECRET` or `DATABASE_URL`) or the Prisma client wasn't generated on build | Check `/api/health` for the failing subsystem. The fix from #99 adds a `postinstall: prisma generate` step so a fresh `pnpm install` always populates the client. |
| `Module '@prisma/client' has no exported member 'Prisma'` at build time | Same as above — Prisma client not generated | `pnpm install` (the postinstall handles it) and rebuild. |
| Return detail page shows "Cannot generate" | A predecessor return isn't yet Filed | File the predecessor first. The system enforces strict ordering. |
| Stellar receipt shows `FAILED` status | The on-chain transaction didn't confirm | Use the **Retry** button on the return detail page. Filing itself is preserved; only the on-chain receipt is retried. |
| VAT threshold bar turns red | You've crossed ₱3,000,000 in gross receipts | By law you must register for VAT. The system will block 1701A generation and show a clear message. |

---

## Sanity check before signing off

- [ ] Logged in as `maria` and saw the dashboard.
- [ ] Onboarded a fresh user end-to-end (4-step wizard).
- [ ] Added at least one Form 2307 and saw the VAT bar update.
- [ ] Filed all 8 returns (or 4 for the no-2551Q path) and saw each
      one get a Stellar TX ID.
- [ ] Downloaded the filing package ZIP and confirmed the cover sheet,
      all return PDFs, and the SAWT CSV are inside.
- [ ] Scanned the QR on the Stellar page and confirmed the
      transaction shows up on Stellar Expert testnet.
- [ ] Signed in as `admin`, opened the audit log, and saw the filings
      you just made.
