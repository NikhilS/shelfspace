# Design Document: Richer Sharing & Permissions

## 1. Overview

This document outlines the architectural and UI design for implementing a robust, fail-closed sharing model. The system will introduce:

1. **App-Level Global Allowlist**: A strict gatekeeper restricting application access to approved users only.
2. **Library-Level Roles**: Fine-grained Access Control with `owner`, `editor`, and `viewer` roles per library.
3. **Strict Google Sign-In**: Enforcing verified Google Authentication as the only entry point.

---

## 2. Global Allowlist & Strict Authentication

### Strict Google Sign-In

- **Implementation**: The existing Firebase Auth integration will strictly use `signInWithPopup(auth, new GoogleAuthProvider())`.
- **Enforcement**: Anonymous auth and email/password will be disabled. We will enforce `request.auth.token.email_verified == true` in Firestore rules to prevent email spoofing attacks.

### Global Allowlist Architecture

To ensure the app-level allowlist is not brittle and doesn't require updating every single component:

1. **Firestore Structure**:
   - A top-level collection: `/appSettings/allowlist/users/{email}`.
2. **Context-Level Gatekeeper (Fail-Closed UI)**:
   - Within `AuthContext.tsx`, after a user successfully logs in via Google, we query the allowlist collection for their email.
   - If the email is missing, `AuthContext` provides a generic `Not Authorized` state. The router will _only_ render an "Access Denied" screen.
   - **Why this works**: By blocking access at the foundational `AuthContext` provider layer, no child components are ever mounted. We don't need to add permission checks to new components because they simply won't render if the user is not allowed.
3. **Firestore Rules Gatekeeper (Fail-Closed Data)**:
   - We will define a global function in `firestore.rules`:
     `function isAppAllowed() { return exists(/databases/$(database)/documents/appSettings/allowlist/users/$(request.auth.token.email)); }`
   - Every single rule will require `isAppAllowed()`. This means even if a user bypasses the UI, they cannot read or write any data.

---

## 3. Library-Level Roles: Editor vs. Viewer

### Clean & Extensible Architecture

We will implement an Attribute-Based Access Control (ABAC) matrix that separates **Identity** (Who you are) from **Permissions** (What you can do).

1. **Data Model (`Library` Document)**:
   Instead of a simple `userId`, the library will store an `access` map:

   ```json
   {
     "access": {
       "user_uid_1": "owner",
       "user_uid_2": "editor",
       "user_uid_3": "viewer"
     }
   }
   ```

2. **React Access Hooks (`useLibraryAccess`)**:
   We will create a centralized hook that parses the user's role and returns boolean flags for capabilities.

   ```typescript
   const {canEdit, canDelete, isOwner} = useLibraryAccess(libraryId);
   ```

3. **Fail-Closed Default Routing**:
   - We will introduce a `<RequireLibraryPermission />` wrapper component for routing.
   - **Crucial**: This wrapper will default to requiring the highest permission (e.g., `owner` or `editor`) unless explicitly downgraded for a specific route. For example, if a developer adds a new `/library/:id/massive-delete` route and forgets to specify a permission, it defaults to blocking the action.

### Categorization of Operations

| Feature/Action                      | Operation Type | Minimum Role Required | Notes                          |
| :---------------------------------- | :------------: | :-------------------- | :----------------------------- |
| **View Library Overview**           |      Read      | `viewer`              | See stats and recent books.    |
| **View Books List / Grid**          |      Read      | `viewer`              | Browse the collection.         |
| **View Book Details**               |      Read      | `viewer`              | See synopsis, cover, metadata. |
| **Read Reviews**                    |      Read      | `viewer`              | Read existing reviews.         |
| **View Constellation Map**          |      Read      | `viewer`              | Explore AI groupings.          |
| **Add a Book (Manual/Scan/Search)** |     Write      | `editor`              | Appends to collection.         |
| **Edit Book Details**               |     Write      | `editor`              | Modifies existing document.    |
| **Delete a Book**                   |     Write      | `editor`              | Removes from collection.       |
| **Write/Delete a Review**           |     Write      | `editor`              | Modifies book sub-collections. |
| **Spruce Up (AI Genre/Metadata)**   |     Write      | `editor`              | Performs batch writes/updates. |
| **Change Library Settings**         |     Write      | `editor`              | Renames library, changes icon. |
| **Manage Access / Share**           |     Write      | `owner`               | Modifies the `access` map.     |
| **Delete Entire Library**           |     Write      | `owner`               | Destroys the library.          |

### Handling New Functionality

To ensure future features don't leak permissions:

1. **UI Layer**: All new write-action buttons (Save, Delete, Sync) must be wrapped in a `<Gate requires="editor">` component. If the gate is omitted by mistake, the code reviewer (human or AI) checks the routing layer.
2. **Database Layer (The Ultimate Safety Net)**: Firestore rules are designed with the "Action-Based Update Pattern" (as specified in our backend standards). Every write action must explicitly match an allowed payload shape and verify the user's role via `get()` or `existing()`. If a new feature requires modifying a new field, it will inherently fail unless explicitly allowed in the rules.

---

## 4. Proposed User Interface (UI)

### 1. Global Allowlist UI (Admin only)

- **App Settings Dashboard**: A hidden route (accessible only to "App Admins" defined in Firestore) featuring a simple data table to add/remove email addresses from the global allowlist.
- **Unauthorized Screen**: A polite, branded "Access Request" screen for unauthorized Google accounts: _"It looks like you don't have access to this application yet. Please contact the administrator."_

### 2. Library Access Management (The "Share" Button)

- **Entry Point**: A prominent "Share" button next to "Settings" in the Library Header.
- **Modal Design**:
  - **Top Section (Invite)**: An input field for "Email address" and a dropdown for Role (`Editor`, `Viewer`). A "Send Invite" button.
  - **Middle Section (Current Access)**: A list of current members. Each row shows the user's avatar, name/email, and a dropdown to change their role.
  - **Owner Constraint**: The 'Owner' role is shown as a static badge for the creator. An owner cannot be removed by an editor. Only the owner can remove editors/viewers.
- **Visual Cues for Viewers**:
  - If a user is a `viewer`, all "Add Book", "Edit", "Spruce Up", and "Settings" buttons will completely disappear (rather than just being grayed out, to reduce UI clutter).
  - A subtle "Read-Only Viewer" badge will sit in the top navigation bar to remind them of their context.
