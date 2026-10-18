# Dojo Dash v13: shared leaderboard API (for Web Developer)

PREVIEW ONLY. Nothing has been created, deployed or merged. The player location map was dropped (Anthoni, 17 Oct 00:51), so there are no location headers and no region counts.

## Why scores "weren't saving"
The live game (v9, /games/dojo-dash/index.html) saves the leaderboard only in the browser's localStorage. There is no API and no database. The forza-karate-website project has no leaderboard function and no KV/Redis env vars. So:
- each device/browser has its own board (a score set on the iPad never appears on the iMac or anyone else's phone);
- Safari private mode / storage blocked: setItem throws and the error is silently swallowed, so nothing saves;
- Safari ITP wipes script-written storage after 7 days without a visit;
- preview URLs (GitHub Pages, *.vercel.app previews) are separate origins with separate boards;
- Daily boards use a per-day key (by design).
Same-device save + reload works in Chromium (tested).

## What v13 changes (index.html)
- Checks the save by reading it back, keeps an in-memory copy when storage is blocked, asks for persistent storage (navigator.storage.persist), and shows a toast: "saved to the Forza leaderboard" / "saved on this device" / "this browser is blocking saving".
- Optional online board: on forza-karate-website.vercel.app (or if window.DOJO_LB_API is set) it GETs and POSTs /api/dojo-dash/scores and merges the results with the local board. A 404/503/timeout means it's local-only and nothing breaks. The nickname filter is applied again on display.

## Server: api/dojo-dash/scores.js (+ _lib/nickfilter.js, a verbatim copy of NF)
- GET ?board=<key> returns the top 10. POST {board,n,s,t,b,m} saves an entry.
- Boards are whitelisted: dojoDashLeaderboard, dojoDashTeam, dojoDashMastery, dojoDashDaily-YYYY-MM-DD (daily boards expire after 14 days). It keeps the top 50.
- Stored: nickname (server-side NF filter, max 12 chars), score, time, belt index, mastery level, date. NO IP, location or user agent.
- Rate limit: 6 posts/min. The key is a daily-salted SHA-256 hash of the IP, kept in Redis for 60 s only. The IP itself is never stored or logged.
- Without env vars it returns 503 and the game stays local.

## Setup needed (after Anthoni approves)
1. Vercel → forza-karate-website → Storage/Marketplace → add **Upstash Redis** (free tier is fine) and connect it to the project. This injects KV_REST_API_URL and KV_REST_API_TOKEN (UPSTASH_REDIS_REST_URL/TOKEN also work).
2. Optional env var DD_RATE_SALT (any random string).
3. Copy api/dojo-dash/* into the site's API (Next.js: app/api/dojo-dash/scores/route.ts wrapper, or pages/api/dojo-dash/scores.js, which works as-is with the Node req/res signature) and v13/index.html into public/games/dojo-dash/index.html.
4. Privacy notice update (see below), then deploy a preview, test, and get Anthoni's OK before production.
(The existing BLOB_READ_WRITE_TOKEN store isn't suited to this because concurrent writes would overwrite each other. Use Redis.)

## Privacy notice update needed
Add a "Dojo Dash leaderboard" section: what's collected (chosen nickname, score, time, belt, date), its purpose (public leaderboard), that it's shown publicly, that no real names should be used (nicknames are filtered), the retention (daily boards 14 days, the main board until reset), that no IP or location is stored (a short-lived hashed rate-limit key only), that the processor is Upstash/Vercel, and how to ask for removal. It's a children's game, so lawful basis/legitimate interest and the UK Children's Code apply.
