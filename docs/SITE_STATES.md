# Site States
# جدول حالات الموقع داخل النظام

**Version:** 0.1 — Phase 0 Draft

---

## State Definitions

| State ID | State Name | Arabic | Who Sets It | Description |
|----------|-----------|--------|-------------|-------------|
| S0 | `PUBLIC_CHECK` | فحص عام | System (auto) | Domain was checked via public endpoint — no account relationship |
| S1 | `LEAD` | عميل محتمل | Admin | Admin added domain as a prospect |
| S2 | `CONTACTED` | تم التواصل | Admin | Admin sent outreach message |
| S3 | `PERMISSION_REQUESTED` | طلب إذن مرسل | Admin | Formal permission request was sent to domain owner |
| S4 | `VERIFIED_OWNER` | مالك موثق | System (after verification) | User proved domain ownership via DNS/file/meta |
| S5 | `ACTIVE_CLIENT` | عميل نشط | Admin | Domain owner agreed to monitoring — Authorization Record created |
| S6 | `MONITORING_ENABLED` | مراقبة مفعّلة | System / Admin | Scheduled scans are active |
| S7 | `REJECTED` | مرفوض | Admin / System | Owner explicitly opted out or consent expired |
| S8 | `DO_NOT_SCAN` | ممنوع الفحص | Super Admin | Hard block — no scan of any type allowed, ever |

---

## State Transition Diagram

```
[URL submitted publicly]
        ↓
    PUBLIC_CHECK (S0)
        |
        | Admin adds as prospect
        ↓
      LEAD (S1)
        |
        | Admin sends outreach
        ↓
   CONTACTED (S2)
        |
        | Admin sends formal permission request
        ↓
PERMISSION_REQUESTED (S3)
        |
        | Owner verifies via DNS/file/meta
        ↓
  VERIFIED_OWNER (S4)   ←── User self-registers and verifies
        |
        | Admin creates Authorization Record
        ↓
  ACTIVE_CLIENT (S5)
        |
        | Monitoring configured
        ↓
MONITORING_ENABLED (S6)
        |
        | Owner opts out / consent expires
        ↓
    REJECTED (S7)
        |
        | Super Admin hard-blocks
        ↓
  DO_NOT_SCAN (S8) ← (also reachable directly from any state)
```

---

## Allowed Scan Depth per State

| State | Public Trust Check | Lead Audit (surface) | Owner Security Scan (deep) | Scheduled Monitoring | Deep Scan with AuthRecord |
|-------|--------------------|----------------------|---------------------------|---------------------|--------------------------|
| S0 PUBLIC_CHECK | ✅ once (rate limited) | ❌ | ❌ | ❌ | ❌ |
| S1 LEAD | ✅ (rate limited) | ✅ (surface only) | ❌ | ❌ | ❌ |
| S2 CONTACTED | ✅ (rate limited) | ✅ (surface only) | ❌ | ❌ | ❌ |
| S3 PERMISSION_REQUESTED | ✅ (rate limited) | ❌ | ❌ | ❌ | ❌ |
| S4 VERIFIED_OWNER | ✅ | ❌ (not needed) | ✅ | ❌ | ❌ (need S5) |
| S5 ACTIVE_CLIENT | ✅ | ❌ | ✅ | ✅ | 🔐 if AuthRecord permits |
| S6 MONITORING_ENABLED | ✅ | ❌ | ✅ | ✅ | 🔐 if AuthRecord permits |
| S7 REJECTED | ❌ | ❌ | ❌ | ❌ | ❌ |
| S8 DO_NOT_SCAN | ❌ | ❌ | ❌ | ❌ | ❌ |

Note: States S7 and S8 must be enforced at the Policy Engine level before any scan is dispatched.

---

## State Storage Requirements

Each domain record in the database must store:
- `state` (current state ID)
- `state_history` (array of state transitions with timestamp + actor)
- `authorization_record_id` (FK, nullable — required for S5/S6 deep scans)
- `do_not_scan_set_by` (if S8, who set it and when)
- `do_not_scan_reason` (if S8)
- `verified_at` (if S4+)
- `verification_method` (dns_txt / html_file / meta_tag)
