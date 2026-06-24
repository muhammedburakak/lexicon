/* ═══════════════════════════════════════════════
   LEADERBOARD + CUSTOM SETS — Supabase ücretsiz + localStorage fallback

   Supabase SQL (bir kez çalıştır):
   ─────────────────────────────────
   create table leaderboard (
     id bigserial primary key,
     player_name text not null,
     score integer not null,
     category text not null,
     mode text default 'solo',
     streak integer default 0,
     set_code text default null,
     created_at timestamptz default now()
   );
   alter table leaderboard enable row level security;
   create policy "okuma" on leaderboard for select using (true);
   create policy "yazma" on leaderboard for insert with check (true);

   create table custom_sets (
     id bigserial primary key,
     set_code text unique not null,
     creator_name text not null,
     title text not null,
     questions jsonb not null,
     play_count integer default 0,
     created_at timestamptz default now()
   );
   alter table custom_sets enable row level security;
   create policy "okuma_cs" on custom_sets for select using (true);
   create policy "yazma_cs" on custom_sets for insert with check (true);
   create policy "guncelle_cs" on custom_sets for update using (true);

   Eğer leaderboard tablosu zaten varsa sadece şunu çalıştır:
   alter table leaderboard add column if not exists set_code text default null;

   ── Arkadaş sistemi SQL (bir kez çalıştır) ──
   alter table users add column if not exists last_seen timestamptz default now();

   create table if not exists friendships (
     id bigserial primary key,
     requester_id text not null,
     addressee_id text not null,
     status text default 'pending',
     created_at timestamptz default now(),
     unique(requester_id, addressee_id)
   );
   alter table friendships enable row level security;
   create policy "fr_read"   on friendships for select using (true);
   create policy "fr_insert" on friendships for insert with check (true);
   create policy "fr_update" on friendships for update using (true);
   create policy "fr_delete" on friendships for delete using (true);

   create table if not exists friend_invites (
     id bigserial primary key,
     from_user_id text not null,
     to_user_id   text not null,
     room_code    text not null,
     category     text default 'turkce',
     rounds       int  default 10,
     status       text default 'pending',
     created_at   timestamptz default now()
   );
   alter table friend_invites enable row level security;
   create policy "fi_read"   on friend_invites for select using (true);
   create policy "fi_insert" on friend_invites for insert with check (true);
   create policy "fi_update" on friend_invites for update using (true);
   ─────────────────────────────────
═══════════════════════════════════════════════ */

const SUPABASE_URL = 'https://uzvzkhiekubshxjzvvkm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6dnpraGlla3Vic2h4anp2dmttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNDgyMzIsImV4cCI6MjA5NDkyNDIzMn0.qXZQpuAJOhECYGVhRardkdb9eIV-GueWs69sbMUx3oM';

const LB_LOCAL_KEY  = 'lex_leaderboard_v1';
const CS_LOCAL_KEY  = 'lex_custom_sets_v1';
const LB_ENABLED    = !!(SUPABASE_URL && SUPABASE_KEY);

function _sbH(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    ...extra
  };
}

/* ── LEADERBOARD ─────────────────────────── */

async function lbSubmitScore({ playerName, score, category, mode, streak, setCode = null, weekKey = null }) {
  lbSaveLocal({ playerName, score, category, mode, streak, setCode, weekKey });
  if (!LB_ENABLED) return null;
  try {
    const body = { player_name: playerName.substring(0, 20), score, category, mode, streak };
    if (setCode)  body.set_code  = setCode;
    if (weekKey)  body.week_key  = weekKey;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leaderboard`, {
      method: 'POST',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(body)
    });
    return res.ok;
  } catch (e) { return null; }
}

async function lbFetch(category = 'all', limit = 20) {
  if (LB_ENABLED) {
    try {
      const now = new Date().toISOString();
      let url = `${SUPABASE_URL}/rest/v1/leaderboard?select=player_name,score,category,mode,streak,created_at&order=score.desc&limit=${limit}&set_code=is.null&expires_at=gt.${now}`;
      if (category !== 'all') url += `&category=eq.${encodeURIComponent(category)}`;
      const res = await fetch(url, { headers: _sbH() });
      if (res.ok) return await res.json();
    } catch (_) {}
  }
  return lbFetchLocal(category, limit);
}

function lbSaveLocal({ playerName, score, category, mode, streak, setCode = null, weekKey = null }) {
  const entries = JSON.parse(localStorage.getItem(LB_LOCAL_KEY) || '[]');
  entries.push({
    player_name: playerName.substring(0, 20),
    score, category, mode, streak,
    set_code: setCode,
    week_key: weekKey,
    created_at: new Date().toISOString()
  });
  entries.sort((a, b) => b.score - a.score);
  localStorage.setItem(LB_LOCAL_KEY, JSON.stringify(entries.slice(0, 200)));
}

async function lbFetchChallenge(weekKey, limit = 50) {
  if (LB_ENABLED) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/leaderboard?select=player_name,score,streak,created_at&mode=eq.challenge&week_key=eq.${encodeURIComponent(weekKey)}&order=score.desc&limit=${limit}`,
        { headers: _sbH() }
      );
      if (res.ok) return await res.json();
    } catch (_) {}
  }
  const entries = JSON.parse(localStorage.getItem(LB_LOCAL_KEY) || '[]');
  return entries
    .filter(e => e.mode === 'challenge' && e.week_key === weekKey)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function lbFetchLocal(category = 'all', limit = 20) {
  const entries = JSON.parse(localStorage.getItem(LB_LOCAL_KEY) || '[]');
  let filtered = entries.filter(e => !e.set_code);
  if (category !== 'all') filtered = filtered.filter(e => e.category === category);
  return filtered.slice(0, limit);
}

function lbFormatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

function lbModeLabel(mode) {
  return mode === 'duel' ? '⚔️' : mode === 'challenge' ? '🏆' : mode === 'daily' ? '🌅' : mode === 'custom' ? '🎨' : '🎯';
}

/* ── CUSTOM SETS ─────────────────────────── */

function _genSetCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 8; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

async function csCreate({ creatorName, title, questions, creatorUserId = null }) {
  const setCode = _genSetCode();
  const data = {
    set_code: setCode,
    creator_name: creatorName.substring(0, 20),
    title: title.substring(0, 40),
    questions,
    creator_user_id: creatorUserId
  };

  // Yerel cache'e kaydet
  const local = JSON.parse(localStorage.getItem(CS_LOCAL_KEY) || '{}');
  local[setCode] = { ...data, created_at: new Date().toISOString(), play_count: 0 };
  localStorage.setItem(CS_LOCAL_KEY, JSON.stringify(local));

  if (!LB_ENABLED) return setCode;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/custom_sets`, {
      method: 'POST',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(data)
    });
    return res.ok ? setCode : setCode;
  } catch (_) { return setCode; }
}

async function csFetch(setCode) {
  const local = JSON.parse(localStorage.getItem(CS_LOCAL_KEY) || '{}');

  if (LB_ENABLED) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/custom_sets?set_code=eq.${encodeURIComponent(setCode)}&select=*&limit=1`,
        { headers: _sbH() }
      );
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          local[setCode] = data[0];
          localStorage.setItem(CS_LOCAL_KEY, JSON.stringify(local));
          return data[0];
        }
      }
    } catch (_) {}
  }

  return local[setCode] || null;
}

async function csFetchByCreator(creatorUserId) {
  if (!LB_ENABLED) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/custom_sets?creator_user_id=eq.${encodeURIComponent(creatorUserId)}&select=*&order=created_at.desc&limit=50`,
      { headers: _sbH() }
    );
    if (res.ok) return await res.json();
  } catch (_) {}
  return [];
}

async function csScores(setCode, limit = 15) {
  if (LB_ENABLED) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/leaderboard?select=player_name,score,streak,created_at&set_code=eq.${encodeURIComponent(setCode)}&order=score.desc&limit=${limit}`,
        { headers: _sbH() }
      );
      if (res.ok) return await res.json();
    } catch (_) {}
  }
  const entries = JSON.parse(localStorage.getItem(LB_LOCAL_KEY) || '[]');
  return entries.filter(e => e.set_code === setCode).slice(0, limit);
}

async function csDelete(setCode) {
  // Yerel cache'den sil
  const local = JSON.parse(localStorage.getItem(CS_LOCAL_KEY) || '{}');
  delete local[setCode];
  localStorage.setItem(CS_LOCAL_KEY, JSON.stringify(local));

  if (!LB_ENABLED) return true;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/custom_sets?set_code=eq.${encodeURIComponent(setCode)}`,
      { method: 'DELETE', headers: _sbH() }
    );
    return res.ok;
  } catch (_) { return false; }
}

async function csIncrementPlay(setCode) {
  if (!LB_ENABLED) return;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/custom_sets?set_code=eq.${encodeURIComponent(setCode)}&select=play_count&limit=1`,
      { headers: _sbH() }
    );
    if (!r.ok) return;
    const d = await r.json();
    if (!d || !d[0]) return;
    await fetch(
      `${SUPABASE_URL}/rest/v1/custom_sets?set_code=eq.${encodeURIComponent(setCode)}`,
      {
        method: 'PATCH',
        headers: { ..._sbH(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ play_count: (d[0].play_count || 0) + 1 })
      }
    );
  } catch (_) {}
}

/* ── DUEL ROOMS ─────────────────────────── */

async function duelCreate(category, rounds) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];

  if (!LB_ENABLED) return code;

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/duel_rooms`, {
      method: 'POST',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        room_code: code, category, rounds,
        p1_score: 0, p1_correct: 0, p1_done: false,
        p2_score: 0, p2_correct: 0, p2_done: false
      })
    });
  } catch (_) {}
  return code;
}

async function duelJoin(roomCode, playerNum, playerName) {
  if (!LB_ENABLED) return true;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/duel_rooms?room_code=eq.${encodeURIComponent(roomCode)}`,
      {
        method: 'PATCH',
        headers: { ..._sbH(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ [`p${playerNum}_name`]: playerName.substring(0, 20) })
      }
    );
    return res.ok;
  } catch (_) { return false; }
}

async function duelFetch(roomCode) {
  if (!LB_ENABLED) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/duel_rooms?room_code=eq.${encodeURIComponent(roomCode)}&select=*&limit=1`,
      { headers: _sbH() }
    );
    if (res.ok) {
      const data = await res.json();
      return data && data.length > 0 ? data[0] : null;
    }
  } catch (_) {}
  return null;
}

async function duelUpdateScore(roomCode, playerNum, score, correct, done = false) {
  if (!LB_ENABLED) return;
  const p = `p${playerNum}`;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/duel_rooms?room_code=eq.${encodeURIComponent(roomCode)}`,
      {
        method: 'PATCH',
        headers: { ..._sbH(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          [`${p}_score`]: score,
          [`${p}_correct`]: correct,
          [`${p}_done`]: done
        })
      }
    );
  } catch (_) {}
}

async function duelSendReaction(roomCode, emoji, senderName) {
  if (!LB_ENABLED) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/duel_rooms?room_code=eq.${encodeURIComponent(roomCode)}`,
      {
        method: 'PATCH',
        headers: { ..._sbH(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ last_reaction: emoji, reaction_by: senderName })
      }
    );
  } catch (_) {}
}

/* ── TOURNAMENTS ─────────────────────────── */

const MY_TOURS_KEY = 'lex_my_tours_v1';

async function tourCreate({ creatorName, title, category, rounds, creatorUserId = null }) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];

  const data = {
    tour_code: code,
    creator_name: creatorName.substring(0, 20),
    title: title.substring(0, 40),
    category, rounds,
    creator_user_id: creatorUserId
  };

  const local = JSON.parse(localStorage.getItem(MY_TOURS_KEY) || '{}');
  local[code] = { ...data, created_at: new Date().toISOString() };
  localStorage.setItem(MY_TOURS_KEY, JSON.stringify(local));

  if (!LB_ENABLED) return code;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/tournaments`, {
      method: 'POST',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(data)
    });
  } catch (_) {}
  return code;
}

async function tourFetch(tourCode) {
  if (LB_ENABLED) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/tournaments?tour_code=eq.${encodeURIComponent(tourCode)}&select=*&limit=1`,
        { headers: _sbH() }
      );
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) return data[0];
      }
    } catch (_) {}
  }
  const local = JSON.parse(localStorage.getItem(MY_TOURS_KEY) || '{}');
  return local[tourCode] || null;
}

async function tourAddEntry({ tourCode, playerName, score, correct, streak, userId = null }) {
  if (!LB_ENABLED) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/tournament_entries`, {
      method: 'POST',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        tour_code: tourCode,
        player_name: playerName.substring(0, 20),
        score, correct, streak,
        user_id: userId
      })
    });
  } catch (_) {}
}

async function tourGetEntries(tourCode, limit = 100) {
  if (LB_ENABLED) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/tournament_entries?tour_code=eq.${encodeURIComponent(tourCode)}&select=player_name,score,correct,streak,played_at,user_id&order=score.desc&limit=${limit}`,
        { headers: _sbH() }
      );
      if (res.ok) return await res.json();
    } catch (_) {}
  }
  return [];
}

async function tourDelete(tourCode) {
  const local = JSON.parse(localStorage.getItem(MY_TOURS_KEY) || '{}');
  delete local[tourCode];
  localStorage.setItem(MY_TOURS_KEY, JSON.stringify(local));
  if (!LB_ENABLED) return;
  try {
    const r1 = await fetch(`${SUPABASE_URL}/rest/v1/tournaments?tour_code=eq.${encodeURIComponent(tourCode)}`, { method: 'DELETE', headers: _sbH() });
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/tournament_entries?tour_code=eq.${encodeURIComponent(tourCode)}`, { method: 'DELETE', headers: _sbH() });
    if (!r1.ok) console.error('tourDelete tournaments failed:', r1.status, await r1.text());
    if (!r2.ok) console.error('tourDelete entries failed:', r2.status, await r2.text());
  } catch (e) { console.error('tourDelete error:', e); }
}

async function tourFetchByCreator(creatorUserId) {
  if (!LB_ENABLED) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tournaments?creator_user_id=eq.${encodeURIComponent(creatorUserId)}&select=*&order=created_at.desc&limit=50`,
      { headers: _sbH() }
    );
    if (res.ok) return await res.json();
  } catch (_) {}
  return [];
}

/* ── APP USER (kimlik + kupa) ─────────────────────── */

const APP_USER_LOCAL = 'lex_app_user_v1';
const AVATARS_LIST = ['🐺','🦊','🐻','🐼','🦁','🐯','🐨','🦝','🦔','🐸','🦄','🐙','🦅','🐬','🦉'];

function appUserGetBadge(level) {
  if (level < 15) return '';
  if (level < 30) return '🥉';
  if (level < 45) return '🥈';
  if (level < 60) return '🥇';
  if (level < 75) return '💎';
  if (level < 90) return '👑';
  return '🔱';
}

function getLevelTier(level) {
  if (level >= 90) return 'tier-legend';
  if (level >= 75) return 'tier-crown';
  if (level >= 60) return 'tier-diamond';
  if (level >= 45) return 'tier-gold';
  if (level >= 30) return 'tier-silver';
  if (level >= 15) return 'tier-bronze';
  return 'tier-default';
}
function appUserGenId() {
  return 'u' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}
function appUserGenSuffix() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
function appUserGetLocal() { return JSON.parse(localStorage.getItem(APP_USER_LOCAL) || 'null'); }
function appUserSaveLocal(u) { localStorage.setItem(APP_USER_LOCAL, JSON.stringify(u)); }

async function appUserCreate({ userId, userTag, displayName, avatar }) {
  const data = { user_id: userId, user_tag: userTag, display_name: displayName, avatar, trophies: 0, wins: 0, losses: 0, xp: 0, games_played: 0, badges: {}, match_history: [], created_at: new Date().toISOString() };
  appUserSaveLocal(data);
  if (!LB_ENABLED) return data;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ user_id: userId, user_tag: userTag, display_name: displayName, avatar, trophies: 0, wins: 0, losses: 0, xp: 0, games_played: 0, badges: {}, match_history: [] })
    });
  } catch (_) {}
  return data;
}

async function appUserAddMatchHistory(userId, entry) {
  const u = appUserGetLocal() || {};
  const history = Array.isArray(u.match_history) ? u.match_history : [];
  history.unshift(entry);
  if (history.length > 10) history.length = 10;
  u.match_history = history;
  appUserSaveLocal(u);
  if (!LB_ENABLED) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ match_history: history })
    });
  } catch (_) {}
}

async function appUserIncrementGames(userId) {
  const u = appUserGetLocal() || {};
  u.games_played = (u.games_played || 0) + 1;
  appUserSaveLocal(u);
  if (!LB_ENABLED) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ games_played: u.games_played })
    });
  } catch (_) {}
}

async function appUserUpdateBadges(userId, badgesObj) {
  const u = appUserGetLocal() || {};
  u.badges = badgesObj;
  appUserSaveLocal(u);
  if (!LB_ENABLED) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ badges: badgesObj })
    });
  } catch (_) {}
}

async function appUserUpdateXP(userId, totalXP) {
  const u = appUserGetLocal() || {};
  u.xp = totalXP;
  appUserSaveLocal(u);
  if (!LB_ENABLED) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ xp: totalXP })
    });
  } catch (_) {}
}

async function appUserUpdateTrophies({ userId, trophyDelta, won }) {
  const u = appUserGetLocal() || {};
  u.trophies = Math.max(0, (u.trophies || 0) + trophyDelta);
  if (won === true) u.wins = (u.wins || 0) + 1;
  if (won === false) u.losses = (u.losses || 0) + 1;
  appUserSaveLocal(u);
  if (!LB_ENABLED) return u;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ trophies: u.trophies, wins: u.wins, losses: u.losses, last_seen: new Date().toISOString() })
    });
  } catch (_) {}
  return u;
}

async function appUserFetchTrophyLb(limit = 20) {
  if (LB_ENABLED) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/users?select=user_tag,display_name,avatar,trophies,wins,losses&order=trophies.desc&limit=${limit}`,
        { headers: _sbH() }
      );
      if (res.ok) return await res.json();
    } catch (_) {}
  }
  const u = appUserGetLocal();
  return u ? [{ user_tag: u.user_tag, display_name: u.display_name, avatar: u.avatar, trophies: u.trophies || 0, wins: u.wins || 0, losses: u.losses || 0 }] : [];
}

/* ── MATCHMAKING QUEUE ─────────────────────────── */

async function mmqJoin({ userId, userTag, displayName, avatar, trophies, level, category }) {
  await mmqLeave(userId).catch(() => {});
  if (!LB_ENABLED) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/matchmaking_queue`, {
      method: 'POST',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ user_id: userId, user_tag: userTag, display_name: displayName, avatar, trophies, level, category })
    });
  } catch (_) {}
}

async function mmqFindOpponent(userId, trophies, category) {
  if (!LB_ENABLED) return null;
  try {
    const now = new Date().toISOString();
    const min = Math.max(0, trophies - 150), max = trophies + 150;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/matchmaking_queue?user_id=neq.${encodeURIComponent(userId)}&matched=eq.false&category=eq.${encodeURIComponent(category)}&trophies=gte.${min}&trophies=lte.${max}&expires_at=gt.${now}&order=joined_at.asc&limit=1`,
      { headers: _sbH() }
    );
    if (res.ok) { const d = await res.json(); return d && d[0] ? d[0] : null; }
  } catch (_) {}
  return null;
}

async function mmqCheckMyStatus(userId) {
  if (!LB_ENABLED) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/matchmaking_queue?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
      { headers: _sbH() }
    );
    if (res.ok) { const d = await res.json(); return d && d[0] ? d[0] : null; }
  } catch (_) {}
  return null;
}

async function mmqSetMatched(userId, roomCode) {
  if (!LB_ENABLED) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/matchmaking_queue?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ matched: true, room_code: roomCode })
    });
  } catch (_) {}
}

async function mmqLeave(userId) {
  if (!LB_ENABLED) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/matchmaking_queue?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'DELETE', headers: _sbH()
    });
  } catch (_) {}
}

/* ── FRIENDS ─────────────────────────────────── */

async function friendFindBySuffix(suffix) {
  if (!LB_ENABLED) return [];
  try {
    const clean = suffix.replace(/^#/, '').toUpperCase();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/users?user_tag=like.*%23${clean}&select=user_id,user_tag,display_name,avatar,trophies,last_seen&limit=5`,
      { headers: _sbH() }
    );
    if (res.ok) { const d = await res.json(); return Array.isArray(d) ? d : []; }
  } catch (_) {}
  return [];
}

async function friendSendRequest(requesterId, addresseeId) {
  if (!LB_ENABLED) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/friendships`, {
      method: 'POST',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ requester_id: requesterId, addressee_id: addresseeId, status: 'pending' })
    });
    return res.ok || res.status === 409;
  } catch (_) {}
  return false;
}

async function friendAccept(friendshipId) {
  if (!LB_ENABLED) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/friendships?id=eq.${friendshipId}`, {
      method: 'PATCH',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'accepted' })
    });
  } catch (_) {}
}

async function friendRemove(requesterId, addresseeId) {
  if (!LB_ENABLED) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/friendships?or=(and(requester_id.eq.${encodeURIComponent(requesterId)},addressee_id.eq.${encodeURIComponent(addresseeId)}),and(requester_id.eq.${encodeURIComponent(addresseeId)},addressee_id.eq.${encodeURIComponent(requesterId)}))`,
      { method: 'DELETE', headers: _sbH() }
    );
  } catch (_) {}
}

async function friendFetchAll(userId) {
  if (!LB_ENABLED) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/friendships?or=(requester_id.eq.${encodeURIComponent(userId)},addressee_id.eq.${encodeURIComponent(userId)})&select=*`,
      { headers: _sbH() }
    );
    if (res.ok) return await res.json();
  } catch (_) {}
  return [];
}

async function friendFetchUsersByIds(ids) {
  if (!LB_ENABLED || !ids.length) return [];
  try {
    const filter = ids.map(id => `user_id.eq.${encodeURIComponent(id)}`).join(',');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/users?or=(${filter})&select=user_id,user_tag,display_name,avatar,trophies,last_seen`,
      { headers: _sbH() }
    );
    if (res.ok) return await res.json();
  } catch (_) {}
  return [];
}

async function friendInviteSend({ fromUserId, toUserId, roomCode, category, rounds }) {
  if (!LB_ENABLED) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/friend_invites`, {
      method: 'POST',
      headers: { ..._sbH(), 'Prefer': 'return=representation' },
      body: JSON.stringify({ from_user_id: fromUserId, to_user_id: toUserId, room_code: roomCode, category, rounds, status: 'pending' })
    });
    if (res.ok) {
      const d = await res.json();
      return d[0]?.id || null;
    }
  } catch (_) {}
  return null;
}

async function friendInviteFetchStatus(inviteId) {
  if (!LB_ENABLED) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/friend_invites?id=eq.${inviteId}&select=status&limit=1`,
      { headers: _sbH() }
    );
    if (res.ok) {
      const d = await res.json();
      return d[0]?.status || null;
    }
  } catch (_) {}
  return null;
}

async function friendInviteFetch(toUserId) {
  if (!LB_ENABLED) return [];
  try {
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/friend_invites?to_user_id=eq.${encodeURIComponent(toUserId)}&status=eq.pending&created_at=gte.${encodeURIComponent(since)}&select=*&order=created_at.desc&limit=5`,
      { headers: _sbH() }
    );
    if (res.ok) return await res.json();
  } catch (_) {}
  return [];
}

async function friendInviteRespond(inviteId, status) {
  if (!LB_ENABLED) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/friend_invites?id=eq.${inviteId}`, {
      method: 'PATCH',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status })
    });
  } catch (_) {}
}

async function userUpdateLastSeen(userId) {
  if (!LB_ENABLED) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ last_seen: new Date().toISOString() })
    });
  } catch (_) {}
}

function friendIsOnline(lastSeen) {
  if (!lastSeen) return false;
  return (Date.now() - new Date(lastSeen).getTime()) < 3 * 60 * 1000;
}

/* ── USER AUTH (PIN) ─────────────────────────── */

async function appUserLoginByName(displayName, pinCode) {
  if (!LB_ENABLED) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/users?display_name=eq.${encodeURIComponent(displayName)}&pin_code=eq.${encodeURIComponent(pinCode)}&select=*&limit=5`,
      { headers: _sbH() }
    );
    if (res.ok) { const d = await res.json(); return d && d.length > 0 ? d : null; }
  } catch (_) {}
  return null;
}

async function appUserSetPin(userId, pinCode) {
  const u = appUserGetLocal() || {};
  u.pin_code = pinCode;
  appUserSaveLocal(u);
  if (!LB_ENABLED) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { ..._sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ pin_code: pinCode })
    });
  } catch (_) {}
}

async function appUserDelete(userId) {
  localStorage.removeItem(APP_USER_LOCAL);
  if (!LB_ENABLED) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/users?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'DELETE', headers: _sbH()
    });
  } catch (_) {}
}
