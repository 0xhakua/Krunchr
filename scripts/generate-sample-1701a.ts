import { writeFileSync } from "node:fs";
import { renderForm1701AOverlay, buildForm1701AValues } from "../lib/pdf/bir/1701A";
import type { FilingPdfData } from "../lib/pdf/dispatcher";
import Decimal from "decimal.js";
import { join } from "node:path";

const sampleData: FilingPdfData = {
  ret: {
    id: "sample",
    formType: "FORM_1701A",
    quarter: null,
    status: "PENDING",
    computedTaxDue: new Decimal("0"),
    taxCreditsTotal: new Decimal("0"),
    netTaxDue: new Decimal("0"),
    overpaymentAmt: new Decimal("0"),
    statutoryDueDate: new Date(2027, 3, 15),
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
    incomeType: "PURE_SELF_EMPLOYMENT",
    corIncludes2551Q: true,
  },
  certificates: [
    { quarter: 1, payorTin: "000-111-222-333", payorName: "AXA Life", atcCode: "WI071",
      month1Amount: new Decimal("13165.93"), month2Amount: new Decimal("13165.93"),
      month3Amount: new Decimal("13165.94"), quarterlyTotal: new Decimal("39497.80"),
      cwtWithheld: new Decimal("3949.78") },
    { quarter: 2, payorTin: "000-444-555-666", payorName: "Eternal Bright", atcCode: "WI140",
      month1Amount: new Decimal("20097.14"), month2Amount: new Decimal("20097.14"),
      month3Amount: new Decimal("20097.14"), quarterlyTotal: new Decimal("60291.42"),
      cwtWithheld: new Decimal("6029.14") },
    { quarter: 3, payorTin: "000-777-888-999", payorName: "Insular Life", atcCode: "WI071",
      month1Amount: new Decimal("25000.00"), month2Amount: new Decimal("25000.00"),
      month3Amount: new Decimal("25000.00"), quarterlyTotal: new Decimal("75000.00"),
      cwtWithheld: new Decimal("7500.00") },
    { quarter: 4, payorTin: "000-111-222-333", payorName: "AXA Life", atcCode: "WI071",
      month1Amount: new Decimal("4000.00"), month2Amount: new Decimal("4000.00"),
      month3Amount: new Decimal("4000.00"), quarterlyTotal: new Decimal("12000.00"),
      cwtWithheld: new Decimal("1200.00") },
  ],
  priorYearCredit: { amount: new Decimal("0") },
  overpayment: null,
  allReturns: [
    { formType: "FORM_1701Q", quarter: 1, netTaxDue: new Decimal("0") },
    { formType: "FORM_1701Q", quarter: 2, netTaxDue: new Decimal("0") },
    { formType: "FORM_1701Q", quarter: 3, netTaxDue: new Decimal("0") },
  ],
};

async function main() {
  console.log("Built value map keys:", Object.keys(buildForm1701AValues(sampleData)).length);

  const result = await renderForm1701AOverlay(sampleData);
  const out = join(process.cwd(), "tmp", "1701A-sample-overlay.pdf");
  writeFileSync(out, result.bytes);
  console.log(`Wrote ${out} (${result.bytes.length} bytes, ${result.pageCount} pages)`);
  console.log(`Drew ${result.drawnKeys.length} keys:`, result.drawnKeys.join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
