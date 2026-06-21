# Product Requirements Document (PRD)
# Website Trust & Security Advisor — مساعد تقييم أمان وموثوقية المواقع

**Version:** 0.1 — Phase 0 Draft  
**Date:** 2026-06-21  
**Status:** Awaiting Owner Approval Before Phase 1

---

## 1. Product Overview

### 1.1 Product Name
- **English:** Website Trust & Security Advisor
- **Arabic:** مساعد تقييم أمان وموثوقية المواقع

### 1.2 One-Line Description
A multi-layer platform that evaluates website security and trustworthiness — protecting everyday users, empowering site owners with actionable security reports, and giving admins a compliant outreach engine.

### 1.3 Core Problem Being Solved
| Persona | Problem |
|---------|---------|
| Regular user | "Is this site safe to enter my credit card / email / password?" |
| Site owner | "What security issues does my site have and how do I fix them?" |
| Security agency / admin | "How do I find prospects with security gaps and convert them into clients ethically?" |

### 1.4 What This Product Is NOT
- NOT a penetration testing tool.
- NOT an automated attack/exploitation platform.
- NOT a vulnerability scanner that runs without authorization.
- NOT a mass-scanning or DoS tool.
- NOT a credential cracker, brute-forcer, or fuzzer.

---

## 2. Product Layers

### Layer 1 — Public Free Trust Check
**Audience:** Any anonymous or registered user  
**Trigger:** User submits a URL  
**Authorization required:** None (public endpoint)  
**Depth:** Surface-level, non-intrusive checks only  
**Goal:** Help users decide whether to browse, register, pay, or share data on a site  

### Layer 2 — Verified Owner Security Monitoring
**Audience:** Verified site owner or authorized agency  
**Trigger:** User adds a domain and completes ownership verification  
**Authorization required:** Proof of ownership (DNS TXT / HTML file / meta tag)  
**Depth:** Deeper but non-exploitative security checks  
**Goal:** Continuous security posture monitoring + actionable reports + alerts  

### Layer 3 — Admin Lead Audit & Client Scan
**Audience:** Platform admin  
**Trigger A (pre-auth):** Admin adds a domain as a Lead  
**Trigger B (post-auth):** Domain is an Active Client with a valid Authorization Record  
**Authorization required:**  
  - Pre-auth: surface checks only (same depth as Public or slightly more)  
  - Post-auth: Authorization Record mandatory, stored, audited  
**Goal:** Ethical lead discovery + compliant client scanning  

---

## 3. User Types

| ID | Role | Description |
|----|------|-------------|
| U1 | Guest | Unauthenticated visitor |
| U2 | Free User | Registered but unverified owner |
| U3 | Verified Owner | Completed domain ownership verification |
| U4 | Agency User | Verified user acting on behalf of a client with authorization |
| U5 | Admin | Platform operator — Lead management, client management |
| U6 | Super Admin | Full platform control, audit access, policy management |

---

## 4. Score Types

| Score | Audience | Measures |
|-------|----------|---------|
| **Trust Score** | End user (Layer 1) | Is this site safe to use? (browse / email / account / pay) |
| **Security Score** | Site owner (Layer 2) | Strength of security configuration, issue severity, progress |
| **Lead Score** | Admin only (Layer 3 pre-auth) | Commercial opportunity signal — NOT a security audit |

These scores must never be mixed or displayed to the wrong audience.

---

## 5. Report Types

| Report | Audience | Sensitive Details? |
|--------|----------|-------------------|
| Trust Report | End user | No — general risk indicators only |
| Security Report | Site owner | Yes — technical details, no secrets/exploits |
| Executive Report | Non-technical decision maker | No deep technical details |
| Developer Remediation Report | Developer | Technical, actionable, no secrets |
| Outreach Report | Admin (pre-authorization) | Non-sensitive surface overview only |

---

## 6. Key Technical Constraints

- All scans run as background jobs (queue/worker pattern), never as synchronous HTTP requests.
- `scan_id` must be a non-guessable UUID (v4 or v7).
- URL Safety Validator (SSRF protection) is a hard prerequisite for any scan.
- Scan Policy Engine enforces per-site-state scan permissions programmatically.
- No API keys in source code — environment variables only.
- No sensitive file contents stored, ever.
- Rate limiting applied at all scan entry points.
- Audit log for all scan requests (who, what domain, what type, result, timestamp).

---

## 7. Languages & Accessibility
- Arabic (RTL) and English (LTR) — both as first-class citizens.
- All user-facing text translated (no partial translation).
- Adequate color contrast (WCAG AA minimum).
- Accessible error, loading, empty, and failure states.

---

## 8. Monetization (Out of Scope for MVP 1)
- Subscription tiers, payments, and billing are explicitly excluded from MVP 1.
- White-label / Agency accounts are excluded from MVP 1.
- The product must be designed with these in mind architecturally but not implemented.
