# AGENT.md — Kuwenta Coding Agent Guide

You are building **Kuwenta** — a Philippine individual tax compliance system for self-employed freelancers, with a Stellar blockchain layer for immutable filing receipts. Read this file completely before writing a single line of code.

---

## What You Are Building

A Next.js 15 full-stack web application that:
1. Guides Filipino freelancers through 8 mandatory BIR tax returns in the correct legally-mandated sequence
2. Automates all tax computation from BIR Form 2307 income data
3. Generates complete, BIR-compliant filing packages including SAWT
4. Anchors every filed return as a tamper-proof receipt on the Stellar testnet

This is a compliance-critical application. Incorrect computation or sequence enforcement is not a bug — it is a legal liability. Every business rule in SPEC.md is non-negotiable.

---

## Tech Stack — Exact Versions

```json
{
  "next": "15.x",
  "react": "19.x",
  "typescript": "5.x",
  "prisma": "5.x",
  "@prisma/client": "5.x",
  "tailwindcss": "3.x",
  "stellar-sdk": "12.x",
  "@react-pdf/renderer": "3.x",
  "bcrypt": "5.x",
  "jose": "5.x",
  "zod": "3.x",
  "pnpm": "9.x"
}
```

Always install the latest stable version within each major. Run `pnpm outdated` before finalizing and upgrade any stale dependencies.

---

## Project Structure

```
kuwenta/
├── app/                          # Next.js App Router
│   ├── (auth)/
│   │   └── login/
│   │       └── page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx            # Protected layout with sidebar
│   │   ├── dashboard/page.tsx
│   │   ├── onboarding/page.tsx
│   │   ├── income/page.tsx
│   │   ├── election/page.tsx
│   │   ├── returns/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── prior-year-credit/page.tsx
│   │   ├── sawt/page.tsx
│   │   └── stellar/page.tsx
│   ├── admin/
│   │   └── page.tsx
│   └── api/
│       ├── auth/
│       ├── taxpayer/
│       ├── atc/
│       ├── income/
│       ├── election/
│       ├── computation/
│       ├── returns/
│       ├── prior-year-credit/
│       ├── overpayment/
│       ├── penalties/
│       ├── sawt/
│       ├── filing-package/
│       └── stellar/
├── components/
│   ├── ui/                       # shadcn/ui components
│   ├── dashboard/
│   ├── income/
│   ├── returns/
│   └── stellar/
├── lib/
│   ├── auth.ts                   # JWT helpers
│   ├── journal/
│   │   ├── generator.ts          # Main orchestrator — generates all entries from existing data
│   │   ├── entries/
│   │   │   ├── 9a-income.ts      # 2307 income recognition entries (9.1–9.2)
│   │   │   ├── 9b-2551q.ts       # Percentage tax entries (9.3–9.5)
│   │   │   ├── 9c-1701q.ts       # Quarterly income tax entries (9.6–9.9)
│   │   │   ├── 9d-prior-year.ts  # Prior year carry-over entries (9.10–9.11)
│   │   │   ├── 9e-1701a.ts       # Annual income tax entries (9.12–9.14)
│   │   │   ├── 9f-overpayment.ts # Overpayment disposition entries (9.15–9.20)
│   │   │   └── 9g-closing.ts     # Year-end closing entries
│   │   └── xlsx-export.ts        # XLSX workbook generator (2 sheets)
│   ├── prisma.ts                 # Prisma singleton
│   ├── computation/
│   │   ├── eligibility.ts        # 5-condition eligibility checker
│   │   ├── percentage-tax.ts     # 2551Q computation
│   │   ├── quarterly-income.ts   # 1701Q cumulative computation
│   │   ├── annual-income.ts      # 1701A computation
│   │   ├── penalties.ts          # Surcharge, interest, compromise
│   │   └── due-dates.ts          # Statutory due dates + holiday rolling
│   ├── stellar/
│   │   ├── client.ts             # Stellar SDK setup
│   │   ├── anchor.ts             # Anchor filing event on-chain
│   │   └── verify.ts             # Verify TX against ledger
│   ├── pdf/
│   │   ├── form-2551q.tsx        # 2551Q PDF template
│   │   ├── form-1701q.tsx        # 1701Q PDF template
│   │   ├── form-1701a.tsx        # 1701A PDF template
│   │   └── filing-package.tsx    # Cover sheet + package assembler
│   └── storage.ts                # File storage abstraction (local/Railway)
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── docker-compose.yml
├── .env.example
├── .env.local                    # Git-ignored
└── SPEC.md
```

---

## Core Principles

### 1. Tax computation lives in `lib/computation/` — never in components or API handlers

Every computation function must be:
- **Pure** — same inputs always produce same outputs
- **Typed** — use TypeScript types for all monetary values
- **Tested** — write unit tests for every computation function using the reference figures from SPEC.md

Reference test case (from the real engagement):
```typescript
// Full-year gross: ₱187,009.33
// CWT withheld:   ₱18,700.92
// Prior year credit: ₱54,270.00
// Expected annual tax due: ₱0.00
// Expected overpayment: ₱72,970.92
```

### 2. Use Decimal.js for all monetary arithmetic — never floating point

```typescript
import Decimal from 'decimal.js'

// CORRECT
const tax = grossIncome.minus(new Decimal('250000')).times('0.08')

// WRONG — never do this
const tax = (grossIncome - 250000) * 0.08
```

### 3. Business rules enforced at the API layer, not just the UI

Every API route that modifies state must re-validate the relevant business rules server-side. Never trust the client to have enforced them.

### 4. The filing sequence is a hard dependency graph — enforce it everywhere

Before generating or filing any return, check the dependency chain:
```typescript
// RA 11976 (Ease of Paying Taxes Act) — effective Jan 22, 2024
// All Kuwenta users earn < ₱3,000,000 so ALL qualify for reduced rates
// RR No. 6-2024 (effective Apr 27, 2024); RR No. 8-2024
const SURCHARGE_RATE = 0.10   // was 0.25 before RA 11976
const INTEREST_RATE  = 0.06   // was 0.12 before RA 11976
```

```typescript
// Standard path (COR includes 2551Q) — 8 returns
const SEQUENCE_DEPENDENCIES_8: Record<number, number[]> = {
  1: [],           // 2551Q Q1 — election on Item 13; no dependencies
  2: [1],          // 2551Q Q2
  3: [1, 2],       // 2551Q Q3
  4: [1, 2, 3],    // 2551Q Q4
  5: [1],          // 1701Q Q1 — needs Q1 2551Q
  6: [1, 5],       // 1701Q Q2
  7: [1, 5, 6],    // 1701Q Q3
  8: [1, 5, 6, 7], // 1701A
}

// Reduced path (COR does NOT include 2551Q) — 4 returns
// Election made on Item 16 of Q1 1701Q instead of Item 13 of Q1 2551Q
// Legal basis: RMO No. 23-2018 Sec. C.2.1; RR No. 8-2018 Sec. 3
const SEQUENCE_DEPENDENCIES_4: Record<number, number[]> = {
  1: [],     // 1701Q Q1 — election on Item 16
  2: [1],    // 1701Q Q2
  3: [1, 2], // 1701Q Q3
  4: [1, 2, 3], // 1701A
}

// Use taxpayer.corIncludes2551Q to select which dependency map applies
```

---

## Authentication

- JWT stored in httpOnly, Secure, SameSite=Strict cookie — never localStorage
- Use `jose` library for JWT signing and verification (not jsonwebtoken)
- Token expiry: 8 hours
- Middleware in `middleware.ts` protects all routes except `/login` and `/api/auth/login`
- Admin role checked via `user.role === 'ADMIN'` from JWT payload
- bcrypt rounds: 12

```typescript
// lib/auth.ts — token structure
interface JWTPayload {
  sub: string       // userId
  username: string
  role: 'ADMIN' | 'TAXPAYER'
  iat: number
  exp: number
}

// Onboarding flags that affect all downstream logic — always pass these through
interface TaxpayerFlags {
  incomeType: 'PURE_SELF_EMPLOYMENT' | 'MIXED_INCOME'
  corIncludes2551Q: boolean   // false = 4-return path, election via 1701Q Item 16
  isNewRegistrant: boolean    // true = election pre-confirmed via Form 1901; skip election step
}
```

---

## API Route Conventions

All API routes follow this pattern:

```typescript
// app/api/[resource]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { z } from 'zod'

export async function POST(req: NextRequest) {
  // 1. Auth check
  const session = await requireAuth(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Input validation with Zod
  const body = await req.json()
  const result = schema.safeParse(body)
  if (!result.success) return NextResponse.json({ error: result.error.format() }, { status: 400 })

  // 3. Business logic
  try {
    // ...
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

Never expose stack traces or Prisma errors to the client. Log server-side, return generic error message.

---

## Prisma Usage

```typescript
// lib/prisma.ts — singleton for dev HMR
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- Always use `prisma.$transaction()` for operations that must be atomic (e.g., marking return as filed + anchoring on Stellar)
- Never run Prisma queries in React Server Components directly — always through API routes
- Run `prisma migrate dev` for local, `prisma migrate deploy` for Railway

---

## Stellar Integration

```typescript
// lib/stellar/client.ts
import { Horizon, Keypair, Networks } from '@stellar/stellar-sdk'

export const horizon = new Horizon.Server(
  process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org'
)

export const networkPassphrase =
  process.env.STELLAR_NETWORK === 'mainnet'
    ? Networks.PUBLIC
    : Networks.TESTNET

export const systemKeypair = Keypair.fromSecret(process.env.STELLAR_SECRET_KEY!)
```

```typescript
// lib/stellar/anchor.ts
import crypto from 'crypto'
import { horizon, networkPassphrase, systemKeypair } from './client'
import { TransactionBuilder, Operation, Asset, BASE_FEE } from '@stellar/stellar-sdk'

export async function anchorFilingReceipt(
  returnId: string,
  pdfBuffer: Buffer
): Promise<string> {
  const hash = crypto.createHash('sha256').update(pdfBuffer).digest('hex')
  const timestamp = new Date().toISOString()

  const account = await horizon.loadAccount(systemKeypair.publicKey())

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      Operation.manageData({
        name: `tc:${returnId}`.substring(0, 64),
        value: `${hash}:${timestamp}`.substring(0, 64),
      })
    )
    .setTimeout(30)
    .build()

  tx.sign(systemKeypair)
  const result = await horizon.submitTransaction(tx)
  return result.hash
}
```

Wrap Stellar calls in try/catch. A Stellar failure must NOT prevent the return from being marked as filed — log the failure, set `StellarReceipt.status = FAILED`, and expose a retry button in the UI.

---

## Tax Computation — Key Functions

```typescript
// lib/computation/quarterly-income.ts

export function computeQuarterlyIncomeTax(
  cumulativeGross: Decimal,
  priorQuartersTaxPaid: Decimal,
  incomeType: 'PURE_SELF_EMPLOYMENT' | 'MIXED_INCOME' = 'PURE_SELF_EMPLOYMENT'
): Decimal {
  // Mixed-income earners do NOT get the ₱250,000 exemption on freelance income —
  // it is already consumed by their compensation income side.
  // Legal basis: RR No. 8-2018 Sec. 3(D); RMC No. 50-2018
  const exemption = incomeType === 'MIXED_INCOME' ? new Decimal('0') : new Decimal('250000')
  const taxableIncome = Decimal.max(cumulativeGross.minus(exemption), 0)
  const taxDue = taxableIncome.times('0.08')
  const netTaxDue = Decimal.max(taxDue.minus(priorQuartersTaxPaid), 0)
  return netTaxDue.toDecimalPlaces(2)
}

// lib/computation/annual-income.ts

export function computeAnnualIncomeTax(
  fullYearGross: Decimal,
  priorYearCredit: Decimal,
  quarterlyPayments: Decimal,
  cwtWithheld: Decimal,
  incomeType: 'PURE_SELF_EMPLOYMENT' | 'MIXED_INCOME' = 'PURE_SELF_EMPLOYMENT'
): { taxDue: Decimal; totalCredits: Decimal; netPosition: Decimal } {
  // No ₱250,000 exemption for mixed-income earners on the freelance side
  const exemption = incomeType === 'MIXED_INCOME' ? new Decimal('0') : new Decimal('250000')
  const taxableIncome = Decimal.max(fullYearGross.minus(exemption), 0)
  const taxDue = taxableIncome.times('0.08').toDecimalPlaces(2)

  // Credits in BIR-prescribed sequence
  const totalCredits = priorYearCredit
    .plus(quarterlyPayments)
    .plus(cwtWithheld)
    .toDecimalPlaces(2)

  const netPosition = taxDue.minus(totalCredits).toDecimalPlaces(2)

  return { taxDue, totalCredits, netPosition }
  // netPosition < 0 means overpayment
}
```

---

## PDF Generation

Use `@react-pdf/renderer` for all BIR forms. Each form is a React component that accepts typed props and renders a styled PDF.

```typescript
// lib/pdf/form-1701a.tsx
import { Document, Page, Text, View } from '@react-pdf/renderer'

interface Form1701AProps {
  taxpayer: TaxpayerProfile
  taxYear: number
  computation: AnnualComputation
  overpaymentDisposition?: OverpaymentOption
}

export function Form1701A({ taxpayer, taxYear, computation, overpaymentDisposition }: Form1701AProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* BIR form layout */}
      </Page>
    </Document>
  )
}
```

Generate PDFs server-side in API routes using `renderToBuffer()`. Store to Railway Volume. Never generate PDFs in the browser.

---

## Security Checklist

Follow all of these without exception:

**Authentication & Authorization**
- [ ] All API routes check auth before any logic
- [ ] Admin-only routes check `role === 'ADMIN'` explicitly
- [ ] JWT in httpOnly cookie, never in localStorage or response body
- [ ] Rotate NEXTAUTH_SECRET and JWT_SECRET in production — never commit them

**Input Validation**
- [ ] All API input validated with Zod before touching the database
- [ ] TIN format validated: `/^\d{3}-\d{3}-\d{3}(-\d{3})?$/` (9-digit TINs are normalised to 12 digits)
- [ ] All monetary amounts parsed as strings and converted to Decimal — never as JS numbers
- [ ] File uploads: validate MIME type and file size server-side

**Data Isolation**
- [ ] All database queries filter by the authenticated user's taxpayerId
- [ ] Never expose another taxpayer's data — always scope queries with `WHERE taxpayerId = ?`
- [ ] Admin can view all — non-admin can only see their own records

**SQL Injection**
- [ ] Use Prisma parameterized queries only — never raw SQL with string interpolation
- [ ] If `prisma.$queryRaw` is used anywhere, use tagged template literals only

**Audit Trail**
- [ ] All state-changing actions (election, filing, Stellar anchoring) create an AuditLog entry
- [ ] AuditLog is append-only — no update or delete operations on it ever

**Stellar**
- [ ] STELLAR_SECRET_KEY never logged, never sent to client
- [ ] Stellar failures are caught and logged — never crash the request
- [ ] Always use testnet unless STELLAR_NETWORK=mainnet is explicitly set

**Headers & CORS**
- [ ] Set `X-Content-Type-Options: nosniff`
- [ ] Set `X-Frame-Options: DENY`
- [ ] Set `Content-Security-Policy` appropriate for Next.js
- [ ] API routes reject requests with unexpected Content-Type

**Error Handling**
- [ ] Never return Prisma error objects or stack traces to the client
- [ ] Use structured error responses: `{ error: string, code?: string }`
- [ ] Log all server errors with context (userId, route, timestamp)

---

## UI/UX Conventions

- Use shadcn/ui components — do not build primitive UI components from scratch
- Tailwind only — no inline styles, no CSS modules unless absolutely necessary
- All monetary amounts displayed with Philippine Peso format: `₱1,234.56`
- Form validation shown inline — no alert() calls ever
- Loading states on all async actions (skeleton loaders for data, spinner for mutations)
- Status colors: Filed = green-600, Pending = amber-500, Blocked = red-500
- Mobile-responsive — the demo may be shown on a phone

### Compliance Roadmap Component

The filing sequence roadmap on the dashboard is the most critical UI component. It must:
- Show all 8 returns in sequence with clear status indicators
- Show the statutory deadline alongside each return
- Show days until deadline (or days overdue in red)
- Show Stellar TX ID with external link for filed returns
- Be updated in real time when any return status changes

---

## Railway Deployment

All services deploy to Railway. Use environment variable groups:

```
Production environment variables set in Railway dashboard:
- DATABASE_URL (auto-injected by Railway Postgres plugin)
- RAILWAY_VOLUME_MOUNT_PATH (auto-injected by Railway Volume)
- NODE_ENV=production
- All secrets from .env.example
```

Railway build command: `pnpm build`  
Railway start command: `pnpm start`  
Post-deploy command: `pnpm prisma migrate deploy`

Do not commit `.env.local` or any file containing secrets. Use `.env.example` with placeholder values only.

---

## Development Setup Checklist

When setting up a fresh development environment:

```bash
# 1. Clone and install
git clone <repo>
cd kuwenta
pnpm install

# 2. Copy env file
cp .env.example .env.local
# Fill in values in .env.local

# 3. Start dev services
docker-compose up -d

# 4. Run migrations and seed
pnpm prisma migrate dev
pnpm prisma db seed

# 5. Start dev server
pnpm dev
```

Default admin credentials (from seed):
- Username: `admin`
- Password: value of `ADMIN_PASSWORD` in `.env.local`

### Windows-specific notes

- `lib/storage.ts` defaults `STORAGE_PATH` to `/app/storage`, which does not
  exist on Windows dev machines. Set `STORAGE_PATH=./storage` in `.env.local`
  (or per-shell) to redirect PDF and SAWT output to a local directory.
- `lib/__tests__/storage.test.ts` contains a Windows-only `describe` block
  (guarded by `describe.skipIf(!IS_WINDOWS)`) that round-trips a file under
  the override path. On POSIX runners it is reported as skipped, not failed.
- Long path support must be enabled if any project path exceeds the Win32
  260-character limit; pnpm's content-addressable store is usually under
  `~/AppData/Local/pnpm` and can sit close to the limit.

---

## Journal Entry Trigger Map

Every journal entry is generated automatically by a system event. Never generate entries manually.

| Trigger Event | Sub-section | Entries Generated |
|---|---|---|
| `POST /api/income` (2307 added) | 9A | 9.1 — income recognition + CWT receivable |
| `PUT /api/income/[id]` (2307 amended) | 9A | 9.2 reversal, then new 9.1 |
| `POST /api/returns/[id]/file` for 2551Q under 8% | 9B | 9.3 memo only |
| `POST /api/returns/[id]/file` for 2551Q under graduated | 9B | 9.4 + 9.5 |
| `POST /api/returns/[id]/file` for 1701Q | 9C | 9.6 + 9.7 + 9.8 (or 9.9 memo if CWT > tax due) |
| `POST /api/prior-year-credit` | 9D | 9.10 opening entry |
| 1701A computation (prior year credit applied) | 9D | 9.11 application entry |
| `POST /api/returns/[id]/file` for 1701A | 9E | 9.12 + 9.13 + 9.14 |
| `POST /api/overpayment/[taxYear]` — Carry Over | 9F | 9.15 + 9.16 (next year on application) |
| `POST /api/overpayment/[taxYear]` — Refund | 9F | 9.17 (9.18 when cash received) |
| `POST /api/overpayment/[taxYear]` — TCC | 9F | 9.19 (9.20 when TCC applied) |
| Year-end (Dec 31 or on 1701A filing) | 9G | Closing entries for income + expense accounts |

## What NOT To Do

- **Do not use `any` in TypeScript.** Use proper types or `unknown` with type guards.
- **Do not use floating point for money.** Use `decimal.js` for all monetary arithmetic.
- **Do not skip business rule validation to ship faster.** These rules exist because filing incorrectly has legal consequences.
- **Do not generate BIR Form 1701 when 8% rate is elected.** Only 1701A. This is BR-08 and it is a hard rule.
- **Do not let Stellar failures block tax filing.** Decouple them — file first, anchor async.
- **Do not store the Stellar secret key in the database or send it to the client.**
- **Do not use `console.log` for sensitive data** (TIN, amounts, Stellar keys) in production.
- **Do not paginate the filing sequence.** All 8 returns must always be visible together (or 4 returns for the no-2551Q path).
- **Do not apply ₱250,000 exemption to mixed-income earners.** Check `incomeType` before every computation. Using the wrong exemption produces an understated tax liability.
- **Do not use old penalty rates (25% surcharge, 12% interest).** RA 11976 (Ease of Paying Taxes Act) reduced these to 10% and 6% respectively for taxpayers earning below ₱3,000,000. All Kuwenta users qualify. Using the old rates overstates penalties.
- **Do not hardcode the election to Item 13 of 2551Q only.** Taxpayers whose COR does not include 2551Q elect via Item 16 of Q1 1701Q. Always check `corIncludes2551Q` first.
- **Do not require an in-app election for new registrants.** If `isNewRegistrant = true`, the taxpayer already elected 8% on BIR Form 1901 at registration. Mark election as pre-confirmed at onboarding — do not prompt them to elect again.
- **Do not reference the ₱500 annual registration fee anywhere.** It was abolished under RA 11976 effective January 22, 2024. Only ₱30 DST applies. Any hardcoded ₱500 in UI copy, help text, or checklists must be removed.
- **Do not generate Form 1701A for OSD or graduated rate users.**
- **Do not create a separate journal entry for the ₱250,000 deduction.** It is embedded in the Income Tax Expense amount. Only the final computed tax figure is journalised.
- **Do not hardcode account names.** Use the `accountName` field from the `JournalLine` model — it must be consistent across all entries (e.g. always "CWT Receivable", never "CWT" or "Withholding Tax Receivable").
- **Do not regenerate journal entries on every page load.** Generate them on trigger events (2307 added/amended, return filed, overpayment disposition elected). Cache in the `JournalEntry` table.
- **Journal entries must be reversible.** When a 2307 is amended, entry 9.2 (reversal) must be created before 9.1 is re-posted with the corrected amounts. Kuwenta scopes 1701A to 8% electees only. If a user is not on active 8% election, block 1701A generation and show an out-of-scope message.

---

## Reference Figures for Testing

These are real figures from the reference engagement. Use them in all unit tests:

```typescript
const REFERENCE = {
  fullYearGross: new Decimal('187009.33'),
  cwtWithheld: new Decimal('18700.92'),
  priorYearCredit: new Decimal('54270.00'),
  q1Gross: new Decimal('39497.80'),
  q1Cwt: new Decimal('3949.78'),
  q2Gross: new Decimal('60291.42'),
  q2Cwt: new Decimal('6029.14'),
  q3Gross: new Decimal('57020.11'),
  q3Cwt: new Decimal('5702.00'),
  q4Gross: new Decimal('30200.00'),
  q4Cwt: new Decimal('3020.00'),
  expectedAnnualTaxDue: new Decimal('0.00'),
  expectedOverpayment: new Decimal('72970.92'),
  payors: [
    { name: 'AXA Life Insurance Corp', atc: 'WI071' },
    { name: 'Eternal Bright Sanctuary', atc: 'WI140' },
  ]
}
```

All computation functions must produce these exact outputs given these inputs.

### Graduated Rate (TRAIN Law) Reference Cases

The TRAIN Law (RA 10963) graduated brackets are exercised by these cases
(legal basis: NIRC Sec 24(A) as amended). All inputs are
`PURE_SELF_EMPLOYMENT` unless otherwise noted. The expected tax due
comes from walking the bracket table; the work is in
`applyGraduatedBrackets` in `lib/computation/constants.ts`.

| Case                      | Gross         | Exemption / OSD        | Taxable       | Expected tax due |
|---------------------------|---------------|------------------------|---------------|------------------|
| `GRADUATED_LOW` (in 0%)   | `200,000.00`  | 0% bracket (250k)      | `0`           | `0.00`           |
| `GRADUATED_MID` (20%)     | `600,000.00`  | -250,000 = `350,000`   | `350,000`     | `20,000.00`      |
| `GRADUATED_HIGH` (30%)    | `1,500,000.00`| -250,000 = `1,250,000` | `1,250,000`   | `265,000.00`     |
| `GRADUATED_MIXED_MID`     | `500,000.00`  | 0 (mixed income)       | `500,000`     | `55,000.00`      |

Mid bracket walk: 250k @ 0% + 100k @ 20% (250k-350k) = 20,000.
High bracket walk: 250k @ 0% + 150k @ 20% + 400k @ 25% + 450k @ 30%
(800k-1.25M) = 0 + 30,000 + 100,000 + 135,000 = 265,000.
Mixed-income walk: 250k @ 0% (exemption does not apply) + 100k @ 20%
(250k-350k) + 100k @ 25% (400k-500k, after base of 30k) = 30,000 +
20,000 + 5,000 (above base) = 55,000.

### OSD (40% Optional Standard Deduction) Reference Case

Per NIRC Sec 24(A)(2), the OSD replaces the ₱250,000 exemption with a
flat 40% deduction. OSD is valid only under the graduated rate. Mutually
exclusive with the 8% flat rate.

| Case          | Gross         | OSD deduction (40%) | Taxable     | Expected tax due |
|---------------|---------------|---------------------|-------------|------------------|
| `OSD_HIGH`    | `2,000,000.00`| `800,000.00`        | `800,000`   | `130,000.00`     |

Bracket walk: 250k @ 0% + 150k @ 20% + 400k @ 25% (to 800k) = 30,000 +
100,000 = 130,000.

### Quarterly (1701Q) Graduated Reference Cases

Cumulative gross receipts drive the quarterly computation. The 250k 0%
bracket still applies at the cumulative level.

| Case                          | Cumulative gross | Expected cumulative tax due |
|-------------------------------|------------------|------------------------------|
| `GRADUATED_Q1_LOW`            | `200,000.00`     | `0.00`                       |
| `GRADUATED_CUMULATIVE_MID`    | `600,000.00`     | `20,000.00`                  |
| `GRADUATED_CUMULATIVE_HIGH`   | `1,500,000.00`   | `265,000.00`                 |

---


## Running the Test Suite

`pnpm test:run` runs the full CI verification in two phases. Both use `.env.test`
(so they can be executed in CI without a dev database):

1. **Unit tests** (`test:unit`) — Vitest against the test PostgreSQL DB
   (`kuwenta_test`). Each test file truncates application tables in
   `beforeEach`; see `lib/testing/db.ts`.
2. **Computation verification** (`verify:computations`) — runs
   `scripts/verify-computations.ts`, which asserts the reference figures
   above against the pure functions in `lib/computation/`. Exits non-zero
   on any mismatch, so `pnpm test:run` fails fast on a regression.

`pnpm test` (no `:run`) starts Vitest in watch mode for local iteration.

When you add a new pure computation function, add a case to
`scripts/verify-computations.ts` so the reference scenario exercises it.


---



---

## Clean-Clone Checklist

`pnpm lint` and `pnpm build` must both exit 0 on a fresh checkout. CI runs
them in this order; keep them green.

- `pnpm install` must regenerate the Prisma client on every fresh install.
  `package.json` defines `"postinstall": "prisma generate"` so Railway,
  fresh clones, and contributors running `pnpm install --frozen-lockfile`
  all get `node_modules/.prisma/client` populated. Removing this script
  re-introduces the build failure from #99: TypeScript reports
  `Module '"@prisma/client"' has no exported member 'Prisma'` because the
  generated `Prisma` namespace is what `@prisma/client/index.d.ts` re-exports.
- `pnpm lint` — exits 0 with **0 errors** (warnings may be present; see below).
  As of this commit, the only warning is `'taxYear' is assigned a value but
  never used` at `app/api/filing-package/download/__tests__/route.test.ts:160`
  (S5.2 fixture) — the test destructures `taxYear` to keep the type
  signature readable but does not read it. Fix the `_taxYear` rename if you
  touch that file.
- `pnpm build` — exits 0. The build emits three categories of warnings; all
  are documented here so we do not waste a round-trip on them:

  1. `Critical dependency: require function is used in a way in which
     dependencies cannot be statically extracted` and
     `Critical dependency: the request of a dependency is an expression`
     from `sodium-native@4.3.3` / `require-addon@1.2.0` via
     `@stellar/stellar-base@12.1.1`. Native module bundling — webpack cannot
     statically analyse `require('bindings')` chains. Not actionable from
     this repo.
  2. `We detected multiple lockfiles and selected the directory of
     <root>/pnpm-lock.yaml` — only fires when running inside a git
     worktree (the worktree carries its own `pnpm-lock.yaml`). Not a
     clean-clone concern; silence by setting `outputFileTracingRoot` in
     `next.config.ts` if it ever becomes annoying.
  3. Unused-variable warnings emitted by Next.js's own lint pass during
     `next build` are a subset of the `pnpm lint` output; fix the upstream
     rule, not the build warning.

If you add a new dependency that introduces a new webpack or lint warning,
add a one-line justification here so reviewers do not have to chase it.

---

*This agent guide is authoritative. When in doubt between speed and correctness, choose correctness — this is tax compliance software.*