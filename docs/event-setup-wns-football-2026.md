# WNS Football Championship 2026: setup plan and log

Intra-WNS 6-a-side football at Pune, Sat 17 – Sun 18 Oct 2026. Built on 15 Oct 2026 from
the WNS workbook (Teams tab + Master Schedule) by `apps/api/scripts/event-setup/`.
The procedure behind it is written up as a reusable template in
[event-setup-template.md](event-setup-template.md).

## Status

| Step | State | Notes |
|---|---|---|
| Old WNS test bench removed | Mostly done | 386 of 397 `@wns.test` accounts gone. 11 accounts, 5 fixtures, 10 teams, the "WNS Global Services" org and its championship remain, held by 11 test certificates whose scan log is append-only. SQL to finish is in "Open items". |
| Organisation, campus, batches | Done | WNS (code `WNS`), plan Max (annual, no charge), campus Pune, 55 batches |
| People | Done | 383 players, 51 with a real mobile, 332 on placeholder contacts |
| Staff and roles | Done | 6 staff: Rohit (organiser), WNS Sports Admin (owner + organiser), Turf 1–4 Referee (officials) |
| Championship | Done | `entry_level = department`, scoped to Pune, status `registration_open` |
| Venue and grounds | Done | "WNS Football Turfs", Turf 1–4 |
| Draw and format | Done | Football · Mixed (this championship only) · Knockout · 2 × 10 min, 5 min extra time, 5 penalties |
| Squads and entries | Done | 55 squads, 426 roster places, 55 entries, 55 batch invitations |
| Fixtures | Done | 54 matches exactly as the schedule sheet, plus 9 byes; numbered 1–54 in sheet order |
| Verified | Done | Every sheet match checked for date, turf, referee, sides and "Winner of" wiring through the product's own advancement code: 0 failures. A second run finds everything and creates nothing. |
| Grounds UI | Done, not browser-tested | Venue setup shows, adds, renames, disables and deletes grounds again |
| Super admin contact edit | Done | Email now editable by super admin; "Only placeholder contacts" filter on Platform → Users |

## Decisions taken (15 Oct)

1. **Batches: campus Pune, one batch per squad.** The database lets a unit field one
   squad per draw, and 10 processes field 2–3 squads. A batch is the process name when
   the process has one squad, `<process> · <squad>` when it has more (e.g. `IAG · MAS`).
   Standings read by batch, so every squad has its own row.
2. **All 55 squads kept**, including 8 that look like re-registrations of another.
3. **Fixtures follow the Master Schedule exactly.** Byes are the squads the sheet puts
   straight into round 2. No 3rd-place match (none on the sheet).
4. **Dates:** the sheet's "Day 1 (15 Oct) / Day 2 (16 Oct)" are Sat 17 and Sun 18 Oct.
5. **Tie-break:** 5 minutes of extra time, then 5 penalties each, then sudden death.
6. **Same name = same person** across the sheet, with the listed aliases and splits.
7. **Rounds are labelled the product's way**: the sheet's R55 shows as R64 and F as Final.
   Standings award placement points and the lock recognises the final by the round
   named `Final`, so "F" would break both. Each fixture carries the sheet's own id in
   its notes ("Match B1-R55-1").
8. **Squad names are the sheet's "Team Name SGN EOS" exactly** (corrected 15 Oct), e.g.
   "Algonkings - Algonquin (Pradeep Mahato)". Kickoffs, turfs and match lengths are as
   the sheet gives them. Scoreboard codes and batch names still come from the plain
   Team Name column.

## What was created

- Organisation **WNS**, unit labels Campus / Batch, Max plan
- Campus **Pune** → 55 batches
- **383 people**, all verified members of WNS with the employee UID as member code
  where the sheet had one, in the Pune campus and their squad's batch
- **Staff**: Rohit Gupta (existing account, organiser) · WNS Sports Admin (placeholder,
  org owner, organiser) · Turf 1–4 Referee (placeholders, officials; each is the
  official on every match on their turf)
- Championship **WNS Football Championship 2026**, placement points 10 / 7 / 4 + 1 for
  taking part
- Venue **WNS Football Turfs** with grounds Turf 1–4
- Draw **Football · Mixed**, knockout, squads of 5–10, the saved format above
- **55 squads** named as on the sheet, with captain / vice-captain / player / substitute roles
- **63 fixtures** (54 matches + 9 byes) on a 64-slot bracket: brackets 1–4 are its four
  quarters; SF1 = bracket 1 v 2, SF2 = bracket 3 v 4

Credentials for every new account: `apps/api/scripts/event-setup/out/wns-football-2026.credentials.csv`
(gitignored). Real-mobile accounts have the usual `firstname@last4` password; phone OTP
finds an account by the last 10 digits, so they should be able to sign in by WhatsApp
OTP now (not tried, to avoid messaging a real player). Placeholder accounts have random
passwords and cannot sign in until their contact is replaced.

## Findings for WNS to confirm

- **URGENT: players booked in two matches at once** (found 15 Oct by the Event Setup
  validator's clash check, which the original WNS build did not run). The
  re-registered pairs are scheduled at the same time on different turfs, Sat 17 Oct:
  - 10:20, B3-R55-3 Howdy (Turf 3) and B4-R55-3 Team Howden (Turf 4): 5 players in both.
  - 11:00, B1-R55-4 Team Kiwi B, B2-R55-4 Kiwi Champions, B4-R55-4 Team Kiwi and
    B3-R55-4 Kiwi Phoenix FC: the Kiwi squads share 1–6 players pairwise.
  - 11:40, B3-R55-5 and B4-R55-5, the two NLMK GOAL DIGGERS: 5 players in both.
  WNS must withdraw one squad of each pair or move a match.
- **Re-registered squads** (all kept): Howdy / Team Howden, AU Recoveries / United
  Recoveries, the two NLMK GOAL DIGGERS, Team Kiwi / Kiwi Champions, Team Kiwi B / Kiwi
  Phoenix FC, IAG Warriors / Victory FC, IAG Shooters with Elite Strikers and Rising Stars.
- **43 people play for two squads.** Legal on the platform, but WNS should say whether it is meant.
- **Same team name twice**: FALCON FORCE (Farmers) and Falcon Force (RND), and two
  NLMK GOAL DIGGERS. On screen the SGN names already tell them apart; their batches
  carry the process or captain. Row 19 has no plain team name: it shows as
  "- MCC CI (P. Khavei)", exactly as the SGN column has it.
- **Phones not used**: 814914756 (9 digits; Prasad Subhash Pardeshi) and one number
  given for three vice-captains of Team Doraemon, Team Iron Feet and Team Spartan.
- **06 Elites** has 5 named people (the 6th is "TBD").
- **No UID** for the captains of NLMK GOAL DIGGERS (Yug Pandya), The Adjusters and Claim Kickers FC.
- **Not merged, may be one person**: Samruddhi phadtare (CFI) and Samruddhi Phadatare (Country Financial).

The full list, with the spelling variants merged, is on the artifact's Findings tab.

## Registration day runbook

1. Sign in as a super admin, open **Platform → Users**, tick **Only placeholder contacts**.
2. Search the player, **Edit**, replace the phone with their real mobile and the email
   with their real address, **Save**. They then sign in by phone OTP over WhatsApp.
3. Replace **WNS Sports Admin** and **Turf 1–4 Referee** with the real people the same way
   (rename them too). The referee on a turf scores every match on that turf.
4. On Saturday morning set the championship status to **Ongoing**.
5. During play the referee scores in the match console, confirms the result and locks
   the scorecard; the winner moves into the next match on its own.

## Open items

- **Venue name** "WNS Football Turfs" is a placeholder; rename in Setup → Venue.
- **Day 2** uses Turf 1–2 only, as the sheet has it.
- **Old bench leftovers**: run in the Supabase SQL editor, then re-run the bench teardown:
  ```sql
  begin;
  alter table certificate_verifications disable trigger trg_certificate_verifications_no_update;
  delete from certificate_verifications where certificate_id in (select id from certificates where championship_id = 'a0cb300d-158e-477d-b687-d7ffdee4b585');
  alter table certificate_verifications enable trigger trg_certificate_verifications_no_update;
  delete from certificates where championship_id = 'a0cb300d-158e-477d-b687-d7ffdee4b585';
  commit;
  ```
- Two test events from the last two days were left alone: "wns" (host SI) and "WNS Football Test" (org "WNS Test").

## Commands

```bash
cd apps/api
npx tsx scripts/event-setup/run.ts wns plan            # read-only: what would be found / created
npx tsx scripts/event-setup/run.ts wns apply           # safe to re-run
npx tsx scripts/event-setup/run.ts wns verify          # every sheet match checked against the database
npx tsx scripts/event-setup/run.ts wns cleanup         # dry run of the undo
npx tsx scripts/event-setup/run.ts wns cleanup --yes   # refused once any match is played
```
