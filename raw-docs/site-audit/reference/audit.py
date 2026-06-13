#!/usr/bin/env python3
"""
Counting Five — Internal Audit Engine
Crawls a website and generates a comprehensive branded HTML audit report.
"""

import argparse
import base64
import json
import os
import re
import socket
import ssl
import sys
import time
import urllib.parse
import urllib.robotparser
from collections import defaultdict
from datetime import datetime
from urllib.parse import urljoin, urlparse

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("ERROR: Missing dependencies. Run: pip install requests beautifulsoup4 textstat --break-system-packages -q")
    sys.exit(1)

try:
    import textstat
    HAS_TEXTSTAT = True
except ImportError:
    HAS_TEXTSTAT = False

# ── Constants ────────────────────────────────────────────────────────────────

VERSION = "1.0"
TIMEOUT = 10
USER_AGENT = "Mozilla/5.0 (compatible; CountingFiveAudit/1.0; +https://countingfive.com)"
HEADERS = {"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"}

PSI_API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"

SCORING_WEIGHTS = {
    "performance":    0.20,
    "technical":      0.15,
    "onpage_seo":     0.15,
    "ux":             0.10,
    "content":        0.10,
    "indexability":   0.10,
    "schema":         0.10,
    "ai_llm":         0.05,
    "analytics":      0.05,
}

GRADE_SCALE = [(90,"A","Excellent"),(80,"B","Good"),(70,"C","Needs Work"),(60,"D","Poor"),(0,"F","Critical Issues")]

C5 = {
    "dark":   "#1A1A2E",
    "accent": "#E94560",
    "mid":    "#16213E",
    "gray":   "#6B7280",
    "green":  "#10B981",
    "yellow": "#F59E0B",
    "red":    "#DC2626",
    "light":  "#F9FAFB",
}


# ── Helpers ──────────────────────────────────────────────────────────────────

def get_grade(score):
    for threshold, grade, label in GRADE_SCALE:
        if score >= threshold:
            return grade, label
    return "F", "Critical Issues"

def safe_get(url, session, timeout=TIMEOUT, allow_redirects=True):
    try:
        r = session.get(url, headers=HEADERS, timeout=timeout,
                        allow_redirects=allow_redirects, verify=True)
        return r
    except requests.exceptions.SSLError:
        try:
            r = session.get(url, headers=HEADERS, timeout=timeout,
                            allow_redirects=allow_redirects, verify=False)
            r._ssl_error = True
            return r
        except Exception:
            return None
    except Exception:
        return None

def normalize_url(url, base):
    url = url.strip()
    if url.startswith("//"):
        scheme = urlparse(base).scheme
        url = f"{scheme}:{url}"
    parsed = urlparse(url)
    if not parsed.scheme:
        url = urljoin(base, url)
    parsed = urlparse(url)
    return parsed._replace(fragment="").geturl()

def same_domain(url, base_domain):
    try:
        return urlparse(url).netloc.lower().lstrip("www.") == base_domain.lower().lstrip("www.")
    except Exception:
        return False

def esc(text):
    """Escape text for safe HTML embedding."""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

# Security header names → recommended values (used in scoring and report rendering)
SEC_HEADER_RECOMMENDED = {
    "content-security-policy":  "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline';",
    "x-frame-options":          "SAMEORIGIN",
    "x-content-type-options":   "nosniff",
    "referrer-policy":          "strict-origin-when-cross-origin",
    "permissions-policy":       "camera=(), microphone=(), geolocation=()",
}

def count_words(text):
    return len(re.findall(r'\b\w+\b', text)) if text else 0

def flesch_kincaid_grade(text):
    if HAS_TEXTSTAT:
        try:
            return textstat.flesch_kincaid_grade(text)
        except Exception:
            pass
    # Manual fallback: simple approximation
    sentences = max(1, len(re.split(r'[.!?]+', text)))
    words = max(1, count_words(text))
    syllables = sum(len(re.findall(r'[aeiouAEIOU]', w)) for w in text.split())
    syllables = max(words, syllables)
    return round(0.39 * (words/sentences) + 11.8 * (syllables/words) - 15.59, 1)

def logo_to_base64(path):
    if path and os.path.exists(path):
        with open(path, "rb") as f:
            ext = os.path.splitext(path)[1].lower().strip(".")
            if ext == "jpg": ext = "jpeg"
            return f"data:image/{ext};base64," + base64.b64encode(f.read()).decode()
    return ""

def flag(status):
    """Return emoji flag for a status string."""
    return {"pass": "🟢", "warning": "🟡", "fail": "🔴", "info": "ℹ️", "na": "⚪"}.get(status, "⚪")


# ── Crawl Phase ───────────────────────────────────────────────────────────────

def crawl_site(start_url, max_pages=50):
    """Crawl the site, returning a list of page dicts."""
    session = requests.Session()
    session.max_redirects = 5

    parsed_start = urlparse(start_url)
    base_domain = parsed_start.netloc

    visited = set()
    queue = [start_url]
    pages = []
    errors = []

    print(f"  Crawling {start_url} (max {max_pages} pages)...")

    while queue and len(pages) < max_pages:
        url = queue.pop(0)
        if url in visited:
            continue
        visited.add(url)

        r = safe_get(url, session)
        if r is None:
            errors.append({"url": url, "error": "Request failed"})
            continue

        # Track redirect chains
        redirect_chain = []
        if r.history:
            for rr in r.history:
                redirect_chain.append({"url": rr.url, "status": rr.status_code})

        content_type = r.headers.get("content-type", "")
        if "text/html" not in content_type:
            continue

        soup = BeautifulSoup(r.text, "html.parser")

        # Extract page data
        page = {
            "url": r.url,
            "original_url": url,
            "status_code": r.status_code,
            "redirect_chain": redirect_chain,
            "redirect_count": len(redirect_chain),
            "html": r.text,
            "soup": soup,
            "response_headers": dict(r.headers),
            "ssl_error": getattr(r, "_ssl_error", False),
            "content_length": len(r.content),
        }

        if r.status_code == 200:
            pages.append(page)
        else:
            errors.append({"url": url, "status": r.status_code})

        # Discover more links
        if r.status_code == 200 and len(pages) < max_pages:
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if href.startswith("mailto:") or href.startswith("tel:") or href.startswith("#"):
                    continue
                full_url = normalize_url(href, url)
                if same_domain(full_url, base_domain) and full_url not in visited and full_url not in queue:
                    queue.append(full_url)

        time.sleep(0.15)  # polite crawl delay

    print(f"  Crawled {len(pages)} pages, {len(errors)} errors, {len(queue)} URLs remaining in queue")
    return pages, errors, visited


# ── Fetch supporting files ─────────────────────────────────────────────────

def fetch_robots(base_url, session):
    robots_url = urljoin(base_url, "/robots.txt")
    r = safe_get(robots_url, session)
    result = {"url": robots_url, "present": False, "content": "", "disallows": [], "sitemaps": [], "ai_blocked": [], "ai_allowed": []}
    if r and r.status_code == 200:
        result["present"] = True
        result["content"] = r.text
        # Parse disallows
        for line in r.text.splitlines():
            line = line.strip()
            if line.lower().startswith("disallow:"):
                path = line.split(":", 1)[1].strip()
                if path:
                    result["disallows"].append(path)
            if line.lower().startswith("sitemap:"):
                result["sitemaps"].append(line.split(":", 1)[1].strip())
        # Check AI bot rules
        ai_bots = ["gptbot", "claudebot", "perplexitybot", "googleother", "anthropic-ai", "ccbot", "chatgpt-user"]
        content_lower = r.text.lower()
        for bot in ai_bots:
            if bot in content_lower:
                # crude check: if there's a disallow after this bot
                idx = content_lower.find(bot)
                snippet = content_lower[idx:idx+200]
                if "disallow: /" in snippet:
                    result["ai_blocked"].append(bot)
                else:
                    result["ai_allowed"].append(bot)
    return result

def fetch_sitemap(base_url, session, robots_sitemaps=None):
    """
    Fetch and parse sitemap(s). Handles both regular sitemaps and sitemap index files
    (e.g. Yoast SEO generates a sitemap index linking to page-sitemap.xml, post-sitemap.xml, etc.).
    Google fully supports sitemap indexes — all child sitemaps are followed automatically.

    Returns a result dict with:
      found, url, is_index, child_sitemaps, urls (all page URLs),
      count (total), pages (non-post site pages), posts (blog posts),
      page_entries (list of {url, lastmod} dicts for non-post pages)
    """
    candidates = [urljoin(base_url, "/sitemap.xml"), urljoin(base_url, "/sitemap_index.xml")]
    if robots_sitemaps:
        candidates = list(robots_sitemaps) + candidates

    result = {
        "found": False, "url": None, "is_index": False,
        "child_sitemaps": [], "urls": [], "count": 0,
        "pages": 0, "posts": 0, "other": 0,
        "page_entries": [],   # [{url, lastmod, type}] for non-post pages only
    }

    def _parse_sitemap_urls(xml_text, sitemap_url=""):
        """Parse a single sitemap XML and return list of {url, lastmod} dicts."""
        entries = []
        try:
            soup = BeautifulSoup(xml_text, "xml")
            for url_tag in soup.find_all("url"):
                loc = url_tag.find("loc")
                lastmod = url_tag.find("lastmod")
                if loc:
                    entries.append({
                        "url": loc.get_text().strip(),
                        "lastmod": lastmod.get_text().strip() if lastmod else "",
                    })
        except Exception:
            pass
        return entries

    for sm_url in candidates:
        r = safe_get(sm_url, session)
        if not r or r.status_code != 200:
            continue
        ct = r.headers.get("content-type", "")
        if not ("xml" in ct or "<url>" in r.text or "<sitemap>" in r.text):
            continue

        result["found"] = True
        result["url"] = sm_url

        # Detect sitemap index vs regular sitemap
        if "<sitemapindex" in r.text:
            result["is_index"] = True
            soup = BeautifulSoup(r.text, "xml")
            child_urls = [loc.get_text().strip() for loc in soup.find_all("loc")]
            result["child_sitemaps"] = child_urls

            # Follow each child sitemap and collect URLs
            for child_url in child_urls:
                cr = safe_get(child_url, session)
                if not cr or cr.status_code != 200:
                    continue
                entries = _parse_sitemap_urls(cr.text, child_url)
                for e in entries:
                    result["urls"].append(e["url"])

                # Classify by child sitemap name
                child_lower = child_url.lower()
                if "post-sitemap" in child_lower or "article-sitemap" in child_lower or "blog-sitemap" in child_lower:
                    result["posts"] += len(entries)
                elif "page-sitemap" in child_lower:
                    result["pages"] += len(entries)
                    for e in entries:
                        result["page_entries"].append({"url": e["url"], "lastmod": e["lastmod"], "type": "page"})
                else:
                    result["other"] += len(entries)
        else:
            # Regular sitemap — treat all URLs as pages
            entries = _parse_sitemap_urls(r.text, sm_url)
            for e in entries:
                result["urls"].append(e["url"])
                result["page_entries"].append({"url": e["url"], "lastmod": e["lastmod"], "type": "page"})
            result["pages"] = len(entries)

        result["count"] = len(result["urls"])
        break

    return result

def fetch_llms_txt(base_url, session):
    url = urljoin(base_url, "/llms.txt")
    r = safe_get(url, session)
    return {"present": r is not None and r.status_code == 200, "url": url, "content": r.text[:500] if r and r.status_code == 200 else ""}

def check_ssl(base_url):
    result = {"valid": False, "expiry_days": None, "error": None}
    parsed = urlparse(base_url)
    if parsed.scheme != "https":
        result["error"] = "Not using HTTPS"
        return result
    hostname = parsed.hostname
    try:
        ctx = ssl.create_default_context()
        with ctx.wrap_socket(socket.socket(), server_hostname=hostname) as s:
            s.settimeout(8)
            s.connect((hostname, 443))
            cert = s.getpeercert()
            expire_str = cert.get("notAfter", "")
            if expire_str:
                expire_dt = datetime.strptime(expire_str, "%b %d %H:%M:%S %Y %Z")
                days = (expire_dt - datetime.utcnow()).days
                result["expiry_days"] = days
                result["valid"] = days > 0
            else:
                result["valid"] = True
    except ssl.SSLCertVerificationError as e:
        result["error"] = str(e)
    except Exception as e:
        result["error"] = str(e)[:100]
        result["valid"] = True  # can't determine, don't penalise
    return result

def check_pagespeed(url, strategy="mobile"):
    try:
        r = requests.get(PSI_API, params={"url": url, "strategy": strategy}, timeout=30)
        if r.status_code == 200:
            data = r.json()
            cats = data.get("lighthouseResult", {}).get("categories", {})
            audits = data.get("lighthouseResult", {}).get("audits", {})
            perf_score = int(cats.get("performance", {}).get("score", 0) * 100)

            def metric(key):
                a = audits.get(key, {})
                return a.get("numericValue"), a.get("score")

            lcp_val, lcp_score = metric("largest-contentful-paint")
            cls_val, cls_score = metric("cumulative-layout-shift")
            fcp_val, fcp_score = metric("first-contentful-paint")
            ttfb_val, ttfb_score = metric("server-response-time")
            inp_val, inp_score = metric("interaction-to-next-paint")

            return {
                "score": perf_score,
                "lcp": round(lcp_val / 1000, 2) if lcp_val else None,
                "cls": round(cls_val, 3) if cls_val else None,
                "fcp": round(fcp_val / 1000, 2) if fcp_val else None,
                "ttfb": round(ttfb_val / 1000, 2) if ttfb_val else None,
                "inp": round(inp_val, 0) if inp_val else None,
                "lcp_pass": lcp_score >= 0.9 if lcp_score is not None else None,
                "cls_pass": cls_score >= 0.9 if cls_score is not None else None,
                "fcp_pass": fcp_score >= 0.9 if fcp_score is not None else None,
            }
    except Exception as e:
        pass
    return {"score": None, "error": "PageSpeed API unavailable"}


# ── Per-page Analysis ─────────────────────────────────────────────────────────

def analyze_page(page):
    """Extract all SEO / content signals from a single page."""
    soup = page["soup"]
    html = page["html"]
    url = page["url"]

    # ── Meta / SEO ────────────────────────────────────────────────────────
    title_tag = soup.find("title")
    title = title_tag.get_text().strip() if title_tag else ""

    meta_desc_tag = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    meta_desc = meta_desc_tag.get("content", "").strip() if meta_desc_tag else ""

    canonical_tag = soup.find("link", attrs={"rel": "canonical"})
    canonical = canonical_tag.get("href", "").strip() if canonical_tag else ""

    robots_meta = soup.find("meta", attrs={"name": re.compile("^robots$", re.I)})
    noindex = False
    if robots_meta:
        content = robots_meta.get("content", "").lower()
        noindex = "noindex" in content

    # ── Headings ──────────────────────────────────────────────────────────
    headings = {}
    for level in range(1, 7):
        tags = soup.find_all(f"h{level}")
        headings[f"h{level}"] = [t.get_text().strip() for t in tags]
    h1_count = len(headings["h1"])
    # Check for skipped levels (e.g., H1 → H3 with no H2)
    heading_skip = False
    last_level = 0
    for level in range(1, 7):
        if headings[f"h{level}"]:
            if last_level > 0 and level > last_level + 1:
                heading_skip = True
            last_level = level

    # ── Images ───────────────────────────────────────────────────────────
    images = soup.find_all("img")
    imgs_missing_alt = [img.get("src","")[:60] for img in images if not img.get("alt")]
    imgs_total = len(images)

    # ── Open Graph / Twitter Card ─────────────────────────────────────────
    # Use attrs={} for non-standard HTML attributes (property, name) for reliable BS4 matching
    og_title  = bool(soup.find("meta", attrs={"property": "og:title"}))
    og_desc   = bool(soup.find("meta", attrs={"property": "og:description"}))
    og_image  = bool(soup.find("meta", attrs={"property": "og:image"}))
    tw_card   = bool(soup.find("meta", attrs={"name": "twitter:card"}))
    tw_title  = bool(soup.find("meta", attrs={"name": "twitter:title"}))
    tw_image  = bool(soup.find("meta", attrs={"name": "twitter:image"}))

    # ── Mobile viewport ───────────────────────────────────────────────────
    viewport = bool(soup.find("meta", attrs={"name": re.compile("^viewport$", re.I)}))

    # ── Schema / JSON-LD ─────────────────────────────────────────────────
    # Handles three common patterns:
    #   1. Direct {"@type": "X", ...}
    #   2. Array [{"@type": "X"}, ...]
    #   3. Yoast / nested {"@graph": [{"@type": "X"}, ...]}  ← most common in WordPress
    def _extract_schema_types(obj):
        types = []
        if isinstance(obj, list):
            for item in obj:
                types.extend(_extract_schema_types(item))
        elif isinstance(obj, dict):
            if "@graph" in obj:
                types.extend(_extract_schema_types(obj["@graph"]))
            t = obj.get("@type", "")
            if isinstance(t, list):
                types.extend(t)
            elif t:
                types.append(t)
        return types

    schema_types = []
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            raw = script.get_text(strip=True) or "{}"
            data = json.loads(raw)
            schema_types.extend(_extract_schema_types(data))
        except (json.JSONDecodeError, ValueError):
            schema_types.append("__invalid_json__")

    # ── Links ─────────────────────────────────────────────────────────────
    all_links = [a.get("href","") for a in soup.find_all("a", href=True)]
    internal_links = [l for l in all_links if l.startswith("/") or same_domain(l, urlparse(url).netloc)]
    anchor_texts = [a.get_text().strip().lower() for a in soup.find_all("a", href=True)]
    lazy_anchors = sum(1 for t in anchor_texts if t in ("click here","here","read more","learn more","more","link"))

    # ── Content text ─────────────────────────────────────────────────────
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    body_text = soup.get_text(separator=" ", strip=True)
    word_count = count_words(body_text)
    fk_grade = flesch_kincaid_grade(body_text[:2000]) if word_count > 50 else None

    # ── CTA detection ─────────────────────────────────────────────────────
    cta_patterns = re.compile(r'\b(contact us|get started|book a|schedule a|request a|sign up|free trial|get a quote|call us|let\'s talk|try free|start free)\b', re.I)
    has_cta = bool(cta_patterns.search(body_text))

    # ── Trust signals ─────────────────────────────────────────────────────
    trust_patterns = re.compile(r'\b(testimonial|review|case study|certified|award|accredited|years of experience|clients|guarantee|trusted)\b', re.I)
    has_trust = bool(trust_patterns.search(body_text))

    # ── Contact info ─────────────────────────────────────────────────────
    phone_pattern = re.compile(r'(\+?1?\s?[\(\-\.]?\d{3}[\)\-\.\s]\s?\d{3}[\-\.\s]\d{4})')
    email_pattern = re.compile(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}')
    has_phone = bool(phone_pattern.search(html))
    has_email = bool(email_pattern.search(html))

    # ── Analytics detection ───────────────────────────────────────────────
    has_ga4     = bool(re.search(r'(gtag|G-[A-Z0-9]+|googletagmanager\.com/gtag)', html))
    has_gtm     = bool(re.search(r'(GTM-[A-Z0-9]+|googletagmanager\.com/ns\.html)', html))
    has_meta_px = bool(re.search(r'(fbq\(|connect\.facebook\.net)', html))
    has_linkedin= bool(re.search(r'(linkedin\.com/insight|_linkedin_partner)', html))
    has_hotjar  = bool(re.search(r'(hotjar\.com|hj\()', html))
    has_clarity = bool(re.search(r'clarity\.ms', html))

    # ── Mixed content ─────────────────────────────────────────────────────
    mixed_content_raw = re.findall(
        r'(?:src|href)=["\'](http://[^"\']+\.(?:js|css|jpg|jpeg|png|gif|svg|woff|woff2)[^"\']*)["\']',
        html, re.I
    )
    mixed_content_urls = list(dict.fromkeys(mixed_content_raw))[:20]  # deduplicate, cap at 20

    # ── Security headers ──────────────────────────────────────────────────
    resp_headers = page.get("response_headers", {})
    sec_headers = {
        "content-security-policy": bool(resp_headers.get("content-security-policy")),
        "x-frame-options": bool(resp_headers.get("x-frame-options")),
        "x-content-type-options": bool(resp_headers.get("x-content-type-options")),
        "referrer-policy": bool(resp_headers.get("referrer-policy")),
        "permissions-policy": bool(resp_headers.get("permissions-policy") or resp_headers.get("feature-policy")),
    }

    # ── ARIA / accessibility basics ───────────────────────────────────────
    buttons_missing_label = [b for b in soup.find_all("button")
                              if not b.get("aria-label") and not b.get_text(strip=True)]
    inputs_missing_label = []
    for inp in soup.find_all("input", attrs={"type": lambda t: t not in ("hidden","submit","button",None)}):
        inp_id = inp.get("id","")
        if inp_id and soup.find("label", attrs={"for": inp_id}):
            continue
        if not inp.get("aria-label") and not inp.get("aria-labelledby"):
            inputs_missing_label.append(inp.get("type","text"))

    has_skip_nav = bool(soup.find("a", string=re.compile("skip", re.I)))

    # ── URL quality ───────────────────────────────────────────────────────
    parsed_url = urlparse(url)
    url_path = parsed_url.path
    url_has_params = bool(parsed_url.query)
    url_has_caps = url_path != url_path.lower()

    # ── Content for segments (stored for external check) ─────────────────
    page_text_sample = body_text[:3000]

    return {
        "title": title,
        "title_len": len(title),
        "meta_desc": meta_desc,
        "meta_desc_len": len(meta_desc),
        "canonical": canonical,
        "noindex": noindex,
        "h1_count": h1_count,
        "h1_texts": headings["h1"],
        "h2_count": len(headings["h2"]),
        "headings": headings,
        "heading_skip": heading_skip,
        "imgs_total": imgs_total,
        "imgs_missing_alt": len(imgs_missing_alt),
        "og_title": og_title, "og_desc": og_desc, "og_image": og_image,
        "tw_card": tw_card, "tw_title": tw_title, "tw_image": tw_image,
        "viewport": viewport,
        "schema_types": schema_types,
        "schema_valid": "__invalid_json__" not in schema_types,
        "word_count": word_count,
        "fk_grade": fk_grade,
        "has_cta": has_cta,
        "has_trust": has_trust,
        "has_phone": has_phone,
        "has_email": has_email,
        "has_ga4": has_ga4,
        "has_gtm": has_gtm,
        "has_meta_px": has_meta_px,
        "has_linkedin": has_linkedin,
        "has_hotjar": has_hotjar,
        "has_clarity": has_clarity,
        "mixed_content": bool(mixed_content_urls),
        "mixed_content_urls": mixed_content_urls,
        "sec_headers": sec_headers,
        "sec_header_count": sum(sec_headers.values()),
        "lazy_anchors": lazy_anchors,
        "url_has_params": url_has_params,
        "url_has_caps": url_has_caps,
        "buttons_missing_label": len(buttons_missing_label),
        "inputs_missing_label": len(inputs_missing_label),
        "has_skip_nav": has_skip_nav,
        "page_text_sample": page_text_sample,
        "content_length_bytes": page.get("content_length", 0),
        "redirect_count": page.get("redirect_count", 0),
    }


# ── Scoring ───────────────────────────────────────────────────────────────────

def score_category(checks):
    """checks: list of (passed: bool, weight: float) tuples. Returns 0-100."""
    total_weight = sum(w for _, w in checks)
    if total_weight == 0:
        return 100
    passed_weight = sum(w for p, w in checks if p)
    return round((passed_weight / total_weight) * 100)

def compute_scores(pages, analyzed, robots, sitemap, ssl_result, psi_mobile, psi_desktop, llms, errors, google_index_count=None):
    scores = {}
    findings = {}

    # ─ 1. Technical Health ───────────────────────────────────────────────
    all_sec_counts = [p["sec_header_count"] for p in analyzed]
    avg_sec = sum(all_sec_counts) / max(1, len(all_sec_counts))
    mixed_pages = sum(1 for p in analyzed if p["mixed_content"])
    has_canonical_pages = sum(1 for p in analyzed if p["canonical"])
    redirect_chain_pages = [pg for pg in pages if pg.get("redirect_count", 0) > 1]
    broken_pages = len(errors)

    # Mixed content detail: list of {page, resources} for pages with HTTP resources
    mixed_content_detail = []
    for pg, an in zip(pages, analyzed):
        if an.get("mixed_content") and an.get("mixed_content_urls"):
            mixed_content_detail.append({
                "page": pg.get("url", ""),
                "resources": an["mixed_content_urls"][:10],
            })

    # Security headers: determine which headers are missing (headers are server-wide, sample first page)
    sec_headers_sample = analyzed[0]["sec_headers"] if analyzed else {}
    missing_security_headers = [h for h in SEC_HEADER_RECOMMENDED if not sec_headers_sample.get(h)]

    ssl_ok = ssl_result.get("valid", False) and not ssl_result.get("error")

    tech_checks = [
        (ssl_ok, 2.0),
        (robots["present"], 1.0),
        (mixed_pages == 0, 1.5),
        (len(redirect_chain_pages) == 0, 1.0),
        (broken_pages == 0, 1.5),
        (avg_sec >= 3, 1.5),
        (avg_sec == 5, 0.5),
    ]
    scores["technical"] = score_category(tech_checks)
    findings["technical"] = {
        "ssl_valid": ssl_ok,
        "ssl_expiry_days": ssl_result.get("expiry_days"),
        "ssl_error": ssl_result.get("error"),
        "robots_present": robots["present"],
        "mixed_content_pages": mixed_pages,
        "mixed_content_detail": mixed_content_detail,
        "redirect_chain_pages": len(redirect_chain_pages),
        "broken_links": broken_pages,
        "avg_security_headers": round(avg_sec, 1),
        "security_headers_sample": sec_headers_sample,
        "missing_security_headers": missing_security_headers,
    }

    # ─ 2. Core Web Vitals ────────────────────────────────────────────────
    if psi_mobile.get("score") is not None:
        mob_score = psi_mobile["score"]
        desk_score = psi_desktop.get("score", mob_score) if psi_desktop else mob_score
        avg_psi = (mob_score + desk_score) // 2
        lcp_ok = psi_mobile.get("lcp_pass", False)
        cls_ok = psi_mobile.get("cls_pass", False)
        fcp_ok = psi_mobile.get("fcp_pass", False)
        scores["performance"] = avg_psi
        findings["performance"] = {
            "mobile_score": mob_score,
            "desktop_score": desk_score,
            "lcp": psi_mobile.get("lcp"), "lcp_pass": lcp_ok,
            "cls": psi_mobile.get("cls"), "cls_pass": cls_ok,
            "fcp": psi_mobile.get("fcp"), "fcp_pass": fcp_ok,
            "ttfb": psi_mobile.get("ttfb"),
            "inp": psi_mobile.get("inp"),
        }
    else:
        scores["performance"] = None  # unavailable
        findings["performance"] = {"error": psi_mobile.get("error", "PSI unavailable")}

    # ─ 3. On-Page SEO ────────────────────────────────────────────────────
    n = max(1, len(analyzed))
    pct_has_title      = sum(1 for p in analyzed if p["title"]) / n
    pct_title_len_ok   = sum(1 for p in analyzed if 40 <= p["title_len"] <= 65) / n
    pct_unique_title   = len(set(p["title"] for p in analyzed if p["title"])) / max(1, sum(1 for p in analyzed if p["title"]))
    pct_has_meta       = sum(1 for p in analyzed if p["meta_desc"]) / n
    pct_meta_len_ok    = sum(1 for p in analyzed if 100 <= p["meta_desc_len"] <= 165) / n
    pct_one_h1         = sum(1 for p in analyzed if p["h1_count"] == 1) / n
    pct_no_skip        = sum(1 for p in analyzed if not p["heading_skip"]) / n
    pct_alt_text_ok    = sum(1 for p in analyzed if p["imgs_missing_alt"] == 0 or p["imgs_total"] == 0) / n
    pct_og             = sum(1 for p in analyzed if p["og_title"] and p["og_desc"] and p["og_image"]) / n
    pct_tw             = sum(1 for p in analyzed if p["tw_card"]) / n
    pct_clean_url      = sum(1 for p in analyzed if not p["url_has_params"] and not p["url_has_caps"]) / n

    seo_checks = [
        (pct_has_title > 0.9, 2.0),
        (pct_title_len_ok > 0.7, 1.5),
        (pct_unique_title > 0.9, 1.5),
        (pct_has_meta > 0.8, 2.0),
        (pct_meta_len_ok > 0.7, 1.0),
        (pct_one_h1 > 0.85, 2.0),
        (pct_no_skip > 0.85, 1.0),
        (pct_alt_text_ok > 0.8, 1.5),
        (pct_og > 0.7, 1.5),
        (pct_tw > 0.5, 0.5),
        (pct_clean_url > 0.9, 1.0),
    ]
    scores["onpage_seo"] = score_category(seo_checks)
    findings["onpage_seo"] = {
        "pct_has_title": round(pct_has_title * 100),
        "pct_title_len_ok": round(pct_title_len_ok * 100),
        "pct_unique_titles": round(pct_unique_title * 100),
        "pct_has_meta": round(pct_has_meta * 100),
        "pct_meta_len_ok": round(pct_meta_len_ok * 100),
        "pct_one_h1": round(pct_one_h1 * 100),
        "pct_no_heading_skip": round(pct_no_skip * 100),
        "pct_alt_text_ok": round(pct_alt_text_ok * 100),
        "pct_og_complete": round(pct_og * 100),
        "pct_tw_card": round(pct_tw * 100),
        "pct_clean_url": round(pct_clean_url * 100),
        "pages_missing_title": [pages[i]["url"] for i, an in enumerate(analyzed) if not an["title"]][:5],
    }

    # ─ 4. Content Quality ────────────────────────────────────────────────
    pct_adequate_words = sum(1 for p in analyzed if p["word_count"] >= 300) / n
    fk_scores = [p["fk_grade"] for p in analyzed if p["fk_grade"] is not None]
    avg_fk = sum(fk_scores) / max(1, len(fk_scores))
    pct_readable = sum(1 for f in fk_scores if f <= 12) / max(1, len(fk_scores))
    pct_has_cta  = sum(1 for p in analyzed if p["has_cta"]) / n
    pct_has_trust= sum(1 for p in analyzed if p["has_trust"]) / n
    homepage_contact = analyzed[0]["has_phone"] or analyzed[0]["has_email"] if analyzed else False

    # Basic duplicate check: flag pages with very similar word counts AND titles
    title_groups = defaultdict(list)
    for p in analyzed:
        if p["title"]:
            title_groups[p["title"].lower()].append(p)
    dup_pages = sum(len(g)-1 for g in title_groups.values() if len(g) > 1)

    content_checks = [
        (pct_adequate_words > 0.7, 2.0),
        # Reading level intentionally excluded from scoring —
        # professional/technical content is expected to score above grade 12.
        (dup_pages == 0, 1.5),
        (pct_has_cta > 0.6, 2.0),
        (pct_has_trust > 0.3, 1.0),
        (homepage_contact, 1.5),
    ]
    scores["content"] = score_category(content_checks)
    findings["content"] = {
        "pct_adequate_words": round(pct_adequate_words * 100),
        "avg_reading_grade": round(avg_fk, 1),
        "pct_readable": round(pct_readable * 100),
        "pct_has_cta": round(pct_has_cta * 100),
        "pct_has_trust_signals": round(pct_has_trust * 100),
        "homepage_has_contact": homepage_contact,
        "duplicate_title_pages": dup_pages,
    }

    # ─ 5. Indexability ───────────────────────────────────────────────────
    pct_noindex = sum(1 for p in analyzed if p["noindex"]) / n
    sitemap_referenced_in_robots = bool(robots.get("sitemaps"))
    noindex_important = pct_noindex > 0.1  # >10% noindexed is suspicious

    index_checks = [
        (sitemap["found"], 2.0),
        (sitemap_referenced_in_robots, 1.0),
        (not noindex_important, 1.5),
        (True, 1.0),  # Google index — filled in externally
    ]
    google_indexed = google_index_count if google_index_count is not None else "unverified"
    index_score_base = score_category(index_checks[:3])

    scores["indexability"] = index_score_base
    findings["indexability"] = {
        "sitemap_found": sitemap["found"],
        "sitemap_url": sitemap.get("url"),
        "sitemap_is_index": sitemap.get("is_index", False),
        "sitemap_child_count": len(sitemap.get("child_sitemaps", [])),
        "sitemap_url_count": sitemap.get("count", 0),
        "sitemap_pages": sitemap.get("pages", 0),
        "sitemap_posts": sitemap.get("posts", 0),
        "sitemap_other": sitemap.get("other", 0),
        "sitemap_in_robots": sitemap_referenced_in_robots,
        "pages_with_noindex": round(pct_noindex * 100),
        "google_index_count": google_indexed,
        "crawled_pages": len(pages),
    }

    # ─ 6. Schema & Structured Data ───────────────────────────────────────
    all_schema_types = set()
    for p in analyzed:
        all_schema_types.update(p["schema_types"])
    all_schema_types.discard("__invalid_json__")

    has_org        = "Organization" in all_schema_types
    has_website    = "WebSite" in all_schema_types
    has_breadcrumb = "BreadcrumbList" in all_schema_types
    has_local_biz  = "LocalBusiness" in all_schema_types or any("Business" in t for t in all_schema_types)
    has_article    = "Article" in all_schema_types or "BlogPosting" in all_schema_types
    has_faq        = "FAQPage" in all_schema_types
    has_product    = "Product" in all_schema_types
    valid_json     = all(p["schema_valid"] for p in analyzed)
    pct_with_schema= sum(1 for p in analyzed if p["schema_types"]) / n

    schema_checks = [
        (has_org, 2.0),
        (has_website, 1.5),
        (has_breadcrumb, 1.0),
        (pct_with_schema > 0.5, 1.5),
        (valid_json, 2.0),
    ]
    scores["schema"] = score_category(schema_checks)
    findings["schema"] = {
        "types_found": sorted(all_schema_types),
        "has_organization": has_org,
        "has_website": has_website,
        "has_breadcrumb": has_breadcrumb,
        "has_local_business": has_local_biz,
        "has_article": has_article,
        "has_faq": has_faq,
        "has_product": has_product,
        "all_json_valid": valid_json,
        "pct_pages_with_schema": round(pct_with_schema * 100),
    }

    # ─ 7. AI / LLM Readiness ─────────────────────────────────────────────
    has_llms_txt = llms["present"]
    ai_crawlers_not_blocked = len(robots.get("ai_blocked", [])) == 0
    has_faq_content = any(p["schema_types"] and "FAQPage" in p["schema_types"] for p in analyzed)
    # Check for clear about/identity content on homepage or about page
    homepage_text = analyzed[0]["page_text_sample"].lower() if analyzed else ""
    has_about_content = any(kw in homepage_text for kw in ["we are", "who we are", "our mission", "about us", "founded", "we help", "we specialize"])
    # Check for info in images vs. text (rough heuristic: phone in text vs only image)
    has_phone_in_text = analyzed[0]["has_phone"] if analyzed else False

    ai_checks = [
        (has_llms_txt, 1.5),
        (ai_crawlers_not_blocked, 2.0),
        (has_faq_content, 1.0),
        (has_about_content, 1.5),
        (has_phone_in_text, 1.0),
    ]
    scores["ai_llm"] = score_category(ai_checks)
    findings["ai_llm"] = {
        "llms_txt_present": has_llms_txt,
        "llms_txt_url": llms.get("url"),
        "ai_crawlers_blocked": robots.get("ai_blocked", []),
        "ai_crawlers_allowed": robots.get("ai_allowed", []),
        "has_faq_schema": has_faq_content,
        "has_about_content": has_about_content,
        "contact_info_in_text": has_phone_in_text,
    }

    # ─ 8. UX & Accessibility ─────────────────────────────────────────────
    pct_has_viewport     = sum(1 for p in analyzed if p["viewport"]) / n
    pct_no_missing_btns  = sum(1 for p in analyzed if p["buttons_missing_label"] == 0) / n
    pct_form_labels_ok   = sum(1 for p in analyzed if p["inputs_missing_label"] == 0) / n
    pct_skip_nav         = sum(1 for p in analyzed if p["has_skip_nav"]) / n
    has_consistent_nav   = True  # assume true unless we detect wildly different nav counts

    # Check if there's a 404 page (attempt a bogus URL)
    base_url = pages[0]["url"] if pages else ""
    test_404_url = base_url.rstrip("/") + "/this-page-definitely-does-not-exist-audit-check"
    session_temp = requests.Session()
    r404 = safe_get(test_404_url, session_temp)
    has_custom_404 = r404 is not None and r404.status_code == 404 and len(r404.text) > 500

    ux_checks = [
        (pct_has_viewport > 0.9, 2.0),
        (pct_no_missing_btns > 0.8, 1.5),
        (pct_form_labels_ok > 0.8, 1.5),
        (pct_skip_nav > 0.3, 0.5),
        (has_custom_404, 1.0),
    ]
    scores["ux"] = score_category(ux_checks)
    findings["ux"] = {
        "pct_has_viewport": round(pct_has_viewport * 100),
        "pct_buttons_accessible": round(pct_no_missing_btns * 100),
        "pct_form_labels_ok": round(pct_form_labels_ok * 100),
        "pct_skip_nav": round(pct_skip_nav * 100),
        "has_custom_404": has_custom_404,
    }

    # ─ 9. Analytics & Tracking ───────────────────────────────────────────
    any_ga4      = any(p["has_ga4"]     for p in analyzed)
    any_gtm      = any(p["has_gtm"]     for p in analyzed)
    any_meta_px  = any(p["has_meta_px"] for p in analyzed)
    any_linkedin = any(p["has_linkedin"] for p in analyzed)
    any_hotjar   = any(p["has_hotjar"] or p["has_clarity"] for p in analyzed)

    # Check GA4 fires on at least home + one other page
    ga4_pages = sum(1 for p in analyzed if p["has_ga4"])
    ga4_coverage_ok = ga4_pages >= min(2, len(analyzed))

    analytics_checks = [
        (any_ga4, 3.0),
        (any_gtm, 2.0),
        (ga4_coverage_ok, 1.5),
        (any_meta_px, 1.0),
        (any_linkedin, 0.5),
    ]
    scores["analytics"] = score_category(analytics_checks)
    findings["analytics"] = {
        "has_ga4": any_ga4,
        "has_gtm": any_gtm,
        "has_meta_pixel": any_meta_px,
        "has_linkedin_pixel": any_linkedin,
        "has_heatmap_tool": any_hotjar,
        "ga4_page_coverage": ga4_pages,
    }

    return scores, findings


# ── Overall Score ─────────────────────────────────────────────────────────────

def compute_overall(scores):
    total = 0
    total_weight = 0
    for cat, weight in SCORING_WEIGHTS.items():
        if scores.get(cat) is not None:
            total += scores[cat] * weight
            total_weight += weight
    if total_weight == 0:
        return 0
    return round(total / total_weight)


# ── Recommendations ───────────────────────────────────────────────────────────

def generate_recommendations(scores, findings, pages):
    recs = []

    def add(priority, category, title, detail, effort="Medium"):
        recs.append({"priority": priority, "category": category, "title": title, "detail": detail, "effort": effort})

    f = findings

    # Technical
    if not f["technical"]["ssl_valid"]:
        add("critical", "Technical", "Fix SSL Certificate", f"SSL error: {f['technical'].get('ssl_error','Invalid certificate')}. HTTPS is required for rankings and trust.", "Low")
    if f["technical"]["mixed_content_pages"] > 0:
        add("warning", "Technical", "Fix Mixed Content", f"{f['technical']['mixed_content_pages']} page(s) load HTTP resources on HTTPS. Browsers will block these.", "Medium")
    if not f["technical"]["robots_present"]:
        add("warning", "Technical", "Add robots.txt", "No robots.txt found. Add one to guide crawlers and reference your sitemap.", "Low")
    if f["technical"]["avg_security_headers"] < 3:
        add("warning", "Technical", "Add Security Headers", f"Only {f['technical']['avg_security_headers']:.0f}/5 security headers set. Add Content-Security-Policy, X-Frame-Options, and X-Content-Type-Options at minimum.", "Medium")
    if f["technical"]["broken_links"] > 0:
        add("critical", "Technical", "Fix Broken Pages", f"{f['technical']['broken_links']} URL(s) returning errors were found during crawl.", "Medium")

    # Performance
    perf = f.get("performance", {})
    if perf.get("mobile_score") is not None and perf["mobile_score"] < 50:
        add("critical", "Performance", "Improve Mobile PageSpeed Score", f"Mobile score is {perf['mobile_score']}/100. Google uses mobile-first indexing — a score below 50 directly hurts rankings.", "High")
    elif perf.get("mobile_score") is not None and perf["mobile_score"] < 75:
        add("warning", "Performance", "Improve Mobile PageSpeed Score", f"Mobile score is {perf['mobile_score']}/100. Aim for 75+.", "High")
    if perf.get("lcp") and perf["lcp"] > 4.0:
        add("critical", "Performance", "Fix Slow LCP (Largest Contentful Paint)", f"LCP is {perf['lcp']}s. Target is under 2.5s. Check image sizes and server response time.", "High")
    if perf.get("cls") and perf["cls"] > 0.25:
        add("warning", "Performance", "Reduce Layout Shift (CLS)", f"CLS is {perf['cls']} (target: < 0.1). Set explicit width/height on images and embeds.", "Medium")

    # On-Page SEO
    seo = f["onpage_seo"]
    if seo["pct_has_meta"] < 80:
        add("critical", "On-Page SEO", "Add Missing Meta Descriptions", f"Only {seo['pct_has_meta']}% of pages have meta descriptions. These appear in search results and affect click-through rate.", "Low")
    if seo["pct_one_h1"] < 85:
        add("critical", "On-Page SEO", "Fix H1 Tag Issues", f"Only {seo['pct_one_h1']}% of pages have exactly one H1. Every page needs exactly one H1 — it's the primary on-page signal.", "Low")
    if seo["pct_has_title"] < 95:
        add("critical", "On-Page SEO", "Add Missing Title Tags", f"{100 - seo['pct_has_title']}% of pages are missing title tags.", "Low")
    if seo["pct_og_complete"] < 70:
        add("warning", "On-Page SEO", "Add Open Graph Tags", f"Only {seo['pct_og_complete']}% of pages have complete Open Graph tags. These control how the site looks when shared on social media.", "Low")
    if seo["pct_alt_text_ok"] < 80:
        add("warning", "On-Page SEO", "Fix Missing Image Alt Text", f"Only {seo['pct_alt_text_ok']}% of pages have all images tagged with alt text. This hurts accessibility and image SEO.", "Low")

    # Content
    cont = f["content"]
    if cont["pct_adequate_words"] < 70:
        add("warning", "Content", "Expand Thin Content", f"Only {cont['pct_adequate_words']}% of pages have 300+ words. Thin content ranks poorly and doesn't convert.", "High")
    if not cont["homepage_has_contact"]:
        add("critical", "Content", "Add Contact Info to Homepage", "No phone number or email address found on the homepage. This reduces trust and conversions.", "Low")
    if cont["pct_has_cta"] < 60:
        add("warning", "Content", "Add Calls to Action", f"Only {cont['pct_has_cta']}% of pages have a clear CTA. Every page should guide users to a next step.", "Medium")
    if cont["duplicate_title_pages"] > 0:
        add("warning", "Content", "Fix Duplicate Page Titles", f"{cont['duplicate_title_pages']} pages share a title with another page. Unique titles are required for SEO.", "Low")

    # Indexability
    idx = f["indexability"]
    if not idx["sitemap_found"]:
        add("critical", "Indexability", "Create and Submit XML Sitemap", "No sitemap.xml found. Submit one to Google Search Console to ensure all pages are indexed.", "Low")
    if not idx["sitemap_in_robots"]:
        add("warning", "Indexability", "Reference Sitemap in robots.txt", "Add 'Sitemap: https://domain.com/sitemap.xml' to robots.txt so all crawlers find it.", "Low")

    # Schema
    sch = f["schema"]
    if not sch["has_organization"]:
        add("critical", "Schema", "Add Organization Schema", "No Organization schema found. This is the baseline schema every business site needs — it tells Google who you are.", "Low")
    if not sch["has_website"]:
        add("warning", "Schema", "Add WebSite Schema", "Add WebSite schema with a SearchAction to enable sitelinks search in Google.", "Low")
    if not sch["has_breadcrumb"]:
        add("warning", "Schema", "Add BreadcrumbList Schema", "Breadcrumb schema on interior pages enables richer search result listings.", "Low")
    if not sch["all_json_valid"]:
        add("critical", "Schema", "Fix Malformed JSON-LD", "Some schema blocks contain invalid JSON. These are silently ignored by Google — fix them with a JSON validator.", "Low")

    # AI
    ai = f["ai_llm"]
    if not ai["llms_txt_present"]:
        add("warning", "AI / LLM", "Add llms.txt File", "Create /llms.txt to help AI systems understand your site. This is the emerging standard for AI-readable site context.", "Low")
    if ai["ai_crawlers_blocked"]:
        add("warning", "AI / LLM", f"Review AI Crawler Blocks", f"These AI crawlers are blocked in robots.txt: {', '.join(ai['ai_crawlers_blocked'])}. Consider whether blocking AI indexing is intentional.", "Low")

    # UX
    ux = f["ux"]
    if not ux["has_custom_404"]:
        add("warning", "UX", "Create a Custom 404 Page", "The 404 page appears to be missing or minimal. A helpful 404 page with navigation reduces bounce rate.", "Low")
    if ux["pct_has_viewport"] < 90:
        add("critical", "UX", "Add Viewport Meta Tag", f"Only {ux['pct_has_viewport']}% of pages have a viewport meta tag. Without it, mobile browsers can't render the page correctly.", "Low")

    # Analytics
    anal = f["analytics"]
    if not anal["has_ga4"]:
        add("critical", "Analytics", "Install Google Analytics 4 (GA4)", "No GA4 tracking detected. Without it, there is no data on who visits the site, where they come from, or what they do.", "Low")
    if anal["has_ga4"] and not anal["has_gtm"]:
        add("warning", "Analytics", "Install Google Tag Manager", "GA4 is present but GTM is not. GTM makes it easier to manage and add tags without developer involvement.", "Low")
    if not anal["has_meta_pixel"]:
        add("warning", "Analytics", "Install Meta Pixel", "No Facebook/Meta Pixel detected. Required for retargeting ads and tracking conversions from Meta campaigns.", "Low")

    # Sort: critical first, then warning, then effort
    priority_order = {"critical": 0, "warning": 1, "info": 2}
    effort_order = {"Low": 0, "Medium": 1, "High": 2}
    recs.sort(key=lambda r: (priority_order.get(r["priority"], 2), effort_order.get(r["effort"], 1)))

    return recs


# ── Per-page issue detection ──────────────────────────────────────────────────

def _page_issues(an):
    """
    Given a single analyzed page dict, return a list of short issue strings.
    Returns an empty list if the page passes all checks.
    """
    issues = []
    title = an.get("title", "")
    meta  = an.get("meta_desc", "")
    h1s   = an.get("h1_texts", [])
    words = an.get("word_count", 0)

    if not title:
        issues.append("No title tag")
    elif len(title) < 30:
        issues.append(f"Title too short ({len(title)} chars)")
    elif len(title) > 65:
        issues.append(f"Title too long ({len(title)} chars)")

    if not meta:
        issues.append("No meta description")
    elif len(meta) < 100:
        issues.append(f"Meta description too short ({len(meta)} chars)")
    elif len(meta) > 165:
        issues.append(f"Meta description too long ({len(meta)} chars)")

    if not h1s:
        issues.append("No H1 tag")
    elif len(h1s) > 1:
        issues.append(f"Multiple H1s ({len(h1s)})")

    if not an.get("schema_types"):
        issues.append("No schema markup")

    if words < 300:
        issues.append(f"Thin content ({words} words)")

    if not an.get("og_complete"):
        issues.append("Missing OG tags")

    if not an.get("has_ga4"):
        issues.append("No GA4 tracking")

    return issues


# ── SEO suggestion generator ──────────────────────────────────────────────────

def _suggest_title(pa, site_name):
    """
    Generate a suggested title tag for a page.
    Strategy: H1 | Brand — or derive from URL path if no H1.
    Target: 50-60 characters.
    """
    brand = site_name or "Kinexus CPAs & Advisors"
    h1 = (pa.get("h1_text") or "").strip()
    path = urlparse(pa.get("url", "")).path.strip("/")

    # Derive a page label from the URL path as a last resort
    if not h1 and path:
        parts = path.split("/")
        h1 = parts[-1].replace("-", " ").title() if parts else ""

    if not h1:
        return None

    # Build "H1 | Brand" and trim to fit within 60 chars
    separator = " | "
    full = f"{h1}{separator}{brand}"
    if len(full) <= 60:
        return full

    # If too long, try trimming the H1 to make room for the brand
    max_h1 = 60 - len(separator) - len(brand)
    if max_h1 >= 15:
        trimmed_h1 = h1[:max_h1].rstrip()
        # Break at last word boundary
        last_space = trimmed_h1.rfind(" ")
        if last_space > 10:
            trimmed_h1 = trimmed_h1[:last_space]
        return f"{trimmed_h1}{separator}{brand}"

    # Brand too long — just use the H1 trimmed to 60
    return h1[:57].rstrip() + "…" if len(h1) > 60 else h1


def _suggest_meta(pa):
    """
    Generate a suggested meta description for a page.
    Strategy: Use content_snippet — find a natural sentence boundary within 155 chars.
    Target: 140-155 characters.
    """
    snippet = (pa.get("content_snippet") or "").strip()
    if not snippet or len(snippet) < 40:
        return None

    # Try to grab a clean 140-155 char excerpt ending at a sentence boundary
    target = snippet[:160]
    # Prefer ending at ". " or "! " or "? "
    for end_char in [". ", "! ", "? "]:
        idx = target.rfind(end_char, 80, 155)
        if idx != -1:
            return target[:idx + 1].strip()

    # Fall back to word boundary at ~150 chars
    if len(snippet) > 155:
        cut = snippet[:152]
        last_space = cut.rfind(" ")
        if last_space > 80:
            return cut[:last_space].strip() + "…"

    return snippet[:155].strip()


# ── HTML Report ───────────────────────────────────────────────────────────────

def render_html(domain, site_name, url, audit_date, pages, analyzed, scores, findings, recommendations, logo_dark_b64, logo_rev_b64, crawl_errors, sitemap=None, page_analysis_summary=None, google_indexed_urls=None):
    overall = compute_overall(scores)
    overall_grade, overall_label = get_grade(overall)

    # Reliable page count: prefer live crawl length, fall back to page_analysis_summary,
    # then findings.indexability.crawled_pages — never shows 0 after --update-report
    pages_audited = (
        len(pages) if pages
        else len(page_analysis_summary) if page_analysis_summary
        else findings.get("indexability", {}).get("crawled_pages", 0)
    )

    # Score ring color
    ring_color = C5["green"] if overall >= 80 else (C5["yellow"] if overall >= 60 else C5["red"])
    # Grade color
    grade_color = {"A": C5["green"], "B": "#3B82F6", "C": C5["yellow"], "D": C5["accent"], "F": C5["red"]}.get(overall_grade, C5["gray"])

    cat_names = {
        "performance": "Core Web Vitals & Performance",
        "technical": "Technical Health",
        "onpage_seo": "On-Page SEO & Metadata",
        "ux": "UX & Accessibility",
        "content": "Content Quality",
        "indexability": "Indexability",
        "schema": "Schema & Structured Data",
        "ai_llm": "AI / LLM Readiness",
        "analytics": "Analytics & Tracking",
    }

    def score_badge(score, size="normal"):
        if score is None:
            return f'<span class="badge badge-na">N/A</span>'
        g, _ = get_grade(score)
        cls = {"A":"badge-a","B":"badge-b","C":"badge-c","D":"badge-d","F":"badge-f"}.get(g,"badge-na")
        return f'<span class="badge {cls}">{g} &nbsp;{score}</span>'

    def pct_bar(pct, good_threshold=70):
        color = C5["green"] if pct >= good_threshold else (C5["yellow"] if pct >= 50 else C5["red"])
        return f'<div class="bar-wrap"><div class="bar-fill" style="width:{min(pct,100)}%;background:{color}"></div></div><span class="bar-label">{pct}%</span>'

    def check_row(label, status, detail=""):
        icon = flag(status)
        td_class = {"pass":"td-pass","warning":"td-warn","fail":"td-fail"}.get(status,"")
        return f'<tr><td class="check-label">{icon} {label}</td><td class="{td_class}">{detail}</td></tr>'

    # Category detail sections
    cat_sections = ""

    # Performance
    perf = findings.get("performance", {})
    perf_score = scores.get("performance")
    if perf.get("error"):
        perf_detail = f'<p class="note">⚠️ PageSpeed Insights unavailable: {perf["error"]}. Run the audit again or check https://pagespeed.web.dev manually.</p>'
    else:
        def psi_status(val, good, bad, lower_is_better=True):
            if val is None: return "na"
            return ("pass" if val <= good else ("warning" if val <= bad else "fail")) if lower_is_better else \
                   ("pass" if val >= good else ("warning" if val >= bad else "fail"))
        perf_detail = f'''
        <table class="check-table">
            <tr><th>Metric</th><th>Mobile</th><th>Threshold</th></tr>
            {check_row("PageSpeed Score (Mobile)", psi_status(perf.get("mobile_score"),75,50,False), f'{perf.get("mobile_score","—")}/100')}
            {check_row("PageSpeed Score (Desktop)", psi_status(perf.get("desktop_score"),75,50,False), f'{perf.get("desktop_score","—")}/100')}
            {check_row("LCP – Largest Contentful Paint", psi_status(perf.get("lcp"),2.5,4.0), f'{perf.get("lcp","—")}s &nbsp;(target: &lt;2.5s)')}
            {check_row("CLS – Cumulative Layout Shift", psi_status(perf.get("cls"),0.1,0.25), f'{perf.get("cls","—")} &nbsp;(target: &lt;0.1)')}
            {check_row("FCP – First Contentful Paint", psi_status(perf.get("fcp"),1.8,3.0), f'{perf.get("fcp","—")}s &nbsp;(target: &lt;1.8s)')}
            {check_row("TTFB – Time to First Byte", psi_status(perf.get("ttfb"),0.8,1.8), f'{perf.get("ttfb","—")}s &nbsp;(target: &lt;0.8s)')}
        </table>'''

    cat_sections += _cat_section("performance", "Core Web Vitals & Performance", perf_score, perf_detail, recommendations)

    # Technical
    tech = findings["technical"]

    # ── Security headers detail block (shown when not all 5 are set) ──────
    sec_hdrs_present = tech.get("security_headers_sample", {})
    # Compute missing_hdrs on-the-fly if not persisted (backward-compat with old JSON)
    missing_hdrs = tech.get("missing_security_headers") or [
        h for h in SEC_HEADER_RECOMMENDED if not sec_hdrs_present.get(h)
    ]
    if missing_hdrs:
        sec_hdr_rows = ""
        for h in SEC_HEADER_RECOMMENDED:
            present = sec_hdrs_present.get(h, False)
            if present:
                sec_hdr_rows += f'<tr><td><code>{h}</code></td><td style="color:var(--green)">✓ Set</td><td style="color:var(--gray);font-style:italic">No action needed</td></tr>'
            else:
                rec_val = SEC_HEADER_RECOMMENDED[h]
                sec_hdr_rows += (
                    f'<tr style="background:#FFFBEB">'
                    f'<td><code>{h}</code></td>'
                    f'<td style="color:var(--yellow)">✗ Missing</td>'
                    f'<td><code style="font-size:11px;word-break:break-all">{esc(rec_val)}</code></td>'
                    f'</tr>'
                )
        sec_hdrs_detail_html = f'''
        <div style="margin:10px 0 6px 24px;">
          <p style="font-size:12px;color:var(--gray);margin-bottom:6px;">
            These HTTP response headers protect against common browser attacks. Add them via your server config, .htaccess, or Flywheel's custom headers panel.
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <tr style="background:var(--light)"><th style="text-align:left;padding:5px 8px">Header</th><th style="text-align:left;padding:5px 8px;white-space:nowrap">Status</th><th style="text-align:left;padding:5px 8px">Recommended Value</th></tr>
            {sec_hdr_rows}
          </table>
        </div>'''
    else:
        sec_hdrs_detail_html = ""

    # ── Mixed content detail block (shown when pages have HTTP resources) ─
    # Derive mixed content detail from page_analysis_summary if not persisted in findings
    mc_detail = tech.get("mixed_content_detail") or []
    if not mc_detail and page_analysis_summary:
        for pa in page_analysis_summary:
            urls = pa.get("mixed_content_urls", [])
            if urls:
                mc_detail.append({"page": pa["url"], "resources": urls})
    if mc_detail:
        mc_rows = ""
        for entry in mc_detail[:20]:
            page_link = f'<a href="{esc(entry["page"])}" style="font-size:12px" target="_blank">{esc(entry["page"])}</a>'
            resource_list = "".join(
                f'<li style="font-size:11px;color:#DC2626;word-break:break-all"><code>http://</code>{esc(r.replace("http://",""))}</li>'
                for r in entry.get("resources", [])
            )
            mc_rows += f'<tr><td style="padding:6px 8px;vertical-align:top">{page_link}</td><td style="padding:6px 8px;vertical-align:top"><ul style="margin:0;padding-left:16px">{resource_list}</ul></td></tr>'
        mc_detail_html = f'''
        <div style="margin:10px 0 6px 24px;">
          <p style="font-size:12px;color:var(--gray);margin-bottom:6px;">
            These pages load resources over HTTP on an HTTPS site. Browsers block or warn on mixed content, hurting trust and performance.
            Fix by updating each resource URL from <code>http://</code> to <code>https://</code> in your theme, plugins, or media uploads.
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <tr style="background:var(--light)"><th style="text-align:left;padding:5px 8px">Page</th><th style="text-align:left;padding:5px 8px">HTTP Resources Found</th></tr>
            {mc_rows}
          </table>
        </div>'''
    elif tech.get("mixed_content_pages", 0) > 0:
        # mixed content detected but no per-page detail available (run a fresh crawl to populate)
        mc_detail_html = f'''
        <div style="margin:10px 0 6px 24px;">
          <p style="font-size:12px;color:var(--gray)">
            ⚠️ {tech["mixed_content_pages"]} page(s) contain HTTP resources on an HTTPS site.
            Run a fresh audit crawl to generate a page-by-page breakdown of the specific resources causing mixed content.
            Common causes include images uploaded via the WordPress media library before HTTPS was enabled, and third-party embeds using http:// URLs.
            Fix: use a plugin like <strong>Better Search Replace</strong> to update all <code>http://yourdomain.com</code> references to <code>https://</code> in the database.
          </p>
        </div>'''
    else:
        mc_detail_html = ""

    tech_detail = f'''<table class="check-table">
        {check_row("HTTPS / SSL Valid", "pass" if tech["ssl_valid"] else "fail", "Secure" if tech["ssl_valid"] else tech.get("ssl_error","Invalid"))}
        {check_row("robots.txt Present", "pass" if tech["robots_present"] else "warning", "Found" if tech["robots_present"] else "Not found")}
        {check_row("Mixed Content", "pass" if tech["mixed_content_pages"]==0 else "warning", f'{tech["mixed_content_pages"]} page(s) affected' if tech["mixed_content_pages"] else "None found")}
        {check_row("Redirect Chains", "pass" if tech["redirect_chain_pages"]==0 else "warning", f'{tech["redirect_chain_pages"]} chain(s) found' if tech["redirect_chain_pages"] else "None found")}
        {check_row("Broken Pages (4xx/5xx)", "pass" if tech["broken_links"]==0 else "fail", f'{tech["broken_links"]} broken' if tech["broken_links"] else "None found")}
        {check_row("Security Headers", "pass" if tech["avg_security_headers"]>=4 else ("warning" if tech["avg_security_headers"]>=2 else "fail"), f'{tech["avg_security_headers"]:.0f}/5 headers set')}
    </table>
    {sec_hdrs_detail_html}
    {mc_detail_html}'''
    cat_sections += _cat_section("technical", "Technical Health", scores.get("technical"), tech_detail, recommendations)

    # On-Page SEO
    seo = findings["onpage_seo"]

    # ── OG tag detail block (shown when OG coverage is below 80%) ─────────
    og_pct = seo["pct_og_complete"]
    if og_pct < 80 and page_analysis_summary:
        og_rows = ""
        seen_og_urls = set()
        for pa in page_analysis_summary:
            if pa.get("og_complete"):
                continue  # skip pages that are fine
            norm_url = pa["url"].rstrip("/")
            if norm_url in seen_og_urls:
                continue  # deduplicate
            seen_og_urls.add(norm_url)

            path = pa["url"].replace(url.rstrip("/"), "") or "/"
            missing_tags = []

            # Determine which individual OG fields are missing.
            # og_title/og_desc/og_image are stored from a fresh crawl;
            # for older JSON (pre-field storage) we treat all as missing
            # and derive suggestions from the already-stored title/meta_desc.
            has_og_fields = "og_title" in pa  # field present = fresh crawl data
            og_title_missing = not pa.get("og_title") if has_og_fields else True
            og_desc_missing  = not pa.get("og_desc")  if has_og_fields else True
            og_image_missing = not pa.get("og_image") if has_og_fields else True

            if og_title_missing:
                suggested = esc(pa.get("title", "") or path)[:70]
                missing_tags.append(f'<li><code>og:title</code> &mdash; suggested: <em>{suggested}</em></li>')
            if og_desc_missing:
                suggested = esc((pa.get("meta_desc", "") or pa.get("content_snippet", ""))[:155])
                fallback = "Write a 1–2 sentence summary of this page"
                missing_tags.append(f'<li><code>og:description</code> &mdash; suggested: <em>{suggested or fallback}</em></li>')
            if og_image_missing:
                missing_tags.append('<li><code>og:image</code> &mdash; upload a 1200&times;630 px image and set the URL here</li>')

            if missing_tags:
                og_rows += (
                    f'<tr>'
                    f'<td style="padding:5px 8px;font-size:12px;vertical-align:top;white-space:nowrap">'
                    f'<a href="{esc(pa["url"])}" target="_blank" style="color:var(--mid)">{esc(path)}</a></td>'
                    f'<td style="padding:5px 8px;font-size:12px;vertical-align:top">'
                    f'<ul style="margin:0;padding-left:16px;color:#92400E">{" ".join(missing_tags)}</ul></td>'
                    f'</tr>'
                )
        if og_rows:
            og_detail_html = f'''
        <div style="margin:10px 0 6px 24px;">
          <p style="font-size:12px;color:var(--gray);margin-bottom:6px;">
            Open Graph tags control how pages appear when shared on Facebook, LinkedIn, and other platforms.
            Add them via your WordPress SEO plugin (Yoast &rarr; Social, or RankMath &rarr; General &rarr; Social).
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <tr style="background:var(--light)">
              <th style="text-align:left;padding:5px 8px;white-space:nowrap">Page</th>
              <th style="text-align:left;padding:5px 8px">Missing &amp; Suggested Values</th>
            </tr>
            {og_rows}
          </table>
        </div>'''
        else:
            og_detail_html = ""
    else:
        og_detail_html = ""

    seo_detail = f'''<table class="check-table">
        {check_row("Pages with Title Tag", "pass" if seo["pct_has_title"]>=95 else ("warning" if seo["pct_has_title"]>=80 else "fail"), pct_bar(seo["pct_has_title"]))}
        {check_row("Title Tag Length (50-65 chars)", "pass" if seo["pct_title_len_ok"]>=80 else "warning", pct_bar(seo["pct_title_len_ok"]))}
        {check_row("Unique Title Tags", "pass" if seo["pct_unique_titles"]>=95 else "warning", pct_bar(seo["pct_unique_titles"]))}
        {check_row("Pages with Meta Description", "pass" if seo["pct_has_meta"]>=90 else ("warning" if seo["pct_has_meta"]>=70 else "fail"), pct_bar(seo["pct_has_meta"]))}
        {check_row("Meta Description Length (100-165)", "pass" if seo["pct_meta_len_ok"]>=80 else "warning", pct_bar(seo["pct_meta_len_ok"]))}
        {check_row("Single H1 Per Page", "pass" if seo["pct_one_h1"]>=90 else ("warning" if seo["pct_one_h1"]>=70 else "fail"), pct_bar(seo["pct_one_h1"]))}
        {check_row("Heading Hierarchy (no skips)", "pass" if seo["pct_no_heading_skip"]>=90 else "warning", pct_bar(seo["pct_no_heading_skip"]))}
        {check_row("Image Alt Text", "pass" if seo["pct_alt_text_ok"]>=90 else "warning", pct_bar(seo["pct_alt_text_ok"]))}
        {check_row("Open Graph Tags Complete", "pass" if seo["pct_og_complete"]>=80 else ("warning" if seo["pct_og_complete"]>=50 else "fail"), pct_bar(seo["pct_og_complete"]))}
        {check_row("Twitter Card Tags", "pass" if seo["pct_tw_card"]>=60 else "warning", pct_bar(seo["pct_tw_card"]))}
        {check_row("Clean URL Structure", "pass" if seo["pct_clean_url"]>=95 else "warning", pct_bar(seo["pct_clean_url"]))}
    </table>
    {og_detail_html}'''
    cat_sections += _cat_section("onpage_seo", "On-Page SEO & Metadata", scores.get("onpage_seo"), seo_detail, recommendations)

    # Content
    cont = findings["content"]
    cont_detail = f'''<table class="check-table">
        {check_row("Pages with 300+ Words", "pass" if cont["pct_adequate_words"]>=80 else ("warning" if cont["pct_adequate_words"]>=60 else "fail"), pct_bar(cont["pct_adequate_words"]))}
        {check_row("Duplicate Page Titles", "pass" if cont["duplicate_title_pages"]==0 else "warning", f'{cont["duplicate_title_pages"]} duplicate(s)' if cont["duplicate_title_pages"] else "None found")}
        {check_row("Pages with Clear CTA", "pass" if cont["pct_has_cta"]>=70 else ("warning" if cont["pct_has_cta"]>=50 else "fail"), pct_bar(cont["pct_has_cta"]))}
        {check_row("Pages with Trust Signals", "pass" if cont["pct_has_trust_signals"]>=40 else "warning", pct_bar(cont["pct_has_trust_signals"]))}
        {check_row("Contact Info on Homepage", "pass" if cont["homepage_has_contact"] else "fail", "Found" if cont["homepage_has_contact"] else "Not found")}
    </table>'''
    cat_sections += _cat_section("content", "Content Quality", scores.get("content"), cont_detail, recommendations)

    # Indexability
    idx = findings["indexability"]
    idx_google = idx["google_index_count"]
    idx_google_str = f'~{idx_google} pages indexed' if isinstance(idx_google, int) else "Unverified — run site:domain.com in Google"
    # Build sitemap detail string
    if idx["sitemap_found"]:
        if idx.get("sitemap_is_index"):
            sm_type_label = f'Sitemap Index ({idx["sitemap_child_count"]} child sitemaps) — Google follows all child sitemaps automatically'
            sm_count_detail = (
                f'{idx["sitemap_url_count"]} total URLs '
                f'({idx["sitemap_pages"]} pages, {idx["sitemap_posts"]} posts'
                + (f', {idx["sitemap_other"]} other' if idx.get("sitemap_other") else '')
                + ')'
            )
        else:
            sm_type_label = idx.get("sitemap_url", "Found")
            sm_count_detail = f'{idx["sitemap_url_count"]} URLs in sitemap'
    else:
        sm_type_label = "Not found"
        sm_count_detail = "N/A"

    idx_detail = f'''<table class="check-table">
        {check_row("XML Sitemap Found", "pass" if idx["sitemap_found"] else "fail", sm_type_label)}
        {check_row("Sitemap URL Count", "info" if idx["sitemap_found"] else "na", sm_count_detail)}
        {check_row("Sitemap in robots.txt", "pass" if idx["sitemap_in_robots"] else "warning", "Referenced" if idx["sitemap_in_robots"] else "Not referenced")}
        {check_row("Pages with Noindex", "pass" if idx["pages_with_noindex"]<10 else "warning", f'{idx["pages_with_noindex"]}% of crawled pages')}
        {check_row("Google Index Status", "info", idx_google_str)}
        {check_row("Pages Crawled vs Sitemap", "info", f'{idx["crawled_pages"]} crawled, {idx["sitemap_pages"] or idx["sitemap_url_count"]} site pages in sitemap')}
    </table>'''
    cat_sections += _cat_section("indexability", "Indexability & Search Visibility", scores.get("indexability"), idx_detail, recommendations)

    # Schema
    sch = findings["schema"]
    types_str = ", ".join(sch["types_found"]) if sch["types_found"] else "None detected"

    # ── Schema detail blocks — ready-to-paste JSON-LD snippets ───────────
    schema_fix_blocks = ""

    if not sch["has_organization"]:
        org_snippet = esc(f'''<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "{site_name}",
  "url": "{url}",
  "logo": {{
    "@type": "ImageObject",
    "url": "{url}images/logo.png"
  }},
  "sameAs": [
    "https://www.linkedin.com/company/YOUR-SLUG",
    "https://www.facebook.com/YOUR-PAGE"
  ],
  "contactPoint": {{
    "@type": "ContactPoint",
    "telephone": "+1-XXX-XXX-XXXX",
    "contactType": "customer service"
  }}
}}
</script>''')
        schema_fix_blocks += f'''
        <div style="margin:12px 0 6px 24px;">
          <p style="font-size:12px;font-weight:600;color:#DC2626;margin-bottom:4px;">🔴 Organization Schema — paste into your site&rsquo;s &lt;head&gt; (e.g. via Yoast &rarr; Schema &rarr; Organization, or a Custom HTML block):</p>
          <pre style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:4px;padding:10px;font-size:11px;overflow-x:auto;white-space:pre-wrap">{org_snippet}</pre>
        </div>'''

    if not sch["has_website"]:
        site_snippet = esc(f'''<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "{site_name}",
  "url": "{url}",
  "potentialAction": {{
    "@type": "SearchAction",
    "target": {{
      "@type": "EntryPoint",
      "urlTemplate": "{url}?s={{search_term_string}}"
    }},
    "query-input": "required name=search_term_string"
  }}
}}
</script>''')
        schema_fix_blocks += f'''
        <div style="margin:12px 0 6px 24px;">
          <p style="font-size:12px;font-weight:600;color:#D97706;margin-bottom:4px;">🟡 WebSite Schema — add to your homepage &lt;head&gt;. Enables Google Sitelinks Search:</p>
          <pre style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:4px;padding:10px;font-size:11px;overflow-x:auto;white-space:pre-wrap">{site_snippet}</pre>
        </div>'''

    if not sch["has_local_business"]:
        lb_snippet = esc(f'''<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "AccountingService",
  "name": "{site_name}",
  "url": "{url}",
  "telephone": "+1-XXX-XXX-XXXX",
  "address": {{
    "@type": "PostalAddress",
    "streetAddress": "123 Main St",
    "addressLocality": "Your City",
    "addressRegion": "ST",
    "postalCode": "00000",
    "addressCountry": "US"
  }},
  "openingHoursSpecification": [
    {{"@type": "OpeningHoursSpecification","dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday"],"opens": "09:00","closes": "17:00"}}
  ],
  "priceRange": "$$"
}}
</script>''')
        schema_fix_blocks += f'''
        <div style="margin:12px 0 6px 24px;">
          <p style="font-size:12px;font-weight:600;color:#D97706;margin-bottom:4px;">🟡 LocalBusiness / AccountingService Schema — add to your homepage or contact page:</p>
          <pre style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:4px;padding:10px;font-size:11px;overflow-x:auto;white-space:pre-wrap">{lb_snippet}</pre>
        </div>'''

    sch_detail = f'''<table class="check-table">
        {check_row("Organization Schema", "pass" if sch["has_organization"] else "fail", "Present" if sch["has_organization"] else "Missing — required for all sites")}
        {check_row("WebSite Schema", "pass" if sch["has_website"] else "warning", "Present" if sch["has_website"] else "Missing")}
        {check_row("BreadcrumbList Schema", "pass" if sch["has_breadcrumb"] else "warning", "Present" if sch["has_breadcrumb"] else "Missing — adds breadcrumbs in search results")}
        {check_row("LocalBusiness Schema", "pass" if sch["has_local_business"] else "warning", "Present" if sch["has_local_business"] else "Missing — important for local businesses")}
        {check_row("FAQPage Schema", "pass" if sch["has_faq"] else "info", "Present" if sch["has_faq"] else "Not found")}
        {check_row("All JSON-LD Valid", "pass" if sch["all_json_valid"] else "fail", "All valid" if sch["all_json_valid"] else "Invalid JSON detected")}
        {check_row("Pages with Schema", "pass" if sch["pct_pages_with_schema"]>=50 else "warning", pct_bar(sch["pct_pages_with_schema"]))}
    </table>
    <p class="note"><strong>Schema types found:</strong> {types_str}</p>
    {schema_fix_blocks}'''
    cat_sections += _cat_section("schema", "Schema & Structured Data", scores.get("schema"), sch_detail, recommendations)

    # AI
    ai = findings["ai_llm"]
    ai_blocked_str = ", ".join(ai["ai_crawlers_blocked"]) if ai["ai_crawlers_blocked"] else "None blocked"
    ai_detail = f'''<table class="check-table">
        {check_row("llms.txt Present", "pass" if ai["llms_txt_present"] else "warning", f'Found at {ai["llms_txt_url"]}' if ai["llms_txt_present"] else f'Not found — consider creating one at {ai["llms_txt_url"]}')}
        {check_row("AI Crawlers Not Blocked", "pass" if not ai["ai_crawlers_blocked"] else "warning", ai_blocked_str)}
        {check_row("FAQ Schema for AI", "pass" if ai["has_faq_schema"] else "warning", "Present" if ai["has_faq_schema"] else "No FAQPage schema — helps LLMs extract Q&A content")}
        {check_row("About/Identity Content", "pass" if ai["has_about_content"] else "warning", "Found" if ai["has_about_content"] else "No clear 'who we are' passage on homepage")}
        {check_row("Contact Info in Text", "pass" if ai["contact_info_in_text"] else "warning", "Found" if ai["contact_info_in_text"] else "Phone/address may be image-only — invisible to AI")}
    </table>'''
    cat_sections += _cat_section("ai_llm", "AI / LLM Readiness", scores.get("ai_llm"), ai_detail, recommendations)

    # UX
    ux = findings["ux"]
    ux_detail = f'''<table class="check-table">
        {check_row("Mobile Viewport Meta Tag", "pass" if ux["pct_has_viewport"]>=95 else "fail", pct_bar(ux["pct_has_viewport"]))}
        {check_row("Accessible Buttons (ARIA)", "pass" if ux["pct_buttons_accessible"]>=90 else "warning", pct_bar(ux["pct_buttons_accessible"]))}
        {check_row("Form Labels Present", "pass" if ux["pct_form_labels_ok"]>=90 else "warning", pct_bar(ux["pct_form_labels_ok"]))}
        {check_row("Skip Navigation Link", "pass" if ux["pct_skip_nav"]>=50 else "warning", pct_bar(ux["pct_skip_nav"]))}
        {check_row("Custom 404 Page", "pass" if ux["has_custom_404"] else "warning", "Found" if ux["has_custom_404"] else "Missing or minimal")}
    </table>'''
    cat_sections += _cat_section("ux", "UX & Accessibility", scores.get("ux"), ux_detail, recommendations)

    # Analytics
    anal = findings["analytics"]
    anal_detail = f'''<table class="check-table">
        {check_row("Google Analytics 4 (GA4)", "pass" if anal["has_ga4"] else "fail", "Detected" if anal["has_ga4"] else "Not found — critical gap")}
        {check_row("Google Tag Manager (GTM)", "pass" if anal["has_gtm"] else "warning", "Detected" if anal["has_gtm"] else "Not found")}
        {check_row("GA4 Page Coverage", "pass" if anal["ga4_page_coverage"]>=2 else "warning", f'{anal["ga4_page_coverage"]} page(s) with GA4')}
        {check_row("Meta / Facebook Pixel", "pass" if anal["has_meta_pixel"] else "warning", "Detected" if anal["has_meta_pixel"] else "Not found")}
        {check_row("LinkedIn Insight Tag", "pass" if anal["has_linkedin_pixel"] else "info", "Detected" if anal["has_linkedin_pixel"] else "Not found")}
        {check_row("Heatmap / Session Recording", "pass" if anal["has_heatmap_tool"] else "info", "Detected (Hotjar/Clarity)" if anal["has_heatmap_tool"] else "Not found")}
    </table>'''
    cat_sections += _cat_section("analytics", "Analytics & Tracking", scores.get("analytics"), anal_detail, recommendations)

    # Crawled page detail — built from page_analysis_summary (persisted in JSON)
    # Falls back to live analyzed data if running fresh (no prior JSON)
    detail_source = page_analysis_summary or []
    if not detail_source and pages and analyzed:
        for pg, an in zip(pages, analyzed):
            detail_source.append({
                "url": pg["url"],
                "status_code": pg.get("status_code", 200),
                "title": an.get("title", ""),
                "meta_desc": an.get("meta_desc", ""),
                "h1_count": len(an.get("h1_texts", [])),
                "h1_text": (an.get("h1_texts") or [""])[0][:80],
                "schema_types": an.get("schema_types", []),
                "word_count": an.get("word_count", 0),
                "og_complete": an.get("og_complete", False),
                "has_ga4": an.get("has_ga4", False),
                "issues": _page_issues(an),
            })

    def _cell_val(text, max_len, missing_label="❌ Missing"):
        """Render a text value: show actual text (truncated) or a missing badge."""
        if not text:
            return f'<span class="cell-missing">{missing_label}</span>'
        display = esc(text[:max_len]) + ("…" if len(text) > max_len else "")
        length_note = f'<span class="cell-len">({len(text)} ch)</span>'
        return f'{display} {length_note}'

    def _cell_ok(text, min_len, max_len, missing_label="❌ Missing"):
        """Render text with a length-based colour indicator."""
        if not text:
            return f'<span class="cell-missing">{missing_label}</span>'
        n = len(text)
        display = esc(text[:55]) + ("…" if len(text) > 55 else "")
        if n < min_len:
            cls = "cell-warn"
            note = f"({n} ch — too short)"
        elif n > max_len:
            cls = "cell-warn"
            note = f"({n} ch — too long)"
        else:
            cls = "cell-ok"
            note = f"({n} ch ✓)"
        return f'{display}<br><span class="{cls}">{note}</span>'

    page_rows = ""
    # Deduplicate by URL so homepage doesn't appear twice
    seen_urls = set()
    for pa in detail_source[:120]:
        u = pa.get("url", "")
        if u in seen_urls:
            continue
        seen_urls.add(u)

        status = pa.get("status_code", "—")
        status_cls = "status-ok" if status == 200 else "status-err"

        title_cell  = _cell_ok(pa.get("title",""),  30, 65, "❌ No title")
        meta_cell   = _cell_ok(pa.get("meta_desc",""), 100, 165, "❌ No meta description")

        h1_count = pa.get("h1_count", 0)
        h1_text  = pa.get("h1_text", "")
        if h1_count == 0:
            h1_cell = '<span class="cell-missing">❌ No H1</span>'
        elif h1_count > 1:
            h1_cell = f'<span class="cell-warn">{esc(h1_text[:40])}{"…" if len(h1_text)>40 else ""}<br>({h1_count} H1s — fix)</span>'
        else:
            h1_cell = f'<span class="cell-ok">{esc(h1_text[:50])}{"…" if len(h1_text)>50 else ""}</span>'

        schema_types = pa.get("schema_types", [])
        schema_cell = (", ".join(schema_types[:3]) + ("…" if len(schema_types)>3 else "")) if schema_types else '<span class="cell-missing">None</span>'

        words = pa.get("word_count", 0)
        words_cell = f'<span class="{"cell-warn" if words < 300 else "cell-ok"}">{words}</span>'

        issues = pa.get("issues", [])
        if not issues:
            issues_cell = '<span class="issue-ok">✓ Good</span>'
        else:
            tags = " ".join(f'<span class="issue-tag">{esc(i)}</span>' for i in issues)
            issues_cell = tags

        path = urlparse(u).path or "/"
        page_rows += f"""<tr>
            <td class="url-cell"><a href="{u}" target="_blank" title="{esc(u)}">{esc(path)}</a><br><span class="{status_cls}">{status}</span></td>
            <td class="detail-cell">{title_cell}</td>
            <td class="detail-cell">{meta_cell}</td>
            <td class="detail-cell">{h1_cell}</td>
            <td class="center schema-cell">{schema_cell}</td>
            <td class="center">{words_cell}</td>
            <td class="issues-cell">{issues_cell}</td>
        </tr>"""

    # Sitemap page index table — enriched with per-page issues and Google index status
    sitemap_page_entries = (sitemap or {}).get("page_entries", [])
    indexed_set = set(google_indexed_urls or [])

    # Build lookup: url → per-page analysis summary
    pa_lookup = {}
    for pa in (page_analysis_summary or []):
        pa_lookup[pa["url"].rstrip("/")] = pa
        pa_lookup[pa["url"]] = pa

    sitemap_page_rows = ""
    for entry in sitemap_page_entries:
        u = entry.get("url", "")
        lm = entry.get("lastmod", "")
        lm_display = lm[:10] if lm else "—"

        # Derive readable label from URL path
        path = urlparse(u).path.strip("/")
        if not path:
            label = "Homepage"
        else:
            parts = path.split("/")
            label = " › ".join(p.replace("-", " ").title() for p in parts if p)

        # Google index status
        u_norm = u.rstrip("/")
        if indexed_set:
            is_indexed = u_norm in indexed_set or u in indexed_set
            idx_cell = '<span class="idx-yes">✓ Indexed</span>' if is_indexed else '<span class="idx-no">✗ Not confirmed</span>'
        else:
            idx_cell = '<span class="idx-unknown">— Check GSC</span>'

        # Per-page issues
        pa = pa_lookup.get(u_norm) or pa_lookup.get(u)
        if pa:
            issues = pa.get("issues", [])
            if not issues:
                issues_cell = '<span class="issue-ok">✓ Looks good</span>'
            else:
                tags = " &nbsp;·&nbsp; ".join(f'<span class="issue-tag">{esc(i)}</span>' for i in issues)
                issues_cell = tags
        else:
            issues_cell = '<span class="issue-unknown">Not crawled in this run</span>'

        sitemap_page_rows += f"""<tr>
            <td class="url-cell"><a href="{u}" target="_blank">{esc(path or '/')}</a></td>
            <td>{esc(label)}</td>
            <td class="center">{lm_display}</td>
            <td class="center">{idx_cell}</td>
            <td>{issues_cell}</td>
        </tr>"""

        # Suggestion row — shown when title or meta description has issues
        has_title_issue = pa and any("title" in i.lower() or "no title" in i.lower() for i in (pa.get("issues") or []))
        has_meta_issue  = pa and any("meta" in i.lower() for i in (pa.get("issues") or []))
        # For not-crawled pages, generate title-only suggestion from URL/label
        title_issue_any = has_title_issue or (not pa and "title" not in (issues_cell or ""))

        if has_title_issue or has_meta_issue:
            sug_title = _suggest_title(pa, site_name) if pa else _suggest_title({"h1_text": label, "url": u}, site_name)
            sug_meta  = _suggest_meta(pa) if pa else None

            title_sug_html = ""
            meta_sug_html  = ""

            if has_title_issue:
                if sug_title:
                    t_len = len(sug_title)
                    t_ok  = "sug-len-ok" if 50 <= t_len <= 60 else "sug-len-warn"
                    title_sug_html = f'''<div class="sug-block">
                        <span class="sug-label">💡 Suggested title</span>
                        <span class="sug-text">{esc(sug_title)}</span>
                        <span class="sug-chars {t_ok}">{t_len} chars</span>
                    </div>'''
                else:
                    title_sug_html = '<div class="sug-block"><span class="sug-label">💡 Title</span> <span class="sug-na">Write a unique title based on the page H1 and brand name.</span></div>'

            if has_meta_issue:
                if sug_meta:
                    m_len = len(sug_meta)
                    m_ok  = "sug-len-ok" if 140 <= m_len <= 155 else "sug-len-warn"
                    meta_sug_html = f'''<div class="sug-block">
                        <span class="sug-label">💡 Suggested meta description</span>
                        <span class="sug-text">{esc(sug_meta)}</span>
                        <span class="sug-chars {m_ok}">{m_len} chars</span>
                    </div>'''
                else:
                    meta_sug_html = '<div class="sug-block"><span class="sug-label">💡 Meta</span> <span class="sug-na">Page not crawled in this run — increase --max-pages to generate a suggestion.</span></div>'

            if title_sug_html or meta_sug_html:
                sitemap_page_rows += f"""<tr class="sug-row">
            <td colspan="5" class="sug-cell">{title_sug_html}{meta_sug_html}</td>
        </tr>"""

    sitemap_is_index = (sitemap or {}).get("is_index", False)
    sm_page_count = len(sitemap_page_entries)
    sm_post_count = (sitemap or {}).get("posts", 0)
    confirmed_indexed = sum(
        1 for e in sitemap_page_entries
        if e.get("url","").rstrip("/") in indexed_set or e.get("url","") in indexed_set
    ) if indexed_set else None

    if sitemap_is_index:
        index_note_text = (
            f'Sitemap index detected (Yoast SEO) &mdash; {sm_page_count} site pages + {sm_post_count} blog posts. '
            f'Google follows all child sitemaps automatically.'
        )
        if confirmed_indexed is not None:
            index_note_text += f' &nbsp;<strong>{confirmed_indexed}/{sm_page_count} pages confirmed indexed by Google</strong> based on site: search results.'
    else:
        index_note_text = ""

    if sitemap_page_entries:
        sitemap_page_index_html = f"""
  <h2 class="section-title">Page Inventory</h2>
  <p style="color:var(--gray);font-size:13px;margin-bottom:16px;">{index_note_text}</p>
  <div class="table-wrap">
    <table class="page-table sitemap-inv">
      <tr>
        <th>URL Path</th>
        <th>Page</th>
        <th>Last Modified</th>
        <th>Google Indexed</th>
        <th>Issues / Notes</th>
      </tr>
      {sitemap_page_rows}
    </table>
  </div>
  <p style="color:var(--gray);font-size:12px;margin-top:8px;">
    Source: page-sitemap.xml &nbsp;&middot;&nbsp; Blog posts and taxonomy pages excluded.
    &nbsp;&middot;&nbsp; &ldquo;Not confirmed&rdquo; means the page did not appear in a site: search &mdash; verify in Google Search Console for definitive status.
  </p>
"""
    else:
        sitemap_page_index_html = ""

    # Recommendations table
    rec_rows = ""
    for r in recommendations:
        priority_badge = f'<span class="priority-{"critical" if r["priority"]=="critical" else "warning"}">{r["priority"].title()}</span>'
        effort_badge   = f'<span class="effort-{r["effort"].lower()}">{r["effort"]}</span>'
        rec_rows += f"""<tr>
            <td>{priority_badge}</td>
            <td><strong>{r['title']}</strong><br><small class="detail-text">{r['detail']}</small></td>
            <td>{r['category']}</td>
            <td>{effort_badge}</td>
        </tr>"""

    # Score dashboard cards
    dashboard_cards = ""
    for cat_key, cat_label in cat_names.items():
        s = scores.get(cat_key)
        badge = score_badge(s)
        w = int(SCORING_WEIGHTS.get(cat_key, 0) * 100)
        bar_pct = s if s is not None else 0
        bar_color = C5["green"] if (s or 0) >= 80 else (C5["yellow"] if (s or 0) >= 60 else C5["red"])
        dashboard_cards += f"""<div class="dash-card">
            <div class="dash-label">{cat_label}</div>
            <div class="dash-score">{badge}</div>
            <div class="dash-bar"><div class="dash-bar-fill" style="width:{bar_pct}%;background:{bar_color}"></div></div>
            <div class="dash-weight">Weight: {w}%</div>
        </div>"""

    logo_html = f'<img src="{logo_rev_b64}" alt="Counting Five" class="logo">' if logo_rev_b64 else '<span class="logo-text">Counting Five</span>'
    logo_footer = f'<img src="{logo_dark_b64}" alt="Counting Five" class="logo-footer">' if logo_dark_b64 else '<span>Counting Five</span>'

    critical_count = sum(1 for r in recommendations if r["priority"] == "critical")
    warning_count  = sum(1 for r in recommendations if r["priority"] == "warning")

    top_recs = recommendations[:3]
    top_recs_html = "".join(
        '<div class="top-rec"><span class="rec-priority-dot ' +
        ('red' if r['priority'] == 'critical' else 'yellow') +
        '"></span><strong>' + r["title"] + '</strong> \u2014 ' +
        (r["detail"][:100] + "\u2026" if len(r["detail"]) > 100 else r["detail"]) +
        '</div>'
        for r in top_recs
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Site Audit — {site_name} — {audit_date}</title>
<style>
  :root {{
    --dark:   {C5["dark"]};
    --accent: {C5["accent"]};
    --mid:    {C5["mid"]};
    --gray:   {C5["gray"]};
    --green:  {C5["green"]};
    --yellow: {C5["yellow"]};
    --red:    {C5["red"]};
    --light:  {C5["light"]};
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #F3F4F6; color: #1F2937; font-size: 14px; line-height: 1.6; }}
  a {{ color: var(--mid); }}

  /* Header */
  .site-header {{ background: var(--dark); padding: 16px 32px; display: flex; align-items: center; justify-content: space-between; }}
  .logo {{ height: 36px; }}
  .logo-text {{ color: white; font-size: 18px; font-weight: bold; }}
  .header-meta {{ color: #9CA3AF; font-size: 12px; text-align: right; }}
  .header-meta strong {{ color: white; }}

  /* Hero */
  .hero {{ background: linear-gradient(135deg, var(--dark) 0%, var(--mid) 100%); padding: 48px 32px; }}
  .hero-inner {{ max-width: 960px; margin: 0 auto; display: grid; grid-template-columns: auto 1fr; gap: 48px; align-items: center; }}
  .score-ring {{ width: 140px; height: 140px; border-radius: 50%; background: conic-gradient({ring_color} {overall * 3.6}deg, rgba(255,255,255,0.1) 0deg); display: flex; align-items: center; justify-content: center; position: relative; }}
  .score-ring-inner {{ width: 110px; height: 110px; border-radius: 50%; background: var(--mid); display: flex; flex-direction: column; align-items: center; justify-content: center; }}
  .score-number {{ font-size: 38px; font-weight: 900; color: {ring_color}; line-height: 1; }}
  .score-grade {{ font-size: 14px; color: #9CA3AF; margin-top: 2px; }}
  .hero-text h1 {{ font-size: 28px; color: white; font-weight: 800; }}
  .hero-text .site-url {{ color: #9CA3AF; font-size: 13px; margin-top: 4px; }}
  .hero-text .verdict {{ color: #D1D5DB; margin-top: 12px; font-size: 15px; }}
  .hero-pills {{ display: flex; gap: 12px; margin-top: 16px; flex-wrap: wrap; }}
  .pill {{ background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; }}
  .pill.red {{ background: rgba(220,38,38,0.2); border-color: rgba(220,38,38,0.4); }}
  .pill.yellow {{ background: rgba(245,158,11,0.2); border-color: rgba(245,158,11,0.4); }}
  .pill.green {{ background: rgba(16,185,129,0.2); border-color: rgba(16,185,129,0.4); }}

  /* Top findings */
  .top-findings {{ background: rgba(233,69,96,0.1); border: 1px solid rgba(233,69,96,0.3); border-radius: 8px; padding: 16px 20px; margin-top: 24px; }}
  .top-findings h3 {{ color: var(--accent); font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }}
  .top-rec {{ color: #D1D5DB; font-size: 13px; margin-bottom: 6px; display: flex; align-items: flex-start; gap: 8px; }}
  .rec-priority-dot {{ width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }}
  .rec-priority-dot.red {{ background: var(--red); }}
  .rec-priority-dot.yellow {{ background: var(--yellow); }}

  /* Layout */
  .main {{ max-width: 960px; margin: 0 auto; padding: 32px 16px; }}

  /* Section headers */
  .section-title {{ font-size: 20px; font-weight: 700; color: var(--dark); margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 2px solid var(--accent); }}

  /* Dashboard cards */
  .dashboard {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 32px; }}
  .dash-card {{ background: white; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }}
  .dash-label {{ font-size: 11px; color: var(--gray); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }}
  .dash-score {{ margin-bottom: 8px; }}
  .dash-bar {{ height: 4px; background: #E5E7EB; border-radius: 2px; margin-bottom: 6px; }}
  .dash-bar-fill {{ height: 4px; border-radius: 2px; transition: width 0.3s; }}
  .dash-weight {{ font-size: 10px; color: #9CA3AF; }}

  /* Category sections */
  .cat-section {{ background: white; border-radius: 8px; margin-bottom: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }}
  .cat-header {{ display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: var(--dark); cursor: pointer; user-select: none; }}
  .cat-header:hover {{ background: var(--mid); }}
  .cat-header h3 {{ color: white; font-size: 15px; }}
  .cat-body {{ padding: 20px; display: none; }}
  .cat-body.open {{ display: block; }}
  .cat-quick-wins {{ background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; }}
  .cat-quick-wins h4 {{ color: var(--green); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }}
  .cat-quick-wins ul {{ list-style: none; padding: 0; }}
  .cat-quick-wins li {{ font-size: 13px; color: #065F46; margin-bottom: 4px; padding-left: 16px; position: relative; }}
  .cat-quick-wins li::before {{ content: "→"; position: absolute; left: 0; color: var(--green); }}

  /* Tables */
  .check-table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
  .check-table th {{ background: var(--dark); color: white; padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }}
  .check-table tr:nth-child(even) {{ background: #F9FAFB; }}
  .check-table td {{ padding: 8px 12px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }}
  .check-label {{ font-weight: 500; width: 40%; }}
  .td-pass {{ color: var(--green); }}
  .td-warn {{ color: #92400E; }}
  .td-fail {{ color: var(--red); font-weight: 600; }}

  /* Badges */
  .badge {{ display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 4px; font-size: 13px; font-weight: 700; }}
  .badge-a {{ background: #D1FAE5; color: #065F46; }}
  .badge-b {{ background: #DBEAFE; color: #1E3A5F; }}
  .badge-c {{ background: #FEF3C7; color: #78350F; }}
  .badge-d {{ background: #FEE2E2; color: #7F1D1D; }}
  .badge-f {{ background: #FEE2E2; color: #7F1D1D; }}
  .badge-na {{ background: #F3F4F6; color: #6B7280; }}

  /* Bars */
  .bar-wrap {{ display: inline-block; width: 80px; height: 8px; background: #E5E7EB; border-radius: 4px; vertical-align: middle; margin-right: 6px; }}
  .bar-fill {{ height: 8px; border-radius: 4px; }}
  .bar-label {{ font-size: 12px; color: var(--gray); }}

  /* Priority / effort */
  .priority-critical {{ background: #FEE2E2; color: var(--red); padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; }}
  .priority-warning {{ background: #FEF3C7; color: #78350F; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; }}
  .effort-low {{ background: #D1FAE5; color: #065F46; padding: 2px 8px; border-radius: 4px; font-size: 11px; }}
  .effort-medium {{ background: #FEF3C7; color: #78350F; padding: 2px 8px; border-radius: 4px; font-size: 11px; }}
  .effort-high {{ background: #FEE2E2; color: var(--red); padding: 2px 8px; border-radius: 4px; font-size: 11px; }}

  /* Page inventory */
  .page-table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
  .page-table th {{ background: var(--dark); color: white; padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; position: sticky; top: 0; }}
  .page-table td {{ padding: 6px 10px; border-bottom: 1px solid #E5E7EB; }}
  .page-table tr:nth-child(even) {{ background: #F9FAFB; }}
  .sitemap-inv .url-cell {{ max-width: 200px; font-size: 12px; font-family: monospace; }}
  .url-cell {{ max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
  .center {{ text-align: center; }}
  .table-wrap {{ overflow-x: auto; }}
  .idx-yes {{ color: #059669; font-weight: 600; white-space: nowrap; }}
  .idx-no {{ color: #DC2626; font-weight: 500; white-space: nowrap; }}
  .idx-unknown {{ color: #9CA3AF; font-style: italic; white-space: nowrap; }}
  .issue-ok {{ color: #059669; font-weight: 500; }}
  .issue-unknown {{ color: #9CA3AF; font-style: italic; }}
  .issue-tag {{ display: inline-block; background: #FEF3C7; color: #92400E; border: 1px solid #FCD34D; border-radius: 4px; padding: 1px 6px; font-size: 11px; margin: 1px 2px 1px 0; white-space: nowrap; }}
  .detail-table td {{ vertical-align: top; padding: 7px 10px; }}
  .detail-table .detail-cell {{ font-size: 12px; line-height: 1.4; max-width: 240px; word-break: break-word; }}
  .detail-table .schema-cell {{ font-size: 11px; color: #374151; }}
  .detail-table .issues-cell {{ font-size: 11px; }}
  .cell-ok {{ color: #059669; font-size: 11px; }}
  .cell-warn {{ color: #B45309; font-size: 11px; }}
  .cell-missing {{ color: #DC2626; font-size: 11px; font-weight: 500; }}
  .cell-len {{ color: #9CA3AF; font-size: 10px; }}
  .status-ok {{ color: #059669; font-size: 10px; }}
  .status-err {{ color: #DC2626; font-size: 10px; font-weight: 600; }}
  .sug-row {{ background: #F0F9FF !important; }}
  .sug-cell {{ padding: 8px 12px 10px 20px !important; border-bottom: 2px solid #BAE6FD !important; }}
  .sug-block {{ margin-bottom: 6px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }}
  .sug-block:last-child {{ margin-bottom: 0; }}
  .sug-label {{ font-size: 11px; font-weight: 700; color: #0369A1; white-space: nowrap; min-width: 160px; }}
  .sug-text {{ font-size: 12px; color: #1E3A5F; font-style: italic; flex: 1; }}
  .sug-chars {{ font-size: 10px; font-weight: 600; white-space: nowrap; padding: 1px 5px; border-radius: 3px; }}
  .sug-len-ok {{ background: #D1FAE5; color: #065F46; }}
  .sug-len-warn {{ background: #FEF3C7; color: #92400E; }}
  .sug-na {{ font-size: 11px; color: #9CA3AF; font-style: italic; }}

  /* Recs table */
  .rec-table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
  .rec-table th {{ background: var(--dark); color: white; padding: 10px 14px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }}
  .rec-table td {{ padding: 10px 14px; border-bottom: 1px solid #E5E7EB; vertical-align: top; }}
  .rec-table tr:nth-child(even) {{ background: #F9FAFB; }}
  .detail-text {{ color: var(--gray); line-height: 1.5; }}

  /* Notes */
  .note {{ font-size: 12px; color: var(--gray); margin-top: 12px; padding: 8px 12px; background: #F9FAFB; border-left: 3px solid #E5E7EB; border-radius: 0 4px 4px 0; }}

  /* Footer */
  .site-footer {{ background: var(--dark); padding: 24px 32px; margin-top: 48px; display: flex; align-items: center; justify-content: space-between; }}
  .logo-footer {{ height: 28px; }}
  .footer-text {{ color: #6B7280; font-size: 12px; text-align: right; }}

  @media (max-width: 600px) {{
    .hero-inner {{ grid-template-columns: 1fr; gap: 24px; }}
    .score-ring {{ margin: 0 auto; }}
  }}
</style>
</head>
<body>

<header class="site-header">
  {logo_html}
  <div class="header-meta">
    <strong>Site Audit Report</strong><br>
    Generated {audit_date}
  </div>
</header>

<div class="hero">
  <div class="hero-inner">
    <div class="score-ring">
      <div class="score-ring-inner">
        <div class="score-number">{overall}</div>
        <div class="score-grade">/ 100</div>
      </div>
    </div>
    <div class="hero-text">
      <h1>{site_name}</h1>
      <div class="site-url">{url}</div>
      <div class="verdict">Overall grade: <strong style="color:{grade_color}">{overall_grade} — {overall_label}</strong> &nbsp;·&nbsp; {pages_audited} pages audited &nbsp;·&nbsp; {len(recommendations)} recommendations</div>
      <div class="hero-pills">
        <span class="pill red">🔴 {critical_count} Critical</span>
        <span class="pill yellow">🟡 {warning_count} Warnings</span>
        <span class="pill">{audit_date}</span>
      </div>
      <div class="top-findings">
        <h3>Top Findings</h3>
        {top_recs_html}
      </div>
    </div>
  </div>
</div>

<div class="main">

  <h2 class="section-title">Score Dashboard</h2>
  <div class="dashboard">
    {dashboard_cards}
  </div>

  <h2 class="section-title">Category Details</h2>
  <p style="color:var(--gray);font-size:13px;margin-bottom:16px;">Click any category to expand its findings.</p>
  {cat_sections}

  <h2 class="section-title">Recommendations</h2>
  <div class="table-wrap">
    <table class="rec-table">
      <tr><th>Priority</th><th>Recommendation</th><th>Category</th><th>Effort</th></tr>
      {rec_rows}
    </table>
  </div>

  {sitemap_page_index_html}

  <h2 class="section-title">Crawled Page Detail</h2>
  <p style="color:var(--gray);font-size:13px;margin-bottom:12px;">Per-page breakdown of title tags, meta descriptions, H1s, and other signals. Use this as your page-by-page task list — fix issues in red/amber first.</p>
  <div class="table-wrap">
    <table class="page-table detail-table">
      <tr>
        <th style="min-width:160px">Page URL</th>
        <th style="min-width:200px">Title Tag</th>
        <th style="min-width:220px">Meta Description</th>
        <th style="min-width:160px">H1</th>
        <th style="min-width:120px">Schema</th>
        <th style="width:60px">Words</th>
        <th style="min-width:200px">Issues</th>
      </tr>
      {page_rows}
    </table>
  </div>
  {'<p style="color:var(--gray);font-size:12px;margin-top:8px;">Showing first 120 pages. Full data in audit JSON.</p>' if len(detail_source) > 120 else f'<p style="color:var(--gray);font-size:12px;margin-top:8px;">{len(seen_urls)} pages shown.</p>'}

</div>

<footer class="site-footer">
  {logo_footer}
  <div class="footer-text">
    Audit generated by Counting Five &nbsp;·&nbsp; {audit_date}<br>
    {pages_audited} pages crawled &nbsp;·&nbsp; Counting Five Internal Audit v{VERSION}
  </div>
</footer>

<script>
document.querySelectorAll('.cat-header').forEach(h => {{
  h.addEventListener('click', () => {{
    const body = h.nextElementSibling;
    body.classList.toggle('open');
  }});
}});
// Auto-open first category with a failing score
document.querySelectorAll('.cat-section').forEach(sec => {{
  const badge = sec.querySelector('.badge-d, .badge-f');
  if (badge) sec.querySelector('.cat-body').classList.add('open');
}});
</script>
</body>
</html>"""

    return html


def _cat_section(cat_key, cat_label, score, detail_html, recommendations):
    badge_html = score_badge_fn(score)
    # Quick wins for this category
    cat_recs = [r for r in recommendations if r["category"].lower() in cat_label.lower() or cat_key in r.get("category","").lower()][:3]
    quick_wins = ""
    if cat_recs:
        items = "".join(f'<li>{r["title"]}</li>' for r in cat_recs[:2])
        quick_wins = f'<div class="cat-quick-wins"><h4>Quick Wins</h4><ul>{items}</ul></div>'
    return f"""<div class="cat-section">
  <div class="cat-header">
    <h3>{cat_label}</h3>
    {badge_html}
  </div>
  <div class="cat-body">
    {quick_wins}
    {detail_html}
  </div>
</div>"""

def score_badge_fn(score):
    if score is None:
        return '<span class="badge badge-na">N/A</span>'
    g, _ = get_grade(score)
    cls = {"A":"badge-a","B":"badge-b","C":"badge-c","D":"badge-d","F":"badge-f"}.get(g,"badge-na")
    return f'<span class="badge {cls}">{g}&nbsp;&nbsp;{score}</span>'


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Counting Five Internal Audit Engine")
    parser.add_argument("--url", required=False, help="URL to audit")
    parser.add_argument("--site-name", default="", help="Site/client name")
    parser.add_argument("--max-pages", type=int, default=50)
    parser.add_argument("--segments", default="", help="Customer segments to check content against")
    parser.add_argument("--logo-dark", default="", help="Path to dark logo PNG")
    parser.add_argument("--logo-rev", default="", help="Path to reversed/light logo PNG")
    parser.add_argument("--output-dir", default="reports/", help="Output directory for report files")
    parser.add_argument("--update-report", default="", help="Path to existing audit JSON to update with index data")
    parser.add_argument("--google-index-count", type=int, default=None)
    parser.add_argument("--bing-indexed", type=str, default="unknown")
    parser.add_argument("--google-indexed-urls", nargs="*", default=None,
                        help="Space-separated list of URLs confirmed indexed by Google (used in page inventory)")
    args = parser.parse_args()

    # Update-only mode
    if args.update_report:
        if not os.path.exists(args.update_report):
            print(f"ERROR: {args.update_report} not found")
            sys.exit(1)
        with open(args.update_report) as f:
            data = json.load(f)
        if args.google_index_count is not None:
            data["findings"]["indexability"]["google_index_count"] = args.google_index_count
        if args.google_indexed_urls is not None:
            data["google_indexed_urls"] = [u.rstrip("/") for u in args.google_indexed_urls]
        # Re-generate report HTML
        report_path = args.update_report.replace(".json", ".html")
        with open(args.update_report, "w") as f:
            json.dump(data, f, indent=2)
        logo_dark_b64 = logo_to_base64(data.get("logo_dark_path",""))
        logo_rev_b64  = logo_to_base64(data.get("logo_rev_path",""))
        html = render_html(
            data["domain"], data["site_name"], data["url"], data["audit_date"],
            [], [], data["scores"], data["findings"], data["recommendations"],
            logo_dark_b64, logo_rev_b64, [], data.get("sitemap"),
            data.get("page_analysis_summary"), data.get("google_indexed_urls", [])
        )
        with open(report_path, "w") as f:
            f.write(html)
        print(f"Updated: {report_path}")
        return

    if not args.url:
        print("ERROR: --url is required")
        sys.exit(1)

    url = args.url.rstrip("/")
    if not url.startswith("http"):
        url = "https://" + url

    domain = urlparse(url).netloc.replace("www.", "")
    site_name = args.site_name or domain
    audit_date = datetime.now().strftime("%Y-%m-%d")
    output_dir = args.output_dir
    os.makedirs(output_dir, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  Counting Five — Internal Audit")
    print(f"  Site: {site_name} ({url})")
    print(f"  Date: {audit_date}")
    print(f"{'='*60}\n")

    session = requests.Session()

    # Phase 1: Crawl
    print("[1/6] Crawling site...")
    pages, crawl_errors, all_urls = crawl_site(url, args.max_pages)
    if not pages:
        print("ERROR: Could not crawl any pages. Check the URL and try again.")
        sys.exit(1)

    # Phase 2: Supporting files
    print("[2/6] Fetching robots.txt, sitemap, SSL, llms.txt...")
    robots  = fetch_robots(url, session)
    sitemap = fetch_sitemap(url, session, robots.get("sitemaps"))
    ssl_res = check_ssl(url)
    llms    = fetch_llms_txt(url, session)
    print(f"  robots.txt: {'✓' if robots['present'] else '✗'} | sitemap: {'✓ (' + str(sitemap['count']) + ' URLs)' if sitemap['found'] else '✗'} | SSL: {'✓' if ssl_res['valid'] else '✗'} | llms.txt: {'✓' if llms['present'] else '✗'}")

    # Phase 3: PageSpeed Insights
    print("[3/6] Running PageSpeed Insights (mobile + desktop)...")
    psi_mobile  = check_pagespeed(url, "mobile")
    psi_desktop = check_pagespeed(url, "desktop")
    mob_score = psi_mobile.get('score', 'N/A')
    desk_score = psi_desktop.get('score', 'N/A') if psi_desktop else 'N/A'
    print(f"  Mobile: {mob_score} | Desktop: {desk_score}")

    # Phase 4: Analyze each page
    print("[4/6] Analyzing pages...")
    analyzed = []
    for i, page in enumerate(pages):
        analyzed.append(analyze_page(page))
        if (i + 1) % 10 == 0:
            print(f"  {i+1}/{len(pages)} pages analyzed")

    # Phase 5: Score
    print("[5/6] Computing scores...")
    scores, findings = compute_scores(
        pages, analyzed, robots, sitemap, ssl_res,
        psi_mobile, psi_desktop, llms, crawl_errors,
        args.google_index_count
    )
    overall = compute_overall(scores)
    overall_grade, overall_label = get_grade(overall)
    print(f"  Overall: {overall}/100 ({overall_grade} — {overall_label})")
    for cat, s in scores.items():
        if s is not None:
            g, _ = get_grade(s)
            print(f"  {cat:20s}: {s:3d} ({g})")

    recommendations = generate_recommendations(scores, findings, pages)
    print(f"  {len(recommendations)} recommendations generated ({sum(1 for r in recommendations if r['priority']=='critical')} critical)")

    # Phase 6: Generate report
    print("[6/6] Generating HTML report...")

    # Build per-page analysis summary (needed for report + JSON)
    page_analysis_summary = []
    for pg, an in zip(pages, analyzed):
        issues = _page_issues(an)
        # Build a clean content snippet for suggestion generation.
        # Strategy: anchor on the H1 text in the page body, then take the
        # paragraph text that follows it — this jumps past header/nav noise.
        raw_snippet = an.get("page_text_sample", "")
        h1_for_snippet = (an.get("h1_texts") or [""])[0].strip()
        clean_snippet = ""
        if h1_for_snippet and h1_for_snippet in raw_snippet:
            # Start reading after the H1
            post_h1 = raw_snippet[raw_snippet.index(h1_for_snippet) + len(h1_for_snippet):]
            # Strip leading whitespace / punctuation
            post_h1 = post_h1.lstrip(" .,—|-\n\r\t")
            clean_snippet = " ".join(w for w in post_h1.split() if len(w) > 1)[:600]
        if not clean_snippet:
            # Fallback: skip first 150 chars (typical header) then clean
            fallback = raw_snippet[150:]
            clean_snippet = " ".join(w for w in fallback.split() if len(w) > 1)[:600]

        page_analysis_summary.append({
            "url": pg["url"],
            "status_code": pg.get("status_code", 200),
            "title": an.get("title", ""),
            "title_ok": bool(an.get("title")),
            "title_len": len(an.get("title", "")),
            "meta_desc": an.get("meta_desc", ""),
            "meta_ok": bool(an.get("meta_desc")),
            "meta_len": len(an.get("meta_desc", "")),
            "h1_count": len(an.get("h1_texts", [])),
            "h1_text": (an.get("h1_texts") or [""])[0][:80],
            "schema_types": an.get("schema_types", []),
            "word_count": an.get("word_count", 0),
            "og_complete": an.get("og_complete", False),
            "og_title": an.get("og_title", ""),
            "og_desc": an.get("og_desc", ""),
            "og_image": an.get("og_image", ""),
            "has_ga4": an.get("has_ga4", False),
            "issues": issues,
            "content_snippet": clean_snippet,
            "mixed_content_urls": an.get("mixed_content_urls", []),
        })

    logo_dark_b64 = logo_to_base64(args.logo_dark)
    logo_rev_b64  = logo_to_base64(args.logo_rev)

    html = render_html(
        domain, site_name, url, audit_date,
        pages, analyzed, scores, findings, recommendations,
        logo_dark_b64, logo_rev_b64, crawl_errors, sitemap,
        page_analysis_summary, []   # google_indexed_urls populated via --update-report
    )

    # Clean domain for filename
    safe_domain = re.sub(r'[^a-zA-Z0-9\-]', '-', domain).strip('-')
    report_html_path = os.path.join(output_dir, f"audit-{safe_domain}-{audit_date}.html")
    report_json_path = os.path.join(output_dir, f"audit-{safe_domain}-{audit_date}.json")

    with open(report_html_path, "w", encoding="utf-8") as f:
        f.write(html)

    # Save JSON data (strip soup/html for size)
    json_data = {
        "version": VERSION,
        "domain": domain,
        "site_name": site_name,
        "url": url,
        "audit_date": audit_date,
        "max_pages": args.max_pages,
        "pages_crawled": len(pages),
        "crawl_errors": len(crawl_errors),
        "overall_score": overall,
        "overall_grade": overall_grade,
        "scores": scores,
        "findings": findings,
        "recommendations": recommendations,
        "page_analysis_summary": page_analysis_summary,
        "google_indexed_urls": [],   # populated via --update-report or manually
        "sitemap": {
            "found": sitemap.get("found"),
            "url": sitemap.get("url"),
            "is_index": sitemap.get("is_index"),
            "child_sitemaps": sitemap.get("child_sitemaps", []),
            "count": sitemap.get("count", 0),
            "pages": sitemap.get("pages", 0),
            "posts": sitemap.get("posts", 0),
            "other": sitemap.get("other", 0),
            "page_entries": sitemap.get("page_entries", []),
        },
        "logo_dark_path": args.logo_dark,
        "logo_rev_path": args.logo_rev,
    }
    with open(report_json_path, "w", encoding="utf-8") as f:
        json.dump(json_data, f, indent=2)

    print(f"\n{'='*60}")
    print(f"  AUDIT COMPLETE")
    print(f"  Score: {overall}/100 ({overall_grade} — {overall_label})")
    print(f"  Report: {report_html_path}")
    print(f"  Data:   {report_json_path}")
    print(f"{'='*60}\n")
    print(f"REPORT_PATH={report_html_path}")


if __name__ == "__main__":
    main()
