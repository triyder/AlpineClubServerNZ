# Booking Search — Implementation Plan

A public, Booking.com-style search across the central lodge registry. A guest
enters dates and a guest count, filters by facilities, sees the lodges that fit,
and is sent to the lodge's own booking site to make the actual booking. This
server never takes a booking.

Status: **Phase A done** (rates, API 2.2). **Phase B done** (public `/book`
page; every lodge shows "beds available unknown" until Phase D). **Phase C**
issues filed in the booking app (#61, #62); not started. Phases D–E not
started.

---

## Decisions

| Topic | Decision |
| ----- | -------- |
| Where the page lives | A public `/book` page on this server. **Book now** redirects to the lodge's own site (`siteUrl`, the "Non-member booking page URL"). |
| Age groups | Under 5, 5–11, 12–17, 18+. **Guideline groups only**: the guest's real ages are entered on the lodge's own site when the booking is made, so there is no mapping to each club's `AgeTierSetting`. |
| Rates | **8 fields**: a winter set and a summer set, each with the four age groups. Stored as **dollars and cents** (`DECIMAL(8,2)`); display only, nothing is charged here. Shown **incl. GST**. |
| Who edits rates | An administrator can update every lodge on `/lodges`. A club can also upload rates for the lodges **it owns** through the existing lodge upload. Rates are included in the club pull. |
| Availability source | **Retrieved live from the club's booking app at search time.** The server **never stores** availability — no table, no cache. If the call answers, the number is shown; otherwise the unknown message. |
| No bookings here | This server **never makes a booking**. Guests see what is available, choose a lodge, and are **redirected** to that lodge's own booking site, where the booking is made. |
| The two URLs | **`OtherLodge.siteUrl`** (Non-member booking page URL) — where the guest is redirected by **Book now**. Every lodge has one, booking app or not. **`Club.pushUrl`** (origin only) — used by the server, never shown to a guest, to ask a booking-app club for free beds. Only lodges whose club runs the booking app have one. |
| Lodges without the booking app | Many lodges do not run AlpineClubBookingsNZ. They have no linked club (or no push URL), so no call is made; they still appear in results, and **Book now** takes the guest to their own site. |
| Availability unknown | Shown in results, sorted below lodges whose availability is known. Displays the lodge's **maximum beds** with the message **"beds available unknown"**. |
| Lodge location map | Out of scope here; a dynamic map of lodge locations is a later piece of work. |
| Filter | Uses **only the static facilities** (the yes/no columns). The free-form amenity list is shown in full when a row is expanded. |
| Lodge picture | Lodge image → otherwise the lodge logo → otherwise a stock **"No Image"** picture. |
| Privacy | The public shape never includes booking officer name/email/phone, provenance (`sourceClub`), last-updated club, or any audit field. |

---

## Phase A — Lodge rates (central server)

1. **Migration `0012_lodge_non_member_rates`** — add eight nullable
   `DECIMAL(8,2)` columns to `other_lodges`:
   `winter_rate_under5`, `winter_rate_5_to_11`, `winter_rate_12_to_17`,
   `winter_rate_adult`, and the same four for `summer_`. Prisma `Decimal`
   fields; on the API a number of dollars with at most two decimal places
   (`45.5`), or null. **Done.**
2. **Validation** in `src/lib/other-lodges.ts` — each rate is empty or
   `0.00`–`99999.99`, at most two decimal places; reject anything else with a
   `400` before writing (same pattern as the existing whole-number fields).
3. **Edit Lodge popup** (`src/components/other-lodges-panel.tsx`) — a
   "Non-member rates per night (NZD, incl. GST)" section: a 2 × 4 grid, winter
   and summer rows by the four age columns. Wire through
   `/api/admin/other-lodges` create and update.
4. **Tests** — extend `other-lodges-route.test.ts`,
   `other-lodges-detail-route.test.ts` and `other-lodges-detail.test.ts`.
5. **Club upload and pull** — add the eight rates to the upload schema of
   `POST /api/v1/other-lodges` (owner-only, as for every other field; left out
   = unchanged) and to the distributed lodge shape returned by
   `GET /api/v1/other-lodges`. This is a contract change: see Phase D.

## Phase B — Public search page (central server)

6. **Public route `/book`**, no sign-in. Add it to `PUBLIC_PAGES` in
   `src/lib/__tests__/proxy-coverage.test.ts` deliberately; link it from the
   home page.
7. **Search bar** — check-in, check-out, and four guest counters (Under 5 /
   5–11 / 12–17 / 18+), and **Search**. Validation: check-out after check-in, at
   least one guest, stay capped (e.g. 30 nights), dates not in the past. The
   search lives in the URL query so results can be bookmarked and shared.
8. **Search service** `src/lib/lodge-search.ts` — server-side query over
   `OtherLodge` with amenities, image and logo, returning a dedicated
   public-safe shape (see *Privacy* above).
9. **Matching rules** — a lodge is hidden when:
   - its total beds (`bedCapacity`) are fewer than the guests;
   - it lacks any ticked facility;
   - its availability **is known** and the free beds for the stay are fewer than
     the guests.

   Unknown availability never hides a lodge on its own.
10. **Facility filter panel** — checkboxes for the static facilities only:
    free Wi-Fi, quiet room, drying room, shared kitchen, wheelchair accessible,
    breakfast / lunch / dinner included, ski workshop area, games room, lodge
    custodian. Ticked = must have; non-matching lodges are hidden.
11. **Result row** — picture on the left (image → logo → "No Image" stock
    picture, a static file in `public/`); lodge name, cancellation period,
    double beds, single beds, total beds; availability line; **Book now** on the
    right. Disabled with a note when the lodge has no `siteUrl`.
11a. **Redirect route `/book/go/[lodgeId]`** — **Book now** points here, and
    the server answers with a redirect (`303`) to the lodge's `siteUrl`. The
    URL is looked up and re-checked (the existing `siteUrl` rules) on the
    server at the moment of the click, so the page can never send a guest to
    an address that is not the lodge's stored one; an unknown lodge or empty
    URL returns to `/book` with a message. Opens in a new tab
    (`rel="noopener noreferrer"`). The guest's dates and guest counts are
    **not** appended to the lodge's URL, since each site expects its own
    format.
12. **Expand on click** — the row expands downwards to show the full amenity
    list (names and descriptions) and the per-night rates for each age group.
    Also shows a calculated **estimated total** for the entered guests and
    nights, each night priced at its season's rate. Keyboard accessible
    (`button` + `aria-expanded`).
13. **Availability line** — "*N* beds available for your dates" when the
    booking app answered; otherwise the lodge's maximum beds with "beds
    available unknown".
14. **Rate limiting** — public search limited per IP with `checkRateLimit`.
15. **Mobile layout** — picture stacks above the details at phone width.
16. **Tests** — search service (each hiding rule, guest totals, sorting of
    unknown availability), season pricing, query validation, picture fallback,
    and that the public shape carries no private field.

### Season pricing rule

A night uses the **winter** rates from `winterSeasonStart` until
`summerSeasonStart`, and **summer** rates from `summerSeasonStart` until the
next winter start. A stay that crosses a boundary is priced night by night. If
a lodge has no season dates, or the needed rate is empty, the expanded row shows
both rate sets and no estimated total.

## Phase C — Booking app (AlpineClubBookingsNZ)

Not every lodge uses the booking app; this phase only matters for those that
do. The others show "beds available unknown". Tracked as two issues in that
repo, which follows its own issue / branch / PR process:

- [triyder/AlpineClubBookingsNZ#61](https://github.com/triyder/AlpineClubBookingsNZ/issues/61)
  — non-member rates in its Other lodges (stored as integer cents, edited for
  owned lodges, uploaded and pulled) and server API **2.2**. Without it every
  club stays paused against this server.
- [triyder/AlpineClubBookingsNZ#62](https://github.com/triyder/AlpineClubBookingsNZ/issues/62)
  — the availability endpoint below and the lodge link.

**Lodge link.** The booking app's own `Lodge` records are not the central
registry names. Each active `Lodge` gets a **Central lodge** setting chosen
from the names the club owns; a club with one active lodge that owns one name
is linked without setup.

17. **Endpoint** `GET /api/webhooks/servernz-availability?lodge=<name>&from=YYYY-MM-DD&to=YYYY-MM-DD`
    (beside the push receiver, at the push URL's origin)
    — answers `{ lodge, from, to, freeBeds }`, where `freeBeds` is the
    **minimum** free beds across every night of the stay, computed with the
    existing `src/lib/capacity.ts` (holds, whole-lodge bookings and closed
    nights included). Read-only; returns a number, never booking or member
    detail.
18. **Authentication** — no member session. The server signs
    `${timestamp}.GET ${path}?${query}` with HMAC-SHA256 and the club's push
    secret (`X-Acs-Timestamp`, `X-Acs-Signature`), the push receiver's scheme.
    The booking app refuses an unsigned, wrongly signed or stale (> 5 min)
    request. A club without the Communication Portal has no secret and shows
    "beds available unknown" — accepted.
19. **Lodge matching** — the central name is resolved through the Central
    lodge setting (above). An unknown, unowned or unlinked name is a `404`.
20. **Guards** — stay length capped (e.g. 30 nights), rate-limited, fast
    (target well under the server's timeout).
21. **Tests** — signature checks, minimum-across-nights, unknown lodge, date
    validation.

## Phase D — Live call from the server, and the contract (central server)

22. **Client** `src/lib/club-availability.ts` — for each result lodge with a
    linked club that has a push URL: take the push URL's origin, call the
    endpoint above, signed. Short timeout (about 3 s), lodges called in
    parallel with a concurrency limit, **nothing stored or cached**. Any
    failure, timeout, non-`200` or malformed answer → unknown.
23. **Address checks** — the call reuses the push-target rules (https, no
    credentials, resolved address re-checked before each call), which refuse
    private addresses. A few booking apps are reached through NPM at
    `192.168.1.101` on the LAN (most are not), so add an environment setting,
    `ALLOWED_PRIVATE_CLUB_ADDRESSES`, listing exactly the private addresses
    allowed (`192.168.1.101`). Everything else stays blocked; clubs on public
    addresses need nothing extra.
24. **Search fan-out** — one public search can trigger one call per linked
    lodge, so the public rate limit (item 14) also protects the clubs.
25. **API version 2.2** — raised in Phase A, because the rates travel in the
    lodge upload and pull (fingerprint recorded). The availability endpoint
    lives in the booking app, and the booking app release that adds it ships
    with 2.2 as well. Every club pauses until upgraded.
26. **Docs and seed** — README (data model, pages, REST API, version history),
    demo seed with sample rates.

## Phase E — Release

27. Release the booking app (2.2) and this server (2.2) together, then
    upgrade each club and confirm each has a push URL registered.
28. Enter rates and season dates for each lodge; confirm each club owns its
    lodges on `/clubs`.
29. End-to-end check against the LWTC VM: a lodge whose booking app answers,
    a lodge with no linked club, and a linked club that is switched off.

---

## Open points

- None blocking. Worth checking separately: the private-address block in
  `src/lib/push-targets.ts` may already be stopping message-board post pushes
  to the clubs behind `192.168.1.101`; the allowlist in item 23 could serve
  both.
