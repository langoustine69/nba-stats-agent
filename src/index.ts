import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { createAgentApp } from '@lucid-agents/hono';
import { payments, paymentsFromEnv } from '@lucid-agents/payments';
import { createAgentIdentity, generateAgentRegistration } from '@lucid-agents/identity';
import { z } from 'zod';

// Initialize identity (auto-registers if PRIVATE_KEY and REGISTER_IDENTITY=true)
const identity = process.env.PRIVATE_KEY ? await createAgentIdentity({
  autoRegister: process.env.REGISTER_IDENTITY === 'true',
}).catch(e => {
  console.log('[identity] Skipping:', e.message);
  return null;
}) : null;

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const ESPN_V3 = 'https://site.api.espn.com/apis/common/v3/sports/basketball/nba';

// Helper to fetch JSON from ESPN API
async function fetchJSON(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ESPN API error: ${response.status}`);
  return response.json();
}

// Team ID lookup (common teams)
const TEAM_IDS: Record<string, number> = {
  'hawks': 1, 'atl': 1, 'atlanta': 1,
  'celtics': 2, 'bos': 2, 'boston': 2,
  'nets': 17, 'bkn': 17, 'brooklyn': 17,
  'hornets': 30, 'cha': 30, 'charlotte': 30,
  'bulls': 4, 'chi': 4, 'chicago': 4,
  'cavaliers': 5, 'cle': 5, 'cleveland': 5, 'cavs': 5,
  'mavericks': 6, 'dal': 6, 'dallas': 6, 'mavs': 6,
  'nuggets': 7, 'den': 7, 'denver': 7,
  'pistons': 8, 'det': 8, 'detroit': 8,
  'warriors': 9, 'gsw': 9, 'golden state': 9,
  'rockets': 10, 'hou': 10, 'houston': 10,
  'pacers': 11, 'ind': 11, 'indiana': 11,
  'clippers': 12, 'lac': 12, 'la clippers': 12,
  'lakers': 13, 'lal': 13, 'la lakers': 13, 'los angeles lakers': 13,
  'grizzlies': 29, 'mem': 29, 'memphis': 29,
  'heat': 14, 'mia': 14, 'miami': 14,
  'bucks': 15, 'mil': 15, 'milwaukee': 15,
  'timberwolves': 16, 'min': 16, 'minnesota': 16, 'wolves': 16,
  'pelicans': 3, 'nop': 3, 'new orleans': 3,
  'knicks': 18, 'nyk': 18, 'new york': 18,
  'thunder': 25, 'okc': 25, 'oklahoma city': 25,
  'magic': 19, 'orl': 19, 'orlando': 19,
  '76ers': 20, 'phi': 20, 'philadelphia': 20, 'sixers': 20,
  'suns': 21, 'phx': 21, 'phoenix': 21,
  'trail blazers': 22, 'por': 22, 'portland': 22, 'blazers': 22,
  'kings': 23, 'sac': 23, 'sacramento': 23,
  'spurs': 24, 'sas': 24, 'san antonio': 24,
  'raptors': 28, 'tor': 28, 'toronto': 28,
  'jazz': 26, 'uta': 26, 'utah': 26,
  'wizards': 27, 'was': 27, 'washington': 27,
};

function resolveTeamId(team: string): number {
  const normalized = team.toLowerCase().trim();
  if (TEAM_IDS[normalized]) return TEAM_IDS[normalized];
  const numId = parseInt(team);
  if (!isNaN(numId) && numId >= 1 && numId <= 30) return numId;
  throw new Error(`Unknown team: ${team}. Use team name, abbreviation, or ID (1-30)`);
}

const agent = await createAgent({
  name: 'nba-stats-agent',
  version: '1.0.0',
  description: 'Real-time NBA stats, scores, teams, and players from ESPN',
})
  .use(http())
  .use(payments({ config: paymentsFromEnv() }))
  .build();

const { app, addEntrypoint, runtime } = await createAgentApp(agent);

// Override agent.json to add required 'type' field for ERC-8004 compliance
app.get('/.well-known/agent.json', async (c) => {
  const res = await runtime.handlers.manifest(c.req.raw);
  const manifest = await res.json();
  return c.json({
    ...manifest,
    '@context': 'https://schema.org',
    '@type': 'SoftwareAgent',
    type: 'Agent',
  });
});

// === FREE: Overview ===
addEntrypoint({
  key: 'overview',
  description: 'Free overview - today\'s NBA games preview',
  input: z.object({}),
  price: { amount: 0 },
  handler: async () => {
    const data = await fetchJSON(`${ESPN_BASE}/scoreboard`);
    const games = data.events?.map((e: any) => ({
      name: e.shortName,
      status: e.status?.type?.description,
      date: e.date,
    })) || [];
    
    return {
      output: {
        league: 'NBA',
        season: data.season,
        gamesCount: games.length,
        games: games.slice(0, 5),
        fetchedAt: new Date().toISOString(),
        dataSource: 'ESPN API (live)',
      },
    };
  },
});

// === PAID $0.001: Live Games ===
addEntrypoint({
  key: 'games',
  description: 'Today\'s live NBA scoreboard with scores and status',
  input: z.object({
    date: z.string().optional().describe('Date in YYYYMMDD format, defaults to today'),
  }),
  price: { amount: 1000 },
  handler: async (ctx) => {
    const dateParam = ctx.input.date ? `?dates=${ctx.input.date}` : '';
    const data = await fetchJSON(`${ESPN_BASE}/scoreboard${dateParam}`);
    
    const games = data.events?.map((e: any) => {
      const comp = e.competitions?.[0];
      const homeTeam = comp?.competitors?.find((c: any) => c.homeAway === 'home');
      const awayTeam = comp?.competitors?.find((c: any) => c.homeAway === 'away');
      
      return {
        id: e.id,
        name: e.shortName,
        date: e.date,
        venue: comp?.venue?.fullName,
        status: e.status?.type?.description,
        period: e.status?.period,
        clock: e.status?.displayClock,
        homeTeam: {
          name: homeTeam?.team?.displayName,
          abbreviation: homeTeam?.team?.abbreviation,
          score: homeTeam?.score,
          winner: homeTeam?.winner,
        },
        awayTeam: {
          name: awayTeam?.team?.displayName,
          abbreviation: awayTeam?.team?.abbreviation,
          score: awayTeam?.score,
          winner: awayTeam?.winner,
        },
      };
    }) || [];
    
    return {
      output: {
        date: data.day?.date,
        gamesCount: games.length,
        games,
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID $0.002: Team Info ===
addEntrypoint({
  key: 'team',
  description: 'Get team info and roster (by name, abbreviation, or ID)',
  input: z.object({
    team: z.string().describe('Team name (e.g., "nuggets"), abbreviation (e.g., "DEN"), or ESPN ID'),
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const teamId = resolveTeamId(ctx.input.team);
    const [teamData, rosterData] = await Promise.all([
      fetchJSON(`${ESPN_BASE}/teams/${teamId}`),
      fetchJSON(`${ESPN_BASE}/teams/${teamId}/roster`),
    ]);
    
    const team = teamData.team;
    const roster = rosterData.athletes?.map((a: any) => ({
      id: a.id,
      name: a.displayName,
      jersey: a.jersey,
      position: a.position?.abbreviation,
      age: a.age,
    })) || [];
    
    return {
      output: {
        team: {
          id: team.id,
          name: team.displayName,
          abbreviation: team.abbreviation,
          location: team.location,
          color: team.color,
          logo: team.logos?.[0]?.href,
        },
        rosterCount: roster.length,
        roster: roster.slice(0, 15),
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID $0.002: Player Stats ===
addEntrypoint({
  key: 'player',
  description: 'Get player stats and overview by ESPN player ID',
  input: z.object({
    playerId: z.string().describe('ESPN player ID (e.g., "3112335" for Nikola Jokic)'),
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const data = await fetchJSON(`${ESPN_V3}/athletes/${ctx.input.playerId}/overview`);
    
    const stats = data.statistics?.splits?.categories?.[0]?.stats || [];
    const statMap: Record<string, any> = {};
    stats.forEach((s: any) => {
      statMap[s.abbreviation] = s.displayValue;
    });
    
    // gameLog.events is an object with game IDs as keys
    const events = data.gameLog?.events || {};
    const recentGames = Object.values(events).slice(0, 5).map((e: any) => ({
      date: e.gameDate,
      opponent: e.opponent?.displayName,
      result: e.gameResult,
      stats: e.stats,
    }));
    
    return {
      output: {
        playerId: ctx.input.playerId,
        name: data.news?.header,
        stats: statMap,
        recentGames,
        fantasy: data.fantasy,
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID $0.003: Compare Teams ===
addEntrypoint({
  key: 'compare',
  description: 'Compare two NBA teams',
  input: z.object({
    team1: z.string().describe('First team name/abbreviation/ID'),
    team2: z.string().describe('Second team name/abbreviation/ID'),
  }),
  price: { amount: 3000 },
  handler: async (ctx) => {
    const id1 = resolveTeamId(ctx.input.team1);
    const id2 = resolveTeamId(ctx.input.team2);
    
    const [team1Data, team2Data, roster1, roster2] = await Promise.all([
      fetchJSON(`${ESPN_BASE}/teams/${id1}`),
      fetchJSON(`${ESPN_BASE}/teams/${id2}`),
      fetchJSON(`${ESPN_BASE}/teams/${id1}/roster`),
      fetchJSON(`${ESPN_BASE}/teams/${id2}/roster`),
    ]);
    
    const extractTeam = (data: any, roster: any) => ({
      name: data.team.displayName,
      abbreviation: data.team.abbreviation,
      color: data.team.color,
      rosterSize: roster.athletes?.length || 0,
      keyPlayers: roster.athletes?.slice(0, 5).map((a: any) => ({
        name: a.displayName,
        position: a.position?.abbreviation,
      })) || [],
    });
    
    return {
      output: {
        team1: extractTeam(team1Data, roster1),
        team2: extractTeam(team2Data, roster2),
        fetchedAt: new Date().toISOString(),
      },
    };
  },
});

// === PAID $0.005: Full Report ===
addEntrypoint({
  key: 'report',
  description: 'Full NBA game day report with all games, news, and standings',
  input: z.object({
    date: z.string().optional().describe('Date in YYYYMMDD format, defaults to today'),
  }),
  price: { amount: 5000 },
  handler: async (ctx) => {
    const dateParam = ctx.input.date ? `?dates=${ctx.input.date}` : '';
    
    const [scoreboard, news] = await Promise.all([
      fetchJSON(`${ESPN_BASE}/scoreboard${dateParam}`),
      fetchJSON(`${ESPN_BASE}/news?limit=10`),
    ]);
    
    const games = scoreboard.events?.map((e: any) => {
      const comp = e.competitions?.[0];
      const homeTeam = comp?.competitors?.find((c: any) => c.homeAway === 'home');
      const awayTeam = comp?.competitors?.find((c: any) => c.homeAway === 'away');
      
      return {
        id: e.id,
        name: e.name,
        shortName: e.shortName,
        date: e.date,
        venue: comp?.venue?.fullName,
        status: e.status?.type?.description,
        period: e.status?.period,
        clock: e.status?.displayClock,
        homeTeam: {
          name: homeTeam?.team?.displayName,
          abbreviation: homeTeam?.team?.abbreviation,
          score: homeTeam?.score,
          record: homeTeam?.records?.[0]?.summary,
        },
        awayTeam: {
          name: awayTeam?.team?.displayName,
          abbreviation: awayTeam?.team?.abbreviation,
          score: awayTeam?.score,
          record: awayTeam?.records?.[0]?.summary,
        },
      };
    }) || [];
    
    const headlines = news.articles?.map((a: any) => ({
      headline: a.headline,
      description: a.description,
      published: a.published,
      link: a.links?.web?.href,
    })) || [];
    
    return {
      output: {
        date: scoreboard.day?.date,
        season: scoreboard.season,
        gamesCount: games.length,
        games,
        newsCount: headlines.length,
        news: headlines,
        fetchedAt: new Date().toISOString(),
        dataSource: 'ESPN API (live)',
      },
    };
  },
});

const port = Number(process.env.PORT ?? 3000);
console.log(`🏀 NBA Stats Agent running on port ${port}`);

export default { port, fetch: app.fetch };
