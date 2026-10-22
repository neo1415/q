#!/usr/bin/env bash
# A local Postgres 16 that runs every migration and the pgTAP suites without
# Docker or the Supabase CLI (cloud sandboxes). CI's Supabase stack remains
# the gate of record; this is for rehearsal and local tests.
#
#   sudo scripts/local-pg/setup.sh            # cluster on port 54329, database cq
#   CQ_SEED_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/cq ...
#   cd supabase/tests/database/rls && psql -h /tmp -p 54329 -U postgres -d cq -qtAX -f 521_person_q_card.test.sql
#
# Installs pgvector and pgTAP from the distribution, a small pgmq stub (the
# migrations only create queues; nothing here consumes them), and a minimal
# Supabase surface: roles, auth.users/uid()/role()/jwt(), storage tables.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
port="${PGPORT:-54329}"
data="${PGDATA_DIR:-/home/postgres/pgdata}"
bin=/usr/lib/postgresql/16/bin
ext=/usr/share/postgresql/16/extension

DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-16-pgvector postgresql-16-pgtap >/dev/null
install -m 0644 "$here/pgmq.control" "$here/pgmq--1.0.sql" "$ext/"
id -u postgres >/dev/null 2>&1 || useradd -m postgres
if [ ! -d "$data" ]; then
  mkdir -p "$data" && chown postgres "$data"
  su postgres -c "$bin/initdb -D $data -U postgres --auth=trust -E UTF8 >/dev/null"
fi
su postgres -c "$bin/pg_ctl -D $data -o '-p $port -k /tmp' -l $data/log status >/dev/null" ||
  su postgres -c "$bin/pg_ctl -D $data -o '-p $port -k /tmp' -l $data/log start >/dev/null"
sleep 1
psql=(psql -h /tmp -p "$port" -U postgres -q -v ON_ERROR_STOP=1)
"${psql[@]}" -c "drop database if exists cq with (force)" -c "create database cq"
"${psql[@]}" -d cq -f "$here/supabase-local.sql"
"${psql[@]}" -c 'alter database cq set search_path = "$user", public, extensions'
for f in "$repo"/supabase/migrations/*.sql; do
  "${psql[@]}" -d cq -1 -f "$f" >/dev/null || { echo "migration failed: $f" >&2; exit 1; }
done
echo "ready: postgresql://postgres@127.0.0.1:$port/cq"
