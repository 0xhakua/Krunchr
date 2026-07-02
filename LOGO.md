# LOGO.md — Krunchr Logo Generation Prompts

Symbol/mark generation prompts for **Krunchr**, derived from `SPEC.md` (Philippine tax-compliance engine that computes BIR filings and anchors each filed return as a tamper-proof receipt on the Stellar blockchain) and `BRAND.md` (brand identity, color system, and personality).

## Concept

The mark fuses two ideas from the product's single demo moment (`SPEC.md`): **compliance verification** (a checkmark, standing in for a correctly-filed, validated BIR return) and **blockchain anchoring** (a chain-link/node motif, standing in for the Stellar-anchored receipt). The two are built from one continuous geometric form rather than two separate icons collaged together — the checkmark's stroke resolves into a closed link shape, so "verified" and "anchored" read as a single, inseparable idea.

Style is drawn directly from `BRAND.md`: flat geometric vector, rounded terminals matching the app's `--radius` (rounded-xl / rounded-full scale), calm and precise rather than playful, no gradients, no drop shadows beyond the app's flat `.shadow-ambient` convention (omit shadow entirely for a logo mark). Personality: trustworthy, precise, calm, modern-corporate (`BRAND.md` §1).

## Shared technical specs (all three variants)

- **Symbol only — no wordmark, no letterforms, no "K" monogram, no text of any kind.**
- Single continuous geometric symbol: a rounded checkmark whose lower stroke curves into a closed chain-link/node loop — read together as one shield-adjacent silhouette, not two overlapping icons.
- Perfectly flat vector illustration style — clean geometric shapes, consistent stroke width, rounded corners and line caps (no sharp miters), no gradients, no drop shadows, no bevels, no textures, no photorealism, no 3D rendering.
- Enclosed in an implied rounded-square or circular badge boundary (soft geometry, not a hard-edged corporate crest) so the mark works as an app icon / favicon at small sizes.
- Balanced, centered, symmetric composition; must remain legible and recognizable at 32×32px.
- Vector/flat-icon aesthetic, like a modern fintech or compliance-SaaS app icon — think the visual weight of a shadcn/lucide icon scaled up, not a mascot or emblem.
- Square canvas, generous padding, symbol centered.
- No text, no lettering, no numerals, no taglines, no Philippine flag imagery, no currency symbols.

## 1. Colored version

```
A flat vector app-icon symbol: a rounded checkmark whose lower stroke curves and closes into a chain-link node, forming one continuous geometric shape inside a soft rounded-square badge. No text, no letters, no wordmark — symbol only. The checkmark stroke is solid deep teal (#0D9488) with a mint accent (#4EDEA3) filling or outlining the chain-link node where the stroke closes, on a very light, near-white cool background (#F8F9FF) or transparent background. Clean flat vector illustration, consistent rounded stroke width, rounded line caps and corners, no gradients, no drop shadows, no bevels, no textures, no 3D, no photorealism. Calm, precise, trustworthy, modern-corporate fintech app-icon style. Centered, symmetric, balanced negative space, clearly recognizable at small sizes (32x32px favicon scale). Square canvas.
```

## 2. White-only silhouette on dark background

```
A flat vector app-icon symbol: a rounded checkmark whose lower stroke curves and closes into a chain-link node, forming one continuous geometric shape inside a soft rounded-square badge. No text, no letters, no wordmark — symbol only. Rendered as a single solid pure-white (#FFFFFF) silhouette, one flat color only, no gradients, no shading, no color variation within the mark. Background is solid dark navy (#0B1C30), matching a dark-mode app canvas. Clean flat vector illustration, consistent rounded stroke width, rounded line caps and corners, no bevels, no textures, no 3D, no photorealism. Calm, precise, trustworthy, modern-corporate fintech app-icon style. Centered, symmetric, balanced negative space, clearly recognizable at small sizes (32x32px favicon scale). Square canvas.
```

## 3. Dark silhouette on white background

```
A flat vector app-icon symbol: a rounded checkmark whose lower stroke curves and closes into a chain-link node, forming one continuous geometric shape inside a soft rounded-square badge. No text, no letters, no wordmark — symbol only. Rendered as a single solid dark navy-ink (#0B1C30) silhouette, one flat color only, no gradients, no shading, no color variation within the mark. Background is solid clean white (#FFFFFF) or the app's off-white canvas (#F8F9FF). Clean flat vector illustration, consistent rounded stroke width, rounded line caps and corners, no bevels, no textures, no 3D, no photorealism. Calm, precise, trustworthy, modern-corporate fintech app-icon style. Centered, symmetric, balanced negative space, clearly recognizable at small sizes (32x32px favicon scale). Square canvas.
```

## Negative prompt (append to all three, if the generator supports it)

```
no text, no letters, no numbers, no words, no wordmark, no monogram, no realistic photography, no 3D render, no gradient, no drop shadow, no bevel, no texture, no mascot, no human figure, no flag, no currency symbol, no clutter, no multiple unrelated icons, not busy, not low-contrast
```
