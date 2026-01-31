import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { createAgentApp } from '@lucid-agents/hono';
import { payments, paymentsFromEnv } from '@lucid-agents/payments';
import { z } from 'zod';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const ESPN_STATS = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba';

// Team ID mapping for common team abbreviations
const TEAM_ABBR_TO_ID: Record<string, string> = {
  ATL: '1', BOS: '2', BKN: '17', CHA: '30', CHI: '4',
  CLE: '5', DAL: '6', DEN: '7', DET: '8', GSW: '9',
  HOU: '10', IND: '11', LAC: '12', LAL: '13', MEM: '29',
  MIA: '14', MIL: '15', MIN: '16', NOP: '3', NYK: '18',
  OKC: '25', ORL: '19', PHI: '20', PHX: '21', POR: '22',
  SAC: '23', SAS: '24', TOR: '28', UTA: '26', WAS: '27'
};

const agent = await createAgent({
  name: 'nba-stats-agent',
  version: '1.0.0',
  description: 'Live NBA stats, scores, and player data via ESPN. Real-time game data, team rosters, league leaders, and matchup analysis for AI agents.',
})
  .use(http())
  .use(payments({ config: paymentsFromEnv() }))
  .build();

const { app, addEntrypoint } = await createAgentApp(agent);

async function fetchJSON(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ESPN API error: ${response.status}`);
  return response.json();
}

function resolveTeamId(team: string): string {
  const upper = team.toUpperCase();
  if (TEAM_ABBR_TO_ID[upper]) return TEAM_ABBR_TO_ID[upper];
  if (/^\d+$/.test(team)) return team;
  throw new Error(`Unknown team: ${team}. Use team abbreviation (e.g., LAL, BOS, GSW) or ESPN team ID.`);
}

// === FREE ENDPOINT: Overview ===
addEntrypoint({
  key: 'overview',
  description: "Free NBA overview - today's games and league snapshot",
  input: z.object({}),
  price: { amount: 0 },
  handler: async () => {
    const [scoreboard, news] = await Promise.all([
      fetchJSON(`${ESPN_BASE}/scoreboard`),
      fetchJSON(`${ESPN_BASE}/news?limit=3`)
    ]);

    const games = scoreboard.events?.map((e: any) => ({
      matchup: e.shortName,
      status: e.status?.type?.shortDetail,
      venue: e.competitions?.[0]?.venue?.fullName
    })) || [];

    const headlines = news.articles?.map((a: any) => a.headline) || [];

    return {
      output: {
        date: scoreboard.day?.date || new Date().toISOString().split('T')[0],
        gamesCount: games.length,
        games: games.slice(0, 5),
        latestNews: headlines,
        fetchedAt: new Date().toISOString(),
        dataSource: 'ESPN NBA API (live)'
      }
    };
  },
});

// === PAID $0.001: Live Scores ===
addEntrypoint({
  key: 'scores',
  description: 'Live NBA scores for today or specific date',
  input: z.object({
    date: z.string().optional().describe('Date in YYYYMMDD format (default: today)')
  }),
  price: { amount: 1000 },
  handler: async (ctx) => {
    const dateParam = ctx.input.date ? `?dates=${ctx.input.date}` : '';
    const data = await fetchJSON(`${ESPN_BASE}/scoreboard${dateParam}`);

    const games = data.events?.map((e: any) => {
      const comp = e.competitions?.[0];
      const home = comp?.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp?.competitors?.find((c: any) => c.homeAway === 'away');
      
      return {
        id: e.id,
        matchup: e.shortName,
        status: e.status?.type?.shortDetail,
        statusState: e.status?.type?.state,
        homeTeam: home?.team?.abbreviation,
        homeScore: home?.score,
        awayTeam: away?.team?.abbreviation,
        awayScore: away?.score,
        venue: comp?.venue?.fullName,
        broadcast: comp?.broadcasts?.[0]?.names?.[0]
      };
    }) || [];

    return {
      output: {
        date: data.day?.date,
        games,
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === PAID $0.002: Team Info ===
addEntrypoint({
  key: 'team',
  description: 'Team profile with roster and recent games',
  input: z.object({
    team: z.string().describe('Team abbreviation (LAL, BOS, GSW, etc.) or ESPN team ID')
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const teamId = resolveTeamId(ctx.input.team);
    
    const [roster, schedule] = await Promise.all([
      fetchJSON(`${ESPN_BASE}/teams/${teamId}/roster`),
      fetchJSON(`${ESPN_BASE}/teams/${teamId}/schedule`)
    ]);

    const teamInfo = roster.team || {};
    const players = roster.athletes?.map((p: any) => ({
      name: p.displayName,
      jersey: p.jersey,
      position: p.position?.abbreviation,
      height: p.displayHeight,
      weight: p.displayWeight
    })) || [];

    const recentGames = schedule.events?.slice(0, 5).map((e: any) => ({
      matchup: e.shortName,
      date: e.date,
      status: e.status?.type?.shortDetail
    })) || [];

    return {
      output: {
        team: {
          id: teamId,
          name: teamInfo.displayName,
          abbreviation: teamInfo.abbreviation,
          location: teamInfo.location,
          color: teamInfo.color,
          logo: teamInfo.logo
        },
        rosterSize: players.length,
        roster: players,
        recentGames,
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === PAID $0.002: League Leaders ===
addEntrypoint({
  key: 'leaders',
  description: 'NBA league leaders by statistical category',
  input: z.object({
    category: z.enum(['points', 'rebounds', 'assists', 'steals', 'blocks']).optional().default('points'),
    limit: z.number().optional().default(10)
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const catMap: Record<string, string> = {
      points: 'avgPoints',
      rebounds: 'avgRebounds', 
      assists: 'avgAssists',
      steals: 'avgSteals',
      blocks: 'avgBlocks'
    };

    const sortBy = catMap[ctx.input.category] || 'avgPoints';
    const data = await fetchJSON(`${ESPN_STATS}/statistics/byathlete?season=2026&limit=${ctx.input.limit}&sort=${sortBy}:desc`);

    const leaders = data.athletes?.map((a: any, i: number) => {
      const stats = a.categories?.[0]?.stats || [];
      return {
        rank: i + 1,
        name: a.athlete?.displayName,
        team: a.athlete?.teamShortName,
        position: a.athlete?.position?.abbreviation,
        gamesPlayed: stats.find((s: any) => s.name === 'gamesPlayed')?.value,
        points: stats.find((s: any) => s.name === 'avgPoints')?.value,
        rebounds: stats.find((s: any) => s.name === 'avgRebounds')?.value,
        assists: stats.find((s: any) => s.name === 'avgAssists')?.value,
        steals: stats.find((s: any) => s.name === 'avgSteals')?.value,
        blocks: stats.find((s: any) => s.name === 'avgBlocks')?.value
      };
    }) || [];

    return {
      output: {
        category: ctx.input.category,
        season: '2025-26',
        leaders,
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === PAID $0.003: Player Profile ===
addEntrypoint({
  key: 'player',
  description: 'Full player profile with stats and career info',
  input: z.object({
    playerId: z.string().describe('ESPN player/athlete ID')
  }),
  price: { amount: 3000 },
  handler: async (ctx) => {
    const data = await fetchJSON(`${ESPN_BASE}/athletes/${ctx.input.playerId}`);
    const athlete = data.athlete || {};
    
    const stats = athlete.statsSummary?.statistics?.[0]?.stats || [];
    const career = athlete.career?.stats?.[0]?.categories?.[0]?.stats || [];

    return {
      output: {
        player: {
          id: athlete.id,
          name: athlete.displayName,
          firstName: athlete.firstName,
          lastName: athlete.lastName,
          jersey: athlete.jersey,
          position: athlete.position?.name,
          team: athlete.team?.displayName,
          teamId: athlete.team?.id,
          height: athlete.displayHeight,
          weight: athlete.displayWeight,
          age: athlete.age,
          birthDate: athlete.dateOfBirth,
          birthPlace: athlete.birthPlace?.city,
          college: athlete.college?.name,
          draft: athlete.draft ? `${athlete.draft.year} Round ${athlete.draft.round} Pick ${athlete.draft.selection}` : null,
          experience: athlete.experience?.years,
          headshot: athlete.headshot?.href
        },
        seasonStats: stats.reduce((acc: any, s: any) => {
          acc[s.name] = s.value;
          return acc;
        }, {}),
        careerStats: career.reduce((acc: any, s: any) => {
          acc[s.name] = s.value;
          return acc;
        }, {}),
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === PAID $0.005: Matchup Analysis ===
addEntrypoint({
  key: 'matchup',
  description: 'Full matchup preview comparing two teams',
  input: z.object({
    homeTeam: z.string().describe('Home team abbreviation or ID'),
    awayTeam: z.string().describe('Away team abbreviation or ID')
  }),
  price: { amount: 5000 },
  handler: async (ctx) => {
    const homeId = resolveTeamId(ctx.input.homeTeam);
    const awayId = resolveTeamId(ctx.input.awayTeam);

    const [homeRoster, awayRoster, homeSchedule, awaySchedule] = await Promise.all([
      fetchJSON(`${ESPN_BASE}/teams/${homeId}/roster`),
      fetchJSON(`${ESPN_BASE}/teams/${awayId}/roster`),
      fetchJSON(`${ESPN_BASE}/teams/${homeId}/schedule`),
      fetchJSON(`${ESPN_BASE}/teams/${awayId}/schedule`)
    ]);

    const extractTeamInfo = (roster: any) => ({
      name: roster.team?.displayName,
      abbreviation: roster.team?.abbreviation,
      rosterSize: roster.athletes?.length || 0,
      starters: roster.athletes?.slice(0, 5).map((p: any) => ({
        name: p.displayName,
        position: p.position?.abbreviation,
        jersey: p.jersey
      })) || []
    });

    const extractRecord = (schedule: any) => {
      const wins = schedule.events?.filter((e: any) => 
        e.status?.type?.completed && e.competitions?.[0]?.competitors?.find((c: any) => c.winner)
      ).length || 0;
      const completed = schedule.events?.filter((e: any) => e.status?.type?.completed).length || 0;
      return { wins, losses: completed - wins, gamesPlayed: completed };
    };

    return {
      output: {
        matchup: `${ctx.input.awayTeam.toUpperCase()} @ ${ctx.input.homeTeam.toUpperCase()}`,
        homeTeam: {
          ...extractTeamInfo(homeRoster),
          record: extractRecord(homeSchedule)
        },
        awayTeam: {
          ...extractTeamInfo(awayRoster),
          record: extractRecord(awaySchedule)
        },
        analysis: {
          note: 'For betting odds and advanced analytics, consider additional data sources',
          generatedAt: new Date().toISOString()
        },
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

const port = Number(process.env.PORT ?? 3000);
console.log(`🏀 NBA Stats Agent running on port ${port}`);

export default { port, fetch: app.fetch };
