declare module 'pdf2json' {
  interface PdfParserError {
    parserError?: Error
  }

  interface PdfParser {
    on(event: 'pdfParser_dataError', listener: (errData: PdfParserError) => void): void
    on(event: 'pdfParser_dataReady', listener: (pdfData: unknown) => void): void
    parseBuffer(buffer: Buffer): void
    getRawTextContent(): string
  }

  interface PDFParserConstructor {
    new (context?: unknown, verbosity?: number): PdfParser
  }

  const PDFParser: PDFParserConstructor
  export default PDFParser
}
