# Verification Guide — Demo Sandboxes & Private Championships

Covers the July 2026 changes: per-client demo sandboxes (`/platform/demos`), personalized seeding,
Reset/Delete, and the championship public/private visibility option.

**You need:** a super-admin login (e.g. `admin@sportagon.in`), the web app running, and a second
browser (or incognito window) for client-side checks. Use a throwaway client name like **"Zudio"**
so cleanup is obvious.

## Part 1 — Create a demo sandbox

1. Log in as super admin. If you land in the normal workspace, switch to the **System** role
   (role switcher in the sidebar).
2. In the sidebar under **Platform**, click **Demo Sandboxes** → **New sandbox**.
3. Type client name **Zudio** and verify the form personalizes itself live:
   - Expand "Participating organizations" → names like *Zudio Institute of Technology*,
     *Zudio Motors*, *Zudio Public School* are pre-filled.
   - **Sports** is a tap-tile grid (icons + names, ✓ when selected) — same UI as championship
     setup, not checkboxes. Defaults are pre-selected; you can pick from 1 to 30.
   - Pick a **brand colour**, add 1–2 **familiar names** (e.g. `Ratan Mehta`), leave
     **Visibility = Public** and organiser = **Create dedicated login**.
4. Click **Create sandbox**. ✅ Expect: a credentials screen showing **organiser@zudio.com** and a
   password with copy buttons.
5. Watch the list: status goes **seeding… → ready** by itself in ~30–60 s. ✅ Expect: counts appear
   (4 champs, ~190 teams, ~1000 users) and the credentials remain retrievable in the row
   (show / copy).

## Part 2 — Verify the demo content (as the client)

6. In a second browser, log in with `organiser@zudio.com` + the password.
7. ✅ Expect exactly **4 championships**, each at a different stage:
   - **Zudio Inter-College Championship** — *Completed*: full results, standings with podium,
     "Player of the Tournament" awards.
   - **Zudio Inter-School Championship** — *Ongoing*: quarter-finals done, some semi-finals
     **live** right now, one postponed match.
   - **Zudio Corporate Championship** — *Ongoing*: all 8 orgs enrolled & approved, full schedule,
     **nothing played yet** (ready to score live in a demo).
   - **Zudio Open Championship** — *Ongoing*: quarter-finals done, semi-finals scheduled **today**
     with the correct winners advanced.
8. Spot-check personalization: teams named **Zudio Strikers / Zudio Titans…**, orgs
   **Zudio Motors / Zudio Steel…**, players like *Priya Sharma \<priya.sharma@zudio.com\>*, and
   your "familiar names" as team captains.

## Part 3 — Reset restores the exact seeded state

9. Still as the Zudio organiser: **make a mess** — record a result in the Corporate championship,
   create a new team, even create a brand-new championship.
10. Back as admin on **Demo Sandboxes**: click **Reset** on Zudio → confirm.
    Status: **resetting… → ready**.
11. ✅ Expect: same login/password still works; everything you changed in step 9 is **gone**; the
    4 championships are back to their exact original stages.

## Part 4 — Private championships

12. Create a second sandbox (e.g. **Puma**) with **Visibility = Private (invite-only)**.
    ✅ Expect a violet **private** badge on its row after creation.
13. As the **Zudio** organiser (an unrelated user), open **Discover**. ✅ Expect: no Puma
    championships anywhere. Zudio's own (public) ones are listed for other users.
14. Paste a Puma championship URL (`/championships/<id>`) as the Zudio organiser.
    ✅ Expect: not found — private events don't leak by direct link.
15. Organiser-side controls: as any user, start **Create championship** — step 1 has a
    **Public / Private (invite-only)** toggle. The same toggle is in **championship Settings**.
    Set one to Private and confirm it disappears from Discover for other users, and shows a
    **Private** badge for people who can still see it.
16. Invite flow: as the private championship's organiser, **invite an organization**.
    ✅ Expect: that org's owner now sees the championship, and accepting the invitation enrolls
    them (approved). Any other org trying to apply gets *"This championship is private —
    organizations join by invitation from the organiser."*

## Part 5 — Delete erases everything

17. As admin, **Delete** the Zudio and Puma sandboxes → confirm. Status shows **deleting…**, then
    the rows disappear.
18. ✅ Expect: `organiser@zudio.com` can no longer log in; no Zudio/Puma championships, teams, or
    users remain anywhere in the app (Discover, All Users, Organizations).

## Edge cases (2 minutes)

- Creating a second sandbox for the same client while one exists is rejected
  ("already exists — reset or delete it instead").
- Reset/Delete buttons are disabled while a sandbox is busy (seeding/resetting/deleting).
- A non-admin user gets nothing at `/platform/demos` (page redirects, API returns 403).
- Public share links (`/c/<token>`) still work for private championships — the token itself is the
  access grant, generated intentionally by the organiser.
