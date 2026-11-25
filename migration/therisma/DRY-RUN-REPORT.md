# KnockRoute → Therisma: dry-run report

Updated **Nov 25, 2026**, from KnockRoute's live database, read only. Nothing was copied or exported, and nothing was written to Therisma or KnockRoute.

## Scope (Caleb's choice)

- **Leads:** only Turning 65 leads with birth months **Feb through Jun 1962**, the people turning 65 in Feb–Jun 2027. `scope.json` sets this, and the copy script applies it.
- **People:** 21 named:
  - Owners: Caleb and Albert.
  - Managers: Moose, Arban, Casey and Tina.
  - Agents: Christian, Luis, JA, Nico, Johnny, Leo, Jesuel, Lis, Natawi, Jad, John, Justin, Ishaan, Ami and Dari.

  The request said 20, but it named 21, so all 21 are on the roster. Everyone else is left off, including Lauryn and Haleigh. Lauryn's and Haleigh's history goes to Caleb, tagged with their names (Haleigh has none on the copied leads). "JA" becomes **Jon Anthony**. Reporting lines are set in the roster: Moose has Christian, Luis, Jon Anthony, Nico, Johnny and Jad; Arban has Leo, Jesuel, Lis and John; Casey has Natawi, Ishaan and Ami; Tina has Justin; Dari and the four managers report to Albert. All 21 have Therisma user ids in the roster's `therisma_user_id` column, and the copy targets people by id only (19 were newly created by Therisma). `activities.handled_by` stays empty, because in KnockRoute every open item belongs to whoever logged it.
- **Therisma org:** `21754a63-930a-44da-8e68-76bb15485f1a` (BLC - Clermont/Ocala), set in `scope.json`.
- **Therisma side:** the results list is final and the field map follows it. Other table and column names stay unconfirmed, and the Therisma side checks them separately.

## What would be copied

| What | Count | Detail |
|---|---:|---|
| Lead lists | 9 | The Turning 65 lists that still hold Feb–Jun leads |
| Leads | **18,435** | All Turning 65 |
| Visits (dispositions) | **2,061** | Door: 2,030 · Status updates from the Agenda: 31 |
| Open appointments and follow-ups | **194** | Appointments: 61 · Follow-ups: 133. 3 have no date. |
| Gated areas | **122** | All active, drawn outlines, 4 to 347 points each |
| People | 21 on the roster | |

**Leads by birth month**

| Feb 1962 | Mar | Apr | May | Jun |
|---:|---:|---:|---:|---:|
| 3,546 | 3,767 | 3,741 | 3,686 | 3,695 |

**Leads by status:** not worked 16,727 · no answer 888 · not interested 478 · bad info 138 · follow-up 133 · appointment 61 · sold 10.

**Visits by result:** no answer 1,173 · not interested 491 · follow-up 161 · bad info 141 · appointment 85 · sold 10. 995 visits have a note.

**Leads by list**

| List | Leads |
|---|---:|
| Apr 2027 current territories + Jan–Apr 2027 new counties | 5,937 |
| May 2027 (all counties) | 3,668 |
| Jan–Mar 2027 | 3,205 |
| Jun 2027 (service area) | 2,353 |
| Feb–Jun 2027 (Bankers, Nov list) | 1,435 |
| Jan–Mar 2027 (Lake-Orange-Seminole) | 817 |
| Jan–Mar 2027 (Seminole) | 610 |
| Jan–Mar 2027 (Sumter) | 341 |
| DK Route 7 | 69 |

The "Jan–Mar" lists keep only their Feb and Mar people, so their names would be off by a month. Renaming them in Therisma afterwards is the simplest fix.

**Counties:** Orange 4,136 · Polk 2,778 · Marion 2,060 · Lake 1,967 · Seminole 1,670 · Osceola 1,345 · Citrus 1,047 · Clay 1,000 · Sumter 883 · Alachua 724 · Hernando 476 · Levy 233 · Bradford 114 · Columbia 2.

**Other checks:**
- Every lead has a map pin, and 777 of the pins are approximate.
- 3,260 leads have a phone number.
- 174 addresses hold more than one lead (the same household).

## Visit results (Therisma's final list)

Every copied visit maps to exactly one built-in result, with nothing left over:

| KnockRoute result | Therisma result | Doors | Updates | Total |
|---|---|---:|---:|---:|
| no_answer | No Answer/Not Home | 1,173 | 0 | 1,173 |
| appointment | Appointment | 81 | 4 | 85 |
| follow_up | Follow-up | 152 | 9 | 161 |
| not_interested | Not Interested | 483 | 8 | 491 |
| bad_info | Bad Info | 141 | 0 | 141 |
| sold | Sold | 0 | 10 | 10 |
| **Total** | | **2,030** | **31** | **2,061** |

- **Doors (DKs):** 2,030, all on channel `door`. KnockRoute has no phone visits on these leads.
- **Contacts at the door:** 716 (appointment, follow-up and not interested).
- **What counts in Appt, F/U, NI and Sold (doors plus updates):** Appt 85 · F/U 161 · NI 491 · Sold 10.
- **Sold:** all 10 are status updates on an earlier appointment, so no door sale needed splitting. The script would still split one into an appointment plus a Sold update.
- **Deal amounts (`deal_cents`):** empty for all 10 sales. KnockRoute never recorded deal amounts. Its `leads.sale_price` is the home sale price from new-homeowner data, and none of the copied leads has one.
- **No dates:** 10 appointments and follow-ups had no date: 3 still open, 7 closed. Each gets the visit's own time as its date, so the 3 open ones show as overdue in the Agenda.
- **Never visited:** every lead with no visits is `new` (16,727), and every visited lead's status matches its latest result.
- **Office-named results (`result_key`):** KnockRoute has none, so it is never set. Old-only results (left_note, info_requested) aren't used either.
- **How earlier items were closed:** 52 earlier appointments and follow-ups were closed with a result recorded on the item itself:
  - appointment: 7
  - follow-up: 13
  - not interested: 15
  - sold: 10
  - no answer: 7

  Only 31 of those closes also logged their own status update. The 7 "no answer" closes and some of the others exist only as that recorded result. They carry over as `resolved_at`/`resolution` on the original visit, if Therisma's activities table has those columns.

## What is left behind

| What | Count |
|---|---:|
| Jan 2027 Turning 65 leads | 3,865 |
| New-homeowner leads | 597 |
| Natawi's own lead | 1 |
| Visits on those leads | 460 |
| Open appointments and follow-ups on those leads | 33 |
| Lists left empty (new homeowners, Natawi's own list) | 2 |

Those 33 open items will not exist in Therisma. Agents who need them should note them before the copy.

## What wouldn't map cleanly

1. **Gated-area shapes.** KnockRoute stores each outline as `[latitude, longitude]` points and leaves the ring open, so the last point doesn't repeat the first. Most map databases want GeoJSON: `[longitude, latitude]` order with the ring closed, or a PostGIS shape. The script can write any of the three. The Therisma side picks one in `field-map.json`.

2. **Turning 65 birth-month view.** KnockRoute stores birth month only, as `196203`, with no day. The app works out which months agents see: today that's Feb–May 2027, plus anyone with an open appointment or follow-up. In Therisma, agents would see all 18,435 at once, unless the lists are regrouped into one list per birth month. That's an option in `field-map.json` ("Turning 65 – Feb 2027" and so on).

3. **People who left.** Within the copied leads, only **Lauryn** has history from someone not on the roster: 47 visits and 1 open follow-up. **All of it goes to Caleb**, with "[KnockRoute: Lauryn]" at the start of each note so it stays traceable. Her open follow-up lands in Caleb's Agenda. Haleigh has no history. Everyone else with history is on the roster:

   | Person | Visits | Open items |
   |---|---:|---:|
   | Christian | 445 | 49 |
   | JA | 339 | 36 |
   | Luis | 330 | 20 |
   | Nico | 232 | 18 |
   | Johnny | 185 | 8 |
   | Leo | 172 | 17 |
   | Caleb | 164 | 22 |
   | Jesuel | 68 | 7 |
   | Lis | 32 | 7 |
   | Natawi | 23 | 3 |
   | Jad | 7 | 3 |
   | John | 7 | 2 |
   | Moose | 4 | 0 |
   | Justin | 3 | 1 |
   | Ishaan | 3 | 0 |

4. **No real emails for agents.** All 15 agents, and Casey, sign in with stand-in KnockRoute addresses (`…@knockroute.example.com`). Therisma invites by email, so each needs a real one. The script rejects stand-in addresses.

5. **Roles and who sees what.** KnockRoute has only manager and agent: every manager sees everything, and there's no reporting chart. In Therisma, access follows reports-to, so the roster decides what each manager sees.

6. **Route claims aren't copied.** 1,166 of the copied leads are claimed on an agent's route. Therisma uses territories instead.

7. **Small things:**
   - 3 open items have no due date.
   - The 31 status updates count as visits in KnockRoute.
   - Name prefixes (Mr., Mrs.; 17,361 leads have one) are now copied to a `prefix` column, unconfirmed on the Therisma side.
   - KnockRoute's ids are kept, so running the copy twice adds nothing the second time.

## How this was checked

The counts above come from read-only queries on KnockRoute.

I tested the copy script on a made-up export (no real people) and on a stand-in Therisma database on this machine. The tests covered:

- only the chosen leads landing, with their visits
- lists left empty being dropped
- a person who left being credited to someone on the roster (a second KnockRoute name on their row), with the original name kept in the note
- a second run adding nothing
- a missing invite rolling the whole copy back
- the script refusing to run without `--caleb-said-go`, or with a KnockRoute database address

The Therisma table and column names are still unconfirmed.
