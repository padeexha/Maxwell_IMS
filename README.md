# Maxwell Inventory System

A Vite frontend deployed to Vercel, with Supabase Auth and PostgreSQL for hosted persistence. The existing inventory UI also runs in an explicitly selected local demo mode.

## Local development

Use Node.js 22.12+ (or 24 LTS) and npm:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open the URL printed by Vite. `VITE_DATA_MODE=demo` preserves the original `maxwell_inventory_v1` localStorage data and seeded demo. Demo records never upload to Supabase. The former Python static-server command is replaced by Vite because the app now imports bundled dependencies.

## Environment variables

| Variable | Required | Value |
| --- | --- | --- |
| `VITE_DATA_MODE` | Always | `demo` locally, `supabase` for production |
| `VITE_SUPABASE_URL` | Supabase mode | Project URL from Supabase project settings |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase mode | Supabase publishable key (legacy anon key also works) |

All `VITE_*` values are public and bundled into browser assets. **Never use a service-role key, secret key, database password, or administrator token here.** No privileged server key is needed. `.env.local` is gitignored. Vercel production builds reject demo mode; missing configuration fails the build. Changing variables requires a fresh deployment.

Hosted inventory lives only in PostgreSQL; it is held in memory while displayed. Supabase's SDK persists the authentication session in browser storage and refreshes tokens. Local printer settings remain browser preferences for the demo. Production never reads the demo inventory as a fallback when authentication or network requests fail.

## Supabase setup

1. Create a dedicated Supabase project. Run `supabase/migrations/202610290001_inventory.sql` in its SQL editor as the project owner, once. Alternatively apply the migration through your normal Supabase CLI migration workflow. It creates tables, constraints, indexes, RLS policies and the `inventory_command` function in one transaction.
2. In Authentication settings, disable public signups and anonymous sign-ins. Set the Site URL to your production Vercel/custom domain. Use a separate Supabase project for preview/testing environments.
3. In Authentication → Users, create the first confirmed email/password user. Record its UUID. Then provision its profile in the SQL editor:

```sql
insert into public.profiles (id, name, email, role)
select id, 'Your administrator name', email, 'Administrator'
from auth.users where id = 'REPLACE-WITH-AUTH-USER-UUID'::uuid;
```

4. Create other confirmed password users through the same Supabase dashboard workflow and insert their profiles with `Manager` or `Worker`. Verify the insert affected one row. Share initial credentials through your organization's secure process. There is no public self-registration, automatic first-user administrator, metadata-derived role, or automated invitation email in this slice.
5. Administrators can subsequently change another existing staff profile's role or active status from **Team & access → Edit access**. They cannot change their own access. Provisioning and password recovery are currently operator-managed; account invitation and self-service recovery UI remain follow-ups.
6. Set the three environment variables in `.env.local`, restart Vite, and sign in. The hosted database starts empty: create a product, set its value, then receive stock. There is no automatic demo-data import.

Do not manually change grants, disable RLS, or expose privileged credentials. Users without an active profile receive no inventory access even with a valid Auth session. Disabling a profile blocks subsequent database requests regardless of token lifetime. The UI may retain previously viewed data until refresh/sign-out; revocation cannot erase information already delivered to a browser.

## Server permission model

Authorization is enforced inside PostgreSQL, not by hiding frontend buttons. Authenticated users get SELECT grants under RLS and no direct table write grants. Mutations go through the constrained, security-definer `inventory_command` RPC, with an empty search path and a live profile lookup. Roles are not taken from editable user metadata or browser input.

| Capability | Administrator | Manager | Worker |
| --- | --- | --- | --- |
| View/search products, units and stock values | Yes | Yes | Yes |
| Create product / change value | Yes | No | No |
| Receive up to 100 units per batch | Yes | Yes | No |
| Sell available unit / return sold unit / flag available unit for repair | Yes | Yes | Yes |
| Complete repair | Yes | Yes | No |
| Read/export activity history | Yes | Yes | No |
| View team / change another user's access | Yes | No | No |
| Hosted printing | Not implemented | Not implemented | No |

This is one organization with a shared inventory. Workers can read product valuations; hiding confidential costs would require a separate permissioned table/view. Dashboard summaries are available to all staff; historical activity/export is restricted.

Every mutation records an actor and timestamp on the server. Stock changes lock the unit row and require its expected version. A second sale or stale operation fails; refresh before trying again. Receiving writes units and their audit records atomically. SKU uniqueness, case-insensitive non-empty serial uniqueness, valid quantities, and nonnegative values are database-enforced. Returns go directly to `Available`; repairs use `Repair` until a manager/admin completes them. The older `Returned`/`Damaged` demo labels are not new hosted states.

## Vercel deployment

1. Push this project, including `package-lock.json` and the migration, to your Git repository.
2. Import it into Vercel. Select Vite and Node.js 24.x. The checked-in `vercel.json` uses `npm run build` and serves `dist`.
3. Add the three environment variables to the Production environment with `VITE_DATA_MODE=supabase`. Configure Preview separately against a staging Supabase project (or explicitly choose demo for Preview).
4. Apply the migration and provision staff **before** deploying the UI. Deploy; set the final HTTPS URL in Supabase Authentication settings. Redeploy when changing environment variables.
5. Smoke-test using separate administrator, manager and worker accounts: sign-in/out; catalogue restrictions; receiving; code/serial lookup; sell/return/repair; refresh from another browser; CSV export restrictions; and disabled-user denial. Confirm a worker's direct RPC requests to receive or change access fail, not just that buttons are hidden.

Vercel serves static assets; Supabase serves the authenticated API/database. No Vercel API route or service-role credential is needed for this architecture. Security headers are configured in `vercel.json`.

## Validation

```sh
npm test
npm run build
```

Database tests run the actual migration in embedded PostgreSQL (PGlite), with Auth roles and `auth.uid()` simulated. They exercise RLS, direct-write denials, role escalation denial, immutable audit records, inactive/unprovisioned users, duplicate SKU/serial constraints, batch rollback, valid transitions and stale-version rejection. They do not replace a real Supabase Auth/PostgREST integration test or a concurrent multi-connection load test. Both demo and Supabase production bundles were built locally; the demo receipt dialog was checked in a browser. Production is deployed at https://maxwell-ims.vercel.app with GitHub continuous deployment from `main`. The migration is applied to Supabase project `iljvzokqxnicrzyaikkk`; RLS and anonymous/direct-write denials were checked on the hosted database. Public and anonymous signup are disabled. An administrator account is provisioned. The live login page was verified; authenticated end-to-end workflows still require user sign-in and staging validation. Preview deployments use demo mode.

## Printing

Demo mode retains `POST /print` with `{ "labels": [{ "name": "Product name", "barcode": "MSM-..." }] }` and an optional `X-Api-Key`, using your separately supplied local print service. Hosted printing is disabled, including automatic printing during receipt. A public HTTPS page and a local HTTP printer service need a secure integration; do not expose the local service publicly. Implement an authenticated job queue and a trusted local agent, with server checks limiting job creation to administrators/managers, before enabling hosted printing.

## Improvements to prioritize

1. **Before staff rollout:** deploy to staging, test real Supabase sessions with all three roles, configure backups and test restores, and add monitoring/alerts. Verify the role matrix against the business's approval rules.
2. **Printing:** secure print-job queue, local agent, retry/status tracking and actual printer testing.
3. **Account lifecycle:** administrator invitations, password reset/change, MFA, and session/device management. No browser-stored printer secrets for production.
4. **Reliability:** idempotency keys for receiving/catalogue writes. If a network failure loses the response after commit, refresh and inspect records before retrying to avoid duplicate intake. Add live updates and stale-data indicators; currently changes reload after writes or with Refresh.
5. **Scale:** move filtering, dashboard aggregations and exports to server queries. Reads currently fetch all authorized rows in 500-row pages to avoid silent truncation, but large inventories will be slow and multi-query snapshots can momentarily differ during concurrent updates.
6. **Inventory depth:** supplier/purchase documents, sales invoices, return reasons, repair history details, stock adjustments with approvals, valuation history, and multiple locations. Monthly counters summarize current unit timestamps rather than accounting-grade movement totals.
7. **Maintainability/testing:** split the original compact frontend into modules, add automated browser tests and real hosted integration tests in CI, improve scanner compatibility and accessibility, and add a strict Content Security Policy after removing remaining inline HTML/CSS.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [Vercel environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables).
