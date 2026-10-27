# Security Specification — PrivacyGuard AI

## 1. Data Invariants

1. **Zero Raw PII Storage**: Firestore only stores sanitized `AuditRecord` summaries (`/users/{userId}/auditLogs/{logId}`) and non-PII `UserPreference` documents (`/users/{userId}/preferences/{prefId}`). No raw images, GPS coordinates, or uncleaned URLs are stored.
2. **Strict Owner Isolation**: A user can only read, create, update, or delete documents under `/users/{userId}/...` when `request.auth.uid == userId` AND `incoming().ownerId == request.auth.uid` AND `request.auth.token.email_verified == true`.
3. **Immutable Audit Logs**: Once an `AuditRecord` is created at `/users/{userId}/auditLogs/{logId}`, it cannot be updated (`allow update: if false;`), only read or deleted by its owner.
4. **Strict Key & Size Boundaries**: Every string field enforces explicit `.size()` and regex/enum constraints matching `firebase-blueprint.json`.
5. **Temporal Integrity**: `createdAt` on `AuditRecord` and `updatedAt` on `UserPreference` must equal `request.time`.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Unauthenticated Write**: `auth = null`, creating `/users/user_1/auditLogs/log_1` -> `PERMISSION_DENIED`
2. **Unverified Email Write**: `auth = { uid: 'user_1', token: { email_verified: false } }` -> `PERMISSION_DENIED`
3. **Cross-User Spoofing (Path Mismatch)**: `auth.uid = 'user_2'`, writing to `/users/user_1/auditLogs/log_1` -> `PERMISSION_DENIED`
4. **OwnerId Field Spoofing**: `auth.uid = 'user_1'`, writing `ownerId: 'user_2'` to `/users/user_1/auditLogs/log_1` -> `PERMISSION_DENIED`
5. **Shadow / Ghost Field Injection**: Adding `isAdmin: true` to `AuditRecord` create payload -> `PERMISSION_DENIED`
6. **Invalid ActionType Enum**: Setting `actionType: 'hack_system'` -> `PERMISSION_DENIED`
7. **Summary Oversize Payload (Denial of Wallet)**: Setting `summary` to a 5,000-character string (exceeds `maxLength: 280`) -> `PERMISSION_DENIED`
8. **Negative or Excessive Count**: Setting `itemsRemovedCount: -5` or `999999` -> `PERMISSION_DENIED`
9. **Client Timestamp Forgery**: Setting `createdAt` to a past timestamp instead of `request.time` -> `PERMISSION_DENIED`
10. **Audit Log Mutation Attempt**: Updating an existing `/users/user_1/auditLogs/log_1` document -> `PERMISSION_DENIED`
11. **Malformed Document ID Poisoning**: Creating `/users/user_1/auditLogs/bad$id!@#` -> `PERMISSION_DENIED`
12. **Preference Partial Shadow Update**: Updating `UserPreference` with an unauthorized key `role: 'superadmin'` -> `PERMISSION_DENIED`

## 3. Red Team Audit Summary

- **Shadow Update Test**: Blocked by `data.keys().hasAll(...) && data.keys().hasOnly(...)` in `isValidAuditRecord` and `isValidUserPreference`, plus `affectedKeys().hasOnly(...)` on `UserPreference` updates.
- **Email Spoofing Test**: Blocked by `isVerifiedUser()` requiring `request.auth.token.email_verified == true`.
- **PII Blanket Test**: No PII is stored; all user subcollections enforce `isOwner(userId)`.
- **Query Trust Test**: `allow list` explicitly checks `isOwner(userId) && resource.data.ownerId == request.auth.uid`.
