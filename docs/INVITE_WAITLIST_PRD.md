# Product Requirements Document (PRD): Invite & Waitlist System

> **Document Status:** Draft / Under Review  
> **Target Path:** `/docs/INVITE_WAITLIST_PRD.md`  
> **Product Area:** Authentication, Access Control, Public Launch  
> **Authors:** book(ish) Core Team  

---

## 1. Executive Summary & Problem Statement

**book(ish)** is preparing for a phased public launch. Opening registration completely to the open web poses risks to AI/Gemini compute quotas, Firestore bandwidth, and curatorial community quality. 

To govern onboarding gracefully, the application will introduce an **Invite & Waitlist System**. Unenrolled users who sign in via Google OAuth will encounter a bespoke, dignified waitlist experience rather than a generic "Access Denied" barrier. Platform administrators will manage the onboarding queue directly within the Admin Console.

---

## 2. Core User Experience & Flows

### 2.1 The Unenrolled User Experience (Waitlist Landing)

When a user signs in via Google OAuth with an email not yet present in `/appSettings/allowlist/users`:

1. **Waitlist Check:**
   - The client queries `trpc.auth.getWaitlistStatus`.
2. **State A — Not on Waitlist:**
   - Replaces the generic red "Access Denied" error with an inviting, scholarly onboarding screen consistent with the book(ish) aesthetic.
   - Displays user's Google name, avatar, and authenticated email address.
   - Primary Action: Single-click **"Request Access"** / **"Join the Waitlist"** button.
   - Secondary Action: **"Sign Out"** or **"Use another account"**.
3. **State B — Pending on Waitlist:**
   - If the email is already in the waitlist with `status: 'pending'`:
   - Screen displays a refined confirmation: *"You're on the list. We're rolling out access in small cohorts to preserve catalog quality."*
   - Displays position or submission timestamp (e.g., *"Requested on September 21, 2026"*).
   - Interactive control: **"Check Access Status"** button (re-triggers permission check without requiring sign-out/sign-in).
4. **State C — Approved (Immediate Transition):**
   - Once approved by an administrator, clicking "Check Access Status" or refreshing the page immediately grants full access and routes to `/` (Library Dashboard).
5. **State D — Declined / Waitlisted for Later Cohort:**
   - If `status: 'rejected'`, a polite message indicates that public registration is currently at capacity for this cohort, with an option to stay subscribed for future cohort drops.

---

### 2.2 The Administrator Experience (Admin Console Extension)

Within the existing Admin Dashboard (`/admin`), extend the interface with a tabbed or stacked section:

1. **Waitlist Queue Table:**
   - Displays all pending applicant entries with:
     - **User Info:** Name, Email, Profile Avatar (from Google Sign-In profile).
     - **Request Date:** Exact timestamp and relative time (*"2 hours ago"*).
     - **Status Badge:** `Pending` (amber), `Approved` (emerald), `Rejected` (slate/neutral).
2. **Administrative Actions:**
   - **Approve Button:**
     - Atomically adds user to `/appSettings/allowlist/users/{email}` with `{ role: 'user', approvedAt: now(), approvedBy: admin.email }`.
     - Updates waitlist record to `status: 'approved'`.
     - Instantly reflects in the allowlist table.
   - **Reject / Defer Button:**
     - Updates waitlist record to `status: 'rejected'`.
   - **Batch Actions:**
     - "Approve All Pending" for rapid cohort onboarding.
3. **Queue Counters & Stats:**
   - Total Pending Requests, Approved Count, Rejected Count.

---

## 3. Key Missing Considerations & Nuances ("What Else Are We Missing?")

Beyond the baseline flow, the following architectural and product nuances are critical:

### 3.1 Outbound Notifications (Email vs. In-App)
- **Constraint:** Does the app currently have an SMTP/SendGrid/Postmark transactional email service configured?
- **Phased Strategy:**
  - **Phase 1 (Zero-Dependency In-App):** Status persists in Firestore. When user revisits `bookish.app`, they see the updated status. Admin table has a "Copy Approval Link" or "Copy Welcome Text" for manual outreach.
  - **Phase 2 (Transactional Email):** Fire a background notification (via Firebase Functions or server email provider) welcoming the user once approved.

### 3.2 Rate Limiting & Anti-Spam
- Prevent automated bot submission to `joinWaitlist`.
- Require authenticated Firebase JWT (must be a valid logged-in Google account) to submit a waitlist request. This completely eliminates anonymous bot spam without needing invasive CAPTCHAs.

---

## 4. Technical Specification & Data Plane

### 4.1 Cloud Firestore Schema

In adherence to the **Unified Data Authority** invariant (`firestore.rules: allow read, write: if false;`), all waitlist mutations and queries execute through server-side tRPC procedures using the Firebase Admin SDK.

```
/appSettings
  /waitlist
    /entries/{normalizedEmail}
      - email: string (lowercase)
      - displayName: string
      - photoURL: string | null
      - status: 'pending' | 'approved' | 'rejected'
      - requestedAt: Timestamp
      - reviewedAt: Timestamp | null
      - reviewedBy: string | null (admin email)
      - notes: string | null
      - referralSource: string | null
```

### 4.2 API Contract (tRPC Routers)

Add the following procedures to `src/server/trpc/routers/auth.ts`:

1. `auth.getWaitlistStatus`:
   - **Access:** Authenticated user (Firebase JWT).
   - **Returns:** `{ status: 'not_requested' | 'pending' | 'approved' | 'rejected', entry?: WaitlistEntry }`.
2. `auth.joinWaitlist`:
   - **Access:** Authenticated user (Firebase JWT).
   - **Input:** `{ notes?: string, referralCode?: string }`.
   - **Logic:** Upserts into `/appSettings/waitlist/entries/{email}` with `status: 'pending'`.
3. `auth.listWaitlist`:
   - **Access:** Superadmin only (`isAdmin: true`).
   - **Input:** `{ status?: 'pending' | 'approved' | 'rejected' | 'all' }`.
   - **Returns:** `{ entries: WaitlistEntry[] }`.
4. `auth.reviewWaitlistEntry`:
   - **Access:** Superadmin only (`isAdmin: true`).
   - **Input:** `{ email: string, action: 'approve' | 'reject' }`.
   - **Logic:** 
     - If `approve`: creates/updates `/appSettings/allowlist/users/{email}` with `{ role: 'user' }` and sets waitlist status to `'approved'`.
     - If `reject`: sets waitlist status to `'rejected'`.

---

## 5. UI/UX Design Specifications

1. **Design System Alignment:**
   - Adhere strictly to `/docs/evergreen/01-DESIGN-SYSTEM-AND-UI.md`.
   - Typography: Manrope for all copy, headings, and labels. Playfair Display italic reserved solely for the top bar `book(ish)`.
   - Buttons: Rectilinear geometry (`rounded-lg` 8px), warm neutral colors, no glowing AI gradients or pill buttons for primary actions.
2. **Tone & Voice:**
   - Scholarly, thoughtful, and courteous.
   - Example headline: *"An intimate archive for physical and digital books."*
   - Subtitle: *"We are steadily admitting readers and collectors to ensure optimal performance and community focus."*

---

## 6. Implementation Milestones

- [x] **Milestone 1:** Server schemas, tRPC waitlist router procedures, and automated unit tests.
- [x] **Milestone 2:** User-facing Waitlist screen in `src/App.tsx` replacing the raw "Access Denied" view.
- [x] **Milestone 3:** Admin Console extension with waitlist queue table, approve/reject actions, and status indicators.
- [ ] **Milestone 4:** Email notifications and spam checks
