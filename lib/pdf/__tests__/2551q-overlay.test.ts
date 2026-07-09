import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  renderForm2551QOverlay,
  buildForm2551QValues,
  COORD_GROUPS_2551Q,
} from "../bir/2551Q";
import type { FilingPdfData } from "../dispatcher";

const OFFICIAL_PDF = join(process.cwd(), "public", "bir-forms", "2551Q.pdf");

// Sample data for a Q2 2551Q filing under the 8% flat rate. The taxpayer
// has a single 2307 certificate in Q2; under 8% election, tax due is
// always ₱0.00 (BR-04). The compromise penalty of ₱1,000 is a sample
// for visual review of the penalty fields.
const sampleData: FilingPdfData = {
  ret: {
    id: "test-2551q-q2",
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

describe("2551Q overlay (issue #213)", () => {
  it("requires the official 2551Q PDF in public/bir-forms/ to be present", () => {
    expect(existsSync(OFFICIAL_PDF)).toBe(true);
  });

  it("buildForm2551QValues populates the Part I header fields", () => {
    const values = buildForm2551QValues(sampleData);
    expect(values.part1_tin).toBe("123-456-789-001");
    expect(values.part1_rdo_code).toBe("040");
    expect(values.part1_zip_code).toBe("1200");
    expect(values.part1_taxpayer_name).toBe("Dela Cruz, Maria S.");
    expect(values.part1_registered_address).toBe("123 Mabini St, Makati City");
    expect(values.part1_email).toBe("maria.delacruz@example.com");
    expect(values.part1_contact_number).toBe("+639171234567");
    // Q2 2551Q → 2nd-quarter checkbox
    expect(values[COORD_GROUPS_2551Q.quarter[2]]).toBe(true);
    expect(values[COORD_GROUPS_2551Q.quarter[1]]).toBeUndefined();
    expect(values[COORD_GROUPS_2551Q.quarter[3]]).toBeUndefined();
    expect(values[COORD_GROUPS_2551Q.quarter[4]]).toBeUndefined();
    // Calendar year basis
    expect(values[COORD_GROUPS_2551Q.year_basis.calendar]).toBe(true);
    // Default No for amended and treaty
    expect(values[COORD_GROUPS_2551Q.amended.no]).toBe(true);
    expect(values[COORD_GROUPS_2551Q.treaty.no]).toBe(true);
  });

  it("buildForm2551QValues: 8% election checkbox is rendered ONLY on Q1 (BR-02)", () => {
    // Q1 + RATE_8PCT: 8% checkbox is marked
    const q1Data: FilingPdfData = {
      ...sampleData,
      ret: { ...sampleData.ret, quarter: 1 },
    };
    const q1Values = buildForm2551QValues(q1Data);
    expect(q1Values[COORD_GROUPS_2551Q.tax_rate["8pct"]]).toBe(true);
    expect(q1Values[COORD_GROUPS_2551Q.tax_rate.graduated]).toBe(false);

    // Q2 + RATE_8PCT: 8% checkbox is NOT marked (BR-02)
    const q2Values = buildForm2551QValues(sampleData);
    expect(q2Values[COORD_GROUPS_2551Q.tax_rate["8pct"]]).toBe(false);
    expect(q2Values[COORD_GROUPS_2551Q.tax_rate.graduated]).toBe(false);

    // Q3 + RATE_8PCT: same as Q2 — not marked
    const q3Data: FilingPdfData = {
      ...sampleData,
      ret: { ...sampleData.ret, quarter: 3 },
    };
    const q3Values = buildForm2551QValues(q3Data);
    expect(q3Values[COORD_GROUPS_2551Q.tax_rate["8pct"]]).toBe(false);

    // Q4 + RATE_8PCT: same — not marked
    const q4Data: FilingPdfData = {
      ...sampleData,
      ret: { ...sampleData.ret, quarter: 4 },
    };
    const q4Values = buildForm2551QValues(q4Data);
    expect(q4Values[COORD_GROUPS_2551Q.tax_rate["8pct"]]).toBe(false);
  });

  it("buildForm2551QValues: Q1 + GRADUATED marks the Graduated checkbox (not 8%)", () => {
    const gradData: FilingPdfData = {
      ...sampleData,
      taxYear: { ...sampleData.taxYear, electedRate: "GRADUATED" },
      ret: { ...sampleData.ret, quarter: 1 },
    };
    const values = buildForm2551QValues(gradData);
    expect(values[COORD_GROUPS_2551Q.tax_rate["8pct"]]).toBe(false);
    expect(values[COORD_GROUPS_2551Q.tax_rate.graduated]).toBe(true);
  });

  it("buildForm2551QValues: leaves Schedule 1 blank under 8% (BR-04)", () => {
    const values = buildForm2551QValues(sampleData);
    expect(values.sched1_item1_atc).toBe("");
    expect(values.sched1_item2_atc).toBe("");
    expect(values.sched1_item3_atc).toBe("");
    expect(values.sched1_item4_atc).toBe("");
    expect(values.sched1_item5_atc).toBe("");
    expect(values.sched1_item6_atc).toBe("");
    expect(values.sched1_total_tax_due).toBe("0.00");
  });

  it("buildForm2551QValues: Total Tax Due is always ₱0.00 under 8% (BR-04)", () => {
    // RATE_8PCT: tax due = 0 regardless of quarter or gross amount
    const values = buildForm2551QValues(sampleData);
    expect(values.part2_total_tax_due).toBe("0.00");
    expect(values.sched1_total_tax_due).toBe("0.00");
  });

  it("buildForm2551QValues: populates only Schedule 1 row 1 under GRADUATED", () => {
    const gradData: FilingPdfData = {
      ...sampleData,
      taxYear: { ...sampleData.taxYear, electedRate: "GRADUATED" },
      ret: { ...sampleData.ret, computedTaxDue: new Decimal("1184.93") },
    };
    const values = buildForm2551QValues(gradData);
    // 39,497.80 × 3% = 1,184.93
    expect(values.part2_total_tax_due).toBe("1,184.93");
    expect(values.sched1_item1_atc).toBe("PT010");
    expect(values.sched1_item1_taxable).toBe("39,497.80");
    expect(values.sched1_item1_tax_due).toBe("1,184.93");
    expect(values.sched1_item2_atc).toBe("");
    expect(values.sched1_item2_taxable).toBe("");
    expect(values.sched1_item2_tax_due).toBe("");
    expect(values.sched1_item3_atc).toBe("");
    expect(values.sched1_item4_atc).toBe("");
    expect(values.sched1_item5_atc).toBe("");
    expect(values.sched1_item6_atc).toBe("");
  });

  it("buildForm2551QValues: CWT is sum of current-quarter CWT only (Item 15)", () => {
    const values = buildForm2551QValues(sampleData);
    // Q2 cert: CWT = 3,949.78
    expect(values.part2_cwt_withheld).toBe("3,949.78");
  });

  it("buildForm2551QValues: Penalties use RA 11976 rates (sourced from data.ret.penalties)", () => {
    // Sample data has compromisePenalty: 1000, others 0
    const values = buildForm2551QValues(sampleData);
    expect(values.part2_surcharge).toBe("0.00");
    expect(values.part2_interest).toBe("0.00");
    expect(values.part2_compromise).toBe("1,000.00");
    expect(values.part2_total_penalties).toBe("1,000.00");
  });

  it("buildForm2551QValues: Part III payment fields are empty (no payment data in FilingPdfData)", () => {
    const values = buildForm2551QValues(sampleData);
    expect(values.part3_cash_bank_debit).toBe("");
    expect(values.part3_check).toBe("");
    expect(values.part3_tax_debit_memo).toBe("");
    expect(values.part3_others).toBe("");
  });

  it("renderForm2551QOverlay produces a valid 2-page flattened PDF", async () => {
    const result = await renderForm2551QOverlay(sampleData);
    expect(result.pageCount).toBe(2);
    expect(result.bytes.length).toBeGreaterThan(1000);
    // PDF magic header
    const header = Buffer.from(result.bytes.slice(0, 8)).toString("latin1");
    expect(header.startsWith("%PDF-")).toBe(true);
    // drawnKeys should be non-empty
    expect(result.drawnKeys.length).toBeGreaterThan(15);
    // Critical Part II keys are drawn
    expect(result.drawnKeys).toContain("part2_total_tax_due");
    expect(result.drawnKeys).toContain("part2_cwt_withheld");
    expect(result.drawnKeys).toContain("part2_surcharge");
    expect(result.drawnKeys).toContain("part2_interest");
  });

  it("renderForm2551QOverlay: Q2 value map sets the 8% election checkbox to false (BR-02)", () => {
    // Q2 sample data: 8% election was made on Q1; the Q2 form does NOT
    // re-check the box. Verify the value map directly — the buildForm
    // function sets part1_tax_rate_8pct = false for Q2/Q3/Q4. The
    // drawValue function skips false values, so the "X" is not actually
    // drawn on the PDF.
    const values = buildForm2551QValues(sampleData);
    expect(values[COORD_GROUPS_2551Q.tax_rate["8pct"]]).toBe(false);
  });

  it("renderForm2551QOverlay: Q1 with RATE_8PCT DOES mark the 8% election checkbox", async () => {
    const q1Data: FilingPdfData = {
      ...sampleData,
      ret: { ...sampleData.ret, quarter: 1 },
    };
    const result = await renderForm2551QOverlay(q1Data);
    expect(result.drawnKeys).toContain(COORD_GROUPS_2551Q.tax_rate["8pct"]);
  });

  it("renderForm2551QOverlay output is flattenable (no AcroForm fields throw)", async () => {
    const result = await renderForm2551QOverlay(sampleData);
    // Re-load and verify we can save again without issue.
    const { PDFDocument } = await import("pdf-lib");
    const reloaded = await PDFDocument.load(result.bytes);
    const out = await reloaded.save();
    expect(out.length).toBeGreaterThan(1000);
  });

  it("COORD_GROUPS_2551Q maps year_basis (Calendar/Fiscal)", () => {
    expect(COORD_GROUPS_2551Q.year_basis.calendar).toBe("header_calendar");
    expect(COORD_GROUPS_2551Q.year_basis.fiscal).toBe("header_fiscal");
  });

  it("COORD_GROUPS_2551Q maps all 4 quarter selectors", () => {
    expect(COORD_GROUPS_2551Q.quarter[1]).toBe("header_quarter_1st");
    expect(COORD_GROUPS_2551Q.quarter[2]).toBe("header_quarter_2nd");
    expect(COORD_GROUPS_2551Q.quarter[3]).toBe("header_quarter_3rd");
    expect(COORD_GROUPS_2551Q.quarter[4]).toBe("header_quarter_4th");
  });

  it("COORD_GROUPS_2551Q maps amended Yes/No and treaty Yes/No", () => {
    expect(COORD_GROUPS_2551Q.amended.yes).toBe("header_amended_yes");
    expect(COORD_GROUPS_2551Q.amended.no).toBe("header_amended_no");
    expect(COORD_GROUPS_2551Q.treaty.yes).toBe("part1_treaty_yes");
    expect(COORD_GROUPS_2551Q.treaty.no).toBe("part1_treaty_no");
  });

  it("COORD_GROUPS_2551Q maps tax_rate (8pct, graduated)", () => {
    expect(COORD_GROUPS_2551Q.tax_rate["8pct"]).toBe("part1_tax_rate_8pct");
    expect(COORD_GROUPS_2551Q.tax_rate.graduated).toBe("part1_tax_rate_graduated");
  });
});
