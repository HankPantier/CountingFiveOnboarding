#!/usr/bin/env python3
"""
Generate the AI Onboarding Agent Overview PDF.
Updated 2026-04-27: MFP seeding, 8-phase process, system flow diagram.
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether, Flowable
)

# ── Brand colors ──────────────────────────────────────────────────────────────
NAVY       = HexColor("#0B2545")
TEAL       = HexColor("#13A5B0")
DARK_GRAY  = HexColor("#333333")
MED_GRAY   = HexColor("#666666")
LIGHT_GRAY = HexColor("#E8EDF2")
WHITE      = HexColor("#FFFFFF")

# ── Diagram palette ───────────────────────────────────────────────────────────
D_PUR_FILL = HexColor("#EEEDFE")
D_PUR_STR  = HexColor("#9B8FE5")
D_PUR_TEXT = HexColor("#4C3FA0")

D_TEA_FILL = HexColor("#E1F5EE")
D_TEA_STR  = HexColor("#2AAF82")
D_TEA_TEXT = HexColor("#1A7A5E")

D_COR_FILL = HexColor("#FAECE7")
D_COR_STR  = HexColor("#E08060")
D_COR_TEXT = HexColor("#A04028")

D_AMB_FILL = HexColor("#FAEEDA")
D_AMB_STR  = HexColor("#D4AC50")
D_AMB_TEXT = HexColor("#8A6A1A")

D_GRY_FILL = HexColor("#F1EFE8")
D_GRY_STR  = HexColor("#B0A890")
D_GRY_TEXT = HexColor("#5A5548")

ARROW_CLR  = HexColor("#CCCCCC")

# ── Output path ───────────────────────────────────────────────────────────────
OUTPUT_PATH = "/Users/webhank/LocalSites/counting-five-onboarding/raw-docs/AI-Onboarding-Agent-Overview.pdf"


# ══════════════════════════════════════════════════════════════════════════════
# Flow Diagram Flowable
# ══════════════════════════════════════════════════════════════════════════════

class FlowDiagram(Flowable):
    """
    Renders the onboarding system process diagram using pure ReportLab canvas.
    No external SVG libraries required.
    """
    SVG_W = 680   # SVG coordinate space width
    SVG_H = 770   # SVG coordinate space height (includes legend buffer)
    SC    = 450.0 / 680.0   # scale: 450pt PDF content width / 680 SVG units

    def __init__(self):
        Flowable.__init__(self)
        self.width  = self.SVG_W * self.SC
        self.height = self.SVG_H * self.SC

    def wrap(self, aW, aH):
        return self.width, self.height

    # ── Coordinate helpers ────────────────────────────────────────────────────

    def s(self, v):
        """Scale a scalar value from SVG units to PDF points."""
        return v * self.SC

    def px(self, x_svg):
        """SVG x coordinate → PDF x coordinate (unchanged, both left-to-right)."""
        return x_svg * self.SC

    def py(self, y_svg):
        """SVG y (top=0, increases down) → PDF y (bottom=0, increases up)."""
        return (self.SVG_H - y_svg) * self.SC

    # ── Drawing helpers ───────────────────────────────────────────────────────

    def _box(self, c, x, y, w, h, fill, stroke, lines):
        """
        Draw a rounded rectangle box in SVG coordinate space.

        Args:
            x, y, w, h  : SVG top-left corner and dimensions
            fill, stroke : ReportLab color objects
            lines        : list of (text_str, is_bold, text_color)
        """
        bx = self.px(x)
        by = self.py(y + h)      # PDF y of box bottom-left
        bw = self.s(w)
        bh = self.s(h)
        r  = self.s(6)           # corner radius

        c.setFillColor(fill)
        c.setStrokeColor(stroke)
        c.setLineWidth(1.2)
        c.roundRect(bx, by, bw, bh, r, fill=1, stroke=1)

        # Vertical center of box in PDF coords
        n  = len(lines)
        lh = 11.5               # line height in PDF pts (fixed, not scaled)
        cy = by + bh / 2.0      # box center y (PDF)

        for i, (text, bold, color) in enumerate(lines):
            fs = 8.5 if bold else 7.5
            c.setFont("Helvetica-Bold" if bold else "Helvetica", fs)
            c.setFillColor(color)
            # Center block around cy; baseline adjustment of 2.5pt
            line_y = cy + ((n - 1) / 2.0 - i) * lh - 2.5
            c.drawCentredString(bx + bw / 2.0, line_y, text)

    def _arrow_down(self, c, cx_svg, y1_svg, y2_svg):
        """Draw a downward-pointing arrow from SVG (cx, y1) to SVG (cx, y2)."""
        cx = self.px(cx_svg)
        y1 = self.py(y1_svg)    # PDF y of start (higher on page = larger PDF y)
        y2 = self.py(y2_svg)    # PDF y of end   (lower  on page = smaller PDF y)
        ah = 6.0                # arrowhead height (pts)
        aw = 4.0                # arrowhead half-width (pts)

        c.setStrokeColor(ARROW_CLR)
        c.setLineWidth(1.0)
        c.line(cx, y1, cx, y2 + ah)

        c.setFillColor(ARROW_CLR)
        c.setStrokeColor(ARROW_CLR)
        p = c.beginPath()
        p.moveTo(cx, y2)              # tip (lowest point)
        p.lineTo(cx - aw, y2 + ah)   # left base
        p.lineTo(cx + aw, y2 + ah)   # right base
        p.close()
        c.drawPath(p, fill=1, stroke=0)

    def _arrow_right(self, c, x1_svg, y_svg, x2_svg, color, dashed=False):
        """Draw a rightward-pointing arrow from SVG x1 to x2 at SVG y."""
        x1 = self.px(x1_svg)
        x2 = self.px(x2_svg)
        y  = self.py(y_svg)
        ah = 5.0   # arrowhead depth
        aw = 3.5   # arrowhead half-width

        c.setStrokeColor(color)
        c.setLineWidth(1.0)
        if dashed:
            c.setDash(4, 3)
        c.line(x1, y, x2 - ah, y)
        c.setDash()

        c.setFillColor(color)
        p = c.beginPath()
        p.moveTo(x2, y)             # tip (rightmost point)
        p.lineTo(x2 - ah, y + aw)  # upper base
        p.lineTo(x2 - ah, y - aw)  # lower base
        p.close()
        c.drawPath(p, fill=1, stroke=0)

    # ── Main draw entry point ─────────────────────────────────────────────────

    def draw(self):
        c = self.canv
        self._draw_content(c)

    def _draw_content(self, c):
        # Convenience aliases for text colors
        P = D_PUR_TEXT   # admin (purple)
        T = D_TEA_TEXT   # system (teal)
        K = D_COR_TEXT   # client (coral)
        A = D_AMB_TEXT   # automation (amber)
        G = D_GRY_TEXT   # integration (gray)

        def L(text, bold=True, color=None):
            return (text, bold, color)

        # ── Vertical separator ────────────────────────────────────────────────
        c.setStrokeColor(HexColor("#DEDEDE"))
        c.setLineWidth(0.5)
        c.setDash(5, 4)
        c.line(self.px(462), self.py(28), self.px(462), self.py(712))
        c.setDash()

        # ── Column labels ─────────────────────────────────────────────────────
        c.setFillColor(MED_GRAY)
        c.setFont("Helvetica-Bold", 7.5)
        c.drawCentredString(self.px(340), self.py(20), "ONBOARDING PROCESS")
        c.drawCentredString(self.px(562), self.py(20), "AUTOMATION")

        # ── Main flow — 9 boxes ───────────────────────────────────────────────

        # 1. Admin uploads MFP
        self._box(c, 230, 40, 220, 44, D_PUR_FILL, D_PUR_STR,
                  [L("Admin uploads MFP", True, P)])

        # 2. Client session created
        self._box(c, 230, 108, 220, 56, D_TEA_FILL, D_TEA_STR,
                  [L("Client session created", True, T),
                   L("unique URL + JSON seed", False, T)])

        # 3. URL shared with client
        self._box(c, 230, 188, 220, 44, D_PUR_FILL, D_PUR_STR,
                  [L("URL shared with client", True, P)])

        # 4. Client opens URL
        self._box(c, 230, 256, 220, 56, D_COR_FILL, D_COR_STR,
                  [L("Client opens URL", True, K),
                   L("no login required", False, K)])

        # 5. Onboarding chat (taller box — 3 lines)
        self._box(c, 230, 336, 220, 80, D_COR_FILL, D_COR_STR,
                  [L("Onboarding chat", True, K),
                   L("confirm MFP  ·  fill gaps", False, K),
                   L("sitemap  ·  assets  ·  resumable", False, K)])

        # 6. Client completes session
        self._box(c, 230, 440, 220, 44, D_COR_FILL, D_COR_STR,
                  [L("Client completes session", True, K)])

        # 7. Admin reviews + approves
        self._box(c, 230, 508, 220, 56, D_PUR_FILL, D_PUR_STR,
                  [L("Admin reviews + approves", True, P),
                   L("manual trigger", False, P)])

        # 8. Basecamp project created
        self._box(c, 230, 588, 220, 44, D_TEA_FILL, D_TEA_STR,
                  [L("Basecamp project created", True, T)])

        # 9. Content generation kickoff
        self._box(c, 230, 656, 220, 44, D_GRY_FILL, D_GRY_STR,
                  [L("Content generation kickoff", True, G)])

        # ── Automation column — 3 boxes ───────────────────────────────────────

        # A. Inactivity monitor
        self._box(c, 475, 336, 175, 56, D_AMB_FILL, D_AMB_STR,
                  [L("Inactivity monitor", True, A),
                   L("resets on any activity", False, A)])

        # B. 3 days no activity
        self._box(c, 475, 416, 175, 56, D_AMB_FILL, D_AMB_STR,
                  [L("3 days no activity", True, A),
                   L("triggers reminder", False, A)])

        # C. Reminder sent
        self._box(c, 475, 496, 175, 56, D_GRY_FILL, D_GRY_STR,
                  [L("Reminder sent", True, G),
                   L("to admin + client", False, G)])

        # ── Main flow arrows (between consecutive boxes) ───────────────────────
        # Each arrow runs from the bottom of one box to the top of the next.
        # Box bottom = y + h  (SVG coords)
        self._arrow_down(c, 340,  84, 108)   # 1 → 2
        self._arrow_down(c, 340, 164, 188)   # 2 → 3
        self._arrow_down(c, 340, 232, 256)   # 3 → 4
        self._arrow_down(c, 340, 312, 336)   # 4 → 5
        self._arrow_down(c, 340, 416, 440)   # 5 → 6
        self._arrow_down(c, 340, 484, 508)   # 6 → 7
        self._arrow_down(c, 340, 564, 588)   # 7 → 8
        self._arrow_down(c, 340, 632, 656)   # 8 → 9

        # ── Automation arrows ──────────────────────────────────────────────────
        self._arrow_down(c, 562, 392, 416)   # A → B
        self._arrow_down(c, 562, 472, 496)   # B → C

        # ── Dashed connector: Onboarding chat → Inactivity monitor ────────────
        # Box 5 right edge: x=230+220=450, vertical center: y=336+40=376
        # Box A left edge:  x=475,         vertical center: y=336+28=364
        # Use midpoint y for a clean horizontal connector
        self._arrow_right(c, 450, 370, 475, D_AMB_STR, dashed=True)

        # ── Legend ────────────────────────────────────────────────────────────
        legend_items = [
            (D_PUR_FILL, D_PUR_STR, "Admin"),
            (D_TEA_FILL, D_TEA_STR, "System"),
            (D_COR_FILL, D_COR_STR, "Client"),
            (D_AMB_FILL, D_AMB_STR, "Automation"),
            (D_GRY_FILL, D_GRY_STR, "Integration"),
        ]

        # Label
        c.setFillColor(MED_GRAY)
        c.setFont("Helvetica-Bold", 7.5)
        c.drawCentredString(self.px(340), self.py(719), "LEGEND")

        n_items = len(legend_items)
        sw  = self.s(24)    # swatch width
        sh  = self.s(13)    # swatch height
        gap = self.s(88)    # horizontal spacing between items
        start_x = self.px(340) - (n_items - 1) * gap / 2.0

        for i, (fill, stroke, label) in enumerate(legend_items):
            lx    = start_x + i * gap
            sb    = self.py(749)    # swatch PDF bottom  (SVG y=749)
            c.setFillColor(fill)
            c.setStrokeColor(stroke)
            c.setLineWidth(1.0)
            c.roundRect(lx - sw / 2.0, sb, sw, sh, self.s(3), fill=1, stroke=1)
            c.setFillColor(DARK_GRAY)
            c.setFont("Helvetica", 7.0)
            c.drawCentredString(lx, sb - 9.0, label)


# ══════════════════════════════════════════════════════════════════════════════
# Document setup
# ══════════════════════════════════════════════════════════════════════════════

doc = SimpleDocTemplate(
    OUTPUT_PATH,
    pagesize=letter,
    topMargin=0.75 * inch,
    bottomMargin=0.75 * inch,
    leftMargin=0.85 * inch,
    rightMargin=0.85 * inch,
)

# ── Styles ────────────────────────────────────────────────────────────────────
styles = {}

styles["title"] = ParagraphStyle(
    "Title",
    fontName="Helvetica-Bold",
    fontSize=28,
    leading=34,
    textColor=NAVY,
    alignment=TA_LEFT,
    spaceAfter=6,
)
styles["subtitle"] = ParagraphStyle(
    "Subtitle",
    fontName="Helvetica",
    fontSize=13,
    leading=18,
    textColor=TEAL,
    alignment=TA_LEFT,
    spaceAfter=24,
)
styles["h1"] = ParagraphStyle(
    "H1",
    fontName="Helvetica-Bold",
    fontSize=18,
    leading=24,
    textColor=NAVY,
    spaceBefore=20,
    spaceAfter=10,
)
styles["h2"] = ParagraphStyle(
    "H2",
    fontName="Helvetica-Bold",
    fontSize=14,
    leading=18,
    textColor=NAVY,
    spaceBefore=16,
    spaceAfter=6,
)
styles["body"] = ParagraphStyle(
    "Body",
    fontName="Helvetica",
    fontSize=10.5,
    leading=15,
    textColor=DARK_GRAY,
    spaceAfter=8,
)
styles["body_bold"] = ParagraphStyle(
    "BodyBold",
    fontName="Helvetica-Bold",
    fontSize=10.5,
    leading=15,
    textColor=DARK_GRAY,
    spaceAfter=8,
)
styles["bullet"] = ParagraphStyle(
    "Bullet",
    fontName="Helvetica",
    fontSize=10.5,
    leading=15,
    textColor=DARK_GRAY,
    leftIndent=20,
    spaceAfter=4,
    bulletIndent=8,
)
styles["phase_num"] = ParagraphStyle(
    "PhaseNum",
    fontName="Helvetica-Bold",
    fontSize=11,
    leading=14,
    textColor=WHITE,
)
styles["phase_title"] = ParagraphStyle(
    "PhaseTitle",
    fontName="Helvetica-Bold",
    fontSize=12,
    leading=16,
    textColor=NAVY,
)
styles["phase_body"] = ParagraphStyle(
    "PhaseBody",
    fontName="Helvetica",
    fontSize=10,
    leading=14,
    textColor=DARK_GRAY,
)
styles["footer"] = ParagraphStyle(
    "Footer",
    fontName="Helvetica-Oblique",
    fontSize=8,
    leading=10,
    textColor=MED_GRAY,
    alignment=TA_CENTER,
)
styles["callout"] = ParagraphStyle(
    "Callout",
    fontName="Helvetica-Oblique",
    fontSize=10,
    leading=14,
    textColor=NAVY,
    leftIndent=12,
    rightIndent=12,
    spaceBefore=8,
    spaceAfter=8,
)
styles["table_header"] = ParagraphStyle(
    "TableHeader",
    fontName="Helvetica-Bold",
    fontSize=10.5,
    leading=15,
    textColor=WHITE,
)
# Compact variants for denser pages
styles["h1_compact"] = ParagraphStyle(
    "H1Compact",
    fontName="Helvetica-Bold",
    fontSize=16,
    leading=20,
    textColor=NAVY,
    spaceBefore=10,
    spaceAfter=6,
)
styles["h2_compact"] = ParagraphStyle(
    "H2Compact",
    fontName="Helvetica-Bold",
    fontSize=13,
    leading=16,
    textColor=NAVY,
    spaceBefore=10,
    spaceAfter=4,
)
styles["body_compact"] = ParagraphStyle(
    "BodyCompact",
    fontName="Helvetica",
    fontSize=10,
    leading=14,
    textColor=DARK_GRAY,
    spaceAfter=4,
)
styles["bullet_compact"] = ParagraphStyle(
    "BulletCompact",
    fontName="Helvetica",
    fontSize=10,
    leading=13,
    textColor=DARK_GRAY,
    leftIndent=20,
    spaceAfter=3,
    bulletIndent=8,
)
styles["callout_compact"] = ParagraphStyle(
    "CalloutCompact",
    fontName="Helvetica-Oblique",
    fontSize=9.5,
    leading=13,
    textColor=NAVY,
    leftIndent=12,
    rightIndent=12,
    spaceBefore=4,
    spaceAfter=6,
)


# ── Shared helpers ────────────────────────────────────────────────────────────

def make_hr():
    return HRFlowable(width="100%", thickness=1, color=LIGHT_GRAY,
                      spaceBefore=6, spaceAfter=6)


def make_phase_row(number, title, description, badge_color=None):
    """Create a styled phase row as a 2-column table."""
    bc = badge_color or TEAL
    num_para   = Paragraph(number, styles["phase_num"])
    title_para = Paragraph(title,  styles["phase_title"])
    desc_para  = Paragraph(description, styles["phase_body"])

    data = [[num_para, [title_para, Spacer(1, 3), desc_para]]]
    t = Table(data, colWidths=[0.45 * inch, 5.85 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND",  (0, 0), (0, 0), bc),
        ("BACKGROUND",  (1, 0), (1, 0), LIGHT_GRAY),
        ("VALIGN",      (0, 0), (-1, -1), "TOP"),
        ("ALIGN",       (0, 0), (0, 0),   "CENTER"),
        ("TOPPADDING",  (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (0, 0),   10),
        ("RIGHTPADDING", (0, 0), (0, 0),  10),
        ("LEFTPADDING", (1, 0), (1, 0),   14),
        ("RIGHTPADDING", (1, 0), (1, 0),  14),
    ]))
    return t


# ══════════════════════════════════════════════════════════════════════════════
# Build story
# ══════════════════════════════════════════════════════════════════════════════
story = []


# ────────────────────────────────────────────────────────────────────────────
# PAGE 1: Title + Overview
# ────────────────────────────────────────────────────────────────────────────
story.append(Spacer(1, 0.5 * inch))
story.append(Paragraph("AI-Powered Client<br/>Onboarding Agent", styles["title"]))
story.append(Paragraph(
    "Replacing the intake form with an intelligent, research-first conversation",
    styles["subtitle"]
))
story.append(make_hr())
story.append(Spacer(1, 8))

story.append(Paragraph("The Concept", styles["h1"]))
story.append(Paragraph(
    "We are replacing the traditional website development questionnaire with an "
    "AI-powered chat agent that begins with research, not questions. Before the client "
    "ever opens the link, our team generates a Master Firm Profile (MFP) — a full "
    "intelligence brief built from the client's existing website, domain records, and "
    "competitive landscape. This document seeds the onboarding session, pre-populating "
    "the majority of the data we need.",
    styles["body"]
))
story.append(Paragraph(
    "The agent's job is then to confirm what we already know, fill in what we don't, "
    "and collect anything the MFP can't surface — culture, success stories, the client's "
    "own words about what makes them different. The result is a faster, more complete, "
    "and more pleasant intake experience, with an admin approval gate before any "
    "project work begins.",
    styles["body"]
))

story.append(Spacer(1, 12))
story.append(Paragraph("Key Benefits", styles["h2"]))

benefits = [
    ["Pre-onboarding research",
     "Before the client opens the link, we complete a full site analysis and competitive "
     "review. The agent enters the conversation already knowing most of the answers."],
    ["Less work for the client",
     "Pre-populated data from the Master Firm Profile means clients confirm and correct, "
     "not re-type. The bulk of the work is done before they sit down."],
    ["More complete data",
     "The agent tracks every field in a structured schema and won't complete the session "
     "until all required information has been addressed or explicitly skipped."],
    ["Better experience",
     "A guided conversation feels easier and more personal than a 3-page static form — "
     "especially one that starts with 'here's what we already know about you.'"],
    ["Automated reminders",
     "If a client goes quiet, the system automatically follows up after 3 days of "
     "inactivity — emailing both the client and the admin. Reminders continue until "
     "the session is complete."],
    ["Admin approval gate",
     "An admin reviews all collected data and approves before any project work begins. "
     "Content generation is triggered manually from the admin dashboard."],
    ["Automated project setup",
     "Upon admin approval, a Basecamp project is created, the intake summary is posted "
     "to the message board, and all assets are uploaded — no manual steps required."],
]

benefit_data = []
for b in benefits:
    benefit_data.append([
        Paragraph(b[0], styles["body_bold"]),
        Paragraph(b[1], styles["body"]),
    ])

benefit_table = Table(benefit_data, colWidths=[1.8 * inch, 4.5 * inch])
benefit_table.setStyle(TableStyle([
    ("VALIGN",      (0, 0), (-1, -1), "TOP"),
    ("TOPPADDING",  (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LINEBELOW",   (0, 0), (-1, -2), 0.5, LIGHT_GRAY),
]))
story.append(benefit_table)


# ────────────────────────────────────────────────────────────────────────────
# PAGE 2: System Process Flow Diagram
# ────────────────────────────────────────────────────────────────────────────
story.append(PageBreak())

story.append(Paragraph("System Process Flow", styles["h1"]))
story.append(Paragraph(
    "The diagram below shows how each step connects — from the admin uploading the "
    "Master Firm Profile to the completed Basecamp project. The automation column "
    "shows the inactivity monitoring loop that runs in parallel while the client "
    "session is open.",
    styles["body"]
))
story.append(Spacer(1, 10))
story.append(FlowDiagram())


# ────────────────────────────────────────────────────────────────────────────
# PAGE 3: How It Works — 8 Phases
# ────────────────────────────────────────────────────────────────────────────
story.append(PageBreak())

story.append(Paragraph("How It Works", styles["h1"]))
story.append(Paragraph(
    "The onboarding process runs in eight phases. Phase 0 happens before the client "
    "is ever contacted — seeding the session from the MFP so the conversation can "
    "focus on confirmation and gaps, not discovery from scratch.",
    styles["body"]
))
story.append(Spacer(1, 8))

phases = [
    ("0", "MFP Seed (pre-conversation setup)",
     "The agent parses the Master Firm Profile and pre-populates the data schema: "
     "locations, team members, services, niches, social channels, affiliations, and "
     "three positioning options. A gap list is built for everything not found. No web "
     "crawl is performed — the MFP replaces it.",
     NAVY),

    ("1", "Welcome &amp; Identify",
     "The agent greets the client warmly, explains that research has already been done "
     "on their firm, and collects their name, email, phone, and confirms the website URL. "
     "The framing is 'we're going to confirm what we know and ask about a few things we "
     "couldn't find' — not starting from scratch.",
     TEAL),

    ("2", "Domain Lookup",
     "The agent performs a WHOIS lookup to capture registrar name, registration date, "
     "expiry date, and nameservers. This is the only automated lookup in the session — "
     "the MFP has already covered site content.",
     TEAL),

    ("3", "MFP Review — Confirm What We Know",
     "The agent presents MFP-sourced data section by section for client confirmation: "
     "(a) office locations, (b) team members with flagged gaps, (c) services and offerings, "
     "(d) industry niches and the three positioning options for client selection, "
     "(e) technical/hosting info, and (f) social media channels and professional affiliations.",
     TEAL),

    ("4", "Fill the Gaps",
     "The agent works through its gap list conversationally, asking only about fields "
     "still empty: firm history, the PFS credential, Advisory/CFO specifics, client base "
     "demographics, competitive landscape, culture and values, Google Business Profile, "
     "differentiators in the client's own words, and anything else worth capturing.",
     TEAL),

    ("5", "Assets",
     "The client confirms which team members have professional headshots, whether office "
     "photos exist, and provides 3&#8211;5 client testimonials. They can upload logo files "
     "and any photos for the new site directly within the chat. Accepted formats: jpg, gif, "
     "png, tif, pdf (up to 300 MB).",
     TEAL),

    ("6", "Final Summary &amp; Confirmation",
     "The agent presents all collected data across 16 categories for final review. Before "
     "presenting, it runs a guardrail check and flags any required fields still empty. "
     "The client confirms or makes last-minute changes before submitting.",
     TEAL),

    ("7", "Admin Review &amp; Project Setup",
     "Once the client submits, an admin reviews and approves the collected data from the "
     "dashboard. Upon approval, the system generates a PDF summary, creates a Basecamp "
     "project, posts the intake summary to the message board with the PDF attached, uploads "
     "all assets to the project vault, and triggers the content generation process.",
     TEAL),
]

for num, title, desc, badge_color in phases:
    story.append(make_phase_row(num, title, desc, badge_color))
    story.append(Spacer(1, 7))


# ────────────────────────────────────────────────────────────────────────────
# PAGE 4: What the MFP Seeds
# ────────────────────────────────────────────────────────────────────────────
story.append(PageBreak())

story.append(Paragraph("What the MFP Seeds", styles["h1"]))
story.append(Paragraph(
    "The Master Firm Profile is generated before the onboarding session begins. "
    "When the agent parses it, the following data is pre-populated in the session "
    "schema — confirmed or flagged for verification during Phase 3. Anything not "
    "found in the MFP becomes the gap list for Phase 4.",
    styles["body"]
))
story.append(Spacer(1, 8))

seed_data = [
    [Paragraph("MFP Section", styles["table_header"]),
     Paragraph("Data Pre-populated", styles["table_header"]),
     Paragraph("Schema Fields", styles["table_header"])],

    [Paragraph("Section 1 — Firm Identity", styles["body"]),
     Paragraph("Office name, address, phone, fax, email, business hours", styles["body"]),
     Paragraph("locations[]", styles["body"])],

    [Paragraph("Section 2 — Firm Narrative", styles["body"]),
     Paragraph("3 positioning options (A/B/C) and firm tagline; client selects preferred "
               "direction in Phase 3d", styles["body"]),
     Paragraph("business.tagline\nbusiness.positioningStatement", styles["body"])],

    [Paragraph("Section 3 — Accreditations", styles["body"]),
     Paragraph("Confirmed professional memberships and certifications; items marked ❓ "
               "are flagged for verification", styles["body"]),
     Paragraph("business.affiliations[]", styles["body"])],

    [Paragraph("Section 4 — Social &amp; Digital", styles["body"]),
     Paragraph("Confirmed social media channels; unconfirmed handles flagged for "
               "collection in Phase 3f", styles["body"]),
     Paragraph("culture.socialMediaChannels[]", styles["body"])],

    [Paragraph("Section 5 — Who They Serve", styles["body"]),
     Paragraph("Industry niches served, ideal client profiles (ICP) for each niche", styles["body"]),
     Paragraph("niches[]\nbusiness.idealClients[]", styles["body"])],

    [Paragraph("Section 6 — Services", styles["body"]),
     Paragraph("Service names, descriptions, and any pricing/package tier data found "
               "on the site", styles["body"]),
     Paragraph("services[]", styles["body"])],

    [Paragraph("Section 7 — Team", styles["body"]),
     Paragraph("Team member names and titles where found; certifications; members "
               "missing titles flagged ❓ for Phase 3b collection", styles["body"]),
     Paragraph("team[]", styles["body"])],
]

seed_table = Table(seed_data, colWidths=[1.55 * inch, 2.95 * inch, 1.8 * inch])
seed_table.setStyle(TableStyle([
    ("BACKGROUND",  (0, 0), (-1, 0), NAVY),
    ("TEXTCOLOR",   (0, 0), (-1, 0), WHITE),
    ("VALIGN",      (0, 0), (-1, -1), "TOP"),
    ("TOPPADDING",  (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("LINEBELOW",   (0, 1), (-1, -2), 0.5, LIGHT_GRAY),
    ("BACKGROUND",  (0, 1), (-1, -1), WHITE),
    ("BOX",         (0, 0), (-1, -1), 0.5, NAVY),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT_GRAY]),
]))
story.append(seed_table)

story.append(Spacer(1, 14))
story.append(Paragraph(
    "Items marked ❓ in the MFP are flagged automatically and queued for confirmation "
    "or collection during the client session — ensuring nothing slips through.",
    styles["callout"]
))


# ────────────────────────────────────────────────────────────────────────────
# PAGE 5: Admin Dashboard + Basecamp + Technical + Next Steps
# ────────────────────────────────────────────────────────────────────────────
story.append(PageBreak())

# Admin Dashboard
story.append(Paragraph("Admin Dashboard", styles["h2_compact"]))
story.append(Paragraph(
    "The CountingFive team manages every onboarding session from a central admin dashboard:",
    styles["body_compact"]
))

admin_items = [
    "Upload the Master Firm Profile (.md) to initialize a new client session and generate a unique onboarding URL",
    "Monitor all active and completed sessions, with per-field progress tracking",
    "Send manual reminders or view the automated inactivity reminder history",
    "Review all collected data before approval — edit or override any field as needed",
    "Trigger Basecamp project creation and content generation with a single click upon approval",
    "Access all generated PDFs, uploaded assets, and session transcripts",
]
for item in admin_items:
    story.append(Paragraph(f"•  {item}", styles["bullet_compact"]))

# Basecamp Integration
story.append(Paragraph("Basecamp Integration", styles["h2_compact"]))
story.append(Paragraph(
    "Upon admin approval, the following happens automatically:",
    styles["body_compact"]
))

basecamp_items = [
    "A new Basecamp project is created for the client (e.g., \"Korbey Lague PLLP — Website Build\")",
    "A formatted PDF summary of all collected intake data is generated server-side",
    "The intake summary is posted as a rich-text message on the project message board, with the PDF attached",
    "All uploaded logos, headshots, and photos are added to the project file vault",
    "The CountingFive team is notified and content generation can begin",
]
for item in basecamp_items:
    story.append(Paragraph(f"•  {item}", styles["bullet_compact"]))

story.append(Paragraph(
    "No manual data entry, no copying between tools. The entire handoff from "
    "onboarding to project setup is automated.",
    styles["callout_compact"]
))

# Technical Overview
story.append(Paragraph("Technical Overview", styles["h2_compact"]))

tech_data = [
    [Paragraph("Component", styles["table_header"]),
     Paragraph("Technology / Approach", styles["table_header"])],
    [Paragraph("Application", styles["body_compact"]),
     Paragraph("Next.js (React-based web framework)", styles["body_compact"])],
    [Paragraph("AI Engine", styles["body_compact"]),
     Paragraph("Claude API by Anthropic", styles["body_compact"])],
    [Paragraph("MFP Parser", styles["body_compact"]),
     Paragraph("Server-side markdown parser; maps MFP sections to JSON schema on session init",
               styles["body_compact"])],
    [Paragraph("Domain Lookup", styles["body_compact"]),
     Paragraph("WHOIS lookup for registrar, dates, and nameservers (MFP replaces site crawl)",
               styles["body_compact"])],
    [Paragraph("Data Storage", styles["body_compact"]),
     Paragraph("Database with full session state, schema, and file references",
               styles["body_compact"])],
    [Paragraph("Inactivity Monitor", styles["body_compact"]),
     Paragraph("Scheduled job checks session activity; triggers admin + client email after "
               "3 days of no progress; resets on any activity", styles["body_compact"])],
    [Paragraph("PDF Generation", styles["body_compact"]),
     Paragraph("Server-side PDF creation from collected schema data",
               styles["body_compact"])],
    [Paragraph("Project Management", styles["body_compact"]),
     Paragraph("Basecamp API (OAuth 2.0) — admin-triggered, not automatic",
               styles["body_compact"])],
    [Paragraph("Client Access", styles["body_compact"]),
     Paragraph("Unique random URL per client — no login or account creation required",
               styles["body_compact"])],
]

tech_table = Table(tech_data, colWidths=[1.55 * inch, 4.75 * inch])
tech_table.setStyle(TableStyle([
    ("BACKGROUND",  (0, 0), (-1, 0), NAVY),
    ("TEXTCOLOR",   (0, 0), (-1, 0), WHITE),
    ("VALIGN",      (0, 0), (-1, -1), "TOP"),
    ("TOPPADDING",  (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("LINEBELOW",   (0, 1), (-1, -2), 0.5, LIGHT_GRAY),
    ("BOX",         (0, 0), (-1, -1), 0.5, NAVY),
]))
story.append(tech_table)

# Next Steps
story.append(Spacer(1, 6))
story.append(make_hr())
story.append(Paragraph("Next Steps", styles["h2_compact"]))

next_steps = [
    "Review and approve this process overview",
    "Finalize technical architecture and begin development sprint",
    "Set up Basecamp API access (one-time OAuth 2.0 authorization)",
    "Define admin dashboard UI and MFP upload workflow",
    "Configure inactivity monitoring and email templates",
    "Build, test, and deploy the onboarding agent",
]
for i, step in enumerate(next_steps, 1):
    story.append(Paragraph(f"<b>{i}.</b>  {step}", styles["bullet_compact"]))

story.append(Spacer(1, 8))
story.append(make_hr())
story.append(Spacer(1, 4))
story.append(Paragraph(
    "Prepared by CountingFive  ·  April 2026",
    styles["footer"]
))


# ── Build PDF ─────────────────────────────────────────────────────────────────
doc.build(story)
print(f"PDF generated: {OUTPUT_PATH}")
