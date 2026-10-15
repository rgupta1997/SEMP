# Event setup template: from a client's sheet to a ready event

The procedure for taking an event from the sheets a client sends to a championship that
is ready to play: organisation, people, structure, squads, draws, venue, fixtures and
roles. First used for [WNS Football 2026](event-setup-wns-football-2026.md).

It runs from the super-admin **Event Setup** dashboard, or from the CLI in
`apps/api/scripts/event-setup/`. Both use the same validator and engine; see "The
super-admin dashboard" below.

## The three event types

| | Intra (units of one org) | Inter (organisations) | Campus tournament |
|---|---|---|---|
| Who competes | Batches / departments / processes of one organisation | Separate organisations | Campuses of one organisation |
| `entry_level` | `department` | `organization` | `campus` |
| Scope | Optionally one campus (`entry_scope_unit_id`) | none | none |
| A squad belongs to | a batch (`teams.org_unit_id`) | an organisation | a campus |
| Entry gate | the batch is invited (`championship_invitations.org_unit_id`) | the org's entry is approved | the campus is invited |
| Host's own entry | one hidden `championship_organizations` row | host takes part if `host_participates` | one hidden row |
| Visible to outsiders | no (not in Discover, 404 by id) | public | no |
| Example | WNS Football 2026 | Inter IIM 2026 | an MNC's inter-office cup |

**One rule shared by all three:** a unit (or org) fields one squad per draw. When the
client has several squads from one unit, give each squad its own unit, or the second
squad cannot enter.

## The steps, and the switch on each

Every step has the same three-way switch:

- **From sheet**: build it from the sheet. Anything that already exists is found and
  reused; only what is missing is created.
- **Already exists**: it is on the platform already. Look it up and stop if it is not there.
- **Skip**: this run does not touch it. A later run, or a person, does it.

Re-running is always safe: every row the engine writes is recorded against a logical key,
so a second run finds it.

| # | Step | From sheet means | Already exists means | Found by | Skip when |
|---|---|---|---|---|---|
| 1 | **Organisation** | create the org, unit labels, plan | an org the client already has | name (exact, any case) | never: everything hangs off it |
| 2 | **Plan** | grant the plan named (no charge) | keep the current subscription | an active subscription | the client is already paying |
| 3 | **Campus** | create it | the client's campus | name under the org | inter events with no structure |
| 4 | **Batches / departments** | one per row (or per squad, see the rule above) | the client's structure | name under the campus | inter events |
| 5 | **People** | create logins, org membership, unit placement | the roster was imported before | the manifest, then member code (employee id), then real phone + same first name | the client registers people themselves |
| 6 | **Staff and roles** | create staff, grant org and event roles, officials | staff accounts exist | email | roles are assigned in the UI |
| 7 | **Championship** | create with type, dates, entry level, points | an event made in the UI | name under the host org | never |
| 8 | **Venue and grounds** | create the venue and its grounds | grounds were set up in the UI | name under the championship | single-pitch events entered later |
| 9 | **Sports and draws** | sport, discipline, format, saved scoring format | draws made in the UI | sport + discipline | never |
| 10 | **Squads and entries** | team, roster with roles, invitation, entry | squads made by captains | unit + sport + name | captains build their own squads |
| 11 | **Fixtures** | the schedule sheet exactly, or a generated draw | fixtures exist | any fixture on the draw | the organiser draws in the UI |
| 12 | **Verify** | read the result back and check it against the sheet | — | — | never |

What each event type usually ticks:

| Step | Intra (WNS) | Inter (new orgs) | Inter (orgs already on the platform) | Campus tournament |
|---|---|---|---|---|
| Organisation | From sheet | From sheet (one per org) | Already exists | Already exists |
| Campus | From sheet | Skip | Skip | Already exists or From sheet |
| Batches | From sheet | Skip | Skip | Skip |
| People | From sheet | From sheet | From sheet (matched) | From sheet (matched) |
| Staff and roles | From sheet | From sheet (POC per org) | From sheet | From sheet |
| Championship, venue, draws | From sheet | From sheet | From sheet | From sheet |
| Squads | From sheet | From sheet | From sheet or Skip | From sheet |
| Fixtures | From sheet | From sheet or generate | From sheet or generate | From sheet or generate |

## The sheets

Ask the client for these tabs, with these headers. Extra columns are ignored, and blanks
or the words NULL / NA / TBD / - all mean empty.

**Squads** (one row per squad)

| Column | Required | Notes |
|---|---|---|
| Squad name | yes | unique per draw; duplicates are renamed with the unit, then the captain |
| Unit | intra / campus | the batch, process, department or campus that competes |
| Organisation | inter | the organisation that competes |
| Sport, Discipline | multi-sport | one draw per sport + discipline |
| Section | if the bracket is pre-split | pool or bracket the client assigned |
| Captain name, Captain ID, Captain mobile | yes | ID = employee / student id |
| Vice-captain name, ID, mobile | no | |
| Player 1…n, Substitute 1…n | yes | names; add `Player n mobile` columns if the client has them |

**People** (optional, when the client has a roster): name, employee id, mobile, email,
unit, gender.

**Schedule** (optional; without it the draw is generated)

| Column | Notes |
|---|---|
| Day or Date | "Day 1" needs a mapping to a date, which the engine asks for |
| Ground | must match a ground name on the venue |
| Section | for reporting |
| Round | label only; the product names rounds from the bracket size |
| Match ID | kept on the fixture so the client's ids still work |
| Kickoff, End | local time; End − Kickoff = match length |
| Side 1, Side 2 | a squad name, or "Winner of <Match ID>" |

**Event**: name, dates, entry level, venue name, grounds, sport/discipline/format,
match length, tie-break, points for winner / runner-up / semi-finalist / taking part,
and the staff list (name, mobile, role, ground).

## Rules learned from the WNS sheet

1. **One squad per unit per draw.** 10 WNS processes fielded 2–3 squads; each squad got
   its own batch (`<process> · <squad>`).
2. **Players have no ids.** The same name is the same person across the sheet. Spelling
   variants are merged by an explicit alias list, and same-name strangers are kept apart
   by an explicit split list. Both lists go in the findings for the client to confirm.
3. **Sheets carry re-registrations.** Squads sharing 3+ players are flagged, not dropped.
4. **One mobile on several people** is a coordinator's number: use it for nobody, flag it.
5. **Invalid mobiles** (9 digits, two numbers in one cell) take the first valid one or a placeholder.
6. **No contact means a placeholder**, never a made-up real-looking number: phone
   `50000xxxxx` (no real person has it, and sign-in refuses it) and email
   `<name>-<stem>-<n>@placeholder.invalid`, with a **random password**. Super admin
   replaces both on registration day (Platform → Users → Only placeholder contacts).
7. **Real mobiles get the product's usual password** (`firstname@last4`) and sign in by OTP.
8. **Captains missing from their own player list** are added in their role.
9. **Two squads with the same name** are renamed: by unit if the units differ, by captain if not.
10. **Dates in a schedule sheet can be stale.** "Day 1 (15 Oct)" was a template's date;
    always confirm the calendar.
11. **A schedule sheet is a bracket.** The final is the match nobody's winner feeds;
    reading "Winner of" back from it gives the tree. A squad appearing in round 2 is a bye.
    The engine builds it with the product's manual-knockout generator, so winners
    advance through the product's own code.
12. **Free-text location columns are not structure.** WNS wrote 3 sites 14 ways; they were
    not used as campuses.
13. **Don't commit the sheet.** It has real names and phones; inputs and outputs live in
    gitignored `data/` and `out/` folders.

## The super-admin dashboard (built 15 Oct 2026)

**Platform → Event Setup** (`/platform/event-setup`, super admin only; API
`/api/event-setups`, also super-admin only).

1. **List**: every setup with its status, plus a blank template and a filled sample
   for each event type.
2. **New setup**: a label and an event type.
3. **What to build**: the From sheet / Already exists / Skip switch per step.
4. **Template**: downloaded for the setup's own switches and named after it. Fixtures
   on Skip leaves out the Schedule sheet, People on Skip leaves out the People sheet
   and the player columns, Staff on Skip leaves out the Staff sheet. The template,
   the sample and the validator all read one rule (`setupWorkbookLayout`).
5. **Upload & validate**: every problem with its sheet, Excel row and column and how
   to fix it, a CSV of the issues to send back to the client, what each step will find
   or create on the platform, and previews of the squads and schedule.
6. **Apply**: runs in the background; the page follows it until it is applied.
7. **Verify**: reads the event back and checks every scheduled match against the sheet.
8. **Credentials**: download the logins (placeholder accounts have no password).
   **Registration day**: how many accounts still have a placeholder contact.
9. **Undo**: deletes exactly what the run created. Refused once a match is played,
   and only after the championship's name is typed (the API checks it too).

Excel date cells are read from their value as YYYY-MM-DD whatever their display
format (a mm/dd/yyyy cell no longer reads as the wrong month). A date typed as text
that reads both ways (10/11/2026) is read day first, with a warning.

**Known limit**: Apply runs inside the API process, like demo builds. On Lambda the job
stops after the response; the setup shows "looks stuck" after 10 minutes and can be
applied again (what it made is reused) or undone. A queue is needed for production.

The CLI does the same from a terminal: `npx tsx scripts/event-setup/run.ts sheet
<file.xlsx> <intra|inter|campus> plan|apply|verify|cleanup`, and `run.ts wns …` for
the WNS adapter.
