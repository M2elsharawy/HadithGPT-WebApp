# Permissions Table
# جدول الصلاحيات والأدوار

**Version:** 0.1 — Phase 0 Draft

---

## Role × Feature Matrix

Legend:
- ✅ Allowed
- ❌ Forbidden
- 🔐 Requires Authorization Record
- 🏷️ Requires Ownership Verification
- 👤 Requires Authentication

| Feature / Action | Guest (U1) | Free User (U2) | Verified Owner (U3) | Agency User (U4) | Admin (U5) | Super Admin (U6) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Public Trust Check** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Public Trust Check — rate limited | ✅ (strict) | ✅ (relaxed) | ✅ (relaxed) | ✅ (relaxed) | ✅ | ✅ |
| View Trust Report | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Account & Domain Management** | | | | | | |
| Register account | ✅ | — | — | — | — | — |
| Add domain | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Verify domain ownership | ❌ | ✅ | — | ✅ | ✅ | ✅ |
| **Security Monitoring (Owner)** | | | | | | |
| Run deep security scan | ❌ | ❌ | 🏷️ own domains only | 🔐 authorized domains only | 🔐 | 🔐 |
| View Security Report | ❌ | ❌ | 🏷️ own domains only | 🔐 | 🔐 | 🔐 |
| View Executive Report | ❌ | ❌ | 🏷️ | 🔐 | 🔐 | 🔐 |
| View Developer Report | ❌ | ❌ | 🏷️ | 🔐 | 🔐 | 🔐 |
| Configure monitoring schedule | ❌ | ❌ | 🏷️ | 🔐 | 🔐 | 🔐 |
| Receive security alerts | ❌ | ❌ | 🏷️ | 🔐 | 🔐 | 🔐 |
| Export PDF report | ❌ | ❌ | 🏷️ | 🔐 | 🔐 | 🔐 |
| Before/after comparison | ❌ | ❌ | 🏷️ | 🔐 | 🔐 | 🔐 |
| **Admin — Lead Management** | | | | | | |
| View Leads list | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Add Lead domain | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Run Lead Audit (surface only) | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| View Lead Score | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Generate Outreach Report | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Generate Outreach Message | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Update Lead status | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Mark domain as Do Not Scan | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Admin — Client Management** | | | | | | |
| View Authorization Records | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Create Authorization Record | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Run Deep Scan on Active Client | ❌ | ❌ | ❌ | ❌ | 🔐 | 🔐 |
| Run port scan (if permitted in AuthRecord) | ❌ | ❌ | ❌ | ❌ | 🔐 | 🔐 |
| Run crawl (if permitted in AuthRecord) | ❌ | ❌ | ❌ | ❌ | 🔐 | 🔐 |
| **Platform Administration** | | | | | | |
| View Audit Logs | ❌ | ❌ | ❌ | ❌ | ✅ (own clients) | ✅ (all) |
| Manage Do Not Scan list | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Manage Users | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Manage Scan Policies | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| View all scans platform-wide | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## Critical Authorization Rule

```
Admin Role alone ≠ Deep Scan Permission

Admin Role + Valid Authorization Record for that domain = Deep Scan Allowed
```

This rule must be enforced programmatically by the Scan Policy Engine, not just documented.

---

## Authorization Record Required Fields

When an Admin creates an Authorization Record, it must contain:

| Field | Required | Description |
|-------|----------|-------------|
| client_name | ✅ | Client or organization name |
| client_email | ✅ | Primary contact email |
| authorized_domains | ✅ | List of domains covered (no wildcards unless explicit) |
| authorized_by | ✅ | Admin user ID who created the record |
| authorization_date | ✅ | Date authorization was granted |
| expiry_date | ✅ | Mandatory expiry — no indefinite authorizations |
| scan_types_allowed | ✅ | Explicit list: headers, ssl, dns, reputation, exposed_files, etc. |
| port_scan_allowed | ✅ | Boolean — default false |
| crawl_allowed | ✅ | Boolean — default false |
| cms_deep_scan_allowed | ✅ | Boolean — default false |
| scheduled_reports_allowed | ✅ | Boolean — default false |
| alerts_allowed | ✅ | Boolean — default false |
| consent_document_ref | ⚠️ Recommended | Reference to signed agreement or upload |
| notes | Optional | Free text |
