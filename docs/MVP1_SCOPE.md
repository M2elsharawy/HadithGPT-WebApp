# MVP 1 Scope Definition
# تعريف النطاق الأول للمنتج القابل للإطلاق

**Version:** 0.1 — Phase 0 Draft

---

## MVP 1 Goal

Deliver a working, safe, and legally compliant product that:
1. Lets any user check if a website is trustworthy (Layer 1).
2. Lets an admin discover prospects and generate ethical outreach (Layer 3A pre-auth).
3. Lays the security and architecture foundation for owner monitoring (Layer 2, MVP 2).

---

## IN SCOPE for MVP 1

### Core Features

| Feature | Layer | Priority |
|---------|-------|----------|
| Public URL Trust Check | 1 | P0 |
| Trust Score (0–100, color-coded) | 1 | P0 |
| Trust Report — Arabic + English | 1 | P0 |
| Usage recommendations (browse / email / account / pay) | 1 | P0 |
| URL Safety Validator (SSRF protection) | All | P0 |
| Rate limiting on public scans | All | P0 |
| Scan Policy Engine (hard gate) | All | P0 |
| Do Not Scan list enforcement | All | P0 |
| Audit logging (basic) | All | P0 |
| Admin authentication (login) | 3 | P0 |
| Admin: Add Lead domain | 3A | P0 |
| Admin: Run Lead Audit (surface only) | 3A | P0 |
| Admin: Lead Score | 3A | P0 |
| Admin: Outreach Report (non-sensitive) | 3A | P0 |
| Admin: Lead status management | 3A | P0 |
| Admin: Do Not Scan / Do Not Contact marking | 3A | P0 |
| Background job queue for scans | All | P0 |
| Arabic (RTL) + English (LTR) UI | All | P0 |
| Async scan pattern (POST scan → GET status → GET report) | All | P0 |

### Checks Implemented in MVP 1

| Check | Layer |
|-------|-------|
| HTTPS detection | 1 + 3A |
| SSL certificate validity + expiry | 1 + 3A |
| Security Headers — presence only | 1 + 3A |
| HSTS preload list check | 1 + 3A |
| DNS A record basic | 1 + 3A |
| SPF presence | 1 + 3A |
| DMARC presence | 1 + 3A |
| Reputation (Google Safe Browsing or mock) | 1 + 3A |
| Redirect safety (internal check) | 1 + 3A |

---

## OUT OF SCOPE for MVP 1

| Feature | Reason | Target Phase |
|---------|--------|-------------|
| User registration (non-admin) | Focus on admin + public first | Phase 6 |
| Domain ownership verification | Requires user accounts | Phase 7 |
| Owner Security Reports (deep) | Requires verification first | Phase 8 |
| Scheduled monitoring | Requires verified owner | Phase 9 |
| PDF export | Requires report templates | Phase 10 |
| Before/after comparison | Requires scan history | Phase 9 |
| Security alerts / email notifications | Requires monitoring | Phase 9 |
| Port scanning | Requires explicit AuthRecord | Phase 9+ |
| Crawling | Requires explicit AuthRecord | Phase 9+ |
| CMS deep scan | Requires explicit AuthRecord | Phase 9+ |
| Admin Authorized Client Scan | Requires full auth system | Phase 8+ |
| Subscription / billing / payments | Explicitly deferred | Post-MVP |
| White-label / agency accounts | Explicitly deferred | Post-MVP |
| API access / API keys for customers | Explicitly deferred | Post-MVP |
| Mobile app | Out of scope entirely | TBD |
| Webhook notifications | Post-MVP | TBD |
| Multi-factor authentication | Phase 6+ | Phase 6 |
| Executive Report PDF | Phase 10 | Phase 10 |
| Developer Remediation Report | Phase 8 | Phase 8 |
| Risk Engine (contextual severity) | Basic only in MVP 1, full in Phase 8 | Phase 8 |
| DKIM check | Phase 8 | Phase 8 |
| CAA record check | Phase 8 | Phase 8 |
| CMS detection | Phase 8 | Phase 8 |
| Exposed files check | Phase 8 only (verified owner) | Phase 8 |
| Security Score | Phase 8 | Phase 8 |
| Agency user role | Post-MVP | TBD |

---

## MVP 1 Success Criteria

1. A user can submit any URL and receive a Trust Score + Trust Report in under 30 seconds.
2. SSRF protection blocks all private/internal URL attempts.
3. Scan Policy Engine correctly blocks all non-surface checks in public/lead mode.
4. Do Not Scan list prevents any scan of blocked domains.
5. Admin can add a Lead, run a surface-only audit, and generate an Outreach Report.
6. Admin Lead Audit never reveals sensitive paths, file contents, or deep technical details.
7. All text displays correctly in Arabic (RTL) and English (LTR).
8. All scans run asynchronously — no HTTP request hangs waiting for scan completion.
9. Audit log captures every scan request with user, domain, type, timestamp, and result.
10. No API keys or secrets appear in source code, logs, or error messages.

---

## MVP 1 — Phase Mapping

| Phase | Deliverable |
|-------|------------|
| Phase 0 | Planning (this document) |
| Phase 1 | Technical Design |
| Phase 2 | Project Bootstrap |
| Phase 3 | Security Foundation (URL validator, policy engine, rate limiting) |
| Phase 4 | Public Trust Check UI + checks + Trust Report |
| Phase 5 | Admin Lead Audit + Outreach Report |
| Phase 6 | Authentication (admin only in MVP 1) |
| Phase 12 | Testing + Hardening |

Phases 7–11 are MVP 2 territory.
