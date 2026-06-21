# Scan Policy — Allowed & Forbidden Checks per State
# سياسة الفحوصات المسموحة والممنوعة

**Version:** 0.1 — Phase 0 Draft

---

## Section 1: Check Catalog

All checks are classified by type and intrusiveness level.

| Check ID | Check Name | Intrusive? | Notes |
|----------|-----------|-----------|-------|
| C01 | HTTPS presence | No | Checks if HTTPS is used |
| C02 | SSL certificate validity | No | Certificate status and expiry |
| C03 | SSL/TLS configuration | Low | Protocol versions, cipher basics (no active probing) |
| C04 | Security Headers — basic | No | Presence/absence of main headers |
| C05 | Security Headers — detailed | Low | Header value analysis (CSP, HSTS, X-Frame, etc.) |
| C06 | HSTS preload check | No | Public preload list lookup |
| C07 | DNS — basic | No | Public DNS lookup (A, MX, NS) |
| C08 | SPF record | No | Public DNS lookup |
| C09 | DMARC record | No | Public DNS lookup |
| C10 | DKIM hints | Low | Public DNS lookup (common selectors, no probing) |
| C11 | CAA record | No | Public DNS lookup |
| C12 | Reputation check | No | Public blocklist / Safe Browsing APIs |
| C13 | CMS detection — basic | Low | Header/response-based, no deep fingerprinting |
| C14 | Exposed sensitive files | Medium | Check for known paths (no content read or storage) |
| C15 | Redirect chain safety | Low | Follow redirects, verify final destination is public |
| C16 | Port scan — minimal | High | TCP connect to common ports ONLY (requires explicit AuthRecord permission) |
| C17 | Crawl — limited | High | Follow internal links up to depth 2 (requires explicit AuthRecord permission) |
| C18 | CMS deep scan | High | Plugin/version enumeration (requires explicit AuthRecord permission) |

---

## Section 2: Policy per Layer / State

### Layer 1 — Public Trust Check (All users, all site states except S7/S8)

| Check | Allowed | Notes |
|-------|---------|-------|
| C01 HTTPS | ✅ | |
| C02 SSL validity | ✅ | |
| C03 SSL/TLS config | ❌ | Too detailed for public layer |
| C04 Security Headers basic | ✅ | Presence only — no value analysis |
| C05 Security Headers detailed | ❌ | |
| C06 HSTS preload | ✅ | Public list only |
| C07 DNS basic | ✅ | A, MX only |
| C08 SPF | ✅ | Presence only |
| C09 DMARC | ✅ | Presence only |
| C10 DKIM | ❌ | |
| C11 CAA | ❌ | |
| C12 Reputation | ✅ | Public APIs only |
| C13 CMS detection | ❌ | Do not expose CMS type to public |
| C14 Exposed files | ❌ | Strictly forbidden in public layer |
| C15 Redirect safety | ✅ | Internal safety check only — result not displayed in detail |
| C16 Port scan | ❌ | Strictly forbidden |
| C17 Crawl | ❌ | Strictly forbidden |
| C18 CMS deep scan | ❌ | Strictly forbidden |

**Trust Score inputs:** C01, C02, C04, C06, C08, C09, C12, C15

---

### Layer 2 — Verified Owner Security Check (State S4 and above)

| Check | Allowed | Notes |
|-------|---------|-------|
| C01 HTTPS | ✅ | |
| C02 SSL validity | ✅ | |
| C03 SSL/TLS config | ✅ | |
| C04 Security Headers basic | ✅ | |
| C05 Security Headers detailed | ✅ | Full CSP, HSTS, X-Frame, etc. |
| C06 HSTS preload | ✅ | |
| C07 DNS basic | ✅ | |
| C08 SPF | ✅ | Full value analysis |
| C09 DMARC | ✅ | Full policy analysis |
| C10 DKIM | ✅ | Common selectors only |
| C11 CAA | ✅ | |
| C12 Reputation | ✅ | |
| C13 CMS detection | ✅ | Basic only |
| C14 Exposed files | ✅ | Check path existence ONLY — never read or store content |
| C15 Redirect safety | ✅ | |
| C16 Port scan | ❌ | Forbidden until Phase 9+ with explicit per-scan authorization |
| C17 Crawl | ❌ | Forbidden until Phase 9+ with explicit per-scan authorization |
| C18 CMS deep scan | ❌ | Forbidden until Phase 9+ with explicit per-scan authorization |

**Security Score inputs:** C01–C15

---

### Layer 3A — Admin Lead Audit (State S1, S2)

| Check | Allowed | Notes |
|-------|---------|-------|
| C01 HTTPS | ✅ | |
| C02 SSL validity | ✅ | |
| C03 SSL/TLS config | ❌ | |
| C04 Security Headers basic | ✅ | Presence only |
| C05 Security Headers detailed | ❌ | |
| C06 HSTS preload | ✅ | |
| C07 DNS basic | ✅ | |
| C08 SPF | ✅ | Presence only |
| C09 DMARC | ✅ | Presence only |
| C10–C11 | ❌ | |
| C12 Reputation | ✅ | |
| C13 CMS detection | ❌ | Must not expose to non-owner |
| C14 Exposed files | ❌ | Strictly forbidden |
| C15 Redirect safety | ✅ | Internal only |
| C16–C18 | ❌ | Strictly forbidden |

**Lead Score inputs:** C01, C02, C04, C06, C08, C09, C12

---

### Layer 3B — Admin Authorized Client Scan (State S5/S6 + AuthRecord)

Same as Layer 2, PLUS the following are unlockable via Authorization Record:

| Check | Requires AuthRecord field |
|-------|--------------------------|
| C16 Port scan | `port_scan_allowed: true` |
| C17 Crawl | `crawl_allowed: true` |
| C18 CMS deep scan | `cms_deep_scan_allowed: true` |

---

## Section 3: Hard Prohibitions — Regardless of Role or State

The following are NEVER allowed in any mode:

- Sending attack payloads (XSS, SQLi, SSTI, etc.)
- Reading or storing content of sensitive files (`.env`, `backup.sql`, `wp-config.php`, etc.)
- Brute-force or credential stuffing
- Exploiting discovered vulnerabilities
- Accessing or storing data found in exposed files
- Scanning private/internal IP ranges
- DNS rebinding attacks
- Redirect following to internal/private addresses
- Scanning state S7 or S8 domains
- Repeated scanning of unverified/non-client domains
- Mass scanning (bulk domain scanning without explicit authorization per domain)

---

## Section 4: Scan Policy Engine Contract

The Policy Engine must answer YES/NO for every scan request before dispatch:

```
Input:
  - domain
  - scan_type (from Check Catalog)
  - requesting_user_id
  - requesting_user_role
  - site_state
  - authorization_record (if any)

Output:
  - allowed: boolean
  - reason: string (audit trail)
  - evidence_required: string[] (what must exist before YES)
```

If `allowed = false`, the scan is never dispatched. This must be a hard gate, not a soft warning.
