import Decimal from 'decimal.js'
import { z } from 'zod'
import { isValidZipCode } from '@/lib/data/zip-codes'

/**
 * Centralized Zod schemas for every API route.
 *
 * Next.js route files (app/api/**\/route.ts) can only export the HTTP method
 * handlers and a small allow-list of config exports — any other named export
 * breaks the `pnpm build` type check with
 * `"<name>" is not a valid Route export field.`.
 *
 * Schemas therefore live here and the route files import them by name. The
 * S9.2 unit tests also import from this module so the validation rules can
 * be exercised in isolation from the route handler.
 */

// ---- Phone regex (Philippine mobile/landline) --------------------------------
// Accepts +63 or 0 prefix followed by 9–11 digits, covering mobile and
// common landline formats (e.g. +639171234567, 09171234567, or 0324123456).
export const phoneRegex = /^(?:\+63|0)\d{9,11}$/

// ---- TIN regex (AGENT.md BR) -------------------------------------------------
// Philippine TIN is 9 digits for an individual or 12 digits for a branch.
// Both NNN-NNN-NNN and NNN-NNN-NNN-NNN are accepted; 9-digit inputs are
// normalised to the 12-digit form by appending the '-000' branch code.
export const tinRegex = /^\d{3}-\d{3}-\d{3}(-\d{3})?$/

function normalizeTin(tin: string): string {
  return /^\d{3}-\d{3}-\d{3}$/.test(tin) ? `${tin}-000` : tin
}

// ---- POST /api/auth/login ---------------------------------------------------
export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

// ---- POST /api/auth/register ------------------------------------------------
export const registerSchema = z
  .object({
    username: z.string().min(3, 'Username must be at least 3 characters').max(30),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/\d/, 'Password must contain at least one digit')
      .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
    confirmPassword: z.string().min(1, 'Confirm password is required'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

// ---- POST /api/taxpayer (and PUT) -------------------------------------------
export const taxpayerSchema = z.object({
  tin: z.string()
    .regex(tinRegex, 'TIN must be in format NNN-NNN-NNN or NNN-NNN-NNN-NNN')
    .transform(normalizeTin),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  middleInitial: z
    .string()
    .max(2, 'Middle initial must be at most 2 characters')
    .optional(),
  rdoCode: z.string().min(1),
  phoneNumber: z
    .string()
    .min(1, 'Phone number is required')
    .regex(phoneRegex, 'Phone number must be a valid Philippine number (e.g. +639171234567 or 09171234567)'),
  email: z.string().min(1, 'Email is required').email('Email must be a valid email address'),
  registeredAddress: z.string().min(1),
  zipCode: z
    .string()
    .regex(/^\d{4}$/, 'ZIP code must be a 4-digit Philippine ZIP code')
    .refine((v) => isValidZipCode(v), 'ZIP code is not a known Philippine ZIP code'),
  natureOfBusiness: z.string().min(1),
  incomeType: z.enum(['PURE_SELF_EMPLOYMENT', 'MIXED_INCOME']),
  corIncludes2551Q: z.boolean(),
  isNewRegistrant: z.boolean().default(false),
  atcCodes: z.array(z.string()).min(1, 'Select at least one ATC code'),
  taxYear: z.number().int().min(2000).max(2100),
})

// ---- POST /api/income (Form 2307) -------------------------------------------
export const certificateSchema = z.object({
  quarter: z.number().int().min(1).max(4),
  payorTin: z.string().min(1),
  payorName: z.string().min(1),
  atcCode: z.string().min(1),
  month1Amount: z.union([z.string(), z.number()]),
  month2Amount: z.union([z.string(), z.number()]),
  month3Amount: z.union([z.string(), z.number()]),
  cwtWithheld: z.union([z.string(), z.number()]),
})

// ---- PUT /api/income/[id] (Form 2307 amend) ---------------------------------
export const certificateUpdateSchema = z.object({
  quarter: z.number().int().min(1).max(4).optional(),
  payorTin: z.string().min(1).optional(),
  payorName: z.string().min(1).optional(),
  atcCode: z.string().min(1).optional(),
  month1Amount: z.union([z.string(), z.number()]).optional(),
  month2Amount: z.union([z.string(), z.number()]).optional(),
  month3Amount: z.union([z.string(), z.number()]).optional(),
  cwtWithheld: z.union([z.string(), z.number()]).optional(),
})

// ---- POST /api/election -----------------------------------------------------
export const electionSchema = z
  .object({
    electedRate: z.enum(['RATE_8PCT', 'GRADUATED']),
    electionPath: z.enum(['ITEM_13_2551Q_Q1', 'ITEM_16_1701Q_Q1', 'FORM_1905']).optional(),
    disclosuresAcknowledged: z.boolean().refine((v) => v === true, {
      message: 'All disclosures must be acknowledged',
    }),
    // S7.6 (#117): 40% Optional Standard Deduction election. Mutually
    // exclusive with the 8% flat rate (NIRC Sec 24(A)(2)). The
    // cross-field check is a `.superRefine` below.
    osdElection: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.osdElection && data.electedRate === 'RATE_8PCT') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['osdElection'],
        message:
          'OSD is not valid for the 8% flat rate (NIRC Sec 24(A)(2)): the 8% rate is computed on gross receipts and does not allow itemised or standard deductions.',
      })
    }
  })

// ---- POST /api/prior-year-credit --------------------------------------------
export const priorYearCreditCreateSchema = z.object({
  amount: z.union([z.string(), z.number()]).transform((v) => String(v)),
  originYear: z.number().int(),
  originForm: z.string().min(1),
  priorDisposition: z.string().min(1),
})

// ---- POST /api/overpayment/[taxYear] (disposition) --------------------------
export const overpaymentDispositionSchema = z.object({
  disposition: z.enum(['CARRY_OVER', 'REFUND', 'TAX_CREDIT_CERTIFICATE']),
})

// ---- PATCH /api/overpayment/[taxYear] (settlement) --------------------------
export const overpaymentSettlementSchema = z.object({
  event: z.enum(['REFUND_RECEIVED', 'TCC_APPLIED', 'CARRY_OVER_APPLIED']),
  reference: z.string().min(1).max(120).optional(),
  tccNumber: z.string().min(1).max(60).optional(),
  appliedAt: z.string().datetime().optional(),
})

// ---- POST /api/penalties/simulate -------------------------------------------
export const penaltiesSimulateSchema = z.object({
  returnId: z.string().min(1),
  filedDate: z.string().date(),
})

// ---- /api/admin/users (PATCH + POST reset) ----------------------------------
export const adminUsersPatchSchema = z.object({
  userId: z.string().min(1),
  isActive: z.boolean(),
})

export const adminUsersResetSchema = z.object({
  userId: z.string().min(1),
})

// ---- /api/admin/atc --------------------------------------------------------
export const atcCreateSchema = z.object({
  code: z.string().min(1).max(10),
  description: z.string().min(1).max(255),
  ewtRate: z.string().regex(/^\d+(\.\d{1,4})?$/),
  isActive: z.boolean().default(true),
})

export const atcUpdateSchema = z.object({
  code: z.string().min(1).max(10),
  description: z.string().min(1).max(255).optional(),
  ewtRate: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  isActive: z.boolean().optional(),
})

export const atcDeleteSchema = z.object({
  code: z.string().min(1).max(10),
})

// ---- /api/admin/holidays ----------------------------------------------------
export const holidaysCreateSchema = z.object({
  date: z.string().date(),
  name: z.string().min(1).max(255),
})

export const holidaysDeleteSchema = z.object({
  id: z.string().min(1),
})

export const holidaysBulkRowSchema = z
  .object({
    date: z.string().date(),
    name: z.string().min(1).max(255),
    year: z
      .union([z.string(), z.number().finite()])
      .optional()
      .transform((v) => {
        if (v === undefined || v === '' || v === null) return undefined
        const n = Number(v)
        return Number.isFinite(n) ? n : undefined
      })
      .pipe(z.number().int().min(1900).max(2999).optional()),
  })
  .transform((v) => ({
    date: v.date,
    name: v.name,
    year: v.year ?? new Date(v.date).getUTCFullYear(),
  }))

export const holidaysBulkImportSchema = z.object({
  rows: z.array(holidaysBulkRowSchema).min(1).max(500),
  mode: z.enum(['insert', 'upsert']).default('insert'),
})

// ---- /api/admin/rdo-penalties ----------------------------------------------
export const rdoUpsertSchema = z.object({
  rdoCode: z
    .string()
    .min(1)
    .max(10)
    .transform((v) => v.trim().toUpperCase()),
  compromiseFee: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'compromiseFee must be a positive decimal with up to 2 places')
    .refine(
      (v) => {
        try {
          return new Decimal(v).greaterThan(0)
        } catch {
          return false
        }
      },
      'compromiseFee must be greater than zero'
    ),
})

export const rdoUpdateSchema = z.object({
  id: z.string().min(1),
  compromiseFee: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'compromiseFee must be a positive decimal with up to 2 places')
    .refine(
      (v) => {
        try {
          return new Decimal(v).greaterThan(0)
        } catch {
          return false
        }
      },
      'compromiseFee must be greater than zero'
    ),
})

export const rdoDeleteSchema = z.object({
  id: z.string().min(1),
})
