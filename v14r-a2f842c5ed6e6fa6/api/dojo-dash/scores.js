// Dojo Dash shared leaderboard — Vercel Serverless Function (Node).
// Stores ONLY: nickname (filtered), score, time, belt index, mastery level, date. No IP, no location, no user agent.
// Storage: Upstash Redis (Vercel Marketplace). Needs env vars KV_REST_API_URL + KV_REST_API_TOKEN
// (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN). If they're missing, returns 503 and the game stays local-only.
const crypto = require('crypto');
const NF = require('./_lib/nickfilter');
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const BOARD_RE = /^(dojoDashLeaderboard|dojoDashTeam|dojoDashMastery|dojoDashDaily-\d{4}-\d{2}-\d{2})$/;
const MAX_KEEP = 50, SHOW = 10, RATE_MAX = 6, RATE_WIN = 60; // 6 saves / minute / client

async function redis(cmds) {
  const r = await fetch(URL_ + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => x.result);
}
// Rate-limit key: salted hash of the IP that rotates daily, kept in memory for 60 s only. The IP itself is never stored or logged.
function rateKey(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  const day = new Date().toISOString().slice(0, 10);
  return 'dd:rl:' + crypto.createHash('sha256').update((process.env.DD_RATE_SALT || 'dojo') + day + ip).digest('hex').slice(0, 24);
}
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const int = (v, lo, hi) => { v = Math.floor(Number(v)); return Number.isFinite(v) && v >= lo && v <= hi ? v : null; };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  if (!URL_ || !TOK) { res.statusCode = 503; return res.end('{"error":"leaderboard storage not configured"}'); }
  try {
    const q = new URLSearchParams((req.url.split('?')[1]) || '');
    const board = q.get('board') || (req.body && req.body.board) || 'dojoDashLeaderboard';
    if (!BOARD_RE.test(board)) { res.statusCode = 400; return res.end('{"error":"bad board"}'); }
    const key = 'dd:lb:' + board;
    if (req.method === 'GET') {
      const [raw] = await redis([['ZREVRANGE', key, 0, SHOW - 1]]);
      return res.end(JSON.stringify({ board, entries: (raw || []).map(s => JSON.parse(s)) }));
    }
    if (req.method !== 'POST') { res.statusCode = 405; return res.end('{"error":"method"}'); }
    let b = req.body; if (typeof b === 'string') b = JSON.parse(b || '{}'); b = b || {};
    const names = clean(b.n).split(' & ');
    if (names.length < 1 || names.length > 2 || !names.every(x => NF.check(x).ok)) { res.statusCode = 422; return res.end('{"error":"nickname"}'); }
    const s = int(b.s, 0, 10000000), t = int(b.t, 0, 1e7), bl = int(b.b, 0, 40), m = b.m == null ? undefined : int(b.m, 1, 999);
    if (s === null || t === null || bl === null || m === null) { res.statusCode = 422; return res.end('{"error":"fields"}'); }
    const rk = rateKey(req);
    const [cnt] = await redis([['INCR', rk], ['EXPIRE', rk, RATE_WIN, 'NX']]);
    if (cnt > RATE_MAX) { res.statusCode = 429; return res.end('{"error":"slow down"}'); }
    const d = Date.now(), entry = { n: names.join(' & '), s, t, b: bl, d };
    if (m !== undefined) entry.m = m;
    // score is the sort key; tiny time-based fraction makes earlier equal scores rank higher
    const sortKey = s + (1 - (d % 1e9) / 1e9) * 0.5;
    const ttl = board.startsWith('dojoDashDaily-') ? ['EXPIRE', key, 14 * 86400] : ['PERSIST', key];
    await redis([['ZADD', key, sortKey, JSON.stringify(entry)], ['ZREMRANGEBYRANK', key, 0, -(MAX_KEEP + 1)], ttl]);
    res.statusCode = 201; return res.end(JSON.stringify({ ok: true, entry }));
  } catch (e) { res.statusCode = 500; return res.end('{"error":"server"}'); }
};
