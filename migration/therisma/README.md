# KnockRoute → Therisma one-time copy

Prepared Nov 24, 2026. **Not run.** It only runs after the pilot office signs up and Caleb says go.

| File | What it is |
|---|---|
| `DRY-RUN-REPORT.md` | Counts from KnockRoute, plus everything that won't map cleanly |
| `NEEDS-FROM-CALEB.md` | What's still missing before it can run |
| `roster-template.csv` | Roster to fill in: name, email, role (owner, manager, agent), reports to. `knockroute_name` links each row to their KnockRoute login. |
| `extract.sql` | Exports KnockRoute to one JSON file, inside a read-only transaction |
| `copy.mjs` | Copies that file into one Therisma org. Dry run by default. |
| `field-map.json` | Where each KnockRoute field lands in Therisma. **Guesses until checked against Therisma's schema.** |

## Steps on the day

1. Fill in the roster and invite everyone on it to the Therisma org.
2. In `field-map.json`, set the real Therisma names, then set `"confirmed": true`.
3. Export KnockRoute (read only):
   `psql "$KR_DATABASE_URL" -X -q -t -A -v ON_ERROR_STOP=1 -f extract.sql -o kr-bundle.json`
4. Do a dry run. It writes nothing:
   `node copy.mjs --bundle kr-bundle.json --roster roster.csv`
5. Write the SQL and read it over:
   `node copy.mjs --bundle kr-bundle.json --roster roster.csv --org <org-id> --emit-sql therisma-copy.sql`
6. Run it. It's one transaction, so it all lands or none of it does:
   `npm install pg && THERISMA_DATABASE_URL=… node copy.mjs --bundle kr-bundle.json --roster roster.csv --org <org-id> --apply --caleb-said-go`
7. Delete `kr-bundle.json`, the filled roster and `therisma-copy.sql`, because they hold personal data. `.gitignore` keeps them out of git.

## Safety

- The script never connects to KnockRoute. It reads only the export file.
- It refuses a database address that points at KnockRoute.
- It won't write SQL or connect anywhere until the field map is confirmed, the roster has no gaps, and `--org` is a real id.
- It checks that the org exists and that every person is already invited. If not, the whole copy rolls back.
- Every row gets the one `--org` id. KnockRoute's ids are kept, so a second run adds nothing.
