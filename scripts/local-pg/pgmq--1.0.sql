-- Local stub of pgmq (scripts/local-pg/setup.sh): only what the migrations call.
create table pgmq.meta (queue_name text primary key, created_at timestamptz default now());
create table pgmq.messages (msg_id bigserial primary key, queue_name text not null, read_ct int not null default 0, enqueued_at timestamptz default now(), vt timestamptz default now(), message jsonb);
create function pgmq.create(queue_name text) returns void language sql as $$ insert into pgmq.meta values ($1) on conflict do nothing $$;
create function pgmq.send(queue_name text, msg jsonb, delay integer default 0) returns setof bigint language sql as $$ insert into pgmq.messages (queue_name, message, vt) values ($1, $2, now() + make_interval(secs => $3)) returning msg_id $$;
create function pgmq.read(queue_name text, vt integer, qty integer) returns setof pgmq.messages language sql as $$
  update pgmq.messages m set read_ct = read_ct + 1, vt = now() + make_interval(secs => $2)
   where m.msg_id in (select msg_id from pgmq.messages where queue_name = $1 and vt <= now() order by msg_id limit $3 for update skip locked)
  returning m.* $$;
create function pgmq.archive(queue_name text, msg_id bigint) returns boolean language sql as $$ with d as (delete from pgmq.messages where queue_name = $1 and msg_id = $2 returning 1) select exists(select 1 from d) $$;
create function pgmq.delete(queue_name text, msg_id bigint) returns boolean language sql as $$ with d as (delete from pgmq.messages where queue_name = $1 and msg_id = $2 returning 1) select exists(select 1 from d) $$;
