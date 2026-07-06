import type { NextConfig } from "next";

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://horizon-testnet.stellar.org https://horizon.stellar.org",
  "object-src 'none'",
  "frame-ancestors 'none'",
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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
