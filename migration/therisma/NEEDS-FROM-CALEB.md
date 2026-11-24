# What I still need before the copy can run

1. **The filled roster** (`roster-template.csv`): a real email for every person, their role (owner, manager or agent) and who they report to. Caleb and Albert are owners with personal emails, and the other managers are managers. Delete the rows for people who have left. Every agent currently signs in with a stand-in KnockRoute address, so real emails are needed for all of them.
2. **People who left:** either keep them on the roster, or pick one placeholder account (for example "Former team member") to hold their past visits. Reassign their open appointments and follow-ups in KnockRoute first.
3. **Turning 65 choice:** keep the 9 lists, regroup them into one list per birth month, or copy only the months that are still current. Also say whether to bring the Jan 2027 turners (3,865).
4. **A look at Therisma's schema:** read access to the therisma/Therisma-app repo, so I can fill in the real table and column names. That covers gated-area shape format, new-homeowner fields, list owners and allowed status values.
5. **The pilot office's Therisma org id**, once it has signed up. Everyone on the roster must be invited to that org before the copy, because the copy matches people by email.
6. **A way to write to Therisma's database** on the day: a Supabase connection to the Therisma project, or Caleb runs the one command himself.
7. **The go, and a quiet hour:** agents stop logging visits in KnockRoute while the export and copy run, so nothing is missed.
