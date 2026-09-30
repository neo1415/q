// Creates a confirmed fictional user. Keys come from env only.
const [email, name, org] = process.argv.slice(2);
const res = await fetch(`${process.env.SB_URL}/auth/v1/admin/users`, {
  method: "POST",
  headers: {
    apikey: process.env.SB_KEY,
    authorization: `Bearer ${process.env.SB_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    email,
    password: process.env.CQ_SEED_ACCOUNT_PASSWORD,
    email_confirm: true,
    user_metadata: {
      display_name: name,
      full_name: name,
      ...(org ? { organisation_name: org } : {}),
    },
  }),
});
console.log(res.status, (await res.text()).slice(0, 200));
