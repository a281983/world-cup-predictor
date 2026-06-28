// data.js — load JSON, derive & normalise metrics, optional live refresh.
import { minMaxMap, zScoreMap, ppg } from "./utils.js";

const OPENFOOTBALL =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

// Recompute the [0,1] norm block for every team from its current raw stats.
function buildNorms(list) {
  const ratio = (t) => {
    const f = t.stats.recentForm.last10GoalsFor, a = t.stats.recentForm.last10GoalsAgainst;
    return (f + 1) / (a + 1);
  };
  const pedigreeRaw = (t) =>
    t.stats.historical.wcTitles * 3 + t.stats.historical.wcFinals * 1.5 + t.stats.historical.wcSemis;
  const momentumRaw = (t) => {
    const r = t.stats.recentForm.last5;
    const last = r.length ? (r[r.length - 1] === "W" ? 1 : r[r.length - 1] === "D" ? 0.5 : 0) : 0.5;
    const goalSig = t.stats.recentForm.last10GoalsFor - t.stats.recentForm.last10GoalsAgainst;
    return goalSig + last * 2;
  };

  const nElo = minMaxMap(list.map((t) => t.elo));
  const nRank = minMaxMap(list.map((t) => t.fifaRank));
  const nPed = minMaxMap(list.map(pedigreeRaw));
  const nKO = minMaxMap(list.map((t) => t.stats.historical.knockoutWinPct));
  const nGFGA = minMaxMap(list.map(ratio));
  const nExp = minMaxMap(list.map((t) => t.stats.historical.allTimeWinPct));
  const nForm = minMaxMap(list.map((t) => ppg(t.stats.recentForm.last5)));
  const nAvail = minMaxMap(list.map((t) => t.stats.squad.keyPlayersAvailable));
  const nDepth = minMaxMap(list.map((t) => t.stats.squad.squadDepthScore));
  const nCoh = minMaxMap(list.map((t) => t.stats.squad.tacticalCohesion));
  const nPen = minMaxMap(list.map((t) => t.stats.tactical.penaltyShootoutWinPct));
  const nMom = minMaxMap(list.map(momentumRaw));

  for (const t of list) {
    t.norm = {
      elo: nElo(t.elo),
      rankInv: 1 - nRank(t.fifaRank),
      pedigree: nPed(pedigreeRaw(t)),
      knockout: nKO(t.stats.historical.knockoutWinPct),
      gfga: nGFGA(ratio(t)),
      experience: nExp(t.stats.historical.allTimeWinPct),
      form: nForm(ppg(t.stats.recentForm.last5)),
      avail: nAvail(t.stats.squad.keyPlayersAvailable),
      depth: nDepth(t.stats.squad.squadDepthScore),
      cohesion: nCoh(t.stats.squad.tacticalCohesion),
      pen: nPen(t.stats.tactical.penaltyShootoutWinPct),
      momentum: nMom(momentumRaw(t)),
    };
  }

  // z-scores (standardised) drive the strength model — these preserve the spread
  // between teams that min-max averaging washes out, so reweighting actually bites.
  const zElo = zScoreMap(list.map((t) => t.elo));
  const zPed = zScoreMap(list.map(pedigreeRaw));
  const zKO = zScoreMap(list.map((t) => t.stats.historical.knockoutWinPct));
  const zGFGA = zScoreMap(list.map(ratio));
  const zExp = zScoreMap(list.map((t) => t.stats.historical.allTimeWinPct));
  const zForm = zScoreMap(list.map((t) => ppg(t.stats.recentForm.last5)));
  const zAvail = zScoreMap(list.map((t) => t.stats.squad.keyPlayersAvailable));
  const zDepth = zScoreMap(list.map((t) => t.stats.squad.squadDepthScore));
  const zCoh = zScoreMap(list.map((t) => t.stats.squad.tacticalCohesion));
  const zPen = zScoreMap(list.map((t) => t.stats.tactical.penaltyShootoutWinPct));
  const zMom = zScoreMap(list.map(momentumRaw));
  for (const t of list) {
    t.z = {
      elo: zElo(t.elo),
      pedigree: zPed(pedigreeRaw(t)),
      knockout: zKO(t.stats.historical.knockoutWinPct),
      gfga: zGFGA(ratio(t)),
      experience: zExp(t.stats.historical.allTimeWinPct),
      form: zForm(ppg(t.stats.recentForm.last5)),
      avail: zAvail(t.stats.squad.keyPlayersAvailable),
      depth: zDepth(t.stats.squad.squadDepthScore),
      cohesion: zCoh(t.stats.squad.tacticalCohesion),
      pen: zPen(t.stats.tactical.penaltyShootoutWinPct),
      momentum: zMom(momentumRaw(t)),
    };
  }
}

export function indexTeams(rawTeams) {
  const list = rawTeams.map((t) => ({
    code: t.code, name: t.name, flag: t.flag, group: t.group,
    elo: t.eloRating, fifaRank: t.fifaRank, stats: t.stats,
  }));
  buildNorms(list);
  const byCode = {}, byName = {};
  for (const t of list) { byCode[t.code] = t; byName[t.name] = t; }
  return { list, byCode, byName };
}

export async function loadData() {
  const [teamsJson, matchesJson] = await Promise.all([
    fetch("./data/teams.json").then((r) => r.json()),
    fetch("./data/matches.json").then((r) => r.json()),
  ]);
  const teams = indexTeams(teamsJson.teams);
  return { teams, matches: matchesJson, snapshot: matchesJson.lastSnapshot };
}

// Pull the latest openfootball results, fold them into the in-memory model.
// Returns { updated, snapshot, newResults } or throws on network failure.
export async function refreshLive(state) {
  const raw = await fetch(OPENFOOTBALL, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error("upstream " + r.status);
    return r.json();
  });
  const { teams, matches } = state;
  const byName = teams.byName;
  // reset accumulators
  for (const t of teams.list) {
    t.stats.recentForm.last5 = [];
    t.stats.recentForm.last10GoalsFor = 0;
    t.stats.recentForm.last10GoalsAgainst = 0;
  }
  const score = {};
  let newResults = 0, latest = state.snapshot;
  for (const m of raw.matches) {
    const ft = m.score && m.score.ft;
    if (!ft) continue;
    const A = byName[m.team1], B = byName[m.team2];
    if (!A || !B) continue;
    if (m.group && m.group.startsWith("Group")) {
      const rec = (t, gf, ga) => {
        t.stats.recentForm.last5.push(gf > ga ? "W" : gf === ga ? "D" : "L");
        t.stats.recentForm.last10GoalsFor += gf;
        t.stats.recentForm.last10GoalsAgainst += ga;
      };
      rec(A, ft[0], ft[1]); rec(B, ft[1], ft[0]);
      score[`${A.code}|${B.code}`] = ft;
      if (m.date > latest) latest = m.date;
    }
  }
  // write results back into matches.groupMatches; recount changes
  for (const gm of matches.groupMatches) {
    const key = `${gm.team1}|${gm.team2}`;
    if (score[key] && !gm.played) newResults++;
    if (score[key]) { gm.played = true; gm.score = score[key]; }
  }
  for (const t of teams.list) t.stats.recentForm.last5 = t.stats.recentForm.last5.slice(-5);
  buildNorms(teams.list);
  state.snapshot = latest;
  return { updated: true, snapshot: latest, newResults };
}
