#!/bin/bash
# Deploy the latest main branch. Runs ON the EC2 server, either from the
# GitHub Actions workflow (.github/workflows/deploy.yml) or by hand:
#   ssh -i ~/.ssh/Rizins.pem ec2-user@3.104.152.193 'bash ~/smashhh/scripts/deploy.sh'
#
# Steps: pull code -> install deps -> apply new db/NN-*.sql files -> restart -> health check.
# Applied SQL files are recorded in the schema_migrations table so each runs once.

set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Fetching latest code"
git fetch --quiet origin main
git reset --quiet --hard origin/main
echo "    now at $(git log --oneline -1)"

echo "==> Installing dependencies"
npm install --omit=dev --no-audit --no-fund --loglevel=error

echo "==> Applying database migrations"
set -a; . ./.env; set +a
export PGPASSWORD="$DB_PASSWORD"
PSQL=(psql -q -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1)

"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMP DEFAULT NOW())"
applied=0
for f in db/[0-9]*.sql; do
  name=$(basename "$f")
  if [ -z "$("${PSQL[@]}" -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$name'")" ]; then
    echo "    applying $name"
    "${PSQL[@]}" --single-transaction -f "$f"
    "${PSQL[@]}" -c "INSERT INTO schema_migrations (filename) VALUES ('$name')"
    applied=$((applied + 1))
  fi
done
echo "    $applied new migration(s)"

echo "==> Restarting app"
pm2 restart smashhh --update-env >/dev/null

for i in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${PORT:-3000}/login || true)
  if [ "$code" = "200" ]; then
    echo "✅ Deployed $(git rev-parse --short HEAD) at $(date)"
    exit 0
  fi
  sleep 2
done

echo "❌ App did not come back up (last HTTP code: $code). Recent logs:"
pm2 logs smashhh --lines 30 --nostream
exit 1
