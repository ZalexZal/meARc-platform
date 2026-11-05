#!/bin/bash
# Build the lab website with the public Supabase URL and anon key from
# web/config.local.js, then serve it on :4399 (unless already served).
set -e
export PATH=$HOME/.local/node/bin:$PATH
cd "$(dirname "$0")/../../web"
export PUBLIC_SUPABASE_URL=$(grep -o "SUPABASE_URL[^,]*" config.local.js | grep -o "https://[^'\"]*")
export PUBLIC_SUPABASE_ANON_KEY=$(grep -o "SUPABASE_ANON_KEY[^,]*" config.local.js | grep -o "eyJ[^'\"]*")
[ -n "$PUBLIC_SUPABASE_URL" ] && [ -n "$PUBLIC_SUPABASE_ANON_KEY" ] || { echo "config missing"; exit 1; }
npx astro build 2>&1 | grep -iE "error|Complete!" | grep -v Shiki
if ! curl -s -o /dev/null http://localhost:4399/; then
  nohup npx astro preview --port 4399 > /tmp/lab-preview.log 2>&1 &
  for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:4399/ && break; sleep 1; done
fi
echo "preview on http://localhost:4399"
