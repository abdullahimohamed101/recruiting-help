# VPS foundation (Phase 7)

Always-on private production runtime. The Mac is only a development and
administration client. This phase does **not** enable Discord delivery from
GitHub — that waits until after the 48-hour shadow gate.

## Constraints

- No public n8n or Postgres ports.
- Tailscale-only administration after initial bootstrap.
- Operator approves every paid/provider write and enters secrets on the VPS.
- Agents must not create cloud resources or ask for secrets in chat.

## Target host

- x86-64 Ubuntu LTS
- 2 shared vCPU / 4 GB RAM / ≥40 GB SSD / 2 GB swap
- Default provider guidance: Hetzner (see ADR 0001)
- Budget: about $7–$15/month total

## Operator checklist (you)

1. Create the VPS-provider account, verify identity/payment, set a budget alert.
2. Create the approved x86 VPS and record the price.
3. Create/join Tailscale.
4. Create an independent backup bucket (Cloudflare R2 or equivalent).
5. Verify the SSH host key from the provider console before first connect.
6. Approve bootstrap/deploy commands that change the remote host.
7. Enter production secrets only in `.env.production` on the VPS (mode `0600`).

## Agent / repo scaffolding

| Path                                  | Purpose                                                         |
| ------------------------------------- | --------------------------------------------------------------- |
| `infra/bootstrap/bootstrap-ubuntu.sh` | Idempotent host bootstrap (stops before `tailscale up`)         |
| `infra/compose.prod.yaml`             | Production Compose stack                                        |
| `infra/env.example`                   | Production env template                                         |
| `infra/backup/backup-postgres.sh`     | Encrypted `pg_dump` + retention (+ optional upload)             |
| `infra/backup/restore-postgres.sh`    | Restore drill helper (refuses prod URL by default)              |
| `infra/scripts/prod-compose.sh`       | `config` / `ps` / `logs` / `up` / `down` / `migrate` / `backup` |

## Bootstrap sequence

On a fresh VPS (after you approve):

```bash
# as root, from a checked-out repo copy
sudo ./infra/bootstrap/bootstrap-ubuntu.sh
# add your SSH public key to /home/deploy/.ssh/authorized_keys, then:
sudo tailscale up
```

Then as `deploy`:

```bash
sudo mkdir -p /opt/recruiting-help
sudo chown deploy:deploy /opt/recruiting-help
git clone <your-repo-url> /opt/recruiting-help
cd /opt/recruiting-help
cp infra/env.example .env.production
chmod 0600 .env.production
# edit .env.production on the VPS only
./infra/scripts/prod-compose.sh config
./infra/scripts/prod-compose.sh up
./infra/scripts/prod-compose.sh migrate
```

Import and publish n8n workflows from `n8n/workflows/` (same process as local
dev, against the production Compose stack). Keep GitHub `shadow_mode: true`
for the first 48 hours.

## Accessing n8n

n8n binds to `127.0.0.1:5678` on the VPS. From a Tailscale-connected Mac:

```bash
ssh -L 5678:127.0.0.1:5678 deploy@<vps-tailscale-name>
# open http://127.0.0.1:5678 locally
```

## Backup / restore drill

```bash
./infra/scripts/prod-compose.sh backup
# restore into a temporary database only:
BACKUP_ENCRYPTION_PASSPHRASE=... \
TARGET_DATABASE_URL=postgresql://... \
  ./infra/backup/restore-postgres.sh /var/backups/recruiting-help/<file>.sql.gpg
```

Store `N8N_ENCRYPTION_KEY` separately from database backups. Do not back up
browser profiles.

## Deployment sequence (from the phase plan)

1. Bootstrap host and Tailscale.
2. Deploy Postgres and n8n.
3. Apply migrations.
4. Import version-controlled workflows.
5. Enter production credentials.
6. Deploy the bot (delivery can stay gated by shadow mode / workflow state).
7. Keep browser collector disabled (`application` profile off).
8. Configure and test backup.
9. Smoke tests.
10. Enable GitHub shadow polling for 48 hours.

## After the 48-hour shadow gate

Only when precision looks good: set `shadow_mode: false` for the GitHub source
in production config (no code change) so new rows can reach Discord.

## Out of scope for the first scaffolding PR

- Creating the VPS or DNS
- Entering real secrets
- noVNC headed-browser admin (next Phase 7 increment)
- Pinning immutable production image digests from CI publish
