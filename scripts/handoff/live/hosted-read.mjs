// Read-only query against the hosted staging DB via the Management API.
const sql = process.argv[2];
if (!/^\s*select\b/i.test(sql)) {
  console.error("select only");
  process.exit(2);
}
const r = await fetch(
  "https://api.supabase.com/v1/projects/vcohxiqsmnkzxnvawgri/database/query",
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: `begin read only; ${sql}; commit;`
        .replace("begin read only; ", "")
        .replace("; commit;", ""),
      read_only: true,
    }),
  },
);
console.log(r.status, (await r.text()).slice(0, +(process.env.MAX || 6000)));
