#!/usr/bin/env python3
"""Build Krunchr pitch deck v3 PPTX (docs/pitch-deck-v3.pptx).

Extends the v2 deck (scripts/build-pitch-deck-pptx.py / docs/pitch-deck.md)
with three new sections requested for v3:
  - Stellar ecosystem impact
  - Ecosystem integration roadmap (Anchors, SEP standards, DEX, Soroban)
  - Go-to-market strategy at Philippines / APAC / Global levels
Content for the new sections is sourced from the ecosystem research report
saved as a GitHub issue (webnxt-2030/krunchr#191).

Every slide gets embedded PPTX speaker notes (slide.notes_slide), which the
v2 script did not add (those notes only existed in docs/pitch-deck.md prose).

Run: python scripts/build-pitch-deck-v3-pptx.py
"""
from pathlib import Path
from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml import parse_xml

ROOT = Path(__file__).parent.parent
DOCS = ROOT / "docs"
OUTPUT = DOCS / "pitch-deck-v3.pptx"

# Brand colors (BRAND.md)
TEAL = RGBColor(13, 148, 136)
TEAL_INK = RGBColor(0, 106, 97)
MINT = RGBColor(78, 222, 163)
INK = RGBColor(11, 28, 48)
MUTED = RGBColor(69, 70, 77)
ERROR = RGBColor(186, 26, 26)
CANVAS = RGBColor(248, 249, 255)
CARD = RGBColor(255, 255, 255)
BORDER = RGBColor(226, 232, 240)
WHITE = RGBColor(255, 255, 255)
INFO_BLUE = RGBColor(59, 130, 246)
SURFACE = RGBColor(239, 244, 255)   # surface container low (#EFF4FF)
MINT_TINT = RGBColor(223, 250, 241)  # mint verified chip fill
MINT_DEEP = RGBColor(0, 150, 104)    # mint deep text (#009668)


def hex_to_rgb(hex_color: str) -> RGBColor:
    hex_color = hex_color.lstrip("#")
    return RGBColor(int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16))


def render_logo(filename: str, bg: str, stroke: str, node: str, size: int = 512) -> Path:
    """Render the Krunchr logo as PNG from primitive shapes (matches LOGO.md concept)."""
    img = Image.new("RGBA", (size, size), bg)
    draw = ImageDraw.Draw(img)
    r = size / 512

    draw.rounded_rectangle(
        [int(336 * r), int(192 * r), int(432 * r), int(288 * r)],
        radius=int(28 * r),
        fill=node,
    )
    draw.rounded_rectangle(
        [int(360 * r), int(216 * r), int(408 * r), int(264 * r)],
        radius=int(14 * r),
        fill=bg,
    )

    sw = int(56 * r)
    p1 = (int(128 * r), int(168 * r))
    p2 = (int(240 * r), int(344 * r))
    p3 = (int(336 * r), int(240 * r))
    draw.line([p1, p2, p3], fill=stroke, width=sw, joint="curve")

    cap = sw // 2
    for p in (p1, p2, p3):
        draw.ellipse([p[0] - cap, p[1] - cap, p[0] + cap, p[1] + cap], fill=stroke)

    out = DOCS / filename
    img.save(out)
    return out


def set_slide_bg(slide, color: RGBColor):
    background = slide.background
    fill = background.fill
    fill.solid()
    fill.fore_color.rgb = color


def apply_shadow(shape):
    """Apply the BRAND.md flat `shadow-ambient` (soft slate outer shadow) to a shape."""
    spPr = shape._element.spPr
    ns = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
    for el in spPr.findall(ns + "effectLst"):
        spPr.remove(el)
    spPr.append(parse_xml(
        '<a:effectLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        '<a:outerShdw blurRad="76200" dist="34925" dir="5400000" rotWithShape="0">'
        '<a:srgbClr val="0F172A"><a:alpha val="14000"/></a:srgbClr>'
        '</a:outerShdw></a:effectLst>'
    ))
    return shape


def set_notes(slide, text: str):
    """Embed PPTX speaker notes on a slide."""
    notes_slide = slide.notes_slide
    notes_slide.notes_text_frame.text = text


def add_textbox(
    slide,
    left,
    top,
    width,
    height,
    text,
    font_size,
    color=INK,
    bold=False,
    align=PP_ALIGN.LEFT,
    font_name="SF Pro Display",
):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = text
    p.font.size = Pt(font_size)
    p.font.color.rgb = color
    p.font.bold = bold
    p.font.name = font_name
    p.alignment = align
    return box


def add_bullet_list(slide, left, top, width, height, items, font_size=20, color=INK):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = box.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = item
        p.level = 0
        p.font.size = Pt(font_size)
        p.font.color.rgb = color
        p.font.name = "SF Pro Text"
        p.space_after = Pt(14)
        p._pPr.insert(0, parse_xml(r'<a:buChar xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" char="•"/>'))
    return box


def add_card(slide, left, top, width, height, title, body, number=None, title_size=20, body_size=14, accent=TEAL):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(height))
    shape.fill.solid()
    shape.fill.fore_color.rgb = CARD
    shape.line.color.rgb = BORDER
    shape.line.width = Pt(1)
    shape.adjustments[0] = 0.10  # rounded-xl
    apply_shadow(shape)

    if number is not None:
        num = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left + 0.25), Inches(top + 0.25), Inches(0.45), Inches(0.45))
        num.fill.solid()
        num.fill.fore_color.rgb = accent
        num.line.fill.background()
        add_textbox(slide, left + 0.25, top + 0.30, 0.45, 0.35, str(number), 18, WHITE, True, PP_ALIGN.CENTER)

    offset = 0.55 if number is not None else 0
    add_textbox(slide, left + 0.25 + offset, top + 0.25, width - 0.5 - offset, 0.4, title, title_size, INK, True)
    add_textbox(slide, left + 0.25, top + 0.75, width - 0.5, height - 1.0, body, body_size, MUTED)


def add_pill(slide, left, top, width, height, text, bg=TEAL, fg=WHITE, size=12, border=None):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(height))
    shape.fill.solid()
    shape.fill.fore_color.rgb = bg
    if border is not None:
        shape.line.color.rgb = border
        shape.line.width = Pt(1)
    else:
        shape.line.fill.background()
    shape.adjustments[0] = 0.5
    add_textbox(slide, left, top + (height - 0.28) / 2, width, 0.28, text, size, fg, True, PP_ALIGN.CENTER)
    return shape


def add_status_pill(slide, left, top):
    """The signature always-visible 'Blockchain Status: Secured' motif (BRAND.md §1, §7).

    Rendered as a neutral surface chip with a mint status dot and teal-ink label.
    """
    w, h = 2.75, 0.36
    chip = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(w), Inches(h))
    chip.fill.solid()
    chip.fill.fore_color.rgb = SURFACE
    chip.line.color.rgb = BORDER
    chip.line.width = Pt(1)
    chip.adjustments[0] = 0.5
    dot = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(left + 0.22), Inches(top + 0.13), Inches(0.11), Inches(0.11))
    dot.fill.solid()
    dot.fill.fore_color.rgb = MINT_DEEP
    dot.line.fill.background()
    add_textbox(slide, left + 0.42, top + 0.05, w - 0.5, 0.28, "Blockchain Status: Secured", 12, TEAL_INK, True)


def add_footer(slide, logo_path, slide_num, total):
    line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.6), Inches(6.95), Inches(12.13), Inches(0.01))
    line.fill.solid()
    line.fill.fore_color.rgb = BORDER
    line.line.fill.background()

    slide.shapes.add_picture(str(logo_path), Inches(0.6), Inches(7.05), width=Inches(0.35))
    add_textbox(slide, 1.05, 7.02, 3.2, 0.3, "Krunchr", 14, INK, True)
    add_textbox(slide, 1.05, 7.27, 3.2, 0.22, "Compliance Engine", 9, MUTED, False)
    add_textbox(slide, 10.4, 7.08, 2.3, 0.3, f"Pitch Deck v3   ·   {slide_num} / {total}", 12, MUTED, False, PP_ALIGN.RIGHT)


def build():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]

    existing_logo = DOCS / "logo-colored-pptx.png"
    logo_colored = existing_logo if existing_logo.exists() else render_logo(
        "logo-colored-pptx.png", "#F8F9FF", "#0D9488", "#4EDEA3"
    )

    TOTAL = 12

    # ---------------------------------------------------------------
    # Slide 1: Title
    # ---------------------------------------------------------------
    slide = prs.slides.add_slide(blank)
    set_slide_bg(slide, CANVAS)
    # Brand lockup: logo tile + "Krunchr / Compliance Engine" (BRAND.md §6)
    slide.shapes.add_picture(str(logo_colored), Inches(0.8), Inches(0.85), width=Inches(0.95))
    add_textbox(slide, 1.95, 0.88, 5.0, 0.45, "Krunchr", 30, INK, True)
    add_textbox(slide, 1.98, 1.42, 5.0, 0.3, "COMPLIANCE ENGINE", 13, TEAL_INK, True)
    add_textbox(slide, 0.8, 2.5, 11.5, 1.2, "Krunchr", 80, INK, True)
    add_textbox(slide, 0.8, 3.7, 11.0, 0.6, "Compliance Engine — Philippine tax filing, anchored on Stellar.", 30, MUTED)
    add_textbox(slide, 0.8, 4.45, 11.0, 0.5, "v3: from hackathon demo to a Stellar-native compliance business.", 24, TEAL_INK, True)
    add_pill(slide, 0.8, 5.25, 3.05, 0.42, "✓  Stellar-Secured Receipts", MINT_TINT, MINT_DEEP, 13, border=MINT)
    add_textbox(slide, 0.8, 5.95, 11.5, 0.4, "APAC Stellar Hackathon 2026 · Local Finance & Real World Access", 16, TEAL_INK, True)
    add_textbox(slide, 0.8, 6.35, 11.5, 0.3, "Team: [PLACEHOLDER]    Contact: krunchr@artisam.xyz", 15, MUTED)
    add_footer(slide, logo_colored, 1, TOTAL)
    set_notes(slide, (
        "This is Krunchr — a compliance engine that takes one of the most anxious chores a Filipino "
        "freelancer faces, filing their BIR taxes, and turns it into something that just feels handled. "
        "This is v3 of the deck: everything from v2 still stands — the problem, the working product, the "
        "demo — but we've added three things investors and the Stellar community will want to see: our "
        "impact on the Stellar ecosystem specifically, our plan to integrate existing Stellar building "
        "blocks (Anchors, SEP standards, Soroban), and a concrete go-to-market plan from the Philippines "
        "outward to APAC and global. I'm [name], and I'll walk through all of it in the next few minutes."
    ))

    # ---------------------------------------------------------------
    # Slide 2: Problem
    # ---------------------------------------------------------------
    slide = prs.slides.add_slide(blank)
    set_slide_bg(slide, CANVAS)
    add_textbox(slide, 0.8, 0.6, 11.0, 0.4, "THE PROBLEM", 15, TEAL_INK, True)
    add_textbox(slide, 0.8, 1.0, 11.0, 0.9, "Eight returns a year. One mistake costs money, time, and trust.", 44, INK, True)
    items = [
        "A freelancer on the 8% flat rate owes up to 8 BIR returns a year — 2551Q ×4, 1701Q ×3, 1701A — in strict legal order.",
        "The rules interact badly: the 8% election is irrevocable; mixed-income earners lose the ₱250,000 exemption; penalties changed under RA 11976; due dates roll past Philippine holidays.",
        "One wrong sequence or missed deadline → surcharge, daily interest, compromise penalties, and a black mark banks and embassies ask about.",
        "Once filed, all a freelancer has is a scanned PDF — no quick, trustworthy way for a third party to verify it.",
    ]
    add_bullet_list(slide, 0.8, 2.1, 11.3, 4.6, items, 20)
    add_footer(slide, logo_colored, 2, TOTAL)
    set_notes(slide, (
        "Here's the pain. A self-employed freelancer in the Philippines on the 8% flat rate isn't filing "
        "one form, they're filing up to eight, every year, in a legally-mandated order, each with a "
        "different deadline. The rules interact in nasty ways: the 8% election locks for the whole year, "
        "mixed-income earners lose a 250,000-peso exemption, and the penalty rates literally changed under "
        "new legislation. Get the sequence or a deadline wrong and you owe surcharge, interest, and a "
        "compromise penalty, and you carry a mark that banks and embassies will ask about. Once you do "
        "file, all you have to prove it is a scanned PDF that anyone could have edited."
    ))

    # ---------------------------------------------------------------
    # Slide 3: Solution
    # ---------------------------------------------------------------
    slide = prs.slides.add_slide(blank)
    set_slide_bg(slide, CANVAS)
    add_textbox(slide, 0.8, 0.6, 11.0, 0.4, "THE SOLUTION", 15, TEAL_INK, True)
    add_textbox(slide, 0.8, 1.0, 11.0, 0.9, "Krunchr turns eight confusing returns into one upload.", 44, INK, True)
    cards = [
        ("Upload Form 2307s", "Drop in withholding certificates. The engine recomputes your entire tax year, every return, in the correct legal sequence."),
        ("Correct by Construction", "8%, graduated-rate + OSD, RA 11976 penalty rates, holiday-aware due dates, and mixed-income exemption rules are enforced in code."),
        ("Tamper-Evident Receipt", "Every filed return is anchored on Stellar. Banks, embassies, or auditors can verify it in seconds, not trust a PDF."),
        ("One-Click Filing Package", "All return PDFs, the SAWT summary, and a cover sheet — bundled and ready to download."),
    ]
    xs = [0.8, 3.6, 6.4, 9.2]
    for i, (x, (title, body)) in enumerate(zip(xs, cards), 1):
        add_card(slide, x, 2.2, 2.7, 3.9, title, body, i)
    add_footer(slide, logo_colored, 3, TOTAL)
    set_notes(slide, (
        "Our solution is one sentence: Krunchr turns eight confusing returns into one upload. You drop in "
        "your Form 2307 withholding certificates, and the engine recomputes your entire tax year, every "
        "return, in the exact order the BIR requires. Correctness is built into the engine: 8% rules, "
        "graduated-rate brackets with an optional 40% standard deduction, RA 11976 penalty rates, "
        "holiday-aware due dates, and the mixed-income exemption rule. Each filed return becomes a "
        "tamper-evident receipt anchored on Stellar. And the whole package downloads in one click."
    ))

    # ---------------------------------------------------------------
    # Slide 4: Demo
    # ---------------------------------------------------------------
    slide = prs.slides.add_slide(blank)
    set_slide_bg(slide, CANVAS)
    add_textbox(slide, 0.8, 0.6, 11.0, 0.4, "LIVE DEMO", 15, TEAL_INK, True)
    add_textbox(slide, 0.8, 1.0, 11.0, 0.6, "The single demo moment", 44, INK, True)
    add_textbox(slide, 0.8, 1.6, 11.0, 0.4, "From onboarding to verified compliance in about 30 seconds.", 22, MUTED)
    steps = [
        ("Onboard", "3-minute setup: TIN, RDO, tax codes."),
        ("Upload 2307s", "Withholding certificates land in the dashboard."),
        ("Returns Compute", "All 8 returns run in sequence: Blocked → Pending → Generated → Filed."),
        ("File & Anchor", "A Stellar TX ID and scannable QR appear on the receipt."),
        ("Verify", "A loan officer scans it — compliance confirmed in ~30 seconds."),
    ]
    step_w = 2.2
    gap = 0.22
    for i, (title, body) in enumerate(steps, 1):
        x = 0.8 + (i - 1) * (step_w + gap)
        add_card(slide, x, 2.2, step_w, 2.6, title, body, i)
    demo_box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(5.0), Inches(11.73), Inches(1.7))
    demo_box.fill.solid(); demo_box.fill.fore_color.rgb = CARD; demo_box.line.color.rgb = BORDER
    apply_shadow(demo_box)
    add_textbox(slide, 0.8, 5.65, 11.73, 0.5, "[Demo screen recording placeholder — onboarding → upload 2307 → returns compute → file one → QR / verification]", 15, MUTED, False, PP_ALIGN.CENTER)
    add_footer(slide, logo_colored, 4, TOTAL)
    set_notes(slide, (
        "Here's the moment the whole product is built around. Onboarding takes three minutes, then the "
        "user uploads Form 2307 certificates. The dashboard lights up: all eight returns compute in "
        "sequence, moving from Blocked to Pending to Generated to Filed. Filing one return produces a "
        "Stellar transaction ID and a scannable QR code. The punchline: hand your phone to a loan officer, "
        "they scan it, and compliance is confirmed in about thirty seconds. Play the recording here."
    ))

    # ---------------------------------------------------------------
    # Slide 5: How it works
    # ---------------------------------------------------------------
    slide = prs.slides.add_slide(blank)
    set_slide_bg(slide, CANVAS)
    add_textbox(slide, 0.8, 0.6, 11.0, 0.4, "HOW IT WORKS", 15, TEAL_INK, True)
    add_textbox(slide, 0.8, 1.0, 11.0, 0.6, "One app. One engine. One immutable receipt.", 44, INK, True)
    arch = [
        ("Upload income", "Form 2307 certificates trigger a full-year recascade."),
        ("Pure computation engine", "Every return, in order, with RA 11976 penalties and holiday deadlines."),
        ("Generate BIR PDF", "Official-form PDFs plus SAWT and cover sheet."),
        ("Anchor hash on Stellar", "A SHA-256 fingerprint is stored as a manageData operation per return."),
    ]
    y = 1.95
    for title, body in arch:
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(y), Inches(6.5), Inches(0.85))
        card.fill.solid(); card.fill.fore_color.rgb = CARD; card.line.color.rgb = BORDER
        apply_shadow(card)
        add_textbox(slide, 1.0, y + 0.12, 6.1, 0.3, title, 17, INK, True)
        add_textbox(slide, 1.0, y + 0.42, 6.1, 0.35, body, 13, MUTED)
        if y < 5.0:
            add_textbox(slide, 3.8, y + 0.82, 0.5, 0.25, "↓", 20, TEAL, True, PP_ALIGN.CENTER)
        y += 1.05
    items = [
        "Money is never floating-point — all math runs through decimal.js.",
        "Append-only audit trail — elections, filings, retries, and dispositions are logged forever.",
        "Failure is graceful — if anchoring hiccups, the filing still succeeds and retries later.",
        "Today: hash-only anchoring on testnet. The next sections cover how we deepen this into a real Stellar-native stack.",
    ]
    add_bullet_list(slide, 8.0, 2.0, 4.5, 4.2, items, 16)
    add_footer(slide, logo_colored, 5, TOTAL)
    set_notes(slide, (
        "Here's the shape of it, without the buzzwords. One app, one database, one computation engine. A "
        "user uploads income, the engine figures out every return, the server generates the official BIR "
        "PDF, and a fingerprint of that PDF is anchored on-chain. We never do money in floating point, "
        "every meaningful action is written to an append-only audit log, and failure is graceful: if "
        "anchoring hiccups, filing still succeeds and retries later. Today this is hash-only anchoring on "
        "testnet — that's exactly what the next two slides build on."
    ))

    # ---------------------------------------------------------------
    # Slide 6: Stellar Ecosystem Impact (NEW)
    # ---------------------------------------------------------------
    slide = prs.slides.add_slide(blank)
    set_slide_bg(slide, CANVAS)
    add_textbox(slide, 0.8, 0.6, 11.0, 0.4, "STELLAR ECOSYSTEM IMPACT", 15, TEAL_INK, True)
    add_textbox(slide, 0.8, 1.0, 11.5, 0.9, "A real Real-World-Access use case — and ecosystem whitespace.", 38, INK, True)
    items = [
        "Non-speculative use case: every anchored receipt is a genuine compliance event, not a trading or DeFi transaction — the kind of \"real world access\" Stellar's own tracks are built to reward.",
        "Ecosystem research (see GitHub issue #191) found no shipped Stellar product specifically for tax filing or government compliance — Krunchr is credible whitespace, not a me-too dApp.",
        "The Philippines already has real Stellar payment-rail traction — Coins.ph (PHP anchor since ~2017) and MoneyGram Access's PHP/USDC corridor — giving Krunchr a market where Stellar rails are already trusted.",
        "The roadmap (next slide) moves Krunchr from \"a hash on a ledger\" toward genuine on-chain infrastructure: a Soroban attestation registry and portable, privacy-preserving compliance credentials.",
        "This positions Krunchr as a strong Stellar Community Fund (SCF) Build Award candidate — SCF 7.0 grants run $15K–$150K+ for exactly this kind of novel, real-world-impact use case.",
    ]
    add_bullet_list(slide, 0.8, 2.1, 11.3, 4.6, items, 18)
    add_footer(slide, logo_colored, 6, TOTAL)
    set_notes(slide, (
        "Let's talk about impact on Stellar specifically, not blockchain in general. Every receipt we "
        "anchor is a real compliance event — not a trade, not a speculative transaction. We did a deep "
        "ecosystem research pass, saved as GitHub issue #191 in our repo, and found no other shipped "
        "Stellar product doing government tax compliance. That's whitespace. The Philippines already has "
        "Stellar traction through Coins.ph and MoneyGram's PHP/USDC corridor, so we're building in a market "
        "where Stellar rails are already trusted, not starting from zero. And our roadmap takes us from a "
        "simple hash-anchor today to genuine on-chain infrastructure — which is exactly the kind of project "
        "the Stellar Community Fund's Build Award exists to fund."
    ))

    # ---------------------------------------------------------------
    # Slide 7: Ecosystem Integration Roadmap (NEW)
    # ---------------------------------------------------------------
    slide = prs.slides.add_slide(blank)
    set_slide_bg(slide, CANVAS)
    add_textbox(slide, 0.8, 0.6, 11.0, 0.4, "ECOSYSTEM INTEGRATION ROADMAP", 15, TEAL_INK, True)
    add_textbox(slide, 0.8, 1.0, 11.5, 0.9, "Building on Stellar's existing rails, not around them.", 38, INK, True)
    integ_cards = [
        (0.8, "Soroban Smart Contracts", "An on-chain receipt-registry contract: verify(returnId, hash) → bool, multi-party attestation via require_auth, and reusable OpenZeppelin RBAC for admin roles. Upgrades a flat hash into a queryable, tamper-proof registry."),
        (3.75, "Anchors · SEP-24 / SEP-31", "PHP settlement via a Coins.ph-style anchor; USDC income intake from foreign clients auto-drafts an income record; a MoneyGram Access partnership for off-ramp payouts."),
        (6.7, "SEP-12 / SEP-45 (KYC)", "Krunchr's TIN-verified TaxpayerProfile already matches SEP-12's KYC field set — we can act as a KYC source for anchors, plus adopt SEP-45 passkey/smart-wallet login."),
        (9.65, "Stellar DEX · SEP-38", "For USD/USDC-paid freelancers: capture an auditable SEP-38 quote or DEX rate at income-declaration time, giving the peso figure a verifiable FX basis for a BIR audit."),
    ]
    for x, title, body in integ_cards:
        add_card(slide, x, 2.2, 2.75, 4.0, title, body, title_size=17, body_size=12.5)
    add_footer(slide, logo_colored, 7, TOTAL)
    set_notes(slide, (
        "Here's specifically how we plug into what Stellar already has. Soroban gives us a real on-chain "
        "receipt registry instead of a flat key-value hash, with multi-party attestation so a receipt isn't "
        "just self-signed by us. Anchors — SEP-24 and SEP-31 — are how freelancers actually settle: Coins.ph "
        "and MoneyGram Access already run PHP and USDC corridors in the Philippines, and we want to sit on "
        "top of those rather than build our own. SEP-12 is interesting because our taxpayer profile already "
        "collects the exact KYC fields an anchor needs — we could become a KYC source, not just a consumer. "
        "And the Stellar DEX with SEP-38 quotes solves a very specific pain: freelancers paid in USD need an "
        "auditable, third-party FX rate to convert to pesos for their tax filing, and the DEX can supply "
        "that. One caveat we're upfront about: BIR doesn't accept crypto payment or DEX rates as statutory "
        "basis today, so all of this is a settlement and evidence layer feeding existing BIR channels, not "
        "a replacement for them."
    ))

    # ---------------------------------------------------------------
    # Slide 8: Compliance Credential (NEW, supports GTM/differentiation)
    # ---------------------------------------------------------------
    slide = prs.slides.add_slide(blank)
    set_slide_bg(slide, CANVAS)
    add_textbox(slide, 0.8, 0.6, 11.0, 0.4, "THE BIG IDEA", 15, TEAL_INK, True)
    add_textbox(slide, 0.8, 1.0, 11.5, 0.9, "A portable, verifiable Compliance Credential.", 40, INK, True)
    add_textbox(slide, 0.8, 1.85, 11.3, 0.5, "The most differentiated, fundable idea from our ecosystem research — and likely genuine whitespace on Stellar.", 20, MUTED)
    cards = [
        ("Prove compliance, not income", "\"Taxpayer X filed all mandated returns for TY2026, receipts anchored at ledgers …\" — verifiable by a lender or embassy without seeing the underlying returns."),
        ("Selective disclosure (ZK)", "Prove \"declared income ≥ ₱X\" or \"compliant = true\" without revealing exact figures, using Stellar's newer BN254/Poseidon primitives or an identity registry like Luminar."),
        ("Government-attested, eventually", "Adopt the SEP-57 / T-REX attestation pattern so a future BIR/RDO signer can endorse a receipt on-chain — upgrading a self-anchored hash into a government-attested record."),
    ]
    for i, (x, (title, body)) in enumerate(zip([0.8, 4.75, 8.7], cards), 1):
        add_card(slide, x, 2.6, 3.6, 3.6, title, body, i)
    add_footer(slide, logo_colored, 8, TOTAL)
    set_notes(slide, (
        "This is the single idea from our research we're most excited about. Instead of just anchoring a "
        "hash, we issue the taxpayer a portable Compliance Credential — proof that they filed everything "
        "correctly, verifiable by a bank or embassy without exposing the actual return contents. With "
        "zero-knowledge selective disclosure, using Stellar's newer BN254 and Poseidon primitives, a "
        "freelancer could prove \"my declared income is above this threshold\" or \"I am fully compliant\" "
        "without revealing exact numbers. And longer term, this credential could carry an actual BIR or RDO "
        "attestation on-chain. We searched hard and didn't find another Stellar project doing this for tax "
        "compliance — this is where we think the real differentiation and fundability is."
    ))

    # ---------------------------------------------------------------
    # Slide 9: GTM — Philippines (NEW)
    # ---------------------------------------------------------------
    slide = prs.slides.add_slide(blank)
    set_slide_bg(slide, CANVAS)
    add_textbox(slide, 0.8, 0.6, 11.0, 0.4, "GO-TO-MARKET · LEVEL 1", 15, TEAL_INK, True)
    add_pill(slide, 9.8, 0.55, 2.3, 0.42, "PHILIPPINES · NOW", TEAL, WHITE, 14)
    add_textbox(slide, 0.8, 1.0, 11.0, 0.9, "Win the home market first: 8%-flat-rate freelancers.", 38, INK, True)
    items = [
        "Direct-to-consumer: freemium SaaS — free computation, paid tier unlocks generation + anchored receipts + compliance credential.",
        "Channel partnerships: bookkeepers, accountants, and freelancer communities/platforms (e.g. freelancing marketplaces, co-working spaces) as referral and onboarding channels.",
        "Payment-rail partnership pilot: integrate a PHP anchor (Coins.ph-style) and/or MoneyGram Access so freelancers can settle USDC income and pay BIR dues without leaving the app.",
        "Funding: apply for a Stellar Community Fund (SCF) Build Award to finance the Soroban registry and compliance-credential work ahead of revenue.",
        "Proof point to carry forward: a verifiable receipt a Philippine bank or embassy can check in seconds — the trust unlock that sells the next two markets.",
    ]
    add_bullet_list(slide, 0.8, 2.1, 11.3, 4.6, items, 18)
    add_footer(slide, logo_colored, 9, TOTAL)
    set_notes(slide, (
        "Go-to-market starts at home. In the Philippines, we go direct-to-consumer with a freemium model: "
        "free tax computation, paid for generation, anchoring, and eventually the compliance credential. We "
        "partner with bookkeepers, accountants, and freelancer platforms as channels rather than trying to "
        "reach millions of freelancers one at a time. We pilot a real payment-rail partnership — Coins.ph or "
        "MoneyGram Access — so settling tax dues doesn't require leaving the app. And we fund the deeper "
        "Stellar work, the Soroban registry and the credential, through an SCF Build Award rather than "
        "burning runway on it. The output of this stage is a working, trusted proof point we can take to "
        "the next two markets."
    ))

    # ---------------------------------------------------------------
    # Slide 10: GTM — APAC (NEW)
    # ---------------------------------------------------------------
    slide = prs.slides.add_slide(blank)
    set_slide_bg(slide, CANVAS)
    add_textbox(slide, 0.8, 0.6, 11.0, 0.4, "GO-TO-MARKET · LEVEL 2", 15, TEAL_INK, True)
    add_pill(slide, 9.8, 0.55, 2.3, 0.42, "APAC · NEXT 12–18 MO", INFO_BLUE, WHITE, 13)
    add_textbox(slide, 0.8, 1.0, 11.0, 0.9, "Replicate the engine, keep the Stellar spine.", 38, INK, True)
    items = [
        "Target APAC markets with (a) large freelance/gig economies and (b) simplified or presumptive flat-tax regimes similar in shape to the Philippine 8% rate — the computation-engine pattern generalizes even though the tax law doesn't.",
        "Localize the computation layer per country (tax brackets, forms, due dates) while reusing the architecture: recascade engine, PDF dispatcher, audit trail, and Stellar anchoring unchanged.",
        "The Stellar-anchored receipt becomes the cross-border constant: a freelancer working across two APAC markets can carry one verifiable compliance history, not two incompatible paper trails.",
        "Lean on Stellar's existing APAC anchor/remittance network (built on the same MoneyGram/anchor rails validated in the Philippines) rather than negotiating new payment infrastructure market-by-market.",
        "Go-to-market motion: SCF ecosystem grants + local RegTech/accounting-software partnerships in each new market, mirroring the Philippine channel strategy.",
    ]
    add_bullet_list(slide, 0.8, 2.1, 11.3, 4.6, items, 18)
    add_footer(slide, logo_colored, 10, TOTAL)
    set_notes(slide, (
        "Once the Philippine engine is proven, APAC expansion is about replication, not reinvention. We "
        "look for markets with large freelance economies and similarly simplified flat-tax regimes, and we "
        "localize only the computation layer — brackets, forms, deadlines — while the architecture underneath "
        "stays the same: the recascade engine, PDF generation, audit trail, and Stellar anchoring. The "
        "Stellar receipt is what makes this genuinely cross-border: a freelancer working across two "
        "countries can carry one verifiable compliance history instead of two disconnected paper trails. "
        "And because Stellar's remittance and anchor network already spans APAC, we're not negotiating new "
        "payment rails from scratch in every market."
    ))

    # ---------------------------------------------------------------
    # Slide 11: GTM — Global (NEW)
    # ---------------------------------------------------------------
    slide = prs.slides.add_slide(blank)
    set_slide_bg(slide, CANVAS)
    add_textbox(slide, 0.8, 0.6, 11.0, 0.4, "GO-TO-MARKET · LEVEL 3", 15, TEAL_INK, True)
    add_pill(slide, 9.8, 0.55, 2.3, 0.42, "GLOBAL · LONG-TERM", MINT, INK, 13)
    add_textbox(slide, 0.8, 1.0, 11.0, 0.9, "The Compliance Credential becomes the product.", 38, INK, True)
    items = [
        "Beyond a country-by-country tax app, the durable global asset is the Verifiable Compliance Credential itself — a portable, privacy-preserving, Stellar-anchored proof of \"this person/entity is tax-compliant.\"",
        "B2B2C model: sell verification access to lenders, embassies, freelance marketplaces, and gig-economy platforms who need to check a worker's compliance status — the verifier pays, not only the taxpayer.",
        "Position as Compliance-as-a-Service / RegTech-as-a-Service infrastructure for any platform with distributed, self-employed workers — the same problem Krunchr solves for Philippine freelancers exists worldwide.",
        "Revenue mix at scale: freemium subscriptions (consumer) + per-filing anchoring fees (high margin, Stellar network cost is negligible) + credential-verification fees (B2B, most defensible).",
        "Global credibility path: SCF-funded Soroban infrastructure → proven Philippine + APAC deployments → credential-verification partnerships with international platforms.",
    ]
    add_bullet_list(slide, 0.8, 2.1, 11.3, 4.6, items, 18)
    add_footer(slide, logo_colored, 11, TOTAL)
    set_notes(slide, (
        "Long-term, we don't think of Krunchr as just a country-by-country tax app — the durable global "
        "asset is the Compliance Credential itself. Any platform with distributed, self-employed workers "
        "has the same underlying problem: how do you verify someone is compliant without exposing their "
        "full financial history? We can sell that verification to lenders, embassies, and gig platforms "
        "globally — a B2B2C model where the verifier pays. At scale, our revenue mix is freemium consumer "
        "subscriptions, a small high-margin fee per anchored filing, and credential-verification fees for "
        "B2B partners, which is the most defensible line because it depends on the on-chain attestation "
        "existing at all. The credibility path is straightforward: fund the Soroban infrastructure through "
        "SCF, prove it in the Philippines and APAC, then sell verification globally."
    ))

    # ---------------------------------------------------------------
    # Slide 12: Team / Thanks
    # ---------------------------------------------------------------
    slide = prs.slides.add_slide(blank)
    set_slide_bg(slide, CANVAS)
    slide.shapes.add_picture(str(logo_colored), Inches(6.15), Inches(0.9), width=Inches(1.0))
    add_textbox(slide, 0.8, 2.0, 11.73, 0.8, "Thank you.", 56, INK, True, PP_ALIGN.CENTER)
    add_textbox(slide, 0.8, 2.8, 11.73, 0.4, "Eight returns. One upload. One Stellar-native compliance layer.", 24, MUTED, False, PP_ALIGN.CENTER)
    for i in range(3):
        x = 3.1 + i * 2.4
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(3.6), Inches(2.0), Inches(2.0))
        card.fill.solid(); card.fill.fore_color.rgb = CARD; card.line.color.rgb = BORDER
        card.adjustments[0] = 0.10
        apply_shadow(card)
        circle = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x + 0.65), Inches(3.85), Inches(0.7), Inches(0.7))
        circle.fill.solid(); circle.fill.fore_color.rgb = hex_to_rgb("#E5EEFF"); circle.line.fill.background()
        add_textbox(slide, x, 4.65, 2.0, 0.3, "[Name]", 18, INK, True, PP_ALIGN.CENTER)
        add_textbox(slide, x, 5.0, 2.0, 0.25, "[Role]", 14, MUTED, False, PP_ALIGN.CENTER)
    add_textbox(slide, 0.8, 5.9, 11.73, 0.3, "app.krunchr.xyz    ·    krunchr.xyz    ·    krunchr@artisam.xyz", 17, TEAL_INK, True, PP_ALIGN.CENTER)
    add_textbox(slide, 0.8, 6.3, 11.73, 0.3, "Ecosystem research & reference links: github.com/webnxt-2030/krunchr, issue #191", 13, MUTED, False, PP_ALIGN.CENTER)
    add_footer(slide, logo_colored, 12, TOTAL)
    set_notes(slide, (
        "I'm [name], and this is the team — [placeholder]. You can try the app at app.krunchr.xyz, read more "
        "on our landing page, or reach us at krunchr@artisam.xyz. All the sourced research behind the "
        "Stellar ecosystem and go-to-market sections in this deck is saved as issue #191 on our GitHub repo, "
        "if you want to dig into the citations yourself. Thanks to the organizers, the Stellar community, "
        "and every Filipino freelancer who told us how filing actually feels. That's Krunchr — eight "
        "returns, one upload, one Stellar-native compliance layer. We'd love your questions."
    ))

    # Signature motif: place the always-visible "Blockchain Status: Secured"
    # chip top-right on content slides. Strategy slides (9-11) already carry a
    # branded market-level pill in that corner, and the title/closing slides
    # carry their own brand lockup, so those are left as-is.
    status_slide_indices = [1, 2, 3, 4, 5, 6, 7]  # slides 2-8 (0-indexed)
    for idx in status_slide_indices:
        add_status_pill(prs.slides[idx], 9.75, 0.55)

    prs.save(OUTPUT)
    print(f"Saved: {OUTPUT}")


if __name__ == "__main__":
    build()
