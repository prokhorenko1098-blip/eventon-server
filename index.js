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
  // Try multiple F1 API endpoints
  const urls = [
    `https://ergast.com/api/f1/${year}.json`,
    `https://api.jolpi.ca/ergast/f1/${year}.json`,
  ];
  
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      const races = data?.MRData?.RaceTable?.Races || [];

      const now = new Date();
      const soon = new Date();
      soon.setDate(soon.getDate() + 30);

      return races.filter(r => {
        const raceDate = new Date(r.date + 'T' + (r.time || '12:00:00'));
        return raceDate >= now && raceDate <= soon;
      });
    } catch(e) {
      console.log(`F1 API failed (${url}):`, e.message);
    }
  }
  return [];
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
  const matches = await fetchFootballMatches(14);
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
  const games = await fetchNBAGames(14);
  console.log(`Found ${games.length} upcoming NBA games`);

  for (const game of games) {
    const home = game.home_team?.full_name || game.home_team?.name || game.home_team?.abbreviation || 'Home';
    const away = game.visitor_team?.full_name || game.visitor_team?.name || game.visitor_team?.abbreviation || 'Away';
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
  } catch (e) {
    console.error('Football job error:', e.message);
  }
  
  try {
    await createNBAMarkets();
  } catch (e) {
    console.error('NBA job error:', e.message);
  }
  
  try {
    await createF1Markets();
  } catch (e) {
    console.error('F1 job error:', e.message);
  }
  
  console.log('✅ Daily job complete');
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

// Every day at 21:00 UTC — refresh markets again
cron.schedule('0 21 * * *', runDailyJob);

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
  // Parse news on startup too
  setTimeout(createNewsMarkets, 5000);
});

// Keep alive
setInterval(() => {
  console.log('💓 Server alive:', new Date().toISOString());
}, 60 * 60 * 1000); // every hour

// ══════════════════════════════════════════════════════════════════
// ── NEWS PARSER — автоматические рынки из новостей ────────────────
// ══════════════════════════════════════════════════════════════════

const NEWS_SOURCES = [
  // Крипто
  { url: 'https://cointelegraph.com/rss', cat: 'crypto', lang: 'en' },
  { url: 'https://coindesk.com/arc/outboundfeeds/rss/', cat: 'crypto', lang: 'en' },
  // Политика/Мировые новости
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', cat: 'politics', lang: 'en' },
  { url: 'https://rss.reuters.com/reuters/worldNews', cat: 'politics', lang: 'en' },
  // Технологии/AI
  { url: 'https://techcrunch.com/feed/', cat: 'crypto', lang: 'en' },
  { url: 'https://www.theverge.com/rss/index.xml', cat: 'culture', lang: 'en' },
];

// Templates for generating market questions from news
const MARKET_TEMPLATES = {
  crypto: [
    {
      keywords: ['bitcoin', 'btc'],
      patterns: [
        { match: /\$[\d,]+k?/i, fn: (price) => {
          const num = parseFloat(price.replace(/[$,k]/gi, '')) * (price.toLowerCase().includes('k') ? 1000 : 1);
          const target = Math.round(num * 1.1 / 1000) * 1000;
          return {
            ru: `Bitcoin достигнет $${target.toLocaleString()} до конца месяца?`,
            uk: `Bitcoin досягне $${target.toLocaleString()} до кінця місяця?`,
            en: `Will Bitcoin reach $${target.toLocaleString()} by end of month?`,
            prob: 45, emoji: '₿', days: 30
          };
        }},
        { match: /fall|crash|drop|dump/i, fn: () => ({
          ru: 'Bitcoin упадёт ниже $70,000 в ближайшие 30 дней?',
          uk: 'Bitcoin впаде нижче $70,000 найближчі 30 днів?',
          en: 'Will Bitcoin drop below $70,000 in the next 30 days?',
          prob: 30, emoji: '📉', days: 30
        })},
        { match: /etf|институц/i, fn: () => ({
          ru: 'Bitcoin ETF привлечёт более $1 млрд за неделю?',
          uk: 'Bitcoin ETF залучить більше $1 млрд за тиждень?',
          en: 'Will Bitcoin ETF attract more than $1B in a week?',
          prob: 55, emoji: '₿', days: 14
        })},
      ]
    },
    {
      keywords: ['ethereum', 'eth'],
      patterns: [
        { match: /\$[\d,]+/i, fn: (price) => {
          const num = parseFloat(price.replace(/[$,]/g, ''));
          const target = Math.round(num * 1.15 / 100) * 100;
          return {
            ru: `Ethereum превысит $${target.toLocaleString()} до конца месяца?`,
            uk: `Ethereum перевищить $${target.toLocaleString()} до кінця місяця?`,
            en: `Will Ethereum exceed $${target.toLocaleString()} by end of month?`,
            prob: 42, emoji: '📈', days: 30
          };
        }},
        { match: /upgrade|update|merge/i, fn: () => ({
          ru: 'Обновление Ethereum выйдет без серьёзных проблем?',
          uk: 'Оновлення Ethereum вийде без серйозних проблем?',
          en: 'Will the Ethereum upgrade launch without major issues?',
          prob: 78, emoji: '⚡', days: 14
        })},
      ]
    },
    {
      keywords: ['solana', 'sol'],
      patterns: [
        { match: /.+/i, fn: () => ({
          ru: 'Solana войдёт в топ-3 криптовалют по капитализации?',
          uk: 'Solana увійде в топ-3 криптовалют за капіталізацією?',
          en: 'Will Solana enter the top 3 cryptos by market cap?',
          prob: 38, emoji: '🚀', days: 60
        })},
      ]
    },
    {
      keywords: ['sec', 'regulation', 'crypto law', 'регулирование'],
      patterns: [
        { match: /.+/i, fn: () => ({
          ru: 'SEC примет новые правила для крипты в ближайшие 60 дней?',
          uk: 'SEC прийме нові правила для крипти найближчі 60 днів?',
          en: 'Will the SEC adopt new crypto rules in the next 60 days?',
          prob: 52, emoji: '⚡', days: 60
        })},
      ]
    },
    {
      keywords: ['fed', 'federal reserve', 'interest rate', 'ставка'],
      patterns: [
        { match: /cut|lower|снизит/i, fn: () => ({
          ru: 'ФРС снизит ставку на следующем заседании?',
          uk: 'ФРС знизить ставку на наступному засіданні?',
          en: 'Will the Fed cut rates at the next meeting?',
          prob: 60, emoji: '💰', days: 45
        })},
        { match: /raise|hike|повысит/i, fn: () => ({
          ru: 'ФРС повысит ставку на следующем заседании?',
          uk: 'ФРС підвищить ставку на наступному засіданні?',
          en: 'Will the Fed raise rates at the next meeting?',
          prob: 25, emoji: '📊', days: 45
        })},
      ]
    },
  ],
  politics: [
    {
      keywords: ['trump', 'трамп'],
      patterns: [
        { match: /impeach|импич/i, fn: () => ({
          ru: 'Трамп переживёт попытку импичмента в 2026?',
          uk: 'Трамп переживе спробу імпічменту у 2026?',
          en: 'Will Trump survive an impeachment attempt in 2026?',
          prob: 72, emoji: '🇺🇸', days: 180
        })},
        { match: /sign|закон|bill/i, fn: () => ({
          ru: 'Трамп подпишет новый закон в ближайшие 30 дней?',
          uk: 'Трамп підпише новий закон найближчі 30 днів?',
          en: 'Will Trump sign a new major bill in the next 30 days?',
          prob: 65, emoji: '🏛', days: 30
        })},
      ]
    },
    {
      keywords: ['ukraine', 'україна', 'zelensky', 'зеленский', 'war', 'ceasefire'],
      patterns: [
        { match: /ceasefire|перемирие|перемир/i, fn: () => ({
          ru: 'Перемирие на Украине будет подписано до июня 2026?',
          uk: 'Перемир\'я в Україні буде підписано до червня 2026?',
          en: 'Will a Ukraine ceasefire be signed before June 2026?',
          prob: 48, emoji: '🇺🇦', days: 90
        })},
        { match: /aid|помощь|weapons/i, fn: () => ({
          ru: 'США одобрят новый пакет помощи Украине в 2026?',
          uk: 'США схвалять новий пакет допомоги Україні у 2026?',
          en: 'Will the US approve a new Ukraine aid package in 2026?',
          prob: 58, emoji: '🌍', days: 60
        })},
      ]
    },
    {
      keywords: ['election', 'выборы', 'вибори', 'poll', 'vote'],
      patterns: [
        { match: /.+/i, fn: () => ({
          ru: 'Действующий лидер выиграет следующие выборы?',
          uk: 'Чинний лідер виграє наступні вибори?',
          en: 'Will the incumbent win the upcoming election?',
          prob: 52, emoji: '🗳', days: 90
        })},
      ]
    },
    {
      keywords: ['china', 'китай', 'taiwan', 'тайвань'],
      patterns: [
        { match: /.+/i, fn: () => ({
          ru: 'Китай введёт новые санкции до конца 2026?',
          uk: 'Китай введе нові санкції до кінця 2026?',
          en: 'Will China impose new sanctions by end of 2026?',
          prob: 44, emoji: '🇨🇳', days: 180
        })},
      ]
    },
  ],
  culture: [
    {
      keywords: ['openai', 'gpt', 'chatgpt'],
      patterns: [
        { match: /gpt-5|gpt5/i, fn: () => ({
          ru: 'OpenAI выпустит GPT-5 в ближайшие 3 месяца?',
          uk: 'OpenAI випустить GPT-5 найближчі 3 місяці?',
          en: 'Will OpenAI release GPT-5 in the next 3 months?',
          prob: 62, emoji: '🤖', days: 90
        })},
        { match: /.+/i, fn: () => ({
          ru: 'OpenAI анонсирует новый продукт до конца квартала?',
          uk: 'OpenAI анонсує новий продукт до кінця кварталу?',
          en: 'Will OpenAI announce a new product before end of quarter?',
          prob: 70, emoji: '🤖', days: 45
        })},
      ]
    },
    {
      keywords: ['apple', 'iphone', 'apple intelligence'],
      patterns: [
        { match: /release|launch|выпуск/i, fn: () => ({
          ru: 'Apple выпустит новый продукт до конца квартала?',
          uk: 'Apple випустить новий продукт до кінця кварталу?',
          en: 'Will Apple release a new product before end of quarter?',
          prob: 68, emoji: '💡', days: 45
        })},
      ]
    },
    {
      keywords: ['elon', 'musk', 'tesla', 'spacex'],
      patterns: [
        { match: /twitter|x\.com/i, fn: () => ({
          ru: 'X (Twitter) достигнет 1 млрд пользователей в 2026?',
          uk: 'X (Twitter) досягне 1 млрд користувачів у 2026?',
          en: 'Will X (Twitter) reach 1B users in 2026?',
          prob: 35, emoji: '🌟', days: 180
        })},
        { match: /.+/i, fn: () => ({
          ru: 'Tesla выпустит Robotaxi до конца 2026?',
          uk: 'Tesla випустить Robotaxi до кінця 2026?',
          en: 'Will Tesla launch Robotaxi by end of 2026?',
          prob: 58, emoji: '🚀', days: 180
        })},
      ]
    },
    {
      keywords: ['game', 'gta', 'playstation', 'xbox', 'nintendo'],
      patterns: [
        { match: /gta|grand theft/i, fn: () => ({
          ru: 'GTA VI выйдет без переноса в 2026?',
          uk: 'GTA VI вийде без перенесення у 2026?',
          en: 'Will GTA VI launch in 2026 without delays?',
          prob: 68, emoji: '🎮', days: 180
        })},
      ]
    },
  ]
};

async function parseRSSFeed(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Eventon/1.0 RSS Reader' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];
    const xml = await res.text();

    // Simple XML parser for RSS items
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];
      const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                     item.match(/<title>(.*?)<\/title>/))?.[1] || '';
      const desc = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                    item.match(/<description>(.*?)<\/description>/))?.[1] || '';
      const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';

      if (title) items.push({
        title: title.replace(/<[^>]*>/g, '').trim(),
        desc: desc.replace(/<[^>]*>/g, '').trim().substring(0, 200),
        pubDate
      });
    }
    return items.slice(0, 10); // Top 10 items
  } catch(e) {
    console.log(`RSS error for ${url}:`, e.message);
    return [];
  }
}

function findMarketTemplate(text, cat) {
  const lowerText = text.toLowerCase();
  const templates = MARKET_TEMPLATES[cat] || [];

  for (const template of templates) {
    const hasKeyword = template.keywords.some(kw => lowerText.includes(kw));
    if (!hasKeyword) continue;

    for (const pattern of template.patterns) {
      const match = lowerText.match(pattern.match);
      if (match) {
        // Extract price/number if present
        const priceMatch = text.match(/\$[\d,]+k?/i);
        try {
          const market = pattern.fn(priceMatch ? priceMatch[0] : match[0]);
          if (market) return market;
        } catch(e) {}
      }
    }
  }
  return null;
}

async function newsMarketExists(title_ru) {
  // Check if similar market already exists (last 7 days)
  const data = await sb('/rest/v1/markets?title_ru=eq.' + encodeURIComponent(title_ru) + '&select=id');
  return data && data.length > 0;
}

async function createNewsMarkets() {
  console.log('\n📰 Parsing news for market ideas...');
  let created = 0;

  for (const source of NEWS_SOURCES) {
    console.log(`  Fetching: ${source.url}`);
    const items = await parseRSSFeed(source.url);
    console.log(`  Got ${items.length} items`);

    for (const item of items) {
      const fullText = item.title + ' ' + item.desc;
      const market = findMarketTemplate(fullText, source.cat);

      if (!market) continue;

      // Skip if market already exists
      if (await newsMarketExists(market.ru)) {
        console.log(`  Skip (exists): ${market.ru.substring(0, 50)}`);
        continue;
      }

      await sb('/rest/v1/markets', 'POST', {
        emoji: market.emoji,
        cat: source.cat,
        title_ru: market.ru,
        title_uk: market.uk,
        title_en: market.en,
        yes_prob: market.prob,
        volume: 0,
        trades: 0,
        deadline_days: market.days,
        active: true,
      });

      console.log(`  ✓ Created: ${market.ru.substring(0, 60)}`);
      created++;
      await new Promise(r => setTimeout(r, 500)); // rate limit
    }

    await new Promise(r => setTimeout(r, 1000)); // between sources
  }

  console.log(`📰 News markets done: ${created} new markets created`);
}

// Schedule news parsing every 6 hours
cron.schedule('0 */6 * * *', createNewsMarkets);
