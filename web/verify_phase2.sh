#!/usr/bin/env bash
# =============================================================================
# Verifies migrations 0005-0010 from outside the dashboard.
#
# The SQL editor runs with elevated privileges and proves nothing about what a
# client can do. Everything here uses the anon key, which is public by design
# and is the same key that ships inside the APK. The service_role key is not
# used, not needed, and must never appear in this file.
#
# Two users, because half of these checks are about what one person cannot see
# of another, and a check run as a single user passes against a database that
# happens to contain only that user's rows. That already happened once on this
# project: a roster leak passed its own check because at that moment the only
# rows in the table belonged to the tester.
#
# Run it before the migrations are applied and it should FAIL, loudly and in
# most places. That failure is the evidence the checks are real. Keep the output.
# =============================================================================

set -u

URL="https://tajbebyhmvppqlswyjiq.supabase.co"
CFG="$(dirname "$0")/config.local.js"

ANON=$(grep -o 'SUPABASE_ANON_KEY: "[^"]*"' "$CFG" | sed 's/.*: "//;s/"//')
if [ -z "$ANON" ]; then echo "FAIL: could not read the anon key from $CFG"; exit 1; fi

pass=0; fail=0; skip=0

say()  { printf '\n\033[1m-- %s\033[0m\n' "$1"; }
ok()   { pass=$((pass+1)); printf '   \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '   \033[31mFAIL\033[0m  %s\n' "$1"; }
warn() { skip=$((skip+1)); printf '   \033[33mSKIP\033[0m  %s\n' "$1"; }

cut200() { head -c 200; }

jq_get() { python -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: print(''); sys.exit()
for k in '$1'.split('.'):
    if isinstance(d,list): d = d[0] if d else {}
    d = d.get(k) if isinstance(d,dict) else None
    if d is None: print(''); sys.exit()
print(d)"; }

# Row count, or -1 when the reply is not a list at all - which is how an error
# object arrives, and is never the same thing as "no rows".
rows() { python -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: print('-1'); sys.exit()
print(len(d) if isinstance(d,list) else -1)"; }

# Does this reply mean "the thing is not there" rather than "you may not"?
#
# The distinction is the whole point. PostgREST answers a missing table and a
# forbidden one with codes that look alike from a distance, and an earlier draft
# of this script reported PASS for a table that did not exist yet - a check that
# would have gone on passing forever without once testing a policy.
missing() { grep -qiE 'PGRST202|PGRST205|could not find|does not exist|schema cache'; }
refused() { grep -qiE '42501|violates row-level security|permission denied|insufficient'; }

# ----------------------------------------------------------------- two users
say "0. two anonymous users"

anon_session() {
  curl -s "$URL/auth/v1/signup" -H "apikey: $ANON" \
       -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{}'
}

SA=$(anon_session); TOK_A=$(echo "$SA" | jq_get access_token); UID_A=$(echo "$SA" | jq_get user.id)
SB=$(anon_session); TOK_B=$(echo "$SB" | jq_get access_token); UID_B=$(echo "$SB" | jq_get user.id)

if [ -z "$TOK_A" ] || [ -z "$TOK_B" ]; then
  echo "FAIL: could not create two anonymous sessions. Anonymous sign-ins off?"
  exit 1
fi

if [ "$UID_A" != "$UID_B" ]; then
  ok "two distinct users: ${UID_A:0:8} and ${UID_B:0:8}"
else
  bad "both sessions returned the same user"
fi

hA=(-H "apikey: $ANON" -H "Authorization: Bearer $TOK_A" -H "Content-Type: application/json")
hB=(-H "apikey: $ANON" -H "Authorization: Bearer $TOK_B" -H "Content-Type: application/json")
hAnon=(-H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json")

rpc() { curl -s "$URL/rest/v1/rpc/$1" "${@:3}" -d "$2"; }

# ------------------------------------------------------- 1. the email question
say "1. can an email account be made without a human clicking a link?"

EMAIL="artrail.verify.$(date +%s)@mailinator.com"
signup=$(curl -s "$URL/auth/v1/signup" -H "apikey: $ANON" -H "Content-Type: application/json" \
         -d "{\"email\":\"$EMAIL\",\"password\":\"Str0ng-Passw0rd-9x\"}")
EMAIL_TOK=$(echo "$signup" | jq_get access_token)

if [ -n "$EMAIL_TOK" ]; then
  ok "confirmations are off - creator checks can run as a real account"
else
  warn "confirmations are ON, so this script cannot make a confirmed account."
  printf '         The creator-side checks are NOT RUN, which is not the same\n'
  printf '         as passed. Turn confirmations off in Auth settings to run\n'
  printf '         them, or walk them by hand as a confirmed user.\n'
fi

# ------------------------------------------------- 2. anonymous cannot create
say "2. an anonymous user cannot create a trail"

r=$(rpc create_world '{"p_name":"Should not exist","p_mode":"guide"}' "${hA[@]}")
if echo "$r" | missing; then
  bad "create_world is not there yet - migration 0008 is not applied"
elif echo "$r" | grep -qiE 'real account|28000'; then
  ok "create_world refuses an anonymous caller"
else
  bad "expected a refusal, got: $(echo "$r" | cut200)"
fi

# --------------------------------------------- 3. the seam is still the seam
say "3. markers stay behind markers_near"

r=$(curl -s "$URL/rest/v1/markers?select=id&limit=5" "${hA[@]}")
n=$(echo "$r" | rows)
if [ "$n" = "0" ]; then
  ok "a joined-nothing user selects zero markers directly"
else
  bad "expected 0 rows, got $n: $(echo "$r" | cut200)"
fi

# ----------------------------------------------- 4. answers are not readable
say "4. marker_answers is not readable by a player"

r=$(curl -s "$URL/rest/v1/marker_answers?select=marker_id,accepted&limit=5" "${hA[@]}")
n=$(echo "$r" | rows)
if echo "$r" | missing; then
  bad "marker_answers does not exist yet - migration 0006 is not applied"
elif [ "$n" = "0" ]; then
  ok "zero rows for a player"
else
  bad "a player read $n answer row(s): $(echo "$r" | cut200)"
fi

# ------------------------------------------ 5. check_answer tells you nothing
say "5. check_answer never distinguishes wrong from unknown"

FAKE="00000000-0000-0000-0000-000000000000"
r1=$(rpc check_answer "{\"p_marker\":\"$FAKE\",\"p_submitted\":\"anything\"}" "${hA[@]}")
r2=$(rpc check_answer "{\"p_marker\":\"$FAKE\",\"p_submitted\":\"something else\"}" "${hA[@]}")

if echo "$r1" | missing; then
  bad "check_answer is not there yet - migration 0006 is not applied"
else
  if [ "$r1" = "$r2" ]; then
    ok "two different wrong answers give byte-identical replies"
  else
    bad "replies differ: [$r1] vs [$r2]"
  fi

  if echo "$r1" | grep -qiE 'accepted|correct_choice|expected'; then
    bad "the reply mentions the answer: $r1"
  else
    ok "the reply names no expected value: $r1"
  fi
fi

# ---------------------------------------------- 6. one team cannot see another
say "6. teams and rosters stay inside the team"

r=$(curl -s "$URL/rest/v1/team_members?select=team_id,user_id&limit=20" "${hB[@]}")
n=$(echo "$r" | rows)
if echo "$r" | missing; then
  bad "team_members does not exist yet - migration 0005 is not applied"
elif [ "$n" = "-1" ]; then
  bad "unexpected reply: $(echo "$r" | cut200)"
elif [ "$n" = "0" ]; then
  ok "user B, on no team, reads zero roster rows"
else
  foreign=$(echo "$r" | python -c "
import sys,json
d=json.load(sys.stdin)
print(sum(1 for x in d if isinstance(x,dict) and x.get('user_id') != '$UID_B'))")
  if [ "$foreign" = "0" ]; then
    ok "all $n rows belong to user B"
  else
    bad "user B read $foreign roster row(s) belonging to somebody else"
  fi
fi

# ------------------------------------------------- 7. progress is not writable
say "7. a client cannot write its own progress"

r=$(curl -s -X POST "$URL/rest/v1/marker_progress" "${hA[@]}" \
    -d "{\"team_id\":\"$FAKE\",\"marker_id\":\"$FAKE\",\"points\":9999}")
st=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/rest/v1/marker_progress" "${hA[@]}" \
     -d "{\"team_id\":\"$FAKE\",\"marker_id\":\"$FAKE\",\"points\":9999}")

if echo "$r" | missing; then
  bad "marker_progress does not exist yet - migration 0007 is not applied"
elif [ "${st:0:1}" = "2" ]; then
  bad "a client inserted its own progress row (HTTP $st)"
elif echo "$r" | refused || [ "$st" = "401" ] || [ "$st" = "403" ]; then
  ok "direct insert into marker_progress refused by policy (HTTP $st)"
else
  bad "refused, but not by a policy - check why: HTTP $st $(echo "$r" | cut200)"
fi

# award_progress must be absent from a client's view *while the rest of 0007 is
# present*. On its own, "not found" cannot tell revoked from not-yet-applied, so
# my_progress - granted by the same migration - is asked first.
probe=$(rpc my_progress "{\"p_world\":\"$FAKE\"}" "${hA[@]}")
if echo "$probe" | missing; then
  bad "migration 0007 is not applied, so the award_progress check cannot run"
else
  r=$(rpc award_progress "{\"p_team\":\"$FAKE\",\"p_marker\":\"$FAKE\",\"p_points\":9999,\"p_by\":\"$UID_A\"}" "${hA[@]}")
  if echo "$r" | missing; then
    ok "0007 is applied, and award_progress is still not callable by a client"
  else
    bad "award_progress answered a client: $(echo "$r" | cut200)"
  fi
fi

# ----------------------------------------------- 8. the leaderboard leaks nothing
say "8. the leaderboard names no marker and no submission"

YAMBOL="c1bd0005-be21-409f-9e28-40faf3abb661"
r=$(rpc world_leaderboard "{\"p_world\":\"$YAMBOL\"}" "${hAnon[@]}")
if echo "$r" | missing; then
  bad "world_leaderboard is not there yet - migration 0009 is not applied"
else
  n=$(echo "$r" | rows)
  if echo "$r" | grep -qiE 'submitted|marker_id|accepted'; then
    bad "the board names markers or submissions: $(echo "$r" | cut200)"
  else
    ok "the board names no marker and no submission (rows returned: $n)"
  fi
fi

# --------------------------------------------------- 9. my own data is my own
say "9. export names nobody else"

r=$(rpc export_my_data '{}' "${hA[@]}")
if echo "$r" | missing; then
  bad "export_my_data is not there yet - migration 0010 is not applied"
elif echo "$r" | grep -q "$UID_B"; then
  bad "user A's export mentions user B"
else
  ok "user A's export does not mention user B"
fi

# ---------------------------------------------------------------- the tally
printf '\n\033[1m%s\033[0m\n' "----------------------------------------------"
printf '  passed %s   failed %s   skipped %s\n' "$pass" "$fail" "$skip"
if [ "$skip" -gt 0 ]; then
  printf '  \033[33mSkipped is not passed.\033[0m Those checks did not run.\n'
fi
printf '\033[1m%s\033[0m\n' "----------------------------------------------"

[ "$fail" -eq 0 ] || exit 1
