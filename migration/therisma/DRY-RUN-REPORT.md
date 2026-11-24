# KnockRoute → Therisma: dry-run report

Taken from KnockRoute's live database on **Nov 24, 2026**, read only. Nothing was copied or exported, and nothing was written to Therisma or KnockRoute.

## What would be copied

| What | Count | Detail |
|---|---:|---|
| Lead lists | 11 | 9 Turning 65 lists, 1 new-homeowner list, 1 agent's own list (Natawi) |
| Leads | **22,898** | Turning 65: 22,300 · New homeowners: 597 · Agent's own: 1 |
| Visits (dispositions) | **2,521** | Door: 2,467 · Status updates from the Agenda: 54 |
| Open appointments and follow-ups | **227** | Appointments: 74 · Follow-ups: 153 (all on Turning 65 leads). 8 have no date. |
| Gated areas | **122** | All active, drawn outlines, 4 to 347 points each |
| People | 45 | 6 managers, 39 agents. 16 have visits, and 25 have never signed in. |

**Leads by type and status**

| Status | Turning 65 | New homeowner | Own |
|---|---:|---:|---:|
| Not worked (new) | 20,195 | 597 | 1 |
| No answer | 1,120 | | |
| Not interested | 576 | | |
| Bad info | 163 | | |
| Follow-up | 153 | | |
| Appointment | 74 | | |
| Sold | 19 | | |

**Turning 65 by birth month** (these people turn 65 in Jan through Jun 2027)

| Jan 1962 | Feb | Mar | Apr | May | Jun |
|---:|---:|---:|---:|---:|---:|
| 3,865 | 3,546 | 3,767 | 3,741 | 3,686 | 3,695 |

**Visits by result:** no answer 1,434 · not interested 592 · follow-up 195 · bad info 166 · appointment 115 · sold 19. 1,204 visits have a note. 83 earlier appointments and follow-ups are already closed out.

**Counties:** Orange 4,996 · Polk 3,579 · Marion 2,478 · Lake 2,392 · Seminole 2,021 · Osceola 1,954 · Citrus 1,282 · Clay 1,185 · Sumter 1,076 · Alachua 879 · Hernando 576 · Levy 288 · Bradford 140 · Polk/Osceola 49 · Columbia 2 · blank 1.

**Other checks:** every lead has a map pin (1,035 are approximate). 3,924 Turning 65 leads have a phone number, and new-homeowner leads have none. Every visit belongs to a lead that still exists and to a person who still has a KnockRoute login.

## What wouldn't map cleanly

1. **Gated-area shapes.** KnockRoute stores each outline as a list of `[latitude, longitude]` points and leaves the ring open, so the last point doesn't repeat the first. Most map databases want GeoJSON instead: `[longitude, latitude]` order with the ring closed, or a PostGIS shape. The script can write any of the three, but I need to see which one Therisma's gated-areas table uses.

2. **Turning 65 birth-month view.** KnockRoute stores the birth month only (for example `196203`), with no day. The app decides on the fly which months agents see. Today that's people turning 65 from **Feb through May 2027**, plus anyone with an open appointment or follow-up. If Therisma has nothing like that, agents would see all 22,300 at once. The script offers three ways to handle it (Caleb picks one):
   - Keep the 9 lists as they are.
   - Regroup the leads into one list per birth month, such as "Turning 65 – Feb 2027", so managers can switch months on and off.
   - Copy only the months that are still current.

   Jan 2027 turners (3,865) are already outside KnockRoute's window.

3. **People who left.** Anyone Caleb leaves off the roster is treated as having left. **16 people have history:**

   | Person | Visits | Open items |
   |---|---:|---:|
   | Christian | 526 | 55 |
   | Luis | 421 | 30 |
   | JA | 384 | 41 |
   | Nico | 293 | 21 |
   | Johnny | 242 | 9 |
   | Caleb | 219 | 28 |
   | Leo | 190 | 18 |
   | Jesuel | 89 | 7 |
   | Lauryn | 66 | 1 |
   | Lis | 34 | 7 |
   | Natawi | 23 | 3 |
   | Jad | 9 | 3 |
   | John | 9 | 2 |
   | Justin | 7 | 1 |
   | Moose | 6 | 1 |
   | Ishaan | 3 | 0 |

   Natawi also has 1 own lead. If one of these people has left, their visits can't belong to anyone in Therisma. They would go to one placeholder account, such as "Former team member", with the original name kept at the start of each note. Open items from people who left would need a new owner, so it's best to reassign those in KnockRoute before the copy. The other 29 people have no history, so leaving them off loses nothing.

4. **No real emails for agents.** All 39 agents, plus Casey, sign in with stand-in KnockRoute addresses (`…@knockroute.example.com`). Therisma is invite-only by email, so every person needs a real address. The script rejects stand-in addresses.

5. **Roles and who sees what.** KnockRoute has only manager and agent: every manager sees everything, and there's no reporting chart. Therisma's access follows the reports-to chart. So the roster decides what each manager sees, and a manager will only see the agents under them.

6. **New homeowner leads.** All 597 are assigned to Caleb. In KnockRoute only managers can see them. In Therisma, they'll be visible to whoever is above Caleb in the chart and no one below, which matches as long as Caleb is an owner. Their extra fields are sale date, sale price, homestead, buyer flag, parcel id and property type. They need matching Therisma columns, or they'll be left out.

7. **The agent's own lead.** Natawi's 1 own lead is private to Natawi and the managers. In Therisma it lands in Natawi's own list (the list keeps its owner). Whether that keeps it private depends on how Therisma handles list owners.

8. **Route claims aren't copied.** 1,594 Turning 65 leads are claimed on an agent's route. Therisma uses territories instead, so the claims are dropped by default.

9. **Small things:**
   - 8 open items have no due date.
   - The 54 status updates count as visits in KnockRoute.
   - 236 addresses hold more than one lead (same household). They are copied as they are.
   - Name prefixes (Mr., Mrs.) are not copied.
   - KnockRoute's ids are kept, so running the copy twice adds nothing the second time.

## How this was checked

I ran the copy script against a made-up export, with no real people, and a stand-in Therisma database on this machine. It tested:

- all rows landing and the person-to-account matching
- crediting a person who left to a placeholder account
- converting gated areas to GeoJSON
- regrouping Turning 65 leads by birth month
- a second run adding nothing

I also checked that a missing invite rolls the whole copy back. The script refuses to run without `--caleb-said-go`, and it refuses a KnockRoute database address.

The table and column names on the Therisma side are still guesses, because I haven't seen Therisma's schema.
