# Plan: one-step club connection (server + booking app)

Status: draft for review, 2026-10-30. Covers AlpineClubServerNZ (this repo) and
AlpineClubBookingsNZ (the booking app).

## Decision: auto-approval (server item 1) — **option A chosen (2026-10-30)**

Clubs still register as PENDING. The admin approves them with one click from the
new-connection email (S1). Options B and C below are kept only as a record of
what was considered.

Approving every club the moment it registers is **not safe as written**:

- `/register` is public. Its only guards are a honeypot field and a limit of 5
  registrations per IP per hour. It already hands out an API key on the spot
  (`src/app/register/actions.ts`).
- That key only works once the club is APPROVED (`src/lib/api-auth.ts:69`). So
  today, approval is the only gate.
- Approval also gives the club the lodges it ticked at registration
  (`assignRequestedLodgesOnApproval`).

With auto-approval, an anonymous visitor could therefore:

- claim a real club's lodge and overwrite its public details (rates, booking
  officer email) on `/book`;
- post to every club's board;
- read the shared feed.

Options, from recommended to least safe:

| Option | What changes | Effect |
| --- | --- | --- |
| **A. One-click approve from the email (recommended)** | The new-connection email (item 5) carries a signed, single-use, 7-day **Approve** link (HMAC over club id and created-at, using `JOB_SECRET` or a new key). Clicking it opens a confirm page that needs an admin login. | A person stays in the loop, but approval takes about a minute instead of waiting for someone to visit `/clubs`. |
| B. Auto-approve the club, hold the lodges | The club is APPROVED on creation, but requested lodges are assigned only when an admin confirms them. | Stops lodge hijacking. Anyone can still post to the network and read the feed. |
| C. Invite codes | An admin creates a one-time code on `/clubs`. A registration that carries a valid code is approved automatically. | Fully automatic for clubs you invited. Adds a step before the club registers. |

Steps marked *(A)* are part of the chosen option.

Details of the approve link, **as built (2026-10-30)**:
- It is a plain link to `/clubs/review/<club id>`, with **no signed token and no
  new secret**. Approving needs a Manager sign-in anyway, so a signature would
  add nothing. The proxy now sends a signed-out visitor to `/login?next=…` and
  back after sign-in (`safeNextPath`: only console paths on this site).
- The link is built from `PUBLIC_BASE_URL` only, never from the request's Host
  header, which the registrant controls. Without that setting the mail has no
  link.
- Opening the page changes nothing. Approve and Reject are the same
  PENDING-guarded actions as on `/clubs`, so an old email shows the decision
  someone already made.

---

## Server (AlpineClubServerNZ)

### S1. Email on new connection, and the digest *(do first)*
- The digest **already** lists new registrations: `collectDigest` queries `club.createdAt`
  (`src/lib/admin-digest.ts:67`). Rename that section to "New clubs" and add
  contact email, location, requested lodges and notes.
- New `notifyNewClub(clubId)` in `src/lib/admin-digest.ts` (or `src/lib/club-notify.ts`):
  - It reuses `recipients()` and `sendMail()`.
  - Call it from `registerAction` and from `POST /api/v1/clubs/register` **only when `created`**.
    Honeypot hits and repeat registrations of an existing code send nothing.
  - Don't await it: a mail failure is logged and must never fail the registration.
- Everything in the email comes from an anonymous registrant, so it all goes
  through `escapeHtml` and the existing control-character stripping.
- *(A)* Add the Approve link and the route `/clubs/approve/[token]`. It needs a
  Manager login, shows a confirm button, then calls the existing `setStatus`.
- Tests: email sent once on create; nothing sent for a duplicate code or a honeypot hit;
  a mail failure doesn't fail registration; the digest section lists the new club.

### S2. Unapprove (suspend)
- Add `SUSPENDED` to `ClubStatus` (migration 0017). This keeps "we turned this
  off" separate from "we never accepted it" (`REJECTED`).
- New actions in `src/app/clubs/actions.ts`:
  - `suspendClubAction`: moves APPROVED to SUSPENDED.
  - `reapproveClubAction`: moves SUSPENDED back to APPROVED. It must **not** re-run
    the requested-lodges assignment. Both actions are guarded by the current
    status in the WHERE clause, the same way `setStatus` is.
- What stops when a club is suspended:
  - Every API call is refused with 403, because `api-auth.ts:69` already requires APPROVED.
  - No new posts are queued for it, because `enqueuePostDeliveries` already filters on status.
  - Free-bed lookups stop, because `loadAvailabilityTargets` already filters on status.
  - **Gap to fix:** `deliverOne` (`src/lib/push-delivery.ts:168`) doesn't check
    status, so deliveries already queued would still go out. Add `status`
    to the select, and mark the delivery "held" while the club is not APPROVED.
- Decide whether the club's lodges stay on public `/book` while it is suspended.
  The suggestion is to keep them, showing "?" for free beds.
- Audit `club.suspend` and `club.reapprove`. Add a SUSPENDED badge on `/clubs`.

### S3. Delete a club — **dropped (2026-10-30)**
Unapprove (S2) covers this. A one-off test club is deleted by hand with SQL.
Beware: `Post.clubId` cascades, so withdraw the club's shared posts before
deleting it.

### S4. `/clubs` layout
- In `src/app/clubs/page.tsx`, move `<ClubApiVersion>` (~line 163) into the
  `CardHeader`'s right-hand column (line 107).
- Move `<ClubLodgesSelect>` (~line 170) up to sit directly under the description.
- Check that it still fits at phone width.

---

## Booking app (AlpineClubBookingsNZ)

Follow that repo's AGENTS.md:
- hand-edit `schema.prisma`;
- add one `changelog.d` fragment per PR;
- read `docs/invariants/integrations.md` (INV-INT): keep server calls outside long
  transactions and make them idempotent.

### B1. Saving the key registers the site address
- Today `saveApiKey` (`setup/alpine-server-setup.tsx:251`) only stores the key.
  Push registration happens only inside `runMirrorSync`, on the 3-hourly cron
  (`club-post-mirror.ts:374`).
- **Bug to fix here:** `forgetServerConnectionAnswers` (`servernz-settings.ts:439`)
  doesn't delete `servernz/push_secret`. Because of that, `ensurePushRegistration`
  returns early forever after a key or address change, and the site never
  registers again. Delete the secret in the same place.
- After the credentials route saves the key, call `ensurePushRegistration()` directly,
  outside the settings lock, and return its outcome to the UI. Possible outcomes:
  - registered;
  - `NEXTAUTH_URL` is not https (poll-only);
  - club not yet approved (403): show "waiting for server approval"; the cron
    retries later;
  - error.
- Read `NEXTAUTH_URL` through `getAppBaseUrl()` instead of `process.env`.

### B2. Pull the server's lodges and link them
- Straight after B1, run `downloadOtherClubsFromServer`. Its reply carries
  `ownLodges`, which `recordOtherLodgesDownload` saves.
- Move the link-saving logic out of `api/admin/lodges/[id]/central-lodge/route.ts`
  (PUT, :145) into `src/lib/central-lodge-link.ts`. The route and the new flow then
  share one function that keeps the settings lock, the ownership check, the
  FOR UPDATE row lock, the 409 on a unique-key clash, and the audit entry.
- Outcomes:
  - **1 active local lodge, 1 owned central lodge, not linked yet:** link them
    automatically and show "Linked *X* to *Y* — change".
  - **Anything else with owned lodges** (2 or more local lodges, or 2 or more owned):
    open a Dialog, copying the pattern in `other-lodges-panel.tsx:277-307`.
    - Each local lodge gets a select of the owned central lodges, plus "Not linked".
    - The current link is preselected, otherwise the `suggestedCentralLodgeId` suggestion.
    - A central lodge already chosen for one row is greyed out in the other rows,
      because `centralLodgeId` is unique.
    - Save writes every row, then closes.
  - **No owned lodges** (club pending, or none requested): show a message, no dialog.
- Never overwrite an existing link without asking.

### B3. Edit my Lodge: rates from the Fees page on by default
- `OtherLodge.ratesFromFees` already defaults to `true` in the schema. Check that the
  form's own default for a new row (`other-lodge-form.ts:37`) matches.
- Rows someone deliberately switched off stay off.
- Gathering the fee data already happens: `syncOwnOtherLodgesFromFees` runs on save.
  It has been failing quietly with `no-local-lodge` until a central link exists,
  and B2 now creates that link. Run it once more at the end of B2 so the rates are
  filled in before the first upload.

### B4. Save, then upload straight away
- After a successful PATCH of the club's own lodge, call `uploadOtherClubsToServer`.
  - Run it outside the transaction, under `withOtherLodgesSyncClaim`.
  - Show the result in the dialog.
  - If it fails, the nightly 03:00 sync is the backstop.
- Optional: upload the same way after a season is changed, since the season
  routes already re-run the fee sync.

### B5. Setup page link
- In `alpine-server-setup.tsx:609`, beside or under "Other Clubs details", add a
  link to `/admin/lodges` with the text "View all lodge details".

---

## Order and release

1. **Server S1, S2, S4** in one PR. Their only migration adds an enum value.
2. Option A's approve link is part of S1 and ships in PR 1. It needs no new
   setting, only `PUBLIC_BASE_URL` set on production.
3. **Booking app B1–B5.** B1's 403 handling means it works whether approval is
   instant or not. No `/api/v1` response shapes change, so the API version and
   `api-contract-fingerprints.json` don't need a bump.
