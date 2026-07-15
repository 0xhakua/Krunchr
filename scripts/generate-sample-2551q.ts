/**
 * Generate a sample 2551Q overlay PDF for visual verification.
 * Mirrors scripts/generate-sample-1701q.ts.
 *
 * Usage:
 *   pnpm tsx scripts/generate-sample-2551q.ts
 *
 * Writes:
 *   tmp/2551Q-sample-overlay.pdf
 */
import { writeFileSync } from "node:fs";
import { renderForm2551QOverlay, buildForm2551QValues } from "../lib/pdf/bir/2551Q";
import type { FilingPdfData } from "../lib/pdf/dispatcher";
import Decimal from "decimal.js";
import { join } from "node:path";

const sampleData: FilingPdfData = {
  ret: {
    id: "sample-2551q-q2",
    formType: "FORM_2551Q",
    quarter: 2,
    status: "PENDING",
    computedTaxDue: new Decimal("0"),
    taxCreditsTotal: new Decimal("0"),
    netTaxDue: new Decimal("0"),
    overpaymentAmt: new Decimal("0"),
    statutoryDueDate: new Date(2026, 7, 25),
    filedDate: null,
    generatedAt: null,
    penalties: {
      daysLate: 0,
      surcharge: new Decimal("0"),
      interest: new Decimal("0"),
      compromisePenalty: new Decimal("1000"),
      totalPenalty: new Decimal("1000"),
    },
  },
  taxYear: { id: "ty1", year: 2026, electedRate: "RATE_8PCT", electionStatus: "ELECTED_8PCT" },
  taxpayer: {
    fullName: "Dela Cruz, Maria S.",
    tin: "123-456-789-001",
    rdoCode: "040",
    registeredAddress: "123 Mabini St, Makati City",
    zipCode: "1200",
    email: "maria.delacruz@example.com",
    phoneNumber: "+639171234567",
    natureOfBusiness: "Insurance Agent / Freelance Broker",
    citizenship: "Filipino",
    civilStatus: "Single",
    claimingForeignTaxCredits: false,
    foreignTaxNumber: null,
    incomeType: "PURE_SELF_EMPLOYMENT",
    corIncludes2551Q: true,
  },
  certificates: [
    {
      quarter: 2,
      payorTin: "000-111-222-333",
      payorName: "AXA Life",
      atcCode: "WI071",
      month1Amount: new Decimal("13165.93"),
      month2Amount: new Decimal("13165.93"),
      month3Amount: new Decimal("13165.94"),
      quarterlyTotal: new Decimal("39497.80"),
      cwtWithheld: new Decimal("3949.78"),
    },
  ],
  priorYearCredit: { amount: new Decimal("0") },
  overpayment: null,
  allReturns: [],
};

async function main() {
  console.log("Built value map keys:", Object.keys(buildForm2551QValues(sampleData)).length);

  const result = await renderForm2551QOverlay(sampleData);
  const out = join(process.cwd(), "tmp", "2551Q-sample-overlay.pdf");
  writeFileSync(out, result.bytes);
  console.log(`Wrote ${out} (${result.bytes.length} bytes, ${result.pageCount} pages)`);
  console.log(`Drew ${result.drawnKeys.length} keys:`, result.drawnKeys.join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
