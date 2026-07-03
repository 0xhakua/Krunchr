# Client-Provided BIR Guides

These are reference materials supplied by the client. They contain the official BIR form layouts, line-item instructions, and tax-rate tables used to build Kuwenta's computation and PDF-generation logic.

| File | Description |
|------|-------------|
| `1701A Jan 2018 v5 with rates.pdf` | BIR Form 1701A (Annual Income Tax Return for Individuals Earning Income Purely from Compensation/Other Non-Business/Non-Profession-Related Income, and the like) — January 2018 version with rates. |
| `1701Q Guide Jan 2018_copy.pdf` | Client guide/excerpt for BIR Form 1701Q (Quarterly Income Tax Return for Individuals, Estates, and Trusts). |
| `1701Q Jan 2018 final rev2_copy.pdf` | Official BIR Form 1701Q — January 2018 final revision 2. |
| `Kuwenta_1701Q_1701A_Study_Guide.docx` | Client-prepared study guide summarizing the 1701Q → 1701A flow and rules relevant to Kuwenta. |

## How to use these

- **Computation logic**: Cross-check line-item computations in `lib/computation/` against the official tables and instructions in the 1701Q and 1701A PDFs.
- **PDF templates**: Use the form layouts as the visual reference for `lib/pdf/templates/` when rendering filed returns.
- **Business rules**: If a conflict arises between the client guide and the code, prefer the official BIR form/PDF; capture the decision in `SPEC.md` or `AGENT.md`.

Do not edit these source files — they are the authoritative client copies.
    