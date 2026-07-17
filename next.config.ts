import type { NextConfig } from "next";
import path from "path";

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://horizon-testnet.stellar.org https://horizon.stellar.org",
  "object-src 'none'",
  // SAMEORIGIN + frame-ancestors 'self' allow the return-detail page to embed
  // generated/filing PDFs in an iframe while still blocking third-party
  // clickjacking. frame-ancestors 'none' / DENY break PDF preview entirely
  // (issue #260).
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // tesseract.js spawns its own `worker_threads` Worker from a path it
  // computes via `__dirname` of its own source. When Next.js bundles
  // tesseract.js into the app, that `__dirname` is rewritten to point
  // inside `.next/` and the worker script can no longer be located
  // (issue #199). Marking the package as external preserves the original
  // file layout at runtime.
  serverExternalPackages: ["tesseract.js"],
  // The bundled English traineddata at lib/ocr/tessdata/eng.traineddata is
  // not reachable from any source file via a static import, so Next's
  // default output-file tracing skips it. Without this entry the file is
  // absent from the server bundle and POST /api/income/import throws inside
  // the tesseract.js worker init on staging (issue #201), surfacing as a
  // 500. Pin the path relative to the repo root so it is copied into the
  // standalone trace.
  outputFileTracingIncludes: {
    "**/*": [path.join("lib", "ocr", "tessdata", "**")],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
