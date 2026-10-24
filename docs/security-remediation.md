# Security remediation workflow

Scope: findings from the 2026-10-23 static audit. Product research is separate from this remediation.

## Team

The coordinator integrates work. `architect` defines requirements and access rules, `backend` and `frontend` implement their assigned layers, and `tester` independently verifies permitted and denied scenarios. `business_analyst` researches product ideas under `docs/product/`; ideas require selection before technical implementation.

## Acceptance rules

- Group details require membership or ownership; invitation codes are owner-only. User responses never include password hashes.
- Teachers may edit and read answers only for their own tests. Published public tests and group-member tests remain usable by students.
- Lesson access preserves the existing catalog policy: publication plus the existing public/group/school/course/explicit-grant alternatives. Owners retain draft access.
- Generated tests belong to their initiator and may use only questions explicitly permitted for generation. Existing private questions are not made public implicitly.
- Tokens use current user status and role. Logout/reset/ban invalidate access to protected routes. Password changes require reauthentication.
- OTP consumption and refresh rotation are atomic. Verification routes are rate limited.
- Legacy unauthenticated Telegram account binding is disabled until a nonce-based authenticated binding flow is implemented.
- Test timing is enforced by the server. Account changes invalidate frontend cache and in-flight responses.

## Local launch

Production provider configuration fails closed. To explicitly enable local development behavior, run:

```sh
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

The local override sets `APP_ENV=development` for the backend. In this mode a configured log sender may log test OTPs; use only artificial local accounts. Do not use the local override for production.

## Verification

Use a separate PostgreSQL container and a disposable `testing_app_test` database. Tests must not use the site's running PostgreSQL database. Cover multiple teachers/students, authorized access, unauthorized object IDs, drafts, grants, cache transitions and concurrent auth requests. Report executed checks separately from source review and untested cases.
