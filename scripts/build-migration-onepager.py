#!/usr/bin/env python3
"""One-page shareholder executive summary of the Revaltus infrastructure migration."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle, HRFlowable,
)

OUT = "/Users/webhank/LocalSites/counting-five-onboarding/Revaltus-Migration-Plan-Summary.pdf"

NAVY = colors.HexColor("#003B71")
CYAN = colors.HexColor("#00C1DE")
INK = colors.HexColor("#1E293B")
SLATE = colors.HexColor("#475569")
LIGHT = colors.HexColor("#F1F5F9")
BORDER = colors.HexColor("#E2E8F0")
WHITE = colors.white

def S(name, **kw):
    return ParagraphStyle(name, **kw)

body = S("b", fontName="Helvetica", fontSize=9, leading=12.5, textColor=INK, spaceAfter=4)
h = S("h", fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=NAVY, spaceBefore=6, spaceAfter=3)
cell = S("c", fontName="Helvetica", fontSize=8.2, leading=10.5, textColor=INK)
cellb = S("cb", fontName="Helvetica-Bold", fontSize=8.2, leading=10.5, textColor=INK)
cellh = S("ch", fontName="Helvetica-Bold", fontSize=8.2, leading=10.5, textColor=WHITE)
small = S("sm", fontName="Helvetica", fontSize=8, leading=11, textColor=SLATE)

story = []

def C(t, st=cell):
    return Paragraph(t, st)

# Header
brand = Table([[Paragraph('<font color="#FFFFFF"><b>REVALTUS</b></font>',
        S("br", fontName="Helvetica-Bold", fontSize=13, textColor=WHITE)),
        Paragraph('<font color="#8ED8E6">Executive Summary &mdash; For Shareholder Approval</font>',
        S("brr", fontName="Helvetica", fontSize=8.5, textColor=colors.HexColor("#8ED8E6"), alignment=2))]],
        colWidths=[3.0*inch, 4.3*inch])
brand.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), NAVY), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
]))
story.append(brand)
story.append(HRFlowable(width="100%", thickness=2.5, color=CYAN, spaceBefore=0, spaceAfter=9))

story.append(Paragraph("Infrastructure Ownership Migration",
    S("t", fontName="Helvetica-Bold", fontSize=16, leading=19, textColor=NAVY, spaceAfter=2)))
story.append(Paragraph("Moving all platform accounts from personal ownership to Revaltus company ownership.",
    S("st", fontName="Helvetica", fontSize=9.5, leading=13, textColor=SLATE, spaceAfter=8)))

# The situation / the approach — two columns
sit = Paragraph(
    "<b>The situation.</b> The Revaltus Onboarding platform runs on 12 external services "
    "(database, hosting, code, AI, email, and supporting APIs). All are currently registered to a "
    "personal account. This plan puts 100% of that ownership, billing, and control in Revaltus&rsquo; hands.",
    body)
appr = Paragraph(
    "<b>The approach.</b> Low-risk and reversible. The two biggest systems are <b>transferred</b> "
    "intact (no data moved, no downtime). Everything else is a straightforward credential swap where "
    "the old keys stay live until the new ones are proven &mdash; so there is always a fallback.",
    body)
two = Table([[sit, appr]], colWidths=[3.55*inch, 3.55*inch])
two.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (0, 0), 0), ("RIGHTPADDING", (0, 0), (0, 0), 10),
    ("LEFTPADDING", (1, 0), (1, 0), 10), ("RIGHTPADDING", (1, 0), (-1, -1), 0),
    ("LINEBEFORE", (1, 0), (1, 0), 0.5, BORDER)]))
story.append(two)
story.append(Spacer(1, 6))

# Services by method
story.append(Paragraph("How each account moves", h))
rows = [[C("Method", cellh), C("Services", cellh), C("Impact", cellh)]]
data = [
    ("Transfer (kept intact)", "Supabase database &middot; Vercel hosting",
     "Data, domains &amp; settings preserved. No downtime."),
    ("Rebuild (new company org)", "GitHub organization + App",
     "New org &amp; app credentials; repos move with full history."),
    ("Recreate keys", "Anthropic AI &middot; Resend email &middot; Pexels &middot; Serper &middot; Google &middot; ScrapingBee",
     "New keys under company billing; old keys retired last."),
    ("Confirm / consolidate", "Domain &amp; DNS &middot; WordPress bridge &middot; secrets &amp; billing",
     "Company-owned registrar, vault, and payment card."),
]
for d in data:
    rows.append([C("<b>%s</b>" % d[0]), C(d[1]), C(d[2])])
t = Table(rows, colWidths=[1.5*inch, 2.75*inch, 2.85*inch])
ts = [("BACKGROUND", (0, 0), (-1, 0), NAVY), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
      ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
      ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
      ("BOX", (0, 0), (-1, -1), 0.5, BORDER), ("INNERGRID", (0, 0), (-1, -1), 0.4, BORDER)]
for r in range(1, len(rows)):
    if r % 2 == 0:
        ts.append(("BACKGROUND", (0, r), (-1, r), LIGHT))
story.append(t); story.append(TableStyle(ts) and Spacer(1, 8))
t.setStyle(TableStyle(ts))

# Sequence strip
story.append(Paragraph("The plan runs in 6 reversible phases", h))
seq = [["0", "1", "2", "3", "4", "5 + 6"],
       ["Foundations", "API keys", "Supabase\ntransfer", "GitHub\norg + App", "Vercel\ntransfer", "Wire-up +\nverify, retire old"]]
st = Table(seq, colWidths=[1.18*inch]*6)
st.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), CYAN), ("TEXTCOLOR", (0, 0), (-1, 0), NAVY),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, 0), 11),
    ("FONTNAME", (0, 1), (-1, 1), "Helvetica"), ("FONTSIZE", (0, 1), (-1, 1), 7.8),
    ("TEXTCOLOR", (0, 1), (-1, 1), INK), ("BACKGROUND", (0, 1), (-1, 1), LIGHT),
    ("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ("BOX", (0, 0), (-1, -1), 0.5, BORDER), ("INNERGRID", (0, 0), (-1, -1), 0.5, WHITE)]))
story.append(st); story.append(Spacer(1, 8))

# Key points + effort
story.append(Paragraph("Why it is safe", h))
pts = ("&bull;&nbsp; <b>No client-facing downtime</b> &mdash; client websites, domains, and DNS are never touched.<br/>"
       "&bull;&nbsp; <b>Reversible at every step</b> &mdash; old credentials stay active until the final verification passes.<br/>"
       "&bull;&nbsp; <b>No data migration</b> &mdash; the database and hosting are transferred, not copied.<br/>"
       "&bull;&nbsp; <b>Single verification gate</b> &mdash; a full end-to-end test runs before any personal account is retired.")
story.append(Paragraph(pts, body))
story.append(Spacer(1, 4))

effort = Table([[C("Effort", cellh), C("Risk", cellh), C("Client impact", cellh), C("Outcome", cellh)],
                [C("~1 working day"), C("Low, reversible"), C("None"),
                 C("100% company-owned infrastructure &amp; billing")]],
               colWidths=[1.4*inch, 1.5*inch, 1.3*inch, 2.9*inch])
effort.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), NAVY),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ("BOX", (0, 0), (-1, -1), 0.5, BORDER), ("INNERGRID", (0, 0), (-1, -1), 0.4, BORDER),
    ("BACKGROUND", (0, 1), (-1, 1), LIGHT)]))
story.append(effort)
story.append(Spacer(1, 14))

sign = Table([[C("Approved by", cellb), C(""), C("Date", cellb), C("")]],
             colWidths=[1.0*inch, 3.2*inch, 0.6*inch, 1.5*inch])
sign.setStyle(TableStyle([("LINEBELOW", (1, 0), (1, 0), 0.8, INK),
    ("LINEBELOW", (3, 0), (3, 0), 0.8, INK), ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
    ("TOPPADDING", (0, 0), (-1, -1), 8)]))
story.append(sign)
story.append(Spacer(1, 6))
story.append(Paragraph("A full step-by-step runbook accompanies this summary. Confidential.", small))

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5); canvas.setFillColor(SLATE)
    canvas.drawString(0.6*inch, 0.4*inch, "Revaltus — Infrastructure Migration (Executive Summary)")
    canvas.drawRightString(8.0*inch, 0.4*inch, "Prepared by Hank Pantier")
    canvas.restoreState()

doc = BaseDocTemplate(OUT, pagesize=letter, leftMargin=0.6*inch, rightMargin=0.6*inch,
                      topMargin=0.55*inch, bottomMargin=0.6*inch,
                      title="Revaltus Infrastructure Migration — Executive Summary", author="Hank Pantier")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="m")
doc.addPageTemplates([PageTemplate(id="a", frames=[frame], onPage=footer)])
doc.build(story)
print("WROTE", OUT)
