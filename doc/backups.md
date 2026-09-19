# Database backups (NFR-3)

NFR-3 sets a daily backup target. SafeDrop stores its audit trail in the same database as everything
else, and that trail is the product's evidence of record — a lost database loses the evidence it
exists to keep. Ticket: SCRUM-127.

## The decision (OD-7)

**Atlas free tier plus a scheduled export job.** The free tier has no built-in backups (those start
at M10), so the backup is a nightly `mongodump` run by GitHub Actions rather than an Atlas feature.
Recorded in `doc/sdd-v0.2-changes.md` §10.1, still marked **[CONFIRM AT MEETING]** — this file
describes what the code does; the team confirms the decision itself.

## What runs

`.github/workflows/backup.yml`, daily at 05:00 UTC and on demand from the Actions tab:

1. `mongodump --archive --gzip` of the staging database, using the `mongo:7` image so the tool
   version is pinned alongside the server version.
2. SHA-256 of the archive, recorded next to it.
3. AES-256 encryption (`openssl enc -pbkdf2 -iter 600000`).
4. A decrypt-and-compare of the file that is about to be uploaded, so a backup nobody can open
   fails the job instead of sitting in storage looking fine.
5. Upload as the workflow artifact `safedrop-backup-<timestamp>`.

**The archive is encrypted because this repository is public, and so are its artifacts.** An
unencrypted dump would publish every user record, email address and audit event to anyone who can
read the repo. The passphrase is a repository secret and appears nowhere in the workflow output.

The job **fails** when its secrets are missing rather than skipping quietly. A nightly green tick
that produced no backup is the same trap as a health check that cannot see the database.

## Retention

**30 days**, set by `retention-days` on the artifact. That covers the iteration cadence and a long
weekend of nobody looking, and it is well inside GitHub's 90-day maximum. Deleting the repository or
the workflow run deletes the backups with it — see the limits below.

## Setup (once, by whoever holds the Atlas account)

Two repository secrets, under Settings → Secrets and variables → Actions:

| Secret                | Value                                                                       |
| --------------------- | --------------------------------------------------------------------------- |
| `MONGODB_URI_STAGING` | the Atlas connection string for the staging database, including credentials |
| `BACKUP_PASSPHRASE`   | a long random passphrase, e.g. `openssl rand -base64 32`                    |

Keep the passphrase somewhere that survives losing this repository — a backup you cannot decrypt is
not a backup. Atlas must also accept connections from the GitHub runner. Runner IPs are dynamic, so
on the free tier that means allowing `0.0.0.0/0` in Network Access; the database still requires the
credentials in the URI. Tightening that needs the Atlas Admin API to add and remove the runner's IP
around each run, which is a follow-up rather than part of this ticket.

## Restoring

Download the artifact, then, with the passphrase in `BACKUP_PASSPHRASE`:

```bash
# 1. Decrypt, and check the archive is byte-for-byte what was dumped.
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE \
  -in safedrop-<stamp>.archive.gz.enc -out safedrop.archive.gz
shasum -a 256 safedrop.archive.gz      # must equal safedrop-<stamp>.sha256

# 2a. Restore into a SEPARATE database first — never straight over a live one.
docker run --rm -i mongo:7 mongorestore --uri="$MONGODB_URI" --archive --gzip \
  --nsFrom 'safedrop.*' --nsTo 'safedrop_restored.*' < safedrop.archive.gz

# 2b. Or, against the local Compose stack:
docker compose exec -T mongo mongorestore --archive --gzip \
  --nsFrom 'safedrop.*' --nsTo 'safedrop_restored.*' < safedrop.archive.gz

# 3. Compare, then promote deliberately (point MONGODB_URI at it, or restore again
#    without --nsTo once you are satisfied).
docker compose exec -T mongo mongosh --quiet --eval '
  const a=db.getSiblingDB("safedrop"), b=db.getSiblingDB("safedrop_restored");
  a.getCollectionNames().sort().forEach(c =>
    print(c + ": source=" + a[c].countDocuments() + " restored=" + (b.getCollectionNames().includes(c) ? b[c].countDocuments() : "MISSING")));'
```

`mongorestore` recreates the indexes held in the dump, including the unique constraints and the TTL
index on refresh tokens, so a restored database enforces what the live one did.

## Restore test record

A backup that has never been restored is a guess. Re-run this at least once per iteration and add a
row.

| Date       | Source                                                                    | Result                                                                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-19 | Local Compose replica set (`safedrop`, 10 documents across 9 collections) | **Passed.** Dump → SHA-256 → AES-256 encrypt → decrypt → checksum match → `mongorestore` into `safedrop_restore_test`. Every collection matched the source count, indexes were recreated, and a restored user document still carried its `passwordHash`. A deliberately wrong passphrase failed to decrypt, as it should. |

That test exercised the full procedure above, but against the local replica set rather than Atlas,
because the Atlas URI is held by the account owner and is not available to the person who wrote
this. **The first Atlas backup produced by the workflow still needs one restore test**, using the
same steps, before this ticket's acceptance criterion is genuinely met.

## Limits worth knowing

- **One copy, in one place.** Workflow artifacts live in the same GitHub account as the code. This
  meets a daily-export target; it is not off-site storage, and it is not immune to the account
  itself being lost. Object storage (S3, R2, Drive) is the upgrade if the team wants one.
- **Nightly, so up to 24 hours of data can be lost.** There is no point-in-time recovery on the
  free tier. NFR-3 asks for daily; this delivers daily and no better.
- **`mongodump` is not a point-in-time snapshot.** It reads collections in sequence, so a dump taken
  during a write can catch one collection slightly after another. For SafeDrop's traffic at 05:00
  UTC this is theoretical, but it is why the restore goes to a separate database for comparison
  rather than straight over the live one.
- **The tool version is pinned to `mongo:7`,** matching the server in `docker-compose.yml`. If the
  Atlas cluster is ever upgraded past 7.x, bump that tag in the workflow and in the restore commands
  above, so the dump is taken by tooling that matches the server.
- **Integrity is checked, not authenticated.** `openssl enc` provides confidentiality only; the
  SHA-256 file detects corruption and accidental truncation, not a deliberate swap by someone who
  can write to the artifact store.
