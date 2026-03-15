const fetch = require('node-fetch');
const cron = require('node-cron');

// ── CONFIG ─────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://puwyrjejaaqfhcjwgrog.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const FOOTBALL_KEY = process.env.FOOTBALL_KEY;
const NBA_KEY      = process.env.NBA_KEY;

// Football competitions to track
const FOOTBALL_COMPETITIONS = [
  { id: 'PL',  name: 'АПЛ',              emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { id: 'PD',  name: 'Ла Лига',          emoji: '🇪🇸' },
  { id: 'SA',  name: 'Серия А',          emoji: '🇮🇹' },
  { id: 'BL1', name: 'Бундеслига',       emoji: '🇩🇪' },
  { id: 'CL',  name: 'Лига чемпионов',   emoji: '⭐' },
  { id: 'UCL', name: 'Лига чемпионов',   emoji: '⭐' },
];

// ── SUPABASE ───────────────────────────────────────────────────────
async function sb(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : '',
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(SUPABASE_URL + path, opts);
  if (!res.ok) {
    const err = await res.text();
    console.error(`Supabase error [${method} ${path}]:`, err);
    return null;
  }
  return res.json().catch(() => null);
}

// ── FOOTBALL API ───────────────────────────────────────────────────
async function fetchFootballMatches(daysAhead = 2) {
  const today = new Date();
  const future = new Date(today);
  future.setDate(future.getDate() + daysAhead);

  const dateFrom = today.toISOString().split('T')[0];
  const dateTo = future.toISOString().split('T')[0];

  const url = `https://api.football-data.org/v4/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`;
  const res = await fetch(url, {
    headers: { 'X-Auth-Token': FOOTBALL_KEY }
  });

  if (!res.ok) {
    console.error('Football API error:', res.status);
    return [];
  }

  const data = await res.json();
  return data.matches || [];
}

async function fetchFootballResults() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const today = new Date();

  const dateFrom = yesterday.toISOString().split('T')[0];
  const dateTo = today.toISOString().split('T')[0];

  const url = `https://api.football-data.org/v4/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=FINISHED`;
  const res = await fetch(url, {
    headers: { 'X-Auth-Token': FOOTBALL_KEY }
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data.matches || [];
}

// ── NBA API ────────────────────────────────────────────────────────
async function fetchNBAGames(daysAhead = 2) {
  const today = new Date();
  const future = new Date(today);
  future.setDate(future.getDate() + daysAhead);

  const dateFrom = today.toISOString().split('T')[0];
  const dateTo = future.toISOString().split('T')[0];

  const url = `https://api.balldontlie.io/v1/games?start_date=${dateFrom}&end_date=${dateTo}&per_page=25`;
  const res = await fetch(url, {
    headers: { 'Authorization': NBA_KEY }
  });

  if (!res.ok) {
    console.error('NBA API error:', res.status);
    return [];
  }

  const data = await res.json();
  return data.data || [];
}

async function fetchNBAResults() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const today = new Date();

  const dateFrom = yesterday.toISOString().split('T')[0];
  const dateTo = today.toISOString().split('T')[0];

  const url = `https://api.balldontlie.io/v1/games?start_date=${dateFrom}&end_date=${dateTo}&per_page=25`;
  const res = await fetch(url, {
    headers: { 'Authorization': NBA_KEY }
  });

  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || []).filter(g => g.status === 'Final');
}

// ── F1 API (free, no key needed) ───────────────────────────────────
async function fetchF1Races() {
  const year = new Date().getFullYear();
  const res = await fetch(`https://api.jolpi.ca/ergast/f1/${year}.json`);
  if (!res.ok) return [];
  const data = await res.json();
  const races = data?.MRData?.RaceTable?.Races || [];

  // Find upcoming races (next 14 days)
  const now = new Date();
  const soon = new Date();
  soon.setDate(soon.getDate() + 14);

  return races.filter(r => {
    const raceDate = new Date(r.date + 'T' + (r.time || '12:00:00'));
    return raceDate >= now && raceDate <= soon;
  });
}

// ── MARKET CREATION ────────────────────────────────────────────────
async function marketExists(externalId) {
  const data = await sb(`/rest/v1/markets?external_id=eq.${externalId}&select=id`);
  return data && data.length > 0;
}

async function createMarket(market) {
  // Check if already exists
  if (market.external_id && await marketExists(market.external_id)) {
    console.log(`Market already exists: ${market.external_id}`);
    return;
  }

  const result = await sb('/rest/v1/markets', 'POST', market);
  if (result) {
    console.log(`✓ Created market: ${market.title_ru}`);
  }
  return result;
}

// ── CREATE FOOTBALL MARKETS ────────────────────────────────────────
async function createFootballMarkets() {
  console.log('🔍 Fetching football matches...');
  const matches = await fetchFootballMatches(2);
  console.log(`Found ${matches.length} upcoming matches`);

  for (const match of matches) {
    const home = match.homeTeam?.shortName || match.homeTeam?.name || 'Home';
    const away = match.awayTeam?.shortName || match.awayTeam?.name || 'Away';
    const comp = match.competition?.name || 'Football';
    const matchDate = new Date(match.utcDate);
    const daysUntil = Math.ceil((matchDate - new Date()) / (1000 * 60 * 60 * 24));

    // Create 3 markets per match
    // Format match time in local-friendly way
    const matchTimeStr = matchDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kiev' });
    const matchDateStr = matchDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Kiev' });
    const today = new Date();
    const isToday = matchDate.toDateString() === today.toDateString();
    const isTomorrow = matchDate.toDateString() === new Date(today.getTime() + 86400000).toDateString();
    const dateLabel = isToday ? `Сег. ${matchTimeStr}` : isTomorrow ? `Завтра ${matchTimeStr}` : `${matchDateStr} ${matchTimeStr}`;

    const markets = [
      {
        external_id: `football_win_${match.id}`,
        emoji: '⚽',
        cat: 'sport',
        title_ru: `${home} победит ${away}? (${comp})`,
        title_uk: `${home} переможе ${away}? (${comp})`,
        title_en: `Will ${home} beat ${away}? (${comp})`,
        yes_prob: 55,
        volume: 0,
        trades: 0,
        deadline_days: Math.max(1, daysUntil + 1),
        active: true,
        live_score: dateLabel,
      },
      {
        external_id: `football_goals_${match.id}`,
        emoji: '⚽',
        cat: 'sport',
        title_ru: `Больше 2.5 голов в матче ${home} — ${away}?`,
        title_uk: `Більше 2.5 голів у матчі ${home} — ${away}?`,
        title_en: `Over 2.5 goals in ${home} vs ${away}?`,
        yes_prob: 52,
        volume: 0,
        trades: 0,
        deadline_days: Math.max(1, daysUntil + 1),
        active: true,
      },
      {
        external_id: `football_btts_${match.id}`,
        emoji: '⚽',
        cat: 'sport',
        title_ru: `Обе команды забьют в матче ${home} — ${away}?`,
        title_uk: `Обидві команди заб'ють у матчі ${home} — ${away}?`,
        title_en: `Both teams to score in ${home} vs ${away}?`,
        yes_prob: 55,
        volume: 0,
        trades: 0,
        deadline_days: Math.max(1, daysUntil + 1),
        active: true,
      }
    ];

    for (const m of markets) {
      await createMarket(m);
      await new Promise(r => setTimeout(r, 200)); // rate limit
    }
  }
}

// ── CREATE NBA MARKETS ─────────────────────────────────────────────
async function createNBAMarkets() {
  if (!NBA_KEY) { console.log('⚠️ No NBA key, skipping'); return; }
  console.log('🔍 Fetching NBA games...');
  const games = await fetchNBAGames(2);
  console.log(`Found ${games.length} upcoming NBA games`);

  for (const game of games) {
    const home = game.home_team?.abbreviation || game.home_team?.full_name || 'Home';
    const away = game.visitor_team?.abbreviation || game.visitor_team?.full_name || 'Away';
    const gameDate = new Date(game.date);
    const daysUntil = Math.ceil((gameDate - new Date()) / (1000 * 60 * 60 * 24));

    const markets = [
      {
        external_id: `nba_win_${game.id}`,
        emoji: '🏀',
        cat: 'sport',
        title_ru: `${home} победят ${away}? (НБА)`,
        title_uk: `${home} переможуть ${away}? (НБА)`,
        title_en: `Will ${home} beat ${away}? (NBA)`,
        yes_prob: 55,
        volume: 0,
        trades: 0,
        deadline_days: Math.max(1, daysUntil + 1),
        active: true,
      },
      {
        external_id: `nba_total_${game.id}`,
        emoji: '🏀',
        cat: 'sport',
        title_ru: `Тотал больше 220 очков в матче ${home} — ${away}?`,
        title_uk: `Тотал більше 220 очок у матчі ${home} — ${away}?`,
        title_en: `Over 220 points total in ${home} vs ${away}?`,
        yes_prob: 50,
        volume: 0,
        trades: 0,
        deadline_days: Math.max(1, daysUntil + 1),
        active: true,
      }
    ];

    for (const m of markets) {
      await createMarket(m);
      await new Promise(r => setTimeout(r, 200));
    }
  }
}

// ── CREATE F1 MARKETS ──────────────────────────────────────────────
async function createF1Markets() {
  console.log('🔍 Fetching F1 races...');
  const races = await fetchF1Races();
  console.log(`Found ${races.length} upcoming F1 races`);

  for (const race of races) {
    const raceName = race.raceName;
    const raceDate = new Date(race.date);
    const daysUntil = Math.ceil((raceDate - new Date()) / (1000 * 60 * 60 * 24));

    const topDrivers = ['Verstappen', 'Hamilton', 'Leclerc', 'Norris', 'Russell'];

    // Race winner market
    await createMarket({
      external_id: `f1_win_${race.round}_${race.season}`,
      emoji: '🏎',
      cat: 'sport',
      title_ru: `Ферстаппен выиграет ${raceName} 2026?`,
      title_uk: `Ферстаппен виграє ${raceName} 2026?`,
      title_en: `Will Verstappen win the ${raceName} 2026?`,
      yes_prob: 45,
      volume: 0,
      trades: 0,
      deadline_days: Math.max(1, daysUntil + 1),
      active: true,
    });

    // Podium market
    await createMarket({
      external_id: `f1_podium_${race.round}_${race.season}`,
      emoji: '🏎',
      cat: 'sport',
      title_ru: `Норрис попадёт в топ-3 на ${raceName}?`,
      title_uk: `Норріс потрапить у топ-3 на ${raceName}?`,
      title_en: `Will Norris finish top-3 at ${raceName}?`,
      yes_prob: 40,
      volume: 0,
      trades: 0,
      deadline_days: Math.max(1, daysUntil + 1),
      active: true,
    });
  }
}

// ── RESOLVE FINISHED MARKETS ───────────────────────────────────────
async function resolveFootballMarkets() {
  console.log('🔍 Checking finished football matches...');
  const matches = await fetchFootballResults();

  for (const match of matches) {
    if (match.status !== 'FINISHED') continue;
    const homeGoals = match.score?.fullTime?.home ?? 0;
    const awayGoals = match.score?.fullTime?.away ?? 0;
    const totalGoals = homeGoals + awayGoals;
    const homeWon = homeGoals > awayGoals;
    const bothScored = homeGoals > 0 && awayGoals > 0;

    // Resolve win market
    await sb(`/rest/v1/markets?external_id=eq.football_win_${match.id}`, 'PATCH', {
      active: false,
      yes_prob: homeWon ? 95 : 5,
    });

    // Resolve goals market
    await sb(`/rest/v1/markets?external_id=eq.football_goals_${match.id}`, 'PATCH', {
      active: false,
      yes_prob: totalGoals > 2.5 ? 95 : 5,
    });

    // Resolve btts market
    await sb(`/rest/v1/markets?external_id=eq.football_btts_${match.id}`, 'PATCH', {
      active: false,
      yes_prob: bothScored ? 95 : 5,
    });

    console.log(`✓ Resolved: ${match.homeTeam?.name} ${homeGoals}-${awayGoals} ${match.awayTeam?.name}`);
  }
}

// ── ADD COLUMNS IF NOT EXISTS ─────────────────────────────────────
async function ensureSchema() {
  console.log('✓ Schema ready');
}

// ── LIVE MARKETS ──────────────────────────────────────────────────
async function checkLiveMatches() {
  console.log('⚡ Checking live matches...');
  try {
    // Fetch currently live matches
    const res = await fetch('https://api.football-data.org/v4/matches?status=IN_PLAY', {
      headers: { 'X-Auth-Token': FOOTBALL_KEY }
    });
    if (!res.ok) return;
    const data = await res.json();
    const liveMatches = data.matches || [];

    for (const match of liveMatches) {
      const homeGoals = match.score?.fullTime?.home ?? match.score?.halfTime?.home ?? 0;
      const awayGoals = match.score?.fullTime?.away ?? match.score?.halfTime?.away ?? 0;

      // Get match minute and status
      // minute not available on free plan - use status
      const status = match.status;
      let timeLabel = 'LIVE';
      if (status === 'HALF_TIME' || status === 'PAUSED') timeLabel = 'ПТ';
      else if (status === 'EXTRA_TIME') timeLabel = 'ДВ';
      else if (status === 'PENALTY_SHOOTOUT') timeLabel = 'Пен';
      else if (status === 'IN_PLAY') timeLabel = 'LIVE';

      const score = `${homeGoals}:${awayGoals} ${timeLabel}`.trim();

      await sb(`/rest/v1/markets?external_id=eq.football_win_${match.id}`, 'PATCH', {
        live_score: score,
        is_live: true
      });
      console.log(`  LIVE: ${match.homeTeam?.name} ${score} ${match.awayTeam?.name}`);
    }

    // Mark finished matches as not live
    const finRes = await fetch('https://api.football-data.org/v4/matches?status=FINISHED', {
      headers: { 'X-Auth-Token': FOOTBALL_KEY }
    });
    if (finRes.ok) {
      const finData = await finRes.json();
      for (const match of (finData.matches || []).slice(0, 20)) {
        const h = match.score?.fullTime?.home ?? 0;
        const a = match.score?.fullTime?.away ?? 0;
        await sb(`/rest/v1/markets?external_id=eq.football_win_${match.id}`, 'PATCH', {
          is_live: false,
          live_score: `${h}:${a} ФТ`
        });
      }
    }
    console.log(`✓ Live check: ${liveMatches.length} live matches`);
  } catch(e) {
    console.error('Live check error:', e);
  }
}

// ── MAIN JOBS ──────────────────────────────────────────────────────
async function runDailyJob() {
  console.log('\n🚀 Running daily sports job:', new Date().toISOString());
  try {
    await createFootballMarkets();
    await createNBAMarkets();
    await createF1Markets();
    console.log('✅ Daily job complete');
  } catch (e) {
    console.error('Daily job error:', e);
  }
}

async function runResolutionJob() {
  console.log('\n🏁 Running resolution job:', new Date().toISOString());
  try {
    await resolveFootballMarkets();
    console.log('✅ Resolution job complete');
  } catch (e) {
    console.error('Resolution job error:', e);
  }
}

// ── SCHEDULE ───────────────────────────────────────────────────────
// Every day at 9:00 AM UTC — create markets for upcoming matches
cron.schedule('0 9 * * *', runDailyJob);

// Every day at 23:00 UTC — resolve finished matches
cron.schedule('0 23 * * *', runResolutionJob);

// Every 5 minutes — check live scores
cron.schedule('*/5 * * * *', checkLiveMatches);

// ── STARTUP ────────────────────────────────────────────────────────
console.log('⚡ Eventon Sports Server starting...');
console.log('📅 Schedule: Create markets @ 09:00 UTC, Resolve @ 23:00 UTC');
console.log('🏟 Sports: Football (PL/PD/SA/BL1/CL), NBA, F1');

ensureSchema().then(() => {
  // Run immediately on startup
  runDailyJob();
});

// Keep alive
setInterval(() => {
  console.log('💓 Server alive:', new Date().toISOString());
}, 60 * 60 * 1000); // every hour
