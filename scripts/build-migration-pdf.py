#!/usr/bin/env python3
"""Render the Revaltus Infrastructure Migration Plan to a shareable, branded PDF."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether, ListFlowable, ListItem,
)

OUT = "/Users/webhank/LocalSites/counting-five-onboarding/Revaltus-Infrastructure-Migration-Plan.pdf"

# ---- Brand palette (from design system) ----------------------------------
NAVY = colors.HexColor("#003B71")
CYAN = colors.HexColor("#00C1DE")
INK = colors.HexColor("#1E293B")
SLATE = colors.HexColor("#475569")
LIGHT = colors.HexColor("#F1F5F9")
BORDER = colors.HexColor("#E2E8F0")
WHITE = colors.white
AMBER = colors.HexColor("#B45309")

styles = getSampleStyleSheet()

def S(name, **kw):
    return ParagraphStyle(name, **kw)

body = S("Body", fontName="Helvetica", fontSize=10, leading=15, textColor=INK, spaceAfter=6)
h1 = S("H1", fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=NAVY,
       spaceBefore=18, spaceAfter=8)
h2 = S("H2", fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=NAVY,
       spaceBefore=12, spaceAfter=5)
h3 = S("H3", fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=CYAN.clone() and NAVY,
       spaceBefore=8, spaceAfter=3)
bullet = S("Bullet", fontName="Helvetica", fontSize=10, leading=14.5, textColor=INK, spaceAfter=3)
quote = S("Quote", fontName="Helvetica-Oblique", fontSize=9.5, leading=14, textColor=SLATE,
          leftIndent=10, spaceAfter=5)
cell = S("Cell", fontName="Helvetica", fontSize=8.5, leading=11.5, textColor=INK)
cellb = S("CellB", fontName="Helvetica-Bold", fontSize=8.5, leading=11.5, textColor=INK)
cellh = S("CellH", fontName="Helvetica-Bold", fontSize=8.5, leading=11.5, textColor=WHITE)
check = S("Check", fontName="Helvetica-Bold", fontSize=9.5, leading=14, textColor=NAVY,
          spaceBefore=4, spaceAfter=8, backColor=LIGHT, borderColor=CYAN, borderWidth=0,
          leftIndent=6, borderPadding=6)

story = []

def para(text, st=body):
    story.append(Paragraph(text, st))

def space(h=6):
    story.append(Spacer(1, h))

def rule(color=BORDER, w=0.75):
    story.append(HRFlowable(width="100%", thickness=w, color=color,
                            spaceBefore=6, spaceAfter=8))

def bullets(items, st=bullet, start=None, numbered=False):
    flow = []
    for it in items:
        flow.append(ListItem(Paragraph(it, st), leftIndent=14,
                             value=None))
    bt = "1" if numbered else "bullet"
    kwargs = dict(bulletType=bt, leftIndent=14, bulletFontSize=8,
                  bulletColor=CYAN if not numbered else NAVY)
    if numbered and start:
        kwargs["start"] = start
    story.append(ListFlowable(flow, **kwargs))
    space(4)

def table(data, col_widths, header=True, zebra=True):
    tbl_style = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
    ]
    if header:
        tbl_style += [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, NAVY),
        ]
    if zebra:
        for r in range(1, len(data)):
            if r % 2 == 0:
                tbl_style.append(("BACKGROUND", (0, r), (-1, r), LIGHT))
    t = Table(data, colWidths=col_widths, repeatRows=1 if header else 0)
    t.setStyle(TableStyle(tbl_style))
    story.append(t)
    space(8)

def C(txt, st=cell):
    return Paragraph(txt, st)

# ============================ COVER / HEADER ==============================
story.append(Spacer(1, 6))
# Brand bar
brand = Table([[Paragraph('<font color="#FFFFFF"><b>REVALTUS</b></font>',
        S("brand", fontName="Helvetica-Bold", fontSize=16, textColor=WHITE)),
        Paragraph('<font color="#8ED8E6">Infrastructure &amp; Operations</font>',
        S("brandr", fontName="Helvetica", fontSize=9, textColor=colors.HexColor("#8ED8E6"), alignment=2))]],
        colWidths=[3.3*inch, 3.4*inch])
brand.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), NAVY),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 14),
    ("RIGHTPADDING", (0, 0), (-1, -1), 14),
    ("TOPPADDING", (0, 0), (-1, -1), 12),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
]))
story.append(brand)
# Cyan accent line
story.append(HRFlowable(width="100%", thickness=3, color=CYAN, spaceBefore=0, spaceAfter=16))

para("Infrastructure Ownership Migration Plan",
     S("title", fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=NAVY, spaceAfter=4))
para("Transferring all platform infrastructure from personal to Revaltus company ownership",
     S("sub", fontName="Helvetica", fontSize=11, leading=15, textColor=SLATE, spaceAfter=14))

meta = Table([
    [C("Prepared for", cellb), C("Revaltus shareholder review &amp; approval")],
    [C("Prepared by", cellb), C("Hank Pantier")],
    [C("Status", cellb), C("Draft for approval")],
    [C("Effort", cellb), C("~1 working day &middot; 6 phases &middot; reversible at every step")],
], colWidths=[1.3*inch, 5.4*inch])
meta.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ("BACKGROUND", (0, 0), (0, -1), LIGHT),
    ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
    ("INNERGRID", (0, 0), (-1, -1), 0.4, BORDER),
]))
story.append(meta)
space(10)
para('<b>Objective.</b> Transfer ownership of every third-party account the Revaltus Onboarding '
     'platform depends on from personal ownership (webhank@gmail.com / <font face="Courier">HankPantier</font>) '
     'to Revaltus company-owned accounts &mdash; without disrupting the live platform or the '
     'published client sites.')

# ============================ 1. EXEC SUMMARY ============================
para("1. Executive Summary", h1)
rule(CYAN, 1.2)
para("The Revaltus Onboarding platform runs on twelve external services. Today all of them are "
     "registered to a personal account. This plan moves 100% of that ownership to Revaltus, so "
     "the company controls its own infrastructure, billing, and credentials.")
para("The migration is designed to be <b>low-risk and reversible</b>:")
bullets([
    "The two largest systems &mdash; the <b>database (Supabase)</b> and <b>hosting (Vercel)</b> "
    "&mdash; support a native <i>transfer</i> that hands the existing resource to the company "
    "with all data, domains, and settings intact. No data is copied and the platform keeps running.",
    "The remaining services are simple <b>API keys</b> recreated under the company account and "
    "swapped in &mdash; the old keys stay active until the new ones are proven, so there is always a fallback.",
    "The only system needing a genuine credential rebuild is the <b>GitHub App</b> that powers the "
    "content pipeline; it was designed in advance to survive an ownership move.",
])
para("Estimated hands-on effort: <b>about one working day</b>, spread across six phases, each "
     "independently verifiable and reversible. No client-facing website needs to change its domain or DNS.")

# ============================ 2. SERVICES IN SCOPE =======================
para("2. Services In Scope", h1)
rule(CYAN, 1.2)
rows = [[C("#", cellh), C("Service", cellh), C("Role in the platform", cellh), C("Migration approach", cellh)]]
svc = [
    ("1", "Supabase", "Database, login/accounts, file storage", "<b>Transfer</b> (keeps everything)"),
    ("2", "Vercel", "Website hosting &amp; scheduled jobs", "<b>Transfer</b> (keeps domains + settings)"),
    ("3", "GitHub org + App", "Source code + client-site content pipeline", "<b>New company org + new App</b>"),
    ("4", "Anthropic (Claude AI)", "All AI writing &amp; audits", "Recreate key"),
    ("5", "Resend", "Automated emails", "Recreate + re-verify domain"),
    ("6", "Pexels", "Stock photography", "Recreate key"),
    ("7", "Serper", "Search / SEO checks", "Recreate key"),
    ("8", "Google Cloud", "Page-speed &amp; business-profile data (optional)", "Recreate keys"),
    ("9", "ScrapingBee", "Backup web crawler (optional)", "Recreate key"),
    ("10", "Domain / DNS", "revaltus.com and platform address", "Confirm company ownership"),
    ("11", "WordPress bridge", "Blog sync to client WordPress sites", "Config touch-up only"),
    ("12", "Secrets &amp; billing", "Passwords, keys, payment methods", "Consolidate under company"),
]
for r in svc:
    rows.append([C(r[0]), C("<b>%s</b>" % r[1]), C(r[2]), C(r[3])])
table(rows, [0.3*inch, 1.35*inch, 2.75*inch, 2.3*inch])

# ============================ 3. GUIDING DECISIONS =======================
para("3. Guiding Decisions (approved direction)", h1)
rule(CYAN, 1.2)
bullets([
    "<b>Company foundation is ready</b> &mdash; revaltus.com, a shared company email, and a "
    "company card are available and will own every account.",
    "<b>Method chosen per service</b> &mdash; transfer where it is safe and cheap; recreate where "
    "transfer is not supported.",
    "<b>Downtime tolerance is flexible</b> &mdash; brief pauses are acceptable, but the plan still "
    "keeps live client sites online throughout.",
    "<b>GitHub</b> &mdash; a brand-new <font face='Courier'>Revaltus</font> organization will be "
    "created rather than renaming the personal one.",
])

# ============================ 4. ORDER ===================================
para("4. Migration Order", h1)
rule(CYAN, 1.2)
order = [
    ("Phase 0", "Company foundations", "verify prerequisites"),
    ("Phase 1", "Standalone API keys", "independent &mdash; do first"),
    ("Phase 2", "Supabase transfer", "independent &mdash; near-zero risk"),
    ("Phase 3", "GitHub org + App", "must come before Vercel"),
    ("Phase 4", "Vercel transfer + reconnect", "connects hosting to the new GitHub org"),
    ("Phase 5", "Domain / platform address / email", "final wiring"),
    ("Phase 6", "Verify, then retire personal accounts", "reversible until here"),
]
orows = [[C("Order", cellh), C("Phase", cellh), C("Note", cellh)]]
for o in order:
    orows.append([C("<b>%s</b>" % o[0]), C(o[1]), C(o[2])])
table(orows, [0.9*inch, 3.0*inch, 2.8*inch])
para("Each phase is self-contained and leaves the old credentials working until Phase 6, so every "
     "step can be rolled back.", quote)

# ============================ 5. STEP BY STEP ============================
para("5. Step-by-Step Instructions", h1)
rule(CYAN, 1.2)
para("In every phase the account <b>owner</b> should be the Revaltus role email "
     "(e.g. ops@revaltus.com), never a personal inbox, and billing should use the company card.", quote)

# Phase 0
para("Phase 0 &mdash; Company Foundations (verify prerequisites)", h2)
bullets([
    "Confirm the Revaltus <b>role email</b> that will own all accounts (e.g. ops@revaltus.com).",
    "Confirm the <b>company payment card</b> is available.",
    "Create a <b>company password vault</b> (1Password or Bitwarden) to store every new credential.",
    "Confirm <b>who controls DNS for revaltus.com</b> (the registrar login) &mdash; needed for email "
    "verification and the platform address.",
    "Confirm the <b>platform&rsquo;s public web address</b> (e.g. revplatform.revaltus.com) and whether "
    "it will stay the same after migration (it can).",
], numbered=True, start=1)

# Phase 1
para("Phase 1 &mdash; Standalone API Keys (recreate)", h2)
para("For each service below the pattern is identical, so it is stated once:", body)
para("<b>General key-swap procedure</b><br/>"
     "a. Sign up / sign in with the Revaltus role email.<br/>"
     "b. Add the company card as the billing method.<br/>"
     "c. Create a new API key and save it in the company vault.<br/>"
     "d. Enter the new key into the hosting settings (Vercel &rarr; Project &rarr; Settings &rarr; "
     "Environment Variables &rarr; Production, Preview, Development).<br/>"
     "e. Redeploy the platform.<br/>"
     "f. Leave the <b>old</b> key active for now &mdash; it is revoked in Phase 6 after verification.",
     check)

para("1.1 &nbsp;Anthropic (Claude AI) &mdash; ANTHROPIC_API_KEY", h3)
bullets([
    "In the Anthropic Console, create a workspace/organization under the Revaltus email.",
    "Add the company billing card and set a monthly spend limit.",
    "Create a new API key; store it in the vault.",
    "Swap into hosting env and redeploy. (AI usage history is stored in our own database, so nothing is lost.)",
], numbered=True, start=1)

para("1.2 &nbsp;Pexels (stock photos) &mdash; PEXELS_API_KEY", h3)
bullets([
    "Create a Pexels account on the Revaltus email and request an API key.",
    "Swap into hosting env and redeploy.",
], numbered=True, start=1)

para("1.3 &nbsp;Serper (search / SEO) &mdash; SERPER_API_KEY", h3)
bullets([
    "Create a Serper account on the Revaltus email; add the company card and top up credits.",
    "Copy the API key, swap into hosting env, redeploy.",
], numbered=True, start=1)

para("1.4 &nbsp;Google Cloud (optional) &mdash; PAGESPEED_API_KEY, GOOGLE_PLACES_API_KEY", h3)
bullets([
    "In Google Cloud Console (as the Revaltus Workspace user) create a project, e.g. &ldquo;Revaltus Platform.&rdquo;",
    "Enable <b>PageSpeed Insights API</b> and <b>Places API (New)</b>.",
    "Under APIs &amp; Services &rarr; Credentials, create two API keys; restrict each to its API.",
    "Swap into hosting env, redeploy. (These features degrade gracefully, so this can trail the others.)",
], numbered=True, start=1)

para("1.5 &nbsp;ScrapingBee (optional) &mdash; SCRAPINGBEE_API_KEY", h3)
bullets([
    "Create a ScrapingBee account on the Revaltus email; add the company card.",
    "Copy the API key, swap into hosting env, redeploy.",
], numbered=True, start=1)

para("1.6 &nbsp;Resend (email) &mdash; RESEND_API_KEY (sender stays onboarding@revaltus.com)", h3)
bullets([
    "Create a Resend account/team on the Revaltus email; add the company card.",
    "In Domains &rarr; Add Domain, add <b>revaltus.com</b>.",
    "Resend shows SPF / DKIM / return-path DNS records &mdash; add them to the revaltus.com DNS zone.",
    "Wait for the domain to show <b>Verified</b>.",
    "Create a new API key; swap into hosting env; redeploy.",
], numbered=True, start=1)
para("&#9888; <b>Cutover note:</b> a domain can be verified in only one Resend account at a time. "
     "Moving the DKIM records to the new account is the actual switch and briefly pauses outgoing "
     "email &mdash; do this during a low-traffic window.",
     S("warn", fontName="Helvetica", fontSize=9, leading=13, textColor=AMBER,
       backColor=colors.HexColor("#FEF3C7"), borderPadding=6, spaceAfter=8))
para("<b>Phase 1 check:</b> redeploy and confirm one AI generation, one audit, and one test email work.", body)

# Phase 2
para("Phase 2 &mdash; Supabase (database) &mdash; Transfer", h2)
para("The safest, highest-value step. Transferring the project keeps its unique address and access "
     "keys, so <b>no code, no settings, and no data need to change</b>, and the platform stays online.")
bullets([
    "Sign in to Supabase as the Revaltus role user and create a new <b>Organization</b> on a plan "
    "tier equal to or above the current one (transfers require compatible plans). Add the company card.",
    "Ensure your personal account and the new org are linked (add one as a member of the other) so "
    "you are permitted to move the project.",
    "Open the existing <b>CountingFive</b> project &rarr; Settings &rarr; General &rarr; <b>Transfer Project</b>.",
    "Select the new Revaltus organization as the destination and confirm.",
    "Verify billing now sits on the company card in the new org.",
    "<b>(Recommended, optional)</b> After transfer, rotate the project&rsquo;s API keys "
    "(Settings &rarr; API) to fully cut personal exposure; if you do, update the two Supabase keys in "
    "hosting env and redeploy as a separate verified step.",
], numbered=True, start=1)
para("<b>Phase 2 check:</b> log into the admin dashboard, open a session, confirm files/thumbnails load.", body)

# Phase 3
para("Phase 3 &mdash; GitHub Organization + App &mdash; New org", h2)
para("The GitHub App drives the automated building of client websites. GitHub has no &ldquo;transfer "
     "app&rdquo; feature, so a new App is created under a new company organization. Client repositories "
     "move across with full history, and GitHub automatically redirects the old links.")
para("3.1 &nbsp;Create the organization", h3)
bullets(["In GitHub, create a new organization named <b>Revaltus</b>, owned by the Revaltus role "
         "account, billed to the company card."], numbered=True, start=1)
para("3.2 &nbsp;Move the repositories", h3)
bullets(["Transfer these repos into the Revaltus org (each repo: Settings &rarr; Danger Zone &rarr; "
         "Transfer ownership). History, branches, and redirects are preserved: the platform app repo, "
         "the website template repo, and every published client-site repo."], numbered=True, start=2)
para("3.3 &nbsp;Create the new GitHub App", h3)
bullets([
    "In the Revaltus org: Settings &rarr; Developer settings &rarr; GitHub Apps &rarr; New GitHub App.",
    "Set Repository permissions &rarr; <b>Contents: Read &amp; write</b> (matches the current app).",
    "Create the app, then <b>Install</b> it on the org choosing <b>&ldquo;All repositories.&rdquo;</b>",
    "Record into the vault: the <b>App ID</b>, a freshly generated <b>Private Key</b> (PEM), and the "
    "<b>Installation ID</b>.",
], numbered=True, start=3)
para("3.4 &nbsp;Update settings", h3)
bullets(["In hosting env, set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID, "
         "GITHUB_ORG=Revaltus, and GITHUB_TEMPLATE_REPO=Revaltus/&lt;template-repo-name&gt;."],
        numbered=True, start=7)
para("3.5 &nbsp;Code + data touch-ups (done in the codebase by the dev)", h3)
bullets([
    "Update the template default in lib/github/template-seed.ts so it no longer falls back to the personal org.",
    "Run a one-time data update over the content_jobs.github_repo column so any stored "
    "&ldquo;HankPantier/&lt;name&gt;&rdquo; references resolve to the new org (the code already supports "
    "both the short and full form). No database schema change is required.",
], numbered=True, start=8)
para("<b>Phase 3 check:</b> open the editor for one migrated client, confirm the file tree loads and a "
     "test save commits to that repo.", body)

# Phase 4
para("Phase 4 &mdash; Vercel (hosting) &mdash; Transfer + reconnect", h2)
bullets([
    "Sign in to Vercel as the Revaltus role user and create a <b>Team</b> (Pro) on the company card.",
    "<b>Transfer</b> the platform project and each client-site project into the Revaltus team "
    "(Project &rarr; Settings &rarr; Transfer). Domains, environment variables, and deployment history move with them.",
    "Install the <b>Vercel GitHub integration</b> on the new Revaltus GitHub org, then repoint each "
    "project&rsquo;s connected repository to its new Revaltus/&lt;repo&gt; location.",
    "Set/overwrite all environment values changed in Phases 1&ndash;3, and <b>rotate CRON_SECRET</b> "
    "(the scheduled-job password) to a new non-empty value.",
    "Confirm the two scheduled jobs (daily inactivity reminders; stuck-job sweeper every 5 minutes) "
    "and the extended function time-limits are present (they redeploy automatically from project config).",
    "Trigger a production redeploy from the new team.",
], numbered=True, start=1)
para("<b>Phase 4 check:</b> production build is green; a live client site still resolves on its domain; "
     "scheduled-job endpoints reject requests without the new secret and accept them with it.", body)

# Phase 5
para("Phase 5 &mdash; Domain, Platform Address, Notification Email", h2)
bullets([
    "Confirm the <b>revaltus.com DNS zone</b> lives in a company-owned registrar account (move it if "
    "it is under a personal login).",
    "If the <b>platform web address stays the same</b>, no further change is needed and the WordPress "
    "blog-sync feeds keep working. If it changes, update the platform address setting "
    "(NEXT_PUBLIC_APP_URL) and update the feed address in each connected WordPress site&rsquo;s plugin "
    "settings (the per-site secret keys do <b>not</b> change).",
    "Change the <b>admin notification email</b> (ADMIN_EMAIL) from the personal address to the company "
    "role email, so operational alerts go to Revaltus.",
    "<b>Client custom domains</b> are owned by clients and already point at Vercel; after the transfer "
    "they keep working &mdash; no client DNS changes are required.",
], numbered=True, start=1)

# Phase 6
para("Phase 6 &mdash; Verify, Then Retire Personal Accounts", h2)
para("<b>Full end-to-end test on the live platform (signed in as Revaltus):</b>", body)
bullets([
    "Create a test onboarding session.",
    "Run the intake chat (confirms AI / Anthropic).",
    "Run a site audit (confirms Serper / Google / crawler keys).",
    "Generate content (confirms Pexels images + a commit landing in the client repo under Revaltus).",
    "Publish a test site live (confirms GitHub App + Vercel deploy).",
    "Send a reminder email (confirms Resend from onboarding@revaltus.com).",
    "Check the internal usage dashboard shows spend recorded (confirms keys are wired correctly).",
], numbered=True, start=1)
para("<b>Decommission personal ownership (only after all checks pass):</b>", body)
bullets([
    "Revoke every old personal API key (Anthropic, Pexels, Serper, Google, ScrapingBee, old Resend).",
    "Uninstall / delete the old GitHub App and remove personal access to the new org.",
    "Remove the personal account from the Supabase org and Vercel team.",
    "Cancel personal billing on each service.",
    "Confirm the company vault is the single source of truth for all credentials.",
], numbered=True, start=8)

# ============================ 6. CHANGES VS SAME =========================
para("6. What Changes vs. What Stays the Same", h1)
rule(CYAN, 1.2)
cvs = [[C("Stays the same (no disruption)", cellh), C("Changes (swapped to company-owned)", cellh)]]
left = ["Supabase database address, data, logins, files (transfer preserves them).",
        "Vercel domains and deployment history (transfer preserves them).",
        "Client website custom domains and their DNS.",
        "The email sender address onboarding@revaltus.com.",
        "WordPress per-site sync secrets."]
right = ["All API keys (AI, images, search, email, crawlers).",
         "The GitHub organization, App credentials, and template location.",
         "Billing on every service (moves to the company card).",
         "Admin notification email and the scheduled-job secret.",
         ""]
leftp = Paragraph("<br/>".join("&bull;&nbsp; " + x for x in left if x), cell)
rightp = Paragraph("<br/>".join("&bull;&nbsp; " + x for x in right if x), cell)
cvs.append([leftp, rightp])
table(cvs, [3.35*inch, 3.35*inch])

# ============================ 7. RISKS ===================================
para("7. Risks &amp; Safeguards", h1)
rule(CYAN, 1.2)
risk = [[C("Risk", cellh), C("Safeguard", cellh)]]
risks = [
    ("Email pauses during Resend domain move", "Perform the DKIM record move in an off-peak window."),
    ("GitHub App is the only true credential rebuild",
     "Repo references were pre-built to survive an org move; the new App is a known, tested step."),
    ("Vercel Git link must be manually repointed", "Explicit reconnect step in Phase 4."),
    ("Scheduled-job secret left blank during env shuffle",
     "Set the new secret before the first redeploy (an empty value is a security hole)."),
    ("Something misbehaves after a swap", "Old keys stay live until Phase 6, so every step rolls back."),
    ("Client sites affected", "Client domains/DNS are never touched; they ride through the Vercel transfer."),
]
for r in risks:
    risk.append([C(r[0]), C(r[1])])
table(risk, [2.9*inch, 3.8*inch])

# ============================ 8. APPROVAL ================================
para("8. Approval", h1)
rule(CYAN, 1.2)
para("This plan requires no client-facing downtime and consolidates all Revaltus infrastructure under "
     "company ownership and billing within roughly one working day of effort. On approval, Hank will "
     "execute the phases in order, verifying each before proceeding, and report completion after the "
     "Phase 6 end-to-end test passes.")
space(18)
sign = Table([
    [C("Approved by", cellb), C("", cell), C("Date", cellb), C("", cell)],
], colWidths=[1.0*inch, 3.0*inch, 0.6*inch, 1.5*inch])
sign.setStyle(TableStyle([
    ("LINEBELOW", (1, 0), (1, 0), 0.8, INK),
    ("LINEBELOW", (3, 0), (3, 0), 0.8, INK),
    ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
    ("TOPPADDING", (0, 0), (-1, -1), 10),
]))
story.append(sign)

# ============================ PAGE FURNITURE =============================
def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(0.75*inch, 0.6*inch, 7.75*inch, 0.6*inch)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(SLATE)
    canvas.drawString(0.75*inch, 0.42*inch, "Revaltus — Infrastructure Ownership Migration Plan")
    canvas.drawRightString(7.75*inch, 0.42*inch, "Confidential — Page %d" % doc.page)
    canvas.restoreState()

doc = BaseDocTemplate(OUT, pagesize=letter,
                      leftMargin=0.75*inch, rightMargin=0.75*inch,
                      topMargin=0.7*inch, bottomMargin=0.8*inch,
                      title="Revaltus Infrastructure Ownership Migration Plan",
                      author="Hank Pantier")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=footer)])
doc.build(story)
print("WROTE", OUT)
