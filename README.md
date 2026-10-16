# KnockRoute

Door-knocking route planner + shared lead dispositions for the office.

- **Map** of every lead, colored by its latest disposition, updating live as teammates log visits.
- **Routes**: draw around an area (or take the nearest N open leads), and KnockRoute orders the stops for the shortest drive. Hand off each stop to Apple Maps, Google Maps or Waze. Doors on your route are marked so teammates plan around you.
- **Dispositions** use the same choices as OSCR: Phone call / Door knock, notes, and No Answer/Not Home, Left VM/Note, Appointment, Follow-Up, Not Interested, Info Requested, Bad Info. Every lead keeps a full history of who did what and when.
- **Team board**: today's doors, calls and appointments per agent, plus a live activity feed.
- **Managers** import spreadsheets (the same files inRoute takes), assign leads to an agent or leave them in the shared pool, and set roles.

It's a web app that installs to the home screen (no App Store needed).

## Try it now (demo mode)

```bash
npm install
VITE_DEMO=1 npm run dev
```

With `VITE_DEMO=1`, the app runs in **demo mode**: sample leads (fake people around Celebration, Kissimmee, Hunters Creek, College Park, Winter Garden and Clermont), saved only in that browser. Simulated teammates log a visit every minute or so, which shows how the live map behaves.

## Go live for the whole team

You need two free accounts. About 20 minutes total.

### 1. Supabase (the shared database + logins)

1. Create a project at [supabase.com](https://supabase.com) (free tier is plenty for ~25 people).
2. **SQL Editor → New query**: paste all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up" so only people you add get in.
4. **Authentication → Users → Add user → Create new user**: enter the person's email and a temporary password, and check **Auto Confirm User**. No email is sent; give them the password yourself. They can change it under **More** in the app.
5. Make yourself a manager in **SQL Editor**:
   ```sql
   update profiles set role = 'manager' where id = (select id from auth.users where email = 'YOU@EXAMPLE.COM');
   ```
   After that, everything else happens in the app's **Team** tab: set who's a manager and fix how names show.
6. **Project Settings → API Keys** (or the **Connect** button at the top): copy the **Project URL** and the **anon / publishable** key.

#### Usernames instead of emails
Teammates without an email you can use sign in with a username (e.g. `calebjurkonis`). Fill in
[`supabase/updates/002-add-team-template.sql`](supabase/updates/002-add-team-template.sql) and run it in the SQL Editor:
it creates the logins and sets each person's role. Everyone picks their own password the first time they sign in.
Behind the scenes a username is stored as `username@knockroute.example.com`; no email is ever sent.

#### Database updates
Run each file in [`supabase/updates/`](supabase/updates/) once, in order, in the SQL Editor
(`schema.sql` already includes them for brand-new setups):
- `001-keep-history-and-street-pins.sql`: street-level pins; removing leads keeps their door-knock history.
- `003-app-settings.sql`: shared settings, used for the road-routing key.
- `004-agenda.sql`: dates on appointments and follow-ups, the Agenda tab, and status updates (Sold, Booked…).

#### Adding and removing people later
- **Add:** Authentication → Users → Add user → Create new user (step 4), then set their name and role in the app's Team tab.
- **Remove:** Authentication → Users → click the person → **Delete user**. Their past dispositions stay in the history.
- **Forgot password:** Authentication → Users → click the person → set a new password.

### 2. Vercel (hosting)

1. Sign in at [vercel.com](https://vercel.com) with GitHub, **Add New → Project**, and import this repository.
2. The office project's URL and publishable key are built into `src/main.tsx`. To point at a different project, change them there or set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Environment Variables**.
3. Deploy. Share the URL with the team; on iPhone: open in Safari → Share → **Add to Home Screen**.

#### Road routing (optional)
The office's OpenRouteService key is built in (`src/lib/roads.ts`), so routes follow real roads with no setup.
Managers can swap in a different key or turn routing off under **More → Road routing** (needs `003-app-settings.sql`). Stops are then ordered by drive time and the route follows real streets. If the service
is unavailable or over its daily limit, the app falls back to straight lines on its own.

## How it works

| Piece | What it does |
| --- | --- |
| `src/` | React app (Vite + TypeScript), Leaflet map |
| `src/data/demoStore.ts` | Demo mode, sample data in the browser |
| `src/data/supabaseStore.ts` | Live mode, Supabase with realtime updates |
| `supabase/schema.sql` | Tables, access rules (agents only see the pool + their own leads), and the trigger that updates a lead when a disposition is logged |
| `api/geocode.ts` | Turns addresses into map points with the free U.S. Census Bureau geocoder |
| `api/geocode-fallback.ts` | Second try for addresses the Census misses: OpenStreetMap (Nominatim, then Photon), exact house matches only, about one per second |
| `src/lib/route.ts` | Stop ordering (nearest-neighbor + 2-opt), map links |

## Notes

- **OSCR is still the system of record.** KnockRoute doesn't sync with it; log the visit here in the field and keep entering it in OSCR as required.
- **Lead data is personal information** (names, addresses, birth months, phones of seniors). Confirm with your manager/compliance before uploading real lists. Access requires an invited login, and agents can only see the shared pool and leads assigned to them.
- **Map tiles**: streets come from OpenStreetMap and satellite from Esri, both fine for testing. For everyday team use, switch to a provider with a free key (e.g. MapTiler or Stadia Maps). That's a one-line change in `src/components/MapView.tsx`.
