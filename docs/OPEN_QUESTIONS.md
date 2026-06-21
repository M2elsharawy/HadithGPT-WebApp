# Open Questions — Awaiting Owner Decisions
# أسئلة تحتاج قراراتك قبل الانتقال إلى المرحلة 1

**Version:** 0.1 — Phase 0 Draft  
**Status:** Blocking Phase 1

---

## Q1 — Tech Stack Choice [BLOCKING]

**Context:** The current repo uses a Node.js/TypeScript stack (Vite, likely Express or similar) with Drizzle ORM and PostgreSQL.

**Question:** Do you want to:

**Option A — Build inside the existing repo** using the same Node.js/TypeScript stack (Next.js or separate Vite frontend + Node/Express or NestJS backend)?

**Option B — Start a clean new project** (different folder or fresh repo) with the full recommended stack (Next.js + FastAPI backend + PostgreSQL + Redis + Celery workers)?

**Option C — Build within this repo** but replace/repurpose the existing code entirely?

**My recommendation:** Option A (Node.js full-stack, Next.js + NestJS) to reuse the existing Drizzle/PostgreSQL setup and stay in one language. FastAPI would add Python complexity unless you prefer Python for the backend.

**Decision needed:** Which option?

---

## Q2 — Backend Framework [BLOCKING if Option A chosen]

**Options:**
- **NestJS** — structured, scalable, TypeScript-native, good for large APIs
- **Express/Hono** — simpler, faster to start, less opinionated
- **Keep existing server structure** — if the current repo already has a backend

**My recommendation:** NestJS for a production-grade multi-layer platform with RBAC.

---

## Q3 — Queue / Worker System [BLOCKING for Phase 3+]

**Options:**
- **BullMQ** (Redis-based, Node.js) — most common in Node.js ecosystems
- **Inngest** — managed job queue, easier to set up
- **pg-boss** — PostgreSQL-based, no Redis needed
- **Celery + Redis** — only if using Python backend

**My recommendation:** BullMQ + Redis — battle-tested, good monitoring UI (Bull Board), works well with NestJS.

**Decision needed:** Do you have Redis available in your deployment environment? Or do you prefer a PostgreSQL-only approach (pg-boss)?

---

## Q4 — Deployment Target [IMPORTANT for Phase 2 architecture]

**Options:**
- **Vercel** (frontend) + **Railway / Render** (backend + Redis + PostgreSQL)
- **Single VPS** (DigitalOcean, Hetzner) with Docker Compose
- **AWS / GCP / Azure** (ECS, Cloud Run, etc.)
- **Something else**

The current repo has a `vercel.json` — suggests Vercel is the current target.

**Decision needed:** Where will this run in production? This affects whether Docker Compose makes sense for Phase 2.

---

## Q5 — Reputation Check APIs [IMPORTANT for Phase 4]

For Trust Score and Lead Score, we need reputation data. Options:

| Provider | Free Tier | Requires Key | Notes |
|----------|-----------|-------------|-------|
| Google Safe Browsing API | Yes (1M req/day) | Yes (free) | Best coverage |
| VirusTotal | Yes (limited) | Yes (free) | Good for domain reputation |
| URLhaus (Abuse.ch) | Yes | No | Malware URLs |
| AbuseIPDB | Yes | Yes (free) | IP reputation |
| IPQS | Limited | Yes | Paid for full features |

**Question:** Do you have or can you get a Google Safe Browsing API key? It's free and requires a Google account.

For MVP 1, I'll build with mock providers if no keys are available, with a plug-in interface for real APIs.

---

## Q6 — Email Service for Admin Alerts [NOT blocking for MVP 1, but needed for Phase 9]

Options: SendGrid, Resend, Mailgun, AWS SES, SMTP.

**Question:** Do you have a preferred email service provider? Or should we design for a generic SMTP interface and decide later?

---

## Q7 — Arabic Translation Strategy [IMPORTANT for Phase 4]

**Question:** For all Arabic UI text:
- Will you write the Arabic strings yourself?
- Should I write Arabic copy and you review/correct it?
- Do you have a preferred Arabic translation reviewer?

This is important because machine-translated Arabic security terminology can be misleading or inaccurate.

---

## Q8 — Public Scan Rate Limits [Design decision]

For the public endpoint (no login required), suggested limits:

- Per IP: max 5 scans per hour, max 20 per day
- Per domain: max 3 scans per IP per day (prevent targeting)
- Total platform: configurable cap

**Question:** Are these limits acceptable? Or do you want stricter / more lenient limits?

---

## Q9 — Do Not Scan List Seeding [Legal protection]

**Question:** Should the Do Not Scan list be pre-seeded with:
- Government domains (gov.*)
- Banking domains
- Healthcare domains
- Major tech companies

Or start empty and grow as needed?

**My recommendation:** Pre-seed with government and critical infrastructure domains in your target market. This reduces legal risk.

---

## Q10 — Existing Codebase

**Question:** The current repo appears to be a different project ("معالج الصوت الذكي" — audio processor). Should this new project:

**Option A:** Be built inside this repo (replacing or alongside existing code)?  
**Option B:** Be built in a new separate folder structure within this repo?  
**Option C:** Should I proceed ignoring the existing project entirely and treat this as a fresh start in this repo?

---

## Summary — Blocking Questions for Phase 1

| # | Question | Why Blocking |
|---|---------|-------------|
| Q1 | Tech stack (existing repo vs new) | Determines entire architecture |
| Q2 | Backend framework | Determines project structure |
| Q3 | Queue system (BullMQ vs pg-boss) | Determines infra requirements |
| Q4 | Deployment target | Affects Phase 2 setup |
| Q10 | What to do with existing code | Determines Phase 2 approach |

| # | Question | Can Proceed Without |
|---|---------|---------------------|
| Q5 | Reputation API keys | Yes — mock providers for MVP 1 |
| Q6 | Email service | Yes — not needed until Phase 9 |
| Q7 | Arabic translation | Yes — placeholder strings OK for Phase 2–3 |
| Q8 | Rate limit numbers | Yes — use suggested defaults |
| Q9 | Do Not Scan seeding | Yes — start empty |
