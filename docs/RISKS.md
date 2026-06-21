# Risks — Security, Legal & Product
# المخاطر الأمنية والقانونية والمنتجية

**Version:** 0.1 — Phase 0 Draft

---

## Category 1: Security Risks

### R1 — SSRF (Server-Side Request Forgery) — CRITICAL
**Risk:** A malicious user submits a URL pointing to an internal service (e.g., `http://169.254.169.254/`, `http://localhost/admin`) and the backend fetches it, exposing internal cloud metadata or services.  
**Mitigation:**
- URL Safety Validator is a Phase 3 hard prerequisite.
- Validate URL scheme (http/https only), resolve DNS, check resolved IP against private ranges, validate after every redirect.
- Enforce timeouts and response size limits.
- Run scan workers in isolated network contexts where possible.

### R2 — Scan Abuse / Mass Scanning
**Risk:** Attacker uses the public endpoint to DoS third-party sites through our platform, or to enumerate targets.  
**Mitigation:**
- Strict rate limiting on public endpoint (per IP, per domain per time window).
- CAPTCHAs or challenge on suspicious patterns (Phase 11).
- Queue system prevents unbounded concurrent scans.
- Audit log detects abuse patterns.

### R3 — Sensitive Data Exposure
**Risk:** Exposed files check (C14) fetches and stores contents of `.env`, `backup.sql`, etc.  
**Mitigation:**
- C14 checks for HTTP status code of known sensitive paths ONLY.
- Content is NEVER fetched, read, parsed, or stored.
- If a 200 is returned, we record "path accessible" — not the content.
- This check is locked to Verified Owner state only.

### R4 — Scan Result Information Leakage
**Risk:** Public Trust Report reveals exploitable technical details about a site the user doesn't own.  
**Mitigation:**
- Public reports show risk indicators, not vulnerability details.
- No CMS type exposed in public layer.
- No path information exposed in public layer.
- Security Reports (detailed) locked to Verified Owner.

### R5 — scan_id Enumeration
**Risk:** Predictable scan IDs allow users to access other users' reports.  
**Mitigation:**
- All scan IDs must be UUID v4 (random, non-sequential).
- Report access must verify ownership/authorization at read time, not just creation time.

### R6 — API Key Exposure
**Risk:** Reputation check API keys or email service keys exposed in source, logs, or error messages.  
**Mitigation:**
- All secrets via environment variables only.
- Error messages must not include key values.
- Keys must not appear in any logs (use key ID or masked form for logging).
- CI/CD must not print env vars.

### R7 — DNS Rebinding
**Risk:** A domain resolves to a public IP at validation time, then rebinds to a private IP at scan time.  
**Mitigation:**
- Re-validate resolved IP immediately before each HTTP request in the scan.
- Block if resolved IP is in private ranges at any point.

### R8 — Redirect to Private IP
**Risk:** A public URL redirects to `http://192.168.1.1` or `http://10.0.0.1`.  
**Mitigation:**
- Re-validate destination after every redirect.
- Hard limit: max 5 redirects.
- Block if any redirect target resolves to private/internal IP.

---

## Category 2: Legal & Compliance Risks

### R9 — Unauthorized Scanning
**Risk:** Running deeper scans on domains without owner consent could constitute unauthorized computer access under laws like CFAA (US), Computer Misuse Act (UK), or equivalent laws in other jurisdictions.  
**Mitigation:**
- Scan Policy Engine enforces scan depth based on site state.
- Lead Audit (pre-auth) is strictly surface-level (public info only).
- Deep scans require Verified Owner state or Authorization Record.
- Do Not Scan list is a hard block.
- Audit log provides legal trail of all scan authorizations.

### R10 — Data Privacy (GDPR / PDPA / local laws)
**Risk:** Storing scan results, user data, or IP addresses may trigger data protection obligations.  
**Mitigation:**
- Principle of data minimization from day one.
- No sensitive file contents stored.
- User IP stored only if legally required and disclosed in privacy policy.
- Clear data retention policy per report type.
- Data deletion on account closure.
- Privacy policy must be drafted before public launch.

### R11 — Outreach Report Misuse
**Risk:** Admin uses Outreach Report to impersonate a security researcher or misrepresent findings to pressure prospects.  
**Mitigation:**
- Outreach Report template is deliberately non-technical and non-alarmist.
- Template language is reviewed and approved before launch.
- Admin audit log captures all Outreach Report generation.

### R12 — Terms of Service Violations
**Risk:** Using Google Safe Browsing API, Shodan, VirusTotal, etc. in ways that violate their ToS.  
**Mitigation:**
- Review and comply with ToS of every third-party service before integration.
- Fall back to mock providers in development.
- Attribution where required.

---

## Category 3: Product Risks

### R13 — False Trust Scores
**Risk:** A site with hidden malware but valid SSL and good headers receives a high Trust Score, misleading users.  
**Mitigation:**
- Trust Score messaging explicitly states: "based on publicly observable security indicators."
- Trust Score is NOT a guarantee of safety.
- Disclaimer visible on all Trust Reports.

### R14 — Over-Broad Admin Permissions
**Risk:** Admin role is treated as a master key, bypassing all authorization checks.  
**Mitigation:**
- Policy Engine enforces AuthRecord requirement for deep scans even for Admins.
- Admin actions are fully logged.
- Super Admin is a separate, more restricted role for platform management.

### R15 — i18n Quality
**Risk:** Arabic translations are poor, inconsistent, or technically incorrect, damaging trust with Arabic-speaking users.  
**Mitigation:**
- All Arabic copy reviewed by a native speaker before launch.
- No auto-translation without human review for user-facing strings.
- RTL layout tested on all major browsers.

---

## Risk Priority Matrix

| Risk | Likelihood | Impact | Priority |
|------|-----------|--------|----------|
| R1 SSRF | High | Critical | P0 — Must fix in Phase 3 |
| R9 Unauthorized Scanning | High | Critical | P0 — Policy Engine in Phase 3 |
| R3 Sensitive Data Stored | Medium | Critical | P0 — Design constraint |
| R5 scan_id Enumeration | Medium | High | P0 — UUID enforced from start |
| R2 Scan Abuse | High | High | P1 — Rate limiting Phase 3 |
| R6 API Key Exposure | Medium | High | P1 — Env vars from Phase 2 |
| R7 DNS Rebinding | Low | Critical | P1 — URL validator Phase 3 |
| R8 Redirect to Private | Medium | Critical | P1 — URL validator Phase 3 |
| R4 Info Leakage | Medium | High | P1 — Report design Phase 4 |
| R10 Data Privacy | Medium | High | P1 — Architecture decision Phase 1 |
| R13 False Trust Score | High | Medium | P2 — Disclaimer in Phase 4 |
| R11 Outreach Misuse | Low | Medium | P2 — Template review Phase 5 |
| R12 ToS Violations | Low | Medium | P2 — Review before integration |
| R14 Admin Bypass | Low | Critical | P0 — Policy Engine Phase 3 |
| R15 i18n Quality | Medium | Medium | P2 — Review Phase 11 |
