#!/bin/bash
# usage: transcript.sh email
cd "$(dirname "$0")" && MAX=80000 NODE_USE_ENV_PROXY=1 node hosted-read.mjs "select to_char(t.created_at,'HH24:MI:SS') t, t.role, t.step_key, left(t.text,260) x from onboarding.interview_turns t join onboarding.sessions s on s.id=t.session_id join identity.user_profiles p on p.id=s.user_id join auth.users u on u.id=p.auth_user_id where u.email='$1' order by t.created_at" | node -e 'const s=require("fs").readFileSync(0,"utf8");const j=JSON.parse(s.slice(4));for(const r of j)console.log(r.t,r.role,r.step_key??"","|",r.x)'
