import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

// Body / headings / UI — SF Pro system font stack (BRAND.md §4).
// Apple ships SF Pro on every macOS / iOS device, so we get a native
// iOS / macOS / iCloud look with zero download and zero FOIT. On
// Windows / Android the stack degrades to system-ui. Defined as
// `--font-sans` / `--font-heading` in app/globals.css :root.

// Monospace — Stellar hashes / TX IDs only. Geist Mono is loaded
// via next/font/google and exposed as `--font-mono`.
const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Krunchr — Compliance Engine",
  description:
    "Philippine tax compliance for self-employed freelancers, with Stellar-anchored filing receipts.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
