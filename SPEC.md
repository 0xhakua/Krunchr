# SPEC.md — Philippine Individual Tax Compliance System
**Kuwenta** | Full-Stack Web Application Specification  
Tax Framework: TRAIN Law (RA 10963) | RR No. 8-2018 | RMO No. 23-2018  
Track: Local Finance & Real World Access — APAC Stellar Hackathon 2026

---

## Overview

A web-based tax compliance engine for Filipino self-employed professionals and freelancers operating under the BIR's 8% flat income tax rate. The system guides users through all 8 mandatory BIR returns in the correct legally-mandated sequence, automates tax computation from BIR Form 2307 data, generates a complete filing package, and anchors every filed return as a tamper-proof receipt on the Stellar blockchain.

**The single demo moment:** A Filipino freelancer uploads their Form 2307 certificates, the system computes their full tax position, generates 8 sequenced returns, and each filed return is permanently anchored on Stellar — producing a verifiable compliance trail that banks and embassies can check in seconds.

---

## Tech Stack

- **Framework:** Next.js 15 (App Router) — frontend and API routes
- **ORM:** Prisma (with seed script for admin account)
- **Database:** PostgreSQL via Railway
- **File Storage:** Railway Volumes
- **Deployment:** Railway (frontend, backend, database, storage all on Railway)
- **Styling:** Tailwind CSS + shadcn/ui
- **Runtime:** Node.js 20+
- **Package Manager:** pnpm
- **Authentication:** Username + password (bcrypt, JWT via httpOnly cookies)
- **Blockchain:** Stellar SDK (stellar-sdk) for testnet anchoring
- **PDF Generation:** @react-pdf/renderer
- **Dev Services:** Docker Compose (PostgreSQL, MinIO for local file storage)

---

## Application Pages

### 1. `/login`
**Authentication page**
- Username and password form
- JWT issued on success, stored as httpOnly cookie
- Redirect to `/dashboard` on success
- No registration — admin account seeded only

---

### 2. `/dashboard`
**Compliance overview — the home screen**
- Greeting with taxpayer name and TIN
- Active taxable year selector (defaults to current year)
- **Filing Roadmap** — visual checklist of all 8 required returns showing status per return:
  - Filed (green) — return confirmed filed, Stellar TX ID shown
  - Pending (amber) — prerequisites met, ready to file
  - Blocked (red) — predecessor return not yet filed
- VAT threshold progress bar (₱0 → ₱3,000,000) with warning indicator at ₱2,400,000
- Quick stats: Total Gross Income YTD, Total CWT YTD, Estimated Tax Position
- Upcoming deadline reminders (next 3 returns due)
- Quick action buttons: Add 2307 Certificate, View Filing Package

---

### 3. `/onboarding`
**Taxpayer registration — one-time setup**

Step 1 — Personal Information
- Full registered name (as on BIR COR)
- TIN (format: NNN-NNN-NNN-NNN, validated and duplicate-checked)
- RDO Code
- Registered address, ZIP code
- Nature of business / profession
- **Nature of Income** — single select: `Pure Self-Employment` or `Mixed Income (Salary + Freelance)`
  - If `Mixed Income`: the ₱250,000 statutory exemption is NOT applied in any computation (already absorbed by the compensation side). Annual return is Form 1701, not 1701A. Legal basis: RR No. 8-2018 Sec. 3(D); RMC No. 50-2018; BIR Form 1701-MS (Aug 2024) Item 22.
- **Are you a new BIR registrant?** — Yes / No
  - If `Yes`: taxpayer elected 8% rate at the time of initial BIR registration via Form 1901. This is a valid pre-election — no Item 13 on 2551Q or Item 16 on 1701Q is required because the election was already made at registration. System records election status as confirmed and pre-populates the election flag. Legal basis: RR No. 8-2018 Sec. 3; BIR Form 1901.
  - If `No`: election must be made via Item 13 on Q1 2551Q, Item 16 on Q1 1701Q, or Form 1905.
- **COR includes 2551Q?** — Yes / No
  - If `No`: taxpayer registered with BIR already declaring 8% at signup; BIR removes 2551Q from their registered tax types. Skip all 2551Q filings — total returns reduced from 8 to 4 (1701Q Q1, Q2, Q3, and 1701A only). Legal basis: RMO No. 23-2018 Sec. C.2.1–2.3; BIR Form 2303.
  - If `Yes`: standard 8-return path applies.
- **Annual Registration Fee** — as of January 22, 2024 under RA 11976 (Ease of Paying Taxes Act), the ₱500 annual BIR registration fee has been abolished. Only the ₱30 Documentary Stamp Tax applies. If onboarding references any registration costs, display ₱30 DST only — never ₱500. Legal basis: RA No. 11976 Sec. 18; RR No. 6-2024.

Step 2 — Eligibility Check
- System validates all 5 conditions simultaneously and displays pass/fail per condition:
  1. Individual taxpayer (not corporation or partnership)
  2. Income from self-employment or profession (mixed-income earners routed to separate path — no ₱250,000 deduction, Form 1701 as annual return)
  3. Non-VAT registered
  4. Gross receipts below ₱3,000,000
  5. No prior Q1 return filed under graduated rate for this taxable year
- All 5 must pass to proceed

Step 3 — ATC Code Setup
- Add one or more ATC codes applicable to the taxpayer
- Lookup table with ATC code, description, and EWT rate
- Pre-filled options: WI071 (Insurance Agents, 10%), WI140 (Broker Fees, 10%)
- Admin-configurable ATC table

Step 4 — Tax Year Initialization
- Confirm active taxable year
- Initialize return slots: 8 returns if COR includes 2551Q; 4 returns (1701Q x3 + 1701A) if COR does not
- Election flag defaulted to "Not Yet Elected"
- Income type flag stored (`PURE_SELF_EMPLOYMENT` or `MIXED_INCOME`) — used in all downstream computations

---

### 4. `/income`
**BIR Form 2307 Manager**

List view:
- All 2307 certificates for the active taxable year
- Grouped by quarter, then by payor (each payor gets a sub-header with name, TIN, and certificate count; rows show ATC, Gross, CWT, Status, Actions)
- Add New Certificate button
- Running totals at top: YTD Gross, YTD CWT, VAT Threshold %

Add/Edit Certificate modal:
- Period covered (quarter selector)
- Payor TIN and Name
- ATC Code (dropdown from lookup table)
- Monthly amounts: Month 1, Month 2, Month 3 (auto-sums to quarterly total)
- CWT Withheld (auto-validated against ATC rate × gross, ±₱1.00 tolerance)
- Warning shown if CWT mismatch detected
- Save triggers recascade of all affected return computations

Consolidated Income Summary:
- Table of all certificates: Quarter | Payor | ATC | Gross | CWT
- "Export PDF" button downloads a printable, BIR-style summary attachable to 1701A (uses the active-year selector)

---

### 5. `/election`
**Tax Rate Election**

Only accessible if Q1 2551Q has not yet been filed.

- **Three valid election methods — system supports all three:**
  1. **Item 13 on Q1 Form 2551Q** — standard path for taxpayers whose COR includes 2551Q
  2. **Item 16 on Q1 Form 1701Q** — valid alternative; applicable to taxpayers whose COR does NOT include 2551Q. For these users, the Q1 1701Q is the first (and only quarterly income tax) return, and Item 16 is where the election is declared. Legal basis: RR No. 8-2018 Sec. 3; RMC No. 32-2018; RMO No. 23-2018 Sec. 7.
  3. **BIR Form 1905 (COR update)** — election via RDO; when recorded the system resolves the actual BIR line item (Item 13 or Item 16) from the COR-2551Q flag and stores it in `electionPath`. `electionMethod` is set to `FORM_1905` so the RDO-driven origin is preserved for audit.
- System detects the default path based on the COR 2551Q flag set during onboarding
- `electionPath` always stores the actual BIR line item (`ITEM_13_2551Q_Q1` or `ITEM_16_1701Q_Q1`)
- `electionMethod` stores how the election was recorded (`ITEM_13_2551Q_Q1`, `ITEM_16_1701Q_Q1`, or `FORM_1905`)
- Displays two rate options:
  - (A) Graduated Income Tax Rate on Net Taxable Income
  - (B) 8% Income Tax Rate on Gross Sales/Receipts/Others
- Selecting (B) triggers mandatory confirmation dialog with four disclosures:
  1. Election is irrevocable for the entire taxable year
  2. Percentage tax is eliminated (if 2551Q applies, tax due = ₱0.00 on all quarters)
  3. BIR Form 1701A is the required annual return (or 1701 for mixed-income earners)
  4. Financial Statements are NOT required
- User must check all four disclosures before confirming
- Confirmation timestamped and logged to audit trail, including both `electionPath` and `electionMethod`
- Once confirmed, election flag locked and cascaded to all return computations
- If new taxable year begins, election resets to default (Graduated) and user is prompted to re-elect

---

### 6. `/returns`
**Filing Sequence Controller — 8 Returns**

List of all 8 returns in mandatory sequence:

| # | Form | Quarter | Deadline | Status |
|---|------|---------|----------|--------|
| 1 | 2551Q Q1 | Jan–Mar | April 25 | |
| 2 | 2551Q Q2 | Apr–Jun | July 25 | |
| 3 | 2551Q Q3 | Jul–Sep | Oct 25 | |
| 4 | 2551Q Q4 | Oct–Dec | Jan 25 (next yr) | |
| 5 | 1701Q Q1 | Jan–Mar cumulative | May 15 | |
| 6 | 1701Q Q2 | Jan–Jun cumulative | Aug 15 | |
| 7 | 1701Q Q3 | Jan–Sep cumulative | Nov 15 | |
| 8 | 1701A Annual | Full Year | April 15 (next yr) | |

Each return card shows:
- Computed tax due
- CWT credits applied
- Net amount due / overpayment
- Penalty breakdown (surcharge, interest, compromise penalty)
- Generate Return button (disabled if predecessor not filed)
- Mark as Filed button (enabled after return is generated)
- Stellar TX ID (shown after filing is confirmed and anchored)

Clicking a return opens the detail view at `/returns/[id]`

---

### 7. `/returns/[id]`
**Return Detail & Computation View**

Two-panel layout:

Left panel — Computation Breakdown:
- All income sources included in this return
- Step-by-step tax computation (formulas shown)
- Credit application sequence (prior year → quarterly payments → CWT)
- Final tax position

Right panel — Generated Form Preview:
- Read-only preview of the populated BIR form
- Download as PDF button
- Mark as Filed button
- Penalty calculator (real-time: shows cost of filing today vs. deadline)

For 1701A only — Overpayment Disposition section:
- Three options: Carry Over / Refund / Tax Credit Certificate
- Selection mandatory before finalization
- If Carry Over: auto-propagates to next year's prior year credit

---

### 8. `/prior-year-credit`
**Prior Year Credit Manager**

- Input: Amount, taxable year of origin, source BIR form, disposition elected in prior year
- Validation: rejects credits where prior year disposition ≠ Carry Over (with explanation)
- Confirmation checklist: user confirms prior year ITR is available and reflects Carry Over election
- Applied as first credit in 1701A Schedule 4 Item 31
- Chain carry-over display: shows the credit lineage across tax years

---

### 9. `/sawt`
**SAWT Generation & Filing Package**

SAWT tab:
- Full alphalist of all 2307 data for the taxable year
- Aggregation applied: same payor + same ATC + same quarter → one line
- Download as CSV in BIR eSubmission format
- Copy email address button (csubmission@bir.gov.ph)

Attachments Checklist tab:
- Checklist of all required documents with status (Available / Pending / External)
- Under 8% rate: Financial Statements row shown as "NOT REQUIRED" in green
- Items: 2307 originals, SAWT, 1701Q receipts (Q1–Q3), 2551Q receipts (Q1–Q4), prior year ITR

Filing Package tab:
- All 8 returns bundled in sequence
- Cover sheet with taxpayer info and tax year
- Penalty summary table
- Download All as ZIP button

---

### 10. `/journal`
**Accounting Journal Entries**

Auto-generated from all tax filing events already in the system. No manual entry required — every peso in the journal traces back to a 2307 certificate, a return filing, or an overpayment disposition.

List view:
- All journal entries for the active taxable year grouped by sub-section (9A–9G)
- Columns: Entry #, Date, Trigger Event, Account, Debit, Credit, Regulation Reference
- Filter by: sub-section, quarter, account name
- Color coding: Debit-led entries (blue), Credit-led entries (green), Memo/no-cash entries (gray)
- Download as XLSX button (single workbook, two sheets — see below)

**7 Sub-sections, 20 Journal Entry Requirements:**

**9A — Income Recognition (triggered by each 2307 entry)**
- 9.1 Dr. Cash (net received) + Dr. CWT Receivable → Cr. Service Income (gross)
- 9.2 Amendment/reversal entry when a 2307 is edited or deleted

**9B — Quarterly Percentage Tax / Form 2551Q**
- 9.3 Under 8% election: memo entry only (tax due = ₱0.00, no cash movement)
- 9.4 Under graduated rate: Dr. Percentage Tax Expense → Cr. Percentage Tax Payable
- 9.5 Dr. Percentage Tax Payable → Cr. Cash (on payment)

**9C — Quarterly Income Tax / Form 1701Q (Q1–Q3)**
- 9.6 Dr. Income Tax Expense → Cr. Income Tax Payable (tax accrual per quarter)
- 9.7 Dr. Income Tax Payable → Cr. CWT Receivable (CWT credit applied)
- 9.8 Dr. Income Tax Payable → Cr. Cash (cash payment of remaining balance)
- 9.9 CWT excess carry-forward noted as memo when CWT > tax due (no entry, balance remains in CWT Receivable)

**9D — Prior Year Carry-Over Credit**
- 9.10 Opening entry at start of year: Dr. Prepaid Income Tax → Cr. Income Tax Overpayment
- 9.11 Application in 1701A Item 31: Dr. Income Tax Payable → Cr. Prepaid Income Tax

**9E — Annual Income Tax / Form 1701A**
- 9.12 Year-end true-up: Dr. Income Tax Expense → Cr. Income Tax Payable (Q4 accrual)
- 9.13 Final CWT application: Dr. Income Tax Payable → Cr. CWT Receivable
- 9.14 Final cash payment if tax still due: Dr. Income Tax Payable → Cr. Cash

**9F — Overpayment Disposition**
- 9.15 Carry Over elected: Dr. Prepaid Income Tax → Cr. Income Tax Receivable
- 9.16 Carry Over applied next year: Dr. Income Tax Payable → Cr. Prepaid Income Tax
- 9.17 Refund elected (Step 1): Dr. Income Tax Refund Receivable → Cr. Income Tax Expense
- 9.18 Refund received (Step 2): Dr. Cash → Cr. Income Tax Refund Receivable
- 9.19 TCC elected (Step 1): Dr. Tax Credit Certificate Asset → Cr. Income Tax Expense
- 9.20 TCC applied (Step 2): Dr. Income Tax Payable → Cr. Tax Credit Certificate Asset

**9G — Year-End Closing Entries**
- Closing entry for Service Income → Retained Earnings
- Closing entry for Income Tax Expense → Retained Earnings
- Closing entry for Percentage Tax Expense → Retained Earnings
- Note: Prepaid Income Tax carries forward without a closing entry

**XLSX Export — Two Sheets:**

Sheet 1 — Journal Entries
- Columns: Entry #, Sub-section, Trigger/Event, Journal Entry Lines, Revenue Regulation, Workflow/Menu
- Cell background in Journal Entry column: blue (debit-led), green (credit-led), light gray (memo/no cash)

Sheet 2 — Legend & Notes
- Color coding explanation
- Journal entry format conventions
- Key notes: ₱250,000 deduction not separately journalised (embedded in Income Tax Expense amount), CWT Receivable lifecycle, Prepaid Income Tax carry-forward, two-step entries for Refund and TCC

**Important note on deductions vs. tax credits:**
- ₱250,000 exemption — NOT journalised separately. It is already embedded in the Dr. Income Tax Expense amount (computed on gross − ₱250,000 × 8%). No separate entry.
- CWT credits — fully journalised via CWT Receivable account (opened in 9.1, progressively closed across quarters and annual in 9.7, 9.9, 9.13)

---

### 11. `/stellar`
**Stellar Compliance Receipts**

- List of all Stellar on-chain filing records for the taxpayer
- Per record: Return type, filing date, Stellar TX ID, link to Stellar explorer
- QR code generator for each TX ID (for showing to banks/embassies)
- Copy TX ID button
- Status: Anchored / Pending / Failed (with retry option)
- Verification instructions (how a bank or embassy can verify the hash)

---

### 11. `/admin`
**Admin Panel (seeded admin account only)**

- User management (view all taxpayer accounts)
- ATC code lookup table management (add/edit/deactivate ATCs)
- Holiday calendar management (for due date rolling)
- Compromise penalty schedule by RDO (configurable)
- Audit log viewer (all election confirmations, filing events, Stellar anchoring events)
- System health: Stellar connection status, Railway storage status

---

## API Endpoints

All endpoints under `/api/`. Authentication required on all except `/api/auth/login`.

### Auth
```
POST   /api/auth/login          — Validate credentials, issue JWT cookie
POST   /api/auth/logout         — Clear JWT cookie
GET    /api/auth/me             — Return current user session
```

### Taxpayer Profile
```
GET    /api/taxpayer            — Get taxpayer profile for current user
POST   /api/taxpayer            — Create taxpayer profile (onboarding)
PUT    /api/taxpayer            — Update taxpayer profile
GET    /api/taxpayer/eligibility — Run eligibility check, return pass/fail per condition
```

### ATC Codes
```
GET    /api/atc                 — List all active ATC codes
GET    /api/atc/[code]          — Get single ATC (rate + description + isActive)
POST   /api/atc                 — Admin: create ATC code (canonical update path is PATCH /api/admin/atc — see below)
```

### Form 2307 Certificates
```
GET    /api/income              — List all 2307s for active tax year (filterable by quarter, payor)
GET    /api/income/[id]         — Get single certificate
POST   /api/income              — Add new 2307 certificate (triggers recascade)
PUT    /api/income/[id]         — Amend certificate (triggers recascade)
DELETE /api/income/[id]         — Remove certificate (triggers recascade)
GET    /api/income/summary      — Consolidated income summary (all quarters, all payors)
GET    /api/income/summary/export — Download consolidated income summary as PDF (attachable to 1701A)
GET    /api/income/totals        — YTD totals: gross, CWT, VAT threshold %
```

### Tax Election
```
GET    /api/election            — Get current election status for active tax year
POST   /api/election            — Record 8% election with confirmation + audit log entry
GET    /api/election/history    — Election history across all tax years
```

### Tax Computation
```
GET    /api/computation/[returnId]   — Get full computation breakdown for a specific return
GET    /api/computation/preview      — Live preview of annual tax position (1701A estimate)
POST   /api/computation/recascade    — Trigger full recomputation of all affected returns
```

### Returns & Filing
```
GET    /api/returns             — List all 8 returns with status for active tax year
GET    /api/returns/[id]        — Get return detail with full computation
POST   /api/returns/[id]/generate   — Generate the return (validates prerequisites)
POST   /api/returns/[id]/file       — Mark return as filed, record filing date, trigger Stellar anchor
GET    /api/returns/[id]/pdf        — Stream generated PDF for download
GET    /api/returns/sequence        — Get filing sequence with dependency graph
```

### Prior Year Credits
```
GET    /api/prior-year-credit        — Get all prior year credits for current taxpayer
POST   /api/prior-year-credit        — Add prior year credit (validates disposition = Carry Over)
DELETE /api/prior-year-credit/[id]   — Remove prior year credit
```

### Overpayment
```
GET    /api/overpayment/[taxYear]    — Get overpayment disposition for a tax year
POST   /api/overpayment/[taxYear]    — Set disposition (Carry Over / Refund / TCC)
PATCH  /api/overpayment/[taxYear]    — Record settlement event (REFUND_RECEIVED / TCC_APPLIED / CARRY_OVER_APPLIED)
```

### Penalties
```
GET    /api/penalties           — Get penalty breakdown for all returns in active tax year
GET    /api/penalties/[returnId] — Get penalty for specific return
POST   /api/penalties/simulate  — What-if: simulate penalty cost if filed on a given date
```

### SAWT & Filing Package
```
GET    /api/sawt                — Get SAWT data for active tax year
GET    /api/sawt/export         — Download SAWT as CSV (BIR eSubmission format)
GET    /api/sawt/attachments    — Get attachments checklist with status per item
GET    /api/filing-package      — Get full filing package metadata
GET    /api/filing-package/download — Stream ZIP of all 8 returns + SAWT + cover sheet
```
All endpoints in this section honor the active-year resolver:
`?year=YYYY` query param → `active_year` cookie → latest tax year. The
selected year is written back to the `active_year` cookie on the response.

### Journal Entries
```
GET    /api/journal                      — List all journal entries for active tax year
                                             Filters: ?subsection=9A&quarter=1&accountName=CWT
GET    /api/journal/[subsection]         — Get entries for a specific sub-section (9A–9G)
                                             Filters: ?quarter=1&accountName=CWT
POST   /api/journal/generate             — Trigger full regeneration of all journal entries from existing data
GET    /api/journal/export               — Download XLSX workbook (2 sheets: entries + legend)
GET    /api/journal/accounts             — List all chart of accounts used in journal entries
```

### Stellar Integration
```
GET    /api/stellar/receipts         — List all on-chain filing records for current taxpayer
POST   /api/stellar/anchor           — Anchor a filing event on Stellar (called by /file endpoint)
GET    /api/stellar/verify/[txId]    — Verify a TX ID against Stellar ledger
GET    /api/stellar/status           — Stellar network connection health check
```

### Admin
```
GET    /api/admin/users              — List all users
GET    /api/admin/audit-log          — Get audit log entries (filterable)
GET    /api/admin/atc                — List all ATC codes including inactive
POST   /api/admin/atc                — Create ATC code
PATCH  /api/admin/atc                — Update ATC code (canonical update path; body: { code, description?, ewtRate?, isActive? })
DELETE /api/admin/atc                — Delete ATC code (body: { code })
GET    /api/admin/holidays           — List holiday calendar entries
POST   /api/admin/holidays           — Add holiday
PUT    /api/admin/penalties/rdo      — Update compromise penalty schedule by RDO
GET    /api/admin/system-health      — Aggregate Stellar + storage + DB health
```

---

## Database Schema (Prisma)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String          @id @default(cuid())
  username      String          @unique
  passwordHash  String
  role          Role            @default(TAXPAYER)
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
  taxpayer      TaxpayerProfile?
  auditLogs     AuditLog[]
}

enum Role {
  ADMIN
  TAXPAYER
}

model TaxpayerProfile {
  id              String    @id @default(cuid())
  userId          String    @unique
  user            User      @relation(fields: [userId], references: [id])
  tin             String    @unique  // NNN-NNN-NNN-NNN
  fullName        String
  rdoCode         String
  registeredAddress String
  zipCode         String
  natureOfBusiness  String
  incomeType        IncomeType      @default(PURE_SELF_EMPLOYMENT)  // PURE_SELF_EMPLOYMENT or MIXED_INCOME
  corIncludes2551Q  Boolean         @default(true)                  // false = BIR removed 2551Q from COR at registration
  isNewRegistrant   Boolean         @default(false)                 // true = elected 8% on Form 1901 at initial BIR registration; election pre-confirmed
  atcCodes        TaxpayerATC[]
  taxYears        TaxYear[]
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}

model ATCCode {
  code        String        @id   // e.g. WI071
  description String
  ewtRate     Decimal       @db.Decimal(5, 4)  // e.g. 0.1000 for 10%
  isActive    Boolean       @default(true)
  taxpayers   TaxpayerATC[]
  certificates Form2307[]
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}

model TaxpayerATC {
  id          String          @id @default(cuid())
  taxpayerId  String
  atcCode     String
  taxpayer    TaxpayerProfile @relation(fields: [taxpayerId], references: [id])
  atc         ATCCode         @relation(fields: [atcCode], references: [code])
  createdAt   DateTime        @default(now())
}

model TaxYear {
  id              String          @id @default(cuid())
  taxpayerId      String
  taxpayer        TaxpayerProfile @relation(fields: [taxpayerId], references: [id])
  year            Int             // e.g. 2025
  electionStatus  ElectionStatus  @default(NOT_ELECTED)
  electedRate     TaxRate?
  electionDate    DateTime?
  electionLockedAt DateTime?
  vatBreached     Boolean         @default(false)
  vatBreachDate   DateTime?
  certificates    Form2307[]
  returns         TaxReturn[]
  priorYearCredit PriorYearCredit?
  overpayment     Overpayment?
  journalEntries  JournalEntry[]
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@unique([taxpayerId, year])
}

enum IncomeType {
  PURE_SELF_EMPLOYMENT
  MIXED_INCOME
}

enum ElectionStatus {
  NOT_ELECTED
  ELECTED_8PCT
  ELECTED_GRADUATED
}

enum TaxRate {
  RATE_8PCT
  GRADUATED
}

model Form2307 {
  id              String    @id @default(cuid())
  taxYearId       String
  taxYear         TaxYear   @relation(fields: [taxYearId], references: [id])
  quarter         Int       // 1, 2, 3, or 4
  payorTin        String
  payorName       String
  atcCode         String
  atc             ATCCode   @relation(fields: [atcCode], references: [code])
  month1Amount    Decimal   @db.Decimal(15, 2)
  month2Amount    Decimal   @db.Decimal(15, 2)
  month3Amount    Decimal   @db.Decimal(15, 2)
  quarterlyTotal  Decimal   @db.Decimal(15, 2)
  cwtWithheld     Decimal   @db.Decimal(15, 2)
  cwtValidated    Boolean   @default(false)
  cwtDiscrepancy  Decimal?  @db.Decimal(15, 2)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}

model TaxReturn {
  id              String        @id @default(cuid())
  taxYearId       String
  taxYear         TaxYear       @relation(fields: [taxYearId], references: [id])
  formType        FormType
  quarter         Int?          // null for annual 1701A
  sequenceOrder   Int           // 1–8
  status          ReturnStatus  @default(BLOCKED)
  computedTaxDue  Decimal?      @db.Decimal(15, 2)
  taxCreditsTotal Decimal?      @db.Decimal(15, 2)
  netTaxDue       Decimal?      @db.Decimal(15, 2)
  overpaymentAmt  Decimal?      @db.Decimal(15, 2)
  statutoryDueDate DateTime
  filedDate       DateTime?
  generatedAt     DateTime?
  pdfPath         String?
  penalties       ReturnPenalty?
  stellarReceipt  StellarReceipt?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@unique([taxYearId, formType, quarter])
}

enum FormType {
  FORM_2551Q
  FORM_1701Q
  FORM_1701A
}

enum ReturnStatus {
  BLOCKED
  PENDING
  GENERATED
  FILED
}

model ReturnPenalty {
  id                String      @id @default(cuid())
  returnId          String      @unique
  taxReturn         TaxReturn   @relation(fields: [returnId], references: [id])
  daysLate          Int         @default(0)
  surcharge         Decimal     @db.Decimal(15, 2) @default(0)
  interest          Decimal     @db.Decimal(15, 2) @default(0)
  compromisePenalty Decimal     @db.Decimal(15, 2) @default(0)
  totalPenalty      Decimal     @db.Decimal(15, 2) @default(0)
  computedAt        DateTime    @default(now())
}

model PriorYearCredit {
  id                  String    @id @default(cuid())
  taxYearId           String    @unique
  taxYear             TaxYear   @relation(fields: [taxYearId], references: [id])
  amount              Decimal   @db.Decimal(15, 2)
  originYear          Int
  originForm          String
  priorDisposition    String   // must be "CARRY_OVER" to be eligible
  isValidated         Boolean   @default(false)
  userConfirmedAt     DateTime?
  sourceOverpaymentId String?  // links to the prior-year Overpayment that produced this credit (used by 9.16)
  createdAt           DateTime  @default(now())
}

model Overpayment {
  id                  String              @id @default(cuid())
  taxYearId           String              @unique
  taxYear             TaxYear             @relation(fields: [taxYearId], references: [id])
  amount              Decimal             @db.Decimal(15, 2)
  disposition         OverpaymentOption?
  electedAt           DateTime?
  carryOverAppliedAt  DateTime?           // 9.16 — set when next year applies the carry-over
  refundReceivedAt    DateTime?           // 9.18 — set when BIR refund is received
  refundReference     String?             // BIR acknowledgement reference for refund
  tccNumber           String?             // Tax Credit Certificate number (for 9.20)
  tccAppliedAt        DateTime?           // 9.20 — set when TCC is applied against 1701A
  createdAt           DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
}

enum OverpaymentOption {
  CARRY_OVER
  REFUND
  TAX_CREDIT_CERTIFICATE
}

model StellarReceipt {
  id              String      @id @default(cuid())
  returnId        String      @unique
  taxReturn       TaxReturn   @relation(fields: [returnId], references: [id])
  stellarTxId     String      @unique
  payloadHash     String      // SHA-256 of the filing package PDF
  network         String      @default("testnet")
  anchoredAt      DateTime    @default(now())
  explorerUrl     String
  status          AnchorStatus @default(PENDING)
}

enum AnchorStatus {
  PENDING
  CONFIRMED
  FAILED
}

model RDOPenaltySchedule {
  id              String    @id @default(cuid())
  rdoCode         String    @unique
  compromiseFee   Decimal   @db.Decimal(10, 2)  // per late return
  updatedAt       DateTime  @updatedAt
}

model JournalEntry {
  id              String        @id @default(cuid())
  taxYearId       String
  taxYear         TaxYear       @relation(fields: [taxYearId], references: [id], onDelete: Cascade)
  entryNumber     String        // e.g. "9.1", "9.2"
  subsection      String        // "9A" through "9G"
  triggerEvent    String        // e.g. "2307_ADDED", "RETURN_1701Q_FILED"
  triggerEntityId String?       // ID of the 2307, return, or overpayment that triggered this
  quarter         Int?          // 1-4 for quarterly entries (9A/9B/9C); null for annual (9D-9G)
  entryDate       DateTime
  lines           JournalLine[]
  regulationRef   String?       // e.g. "RR No. 8-2018"
  workflowMenu    String?       // e.g. "Income > Add 2307"
  isMemo          Boolean       @default(false)  // true = no cash movement, informational only
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
}

model JournalLine {
  id              String        @id @default(cuid())
  entryId         String
  entry           JournalEntry  @relation(fields: [entryId], references: [id])
  lineOrder       Int
  accountCode     String
  accountName     String        // e.g. "CWT Receivable", "Service Income"
  debit           Decimal?      @db.Decimal(15, 2)
  credit          Decimal?      @db.Decimal(15, 2)
}

model PublicHoliday {
  id      String    @id @default(cuid())
  date    DateTime  @db.Date
  name    String
  year    Int
}

model AuditLog {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  action      String    // e.g. "ELECTION_CONFIRMED", "RETURN_FILED", "STELLAR_ANCHORED"
  entityType  String?   // e.g. "TaxReturn", "TaxYear"
  entityId    String?
  metadata    Json?
  createdAt   DateTime  @default(now())
}
```

---

## Seed Script

```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  // Admin user
  const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD ?? 'admin1234!', 12)
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash,
      role: 'ADMIN',
    },
  })

  // ATC Codes
  const atcCodes = [
    { code: 'WI071', description: 'Insurance Agents & Adjusters', ewtRate: 0.10 },
    { code: 'WI140', description: "Agent/Broker's Fees", ewtRate: 0.10 },
    { code: 'WI100', description: 'Professional fees — lawyers, CPAs, engineers', ewtRate: 0.10 },
    { code: 'WI160', description: 'Fees of directors who are not employees', ewtRate: 0.15 },
  ]
  for (const atc of atcCodes) {
    await prisma.aTCCode.upsert({
      where: { code: atc.code },
      update: {},
      create: atc,
    })
  }

  // RDO Penalty Schedules (sample)
  const rdoPenalties = [
    { rdoCode: '040', compromiseFee: 500 },
    { rdoCode: '044', compromiseFee: 500 },
    { rdoCode: '050', compromiseFee: 1000 },
  ]
  for (const rdo of rdoPenalties) {
    await prisma.rDOPenaltySchedule.upsert({
      where: { rdoCode: rdo.rdoCode },
      update: {},
      create: rdo,
    })
  }

  console.log('Seed complete.')
}

main().catch(console.error).finally(() => prisma.$disconnect())
```

---

## Stellar Integration

### Anchoring Flow

When a return is marked as filed (`POST /api/returns/[id]/file`):

1. System generates the return PDF and stores it in Railway Volume
2. SHA-256 hash of the PDF bytes is computed
3. Two Stellar `manageData` operations are submitted in a single transaction:
   - Key: `kuwenta:ph:${returnId}` (truncated to 64 chars)
     - Value: the 64-character SHA-256 hex hash
   - Key: `kuwenta:ts:${returnId}` (truncated to 64 chars)
     - Value: `filedDate.toISOString()`
   
   The hash and timestamp are split because a single 64-byte manageData value
   cannot hold a 64-character hex hash plus an ISO timestamp.
4. Transaction is signed using the system's Stellar keypair (env: `STELLAR_SECRET_KEY`)
5. TX ID, hash, and timestamp stored in `StellarReceipt` table
6. Explorer URL: `https://stellar.expert/explorer/testnet/tx/{txId}`

### Verification Flow

Anyone with a TX ID can:
1. Look up the TX on Stellar explorer or via Horizon
2. Read both `manageData` operations (hash under `kuwenta:ph:*`, timestamp under `kuwenta:ts:*`)
3. Compare hash against the original PDF (if available)

### Environment Variables
```
STELLAR_SECRET_KEY=       # System keypair for signing anchor transactions
STELLAR_NETWORK=testnet   # testnet | mainnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_FRIENDBOT_URL=https://friendbot.stellar.org
```

---

## Critical Business Rules (Enforced at API Layer)

| Rule | Enforcement Point |
|------|-----------------|
| BR-01: Q1 2551Q must be first | `GET /api/returns/sequence` dependency check; `POST /api/returns/[id]/generate` blocks if prerequisite unmet |
| BR-02: Item 13 on Q1 only | Return generator logic — Item 13 flag injected only for Q1 2551Q |
| BR-03: 8% election irrevocable | `POST /api/election` locks `electionLockedAt`; no update endpoint exists for election |
| BR-04: 2551Q tax due = ₱0 under 8% | Computation engine: if `electedRate === RATE_8PCT`, percentage tax forced to 0 |
| BR-05: 1701Q is cumulative | Computation engine: Q2 pulls Q1+Q2 gross; Q3 pulls Q1+Q2+Q3 gross |
| BR-06: ₱250k exemption applied correctly | Applied in both quarterly 1701Q and annual 1701A formulas |
| BR-07: No FS under 8% | SAWT attachments endpoint suppresses FS line item when `electedRate === RATE_8PCT` |
| BR-08: 1701A not 1701 | Return generator never produces Form 1701 when 8% is elected |
| BR-09: Prior year credit = Carry Over only | `POST /api/prior-year-credit` rejects if `priorDisposition !== 'CARRY_OVER'` |
| BR-10: No cross-tax CWT offset | Computation engine maintains separate credit pools for income tax and percentage tax |
| BR-11: Election resets each year | `TaxYear` record initializes `electionStatus = NOT_ELECTED` on each new year |
| BR-12: VAT threshold revocation | Income ingestion checks running total after every `POST /api/income`; triggers revocation at ₱3,000,000 |
| BR-13: Mixed-income earners — no ₱250k exemption | If `incomeType === MIXED_INCOME`, exemption is set to ₱0 in all 1701Q and 1701A computations. Legal basis: RR No. 8-2018 Sec. 3(D) |
| BR-14: No 2551Q if not in COR | If `corIncludes2551Q === false`, filing sequence skips all 2551Q returns. Election is made via Item 16 on Q1 1701Q instead. Total returns = 4. Legal basis: RMO No. 23-2018 Sec. C.2.1 |
| BR-15: Penalty rates per Ease of Paying Taxes Act | Surcharge = 10% (not 25%); Interest = 6% p.a. (not 12%) for taxpayers with gross receipts < ₱3,000,000. All Kuwenta users qualify. Legal basis: RA No. 11976; RR No. 6-2024; RR No. 8-2024 |
| BR-16: Annual registration fee is ₱30 DST only | The ₱500 annual BIR registration fee was abolished under RA 11976 effective January 22, 2024. Never display or reference ₱500. Only ₱30 Documentary Stamp Tax applies. Legal basis: RA No. 11976 Sec. 18; RR No. 6-2024 |
| BR-17: 1701A is scoped to 8% electees only in Kuwenta | OSD taxpayers on graduated rates also use 1701A in real life, but Kuwenta does not serve them. Hard-block 1701A generation for any user not on active 8% election. Display out-of-scope message for OSD/graduated rate users. |
| BR-18: New registrants who elected 8% on Form 1901 are pre-elected | No Item 13 or Item 16 election required in-app. Mark election as confirmed at onboarding if `isNewRegistrant = true`. Legal basis: RR No. 8-2018 Sec. 3; BIR Form 1901 |

---

## Penalty Computation Logic

```
// Ease of Paying Taxes Act (RA 11976, effective Jan 22, 2024) lowered rates
// for small taxpayers (gross receipts < ₱3,000,000). All Kuwenta users qualify.
// RR No. 6-2024 (effective Apr 27, 2024); RR No. 8-2024

surcharge = (taxDue > 0 && daysLate > 0) ? taxDue * 0.10 : 0   // was 25% under old law
interest  = (taxDue > 0 && daysLate > 0) ? taxDue * 0.06 * (daysLate / 365) : 0  // was 12%
compromise = (daysLate > 0) ? rdoPenaltySchedule[rdoCode].compromiseFee : 0
total = surcharge + interest + compromise
```

Key rule: surcharge and interest are ₱0 when `taxDue = 0`, but compromise penalty still applies.

---

## Filing Due Date Engine

```typescript
const DUE_DATES: Record<string, (year: number) => Date> = {
  '2551Q-Q1': (y) => new Date(y, 3, 25),       // April 25
  '2551Q-Q2': (y) => new Date(y, 6, 25),       // July 25
  '2551Q-Q3': (y) => new Date(y, 9, 25),       // October 25
  '2551Q-Q4': (y) => new Date(y + 1, 0, 25),  // January 25 next year
  '1701Q-Q1': (y) => new Date(y, 4, 15),       // May 15
  '1701Q-Q2': (y) => new Date(y, 7, 15),       // August 15
  '1701Q-Q3': (y) => new Date(y, 10, 15),      // November 15
  '1701A':    (y) => new Date(y + 1, 3, 15),  // April 15 next year
}

// Roll forward if due date falls on weekend or public holiday
function adjustForHoliday(date: Date, holidays: Date[]): Date { ... }
```

---

## File Storage

Railway Volume mount path: `/app/storage`

Directory structure:
```
/app/storage/
  returns/
    {taxYearId}/
      {returnId}/
        generated.pdf
        filing-package.zip
  income/
    {taxYearId}/
      sawt-export.csv
```

---

## Docker Compose (Development)

```yaml
# docker-compose.yml
version: '3.9'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: kuwenta
      POSTGRES_PASSWORD: kuwenta_dev
      POSTGRES_DB: kuwenta
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: kuwenta
      MINIO_ROOT_PASSWORD: kuwenta_dev
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data

volumes:
  postgres_data:
  minio_data:
```

---

## Environment Variables

```bash
# .env.example

# App
NODE_ENV=development
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
JWT_SECRET=
ADMIN_PASSWORD=

# Database
DATABASE_URL=postgresql://kuwenta:kuwenta_dev@localhost:5432/kuwenta

# File Storage (dev: MinIO, prod: Railway Volume)
STORAGE_TYPE=local              # local | railway
STORAGE_PATH=/app/storage
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=kuwenta
MINIO_SECRET_KEY=kuwenta_dev
MINIO_BUCKET=kuwenta

# Stellar
STELLAR_SECRET_KEY=
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org

# Railway (prod only)
RAILWAY_VOLUME_MOUNT_PATH=/app/storage
```

---

## The Demo Moment

Maria opens the app. She completes onboarding in 3 minutes — TIN, RDO code, ATC codes. She uploads 8 Form 2307 certificates from her two payors. The system validates each one, computes her full-year position: ₱187,009.33 gross, ₱18,700.92 CWT withheld, ₱54,270 carry-over credit, resulting in a ₱72,970.92 overpayment. She elects Carry Over. All 8 returns generate in sequence. SAWT is ready for eSubmission. Her dashboard is fully green.

Each filed return shows a Stellar transaction ID. She taps one — a QR code appears. She hands her phone to a loan officer. The officer scans it, opens the Stellar explorer, sees the hash and timestamp. Compliance confirmed in 30 seconds. No BIR queue. No PDF hunting.

---

*Legal basis: NIRC as amended by RA 10963 (TRAIN Law) | RR No. 8-2018 | RMO No. 23-2018 | RMC No. 28-2019 | NIRC Sections 24(A), 74, 76, 109, 116, 248–249*