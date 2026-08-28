#!/bin/bash
#
# Trigger a "clear cache and deploy" production build on Netlify.
#
# Use this after making changes directly in the database (SQL console, Drizzle
# Studio, the scripts/backfill-* and import scripts) that bypass the app's normal
# revalidateTag() calls, so the cached public recipe catalog can otherwise stay
# stale for up to 24h.
#
# The site id is resolved by name via `netlify api listSites` so this keeps
# working if the project is re-created. Requires the Netlify CLI to be logged in.

set -euo pipefail

SITE_NAME="${NETLIFY_SITE_NAME}"

TOKEN="$(node -e "const c=require(process.env.HOME+'/Library/Preferences/netlify/config.json');const u=c.users;process.stdout.write(u[Object.keys(u)[0]].auth.token)")"

SITE_ID="$(netlify api listSites --data '{}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const s=JSON.parse(d).find(s=>s.name===process.argv[1]);if(!s){console.error('No Netlify site named '+process.argv[1]);process.exit(1)}process.stdout.write(s.id)})" "$SITE_NAME")"

echo "Clearing cache and redeploying $SITE_NAME ($SITE_ID)..."

curl -sS -i -X POST \
  "https://api.netlify.com/api/v1/sites/${SITE_ID}/builds?clear_cache=true" \
  -H "Authorization: Bearer ${TOKEN}"
