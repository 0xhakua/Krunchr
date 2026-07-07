import { promises as fs } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

type FieldSummary = {
  name: string;
  type: string;
  value: string;
  isMultiline: boolean;
  isReadOnly: boolean;
  isRequired: boolean;
  isVisible: boolean;
  options?: string[];
};

type PageSummary = {
  index: number;
  width: number;
  height: number;
  fieldCount: number;
};

async function inspectForm(pdfPath: string) {
  const bytes = await fs.readFile(pdfPath);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const form = doc.getForm();
  const fields = form.getFields();

  const fieldSummaries: FieldSummary[] = fields.map((f) => {
    const name = f.getName();
    const constructorName = f.constructor.name;
    let value = "";
    let options: string[] | undefined;
    try {
      if (constructorName === "PDFTextField") {
        const tf = f as unknown as { getText?(): string; isMultiline(): boolean };
        value = tf.getText ? tf.getText() : "";
      } else if (constructorName === "PDFCheckBox") {
        const cb = f as unknown as { isChecked(): boolean };
        value = cb.isChecked() ? "checked" : "unchecked";
      } else if (constructorName === "PDFRadioGroup") {
        const rg = f as unknown as {
          getSelected?(): string | undefined;
          getOptions(): string[];
        };
        value = rg.getSelected ? (rg.getSelected() ?? "") : "";
        options = rg.getOptions();
      } else if (constructorName === "PDFDropdown") {
        const dd = f as unknown as {
          getSelected?(): string | string[] | undefined;
          getOptions(): string[];
        };
        const sel = dd.getSelected ? dd.getSelected() : undefined;
        value = Array.isArray(sel) ? sel.join(",") : sel ?? "";
        options = dd.getOptions();
      } else if (constructorName === "PDFOptionList") {
        const ol = f as unknown as {
          getSelected?(): string[];
          getOptions(): string[];
        };
        value = (ol.getSelected ? ol.getSelected() : []).join(",");
        options = ol.getOptions();
      }
    } catch {
      value = "<unreadable>";
    }

    let isMultiline = false;
    let isReadOnly = false;
    let isRequired = false;
    const isVisible = true;
    try {
      if (constructorName === "PDFTextField") {
        const tf = f as unknown as { isMultiline(): boolean; isReadOnly(): boolean; isRequired(): boolean };
        isMultiline = tf.isMultiline();
        isReadOnly = tf.isReadOnly();
        isRequired = tf.isRequired();
      }
    } catch {
      // not all widgets support these predicates
    }

    return {
      name,
      type: constructorName,
      value,
      isMultiline,
      isReadOnly,
      isRequired,
      isVisible,
      ...(options ? { options } : {}),
    };
  });

  const pages: PageSummary[] = doc.getPages().map((p, i) => {
    let count = 0;
    try {
      // pdf-lib's PDFPage doesn't expose getWidgets; widget count requires
      // walking the AcroForm. Use the form's total widget count as a proxy.
      count = form.getFields().length;
    } catch {
      count = -1;
    }
    return {
      index: i + 1,
      width: p.getWidth(),
      height: p.getHeight(),
      fieldCount: count,
    };
  });

  return {
    path: pdfPath,
    pageCount: doc.getPageCount(),
    isEncrypted: doc.isEncrypted,
    fieldCount: fieldSummaries.length,
    fields: fieldSummaries,
    pages,
  };
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: tsx scripts/inspect-bir-form.ts <path-to-bir-pdf>");
    process.exit(2);
  }
  const resolved = path.resolve(target);
  const result = await inspectForm(resolved);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
