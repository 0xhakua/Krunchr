import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  renderForm1701QOverlay,
  buildForm1701QValues,
  COORD_GROUPS_1701Q,
} from "../bir/1701Q";
import { inferTaxpayerType } from "../bir/1701A";
import type { FilingPdfData } from "../dispatcher";

const OFFICIAL_PDF = join(process.cwd(), "public", "bir-forms", "1701Q.pdf");

// Sample data for a Q2 1701Q filing under the 8% flat rate. The taxpayer
// has Q1 and Q2 2307 certificates; Q1 netTaxDue is 0 (cumulative Q1
// gross was below the 250K threshold so no tax was due).
const sampleData: FilingPdfData = {
  ret: {
    id: "test-1701q-q2",
    formType: "FORM_1701Q",
    quarter: 2,
    status: "PENDING",
    computedTaxDue: new Decimal("0"),
    taxCreditsTotal: new Decimal("0"),
    netTaxDue: new Decimal("0"),
    overpaymentAmt: new Decimal("0"),
    statutoryDueDate: new Date(2026, 7, 15),
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
    {
      quarter: 1,
      payorTin: "000-111-222-333",
      payorName: "AXA Life",
      atcCode: "WI071",
      month1Amount: new Decimal("13165.93"),
      month2Amount: new Decimal("13165.93"),
      month3Amount: new Decimal("13165.94"),
      quarterlyTotal: new Decimal("39497.80"),
      cwtWithheld: new Decimal("3949.78"),
    },
    {
      quarter: 2,
      payorTin: "000-444-555-666",
      payorName: "Eternal Bright Sanctuary",
      atcCode: "WI140",
      month1Amount: new Decimal("20097.14"),
      month2Amount: new Decimal("20097.14"),
      month3Amount: new Decimal("20097.14"),
      quarterlyTotal: new Decimal("60291.42"),
      cwtWithheld: new Decimal("6029.14"),
    },
  ],
  priorYearCredit: { amount: new Decimal("0") },
  overpayment: null,
  allReturns: [
    { formType: "FORM_1701Q", quarter: 1, netTaxDue: new Decimal("0") },
  ],
};

describe("1701Q overlay (issue #212)", () => {
  it("requires the official 1701Q PDF in public/bir-forms/ to be present", () => {
    expect(existsSync(OFFICIAL_PDF)).toBe(true);
  });

  it("inferTaxpayerType classifies nature-of-business text conservatively (shared with 1701A)", () => {
    expect(inferTaxpayerType("Insurance Agent")).toBe("single_proprietor");
    expect(inferTaxpayerType("Software Consultant")).toBe("professional");
    expect(inferTaxpayerType("Lawyer / Attorney")).toBe("professional");
    expect(inferTaxpayerType("CPA / Accountant")).toBe("professional");
    expect(inferTaxpayerType("Architect")).toBe("professional");
  });

  it("buildForm1701QValues populates the Part I header fields", () => {
    const values = buildForm1701QValues(sampleData);
    expect(values.part1_tin).toBe("123-456-789-001");
    expect(values.part1_rdo_code).toBe("040");
    expect(values.part1_zip_code).toBe("1200");
    expect(values.part1_taxpayer_name).toBe("Dela Cruz, Maria S.");
    expect(values.part1_email).toBe("maria.delacruz@example.com");
    // Insurance Agent → single_proprietor
    expect(values.part1_taxpayer_type_single_proprietor).toBe(true);
    expect(values.part1_taxpayer_type_professional).toBeUndefined();
    // Q2 1701Q → second-quarter checkbox
    expect(values.part1_quarter_second).toBe(true);
    expect(values.part1_quarter_first).toBeUndefined();
    expect(values.part1_quarter_third).toBeUndefined();
    // 8% election checkbox (Item 16) — RATE_8PCT elected
    expect(values[COORD_GROUPS_1701Q.tax_rate["8pct"]]).toBe(true);
  });

  it("buildForm1701QValues computes Schedule II 8% path (Items 47-54) correctly", () => {
    // Cumulative gross through Q2 = ₱39,497.80 + ₱60,291.42 = ₱99,789.22
    // For Q2, the 250K exemption was already consumed in Q1's
    // computation, so Item 52 (Less 250K) = 0.
    // Item 53 (Taxable to date) = max(99,789.22 - 0, 0) = 99,789.22
    // Item 54 (Tax Due) = 99,789.22 * 0.08 = 7,983.14
    const values = buildForm1701QValues(sampleData);
    expect(values.sched2_sales).toBe("99,789.22");
    expect(values.sched2_total_income_quarter).toBe("99,789.22");
    expect(values.sched2_cumulative_taxable).toBe("99,789.22");
    // For Q2, Item 52 (Less 250K) = 0 (already consumed in Q1)
    expect(values.sched2_less_250k).toBe("0.00");
    expect(values.sched2_taxable_to_date).toBe("99,789.22");
    expect(values.sched2_tax_due).toBe("7,983.14");
    // Item 50: prior Q cumulative = Q1's gross only = 39,497.80
    expect(values.sched2_prev_quarter_taxable).toBe("39,497.80");
  });

  it("buildForm1701QValues applies 250K exemption in Q1 for pure self-employment", () => {
    // For Q1 (with cumulative gross 39,497.80 < 250,000):
    // - Item 52 (Less 250K) = 250,000.00
    // - Item 53 (Taxable to date) = max(39,497.80 - 250,000, 0) = 0
    // - Item 54 (Tax Due) = 0
    const q1Data: FilingPdfData = { ...sampleData, ret: { ...sampleData.ret, quarter: 1 } };
    const values = buildForm1701QValues(q1Data);
    expect(values.sched2_less_250k).toBe("250,000.00");
    expect(values.sched2_taxable_to_date).toBe("0.00");
    expect(values.sched2_tax_due).toBe("0.00");
  });

  it("buildForm1701QValues gives zero 250K exemption for MIXED_INCOME (BR-13)", () => {
    // Mixed-income earners (MIXED_INCOME) get NO 250K exemption — BR-13.
    // Item 52 (Less 250K) = 0.00 regardless of quarter.
    const mixed: FilingPdfData = {
      ...sampleData,
      taxpayer: { ...sampleData.taxpayer, incomeType: "MIXED_INCOME" },
      ret: { ...sampleData.ret, quarter: 1 },
    };
    const values = buildForm1701QValues(mixed);
    expect(values.sched2_less_250k).toBe("0.00");
  });

  it("buildForm1701QValues computes Schedule III credits (Items 55-63) correctly", () => {
    // Item 56 (Prior Q Payments) = Q1's netTaxDue = 0
    // Item 57 (Prior Q CWT) = Q1's CWT = 3,949.78
    // Item 58 (Current Q CWT) = Q2's CWT = 6,029.14
    // Item 62 (Total credits) = 0 + 3,949.78 + 6,029.14 = 9,978.92
    // Item 63 (Tax payable) = max(7,983.14 - 9,978.92, 0) = 0 (overpayment)
    const values = buildForm1701QValues(sampleData);
    expect(values.sched3_prev_quarter_payments).toBe("0.00");
    expect(values.sched3_prev_quarter_cwt).toBe("3,949.78");
    expect(values.sched3_current_quarter_cwt).toBe("6,029.14");
    expect(values.sched3_total_credits).toBe("9,978.92");
    expect(values.sched3_tax_payable_overpayment).toBe("0.00");
  });

  it("buildForm1701QValues mirrors Part III summary on page 1 (Items 26-31)", () => {
    // Part III (page 1) is the Tax Payable summary that mirrors Schedule II/III/IV.
    // Item 26 (Tax Due) = Item 54
    // Item 27 (Less credits) = Item 62
    // Item 28 (Tax payable) = Item 63
    // Item 30 (Total amount payable) = Item 68
    const values = buildForm1701QValues(sampleData);
    expect(values.part3_tax_due).toBe(values.sched2_tax_due);
    expect(values.part3_less_tax_credits).toBe(values.sched3_total_credits);
    expect(values.part3_tax_payable).toBe(values.sched3_tax_payable_overpayment);
  });

  it("buildForm1701QValues maps Schedule IV penalties (Items 64-68) correctly", () => {
    // Sample data has compromisePenalty: 1000, totalPenalty: 1000, others 0
    const values = buildForm1701QValues(sampleData);
    expect(values.sched4_surcharge).toBe("0.00");
    expect(values.sched4_interest).toBe("0.00");
    expect(values.sched4_compromise).toBe("1,000.00");
    expect(values.sched4_total_penalties).toBe("1,000.00");
  });

  it("renderForm1701QOverlay produces a valid 2-page flattened PDF", async () => {
    const result = await renderForm1701QOverlay(sampleData);
    expect(result.pageCount).toBe(2);
    expect(result.bytes.length).toBeGreaterThan(1000);
    // PDF magic header
    const header = Buffer.from(result.bytes.slice(0, 8)).toString("latin1");
    expect(header.startsWith("%PDF-")).toBe(true);
    // drawnKeys should be non-empty
    expect(result.drawnKeys.length).toBeGreaterThan(20);
    // Critical Schedule II + III + IV keys are drawn
    expect(result.drawnKeys).toContain("sched2_sales");
    expect(result.drawnKeys).toContain("sched2_tax_due");
    expect(result.drawnKeys).toContain("sched3_total_credits");
    expect(result.drawnKeys).toContain("sched4_total_penalties");
  });

  it("renderForm1701QOverlay renders the 8% election checkbox for RATE_8PCT", async () => {
    const result = await renderForm1701QOverlay(sampleData);
    expect(result.drawnKeys).toContain(COORD_GROUPS_1701Q.tax_rate["8pct"]);
  });

  it("renderForm1701QOverlay marks the professional checkbox for consultant nature-of-business", async () => {
    const pro: FilingPdfData = {
      ...sampleData,
      taxpayer: { ...sampleData.taxpayer, natureOfBusiness: "Software Consultant" },
    };
    const values = buildForm1701QValues(pro);
    expect(values.part1_taxpayer_type_professional).toBe(true);
    expect(values.part1_taxpayer_type_single_proprietor).toBeUndefined();
  });

  it("renderForm1701QOverlay output is flattenable (no AcroForm fields throw)", async () => {
    const result = await renderForm1701QOverlay(sampleData);
    // Re-load and verify we can save again without issue.
    const { PDFDocument } = await import("pdf-lib");
    const reloaded = await PDFDocument.load(result.bytes);
    const out = await reloaded.save();
    expect(out.length).toBeGreaterThan(1000);
  });

  it("COORD_GROUPS_1701Q maps all 4 taxpayer_type alternatives", () => {
    expect(COORD_GROUPS_1701Q.taxpayer_type.single_proprietor).toBe(
      "part1_taxpayer_type_single_proprietor",
    );
    expect(COORD_GROUPS_1701Q.taxpayer_type.professional).toBe(
      "part1_taxpayer_type_professional",
    );
    expect(COORD_GROUPS_1701Q.taxpayer_type.estate).toBe(
      "part1_taxpayer_type_estate",
    );
    expect(COORD_GROUPS_1701Q.taxpayer_type.trust).toBe(
      "part1_taxpayer_type_trust",
    );
  });

  it("COORD_GROUPS_1701Q maps the 3 8% ATC alternatives (II015, II016, II017)", () => {
    expect(COORD_GROUPS_1701Q.atc.II015).toBe("part1_atc_ii015");
    expect(COORD_GROUPS_1701Q.atc.II016).toBe("part1_atc_ii016");
    expect(COORD_GROUPS_1701Q.atc.II017).toBe("part1_atc_ii017");
  });

  it("COORD_GROUPS_1701Q maps Q1/Q2/Q3 quarter selectors", () => {
    expect(COORD_GROUPS_1701Q.quarter[1]).toBe("part1_quarter_first");
    expect(COORD_GROUPS_1701Q.quarter[2]).toBe("part1_quarter_second");
    expect(COORD_GROUPS_1701Q.quarter[3]).toBe("part1_quarter_third");
  });

  it("COORD_GROUPS_1701Q maps the 4 tax-rate alternatives (8pct, graduated, itemized, osd)", () => {
    expect(COORD_GROUPS_1701Q.tax_rate["8pct"]).toBe("part1_tax_rate_8pct");
    expect(COORD_GROUPS_1701Q.tax_rate.graduated).toBe("part1_tax_rate_graduated");
    expect(COORD_GROUPS_1701Q.tax_rate.itemized).toBe("part1_tax_rate_itemized");
    expect(COORD_GROUPS_1701Q.tax_rate.osd).toBe("part1_tax_rate_osd");
  });
});
