// prediction.js — pure prediction logic. No DOM, no globals. Fully testable.
import { clamp, weightedAverage, rng } from "./utils.js";

export const HOSTS = new Set(["USA", "MEX", "CAN"]); // CONCACAF co-hosts

export const DEFAULT_WEIGHTS = {
  b1: { h2h: 0.35, gfga: 0.40, pedigree: 0.45, knockout: 0.50, experience: 0.40 },
  b2: { form: 0.60, avail: 0.50, depth: 0.50, cohesion: 0.50, elo: 0.90 },
  b3: { upset: 0.35, penalty: 0.40, momentum: 0.35, homeAdv: 0.30, gutBoost: 0.0 },
  bucketMaster: { b1: 0.50, b2: 0.85, b3: 0.35 },
  gutPick: null,
};

// ---- team scoring -----------------------------------------------------------
// Strength is a LINEAR PREDICTOR over standardised (z-score) features:
//   strength = Σ_buckets  master_b · Σ_metrics ( weight · z_metric )
// i.e. a weighted sum of z-scores — the same form as the linear term in a
// logistic regression. Summing (not averaging) standardised features keeps the
// spread between teams, so moving a slider visibly changes the order.

export function baseScore(team, W) {
  const z = team.z;
  const sum = (pairs) => pairs.reduce((s, [v, w]) => s + v * w, 0);
  const b1 = sum([[z.pedigree, W.b1.pedigree], [z.knockout, W.b1.knockout], [z.gfga, W.b1.gfga], [z.experience, W.b1.experience]]);
  const b2 = sum([[z.form, W.b2.form], [z.avail, W.b2.avail], [z.depth, W.b2.depth], [z.cohesion, W.b2.cohesion], [z.elo, W.b2.elo]]);
  const b3 = sum([[z.momentum, W.b3.momentum]]);
  const strength = b1 * W.bucketMaster.b1 + b2 * W.bucketMaster.b2 + b3 * W.bucketMaster.b3;
  const sig = (x) => 1 / (1 + Math.exp(-x)); // squash each bucket to 0..1 for display only
  return {
    strength, score: strength,
    b1: sig(b1 * W.bucketMaster.b1), b2: sig(b2 * W.bucketMaster.b2), b3: sig(b3 * W.bucketMaster.b3),
  };
}

// Contextual matchup strength: base + real H2H record + home + gut + penalty (KO only).
export function matchupScore(team, opp, W, baseMap, ctx = {}) {
  let s = baseMap[team.code].strength;
  const h2h = team.stats.h2h && team.stats.h2h[opp.code];   // [advantage -1..1, meetings]
  const h2hAdv = h2h ? h2h[0] : 0;                          // 0 when the two have no history
  s += h2hAdv * 1.3 * W.b1.h2h * W.bucketMaster.b1;
  if (ctx.homeAdv !== false && HOSTS.has(team.code)) s += 0.45 * W.b3.homeAdv;
  if (W.gutPick === team.code) s += 5.5 * W.b3.gutBoost;          // strong enough to carry a team deep
  if (ctx.knockout) s += team.z.pen * 0.45 * W.b3.penalty;
  return s;
}

// Win probability for A — logistic on the strength difference (Bradley-Terry form).
// The "upset" slider is the temperature: chalk -> steep (decisive), chaos -> flat.
export function matchProbability(sA, sB, upset) {
  const k = 0.22 + 0.85 * (1 - upset);
  const pA = 1 / (1 + Math.exp(-k * (sA - sB)));
  return { pA, pB: 1 - pA };
}

// ---- group stage completion -------------------------------------------------

function blankRow(group) { return { pts: 0, gd: 0, gf: 0, group }; }

export function completeGroups(teams, groupMatches, W, baseMap) {
  const T = teams.byCode;
  const st = {};
  for (const c in T) st[c] = blankRow(T[c].group);

  for (const m of groupMatches) {
    const A = T[m.team1], B = T[m.team2];
    if (!A || !B) continue;
    let ga, gb;
    if (m.played && m.score) { [ga, gb] = m.score; }
    else {
      const sA = matchupScore(A, B, W, baseMap, { homeAdv: true });
      const sB = matchupScore(B, A, W, baseMap, { homeAdv: true });
      const { pA } = matchProbability(sA, sB, W.b3.upset);
      if (Math.abs(pA - 0.5) < 0.06) { ga = 1; gb = 1; }
      else if (pA > 0.5) { ga = pA > 0.7 ? 2 : 1; gb = 0; }
      else { gb = pA < 0.3 ? 2 : 1; ga = 0; }
    }
    apply(st[A.code], ga, gb); apply(st[B.code], gb, ga);
  }
  function apply(row, f, a) {
    row.gf += f; row.gd += f - a;
    row.pts += f > a ? 3 : f === a ? 1 : 0;
  }

  // rank within each group
  const byGroup = {};
  for (const c in st) (byGroup[st[c].group] ||= []).push(c);
  const cmp = (x, y) =>
    st[y].pts - st[x].pts || st[y].gd - st[x].gd || st[y].gf - st[x].gf ||
    T[y].elo - T[x].elo;
  const winner = {}, runner = {}, thirds = [];
  for (const g in byGroup) {
    const ord = byGroup[g].sort(cmp);
    winner[g] = ord[0]; runner[g] = ord[1];
    thirds.push({ code: ord[2], group: g, ...st[ord[2]] });
  }
  return { standings: st, winner, runner, thirds, byGroup };
}

// rank all 12 third-place teams, take the best 8 (FIFA rule)
export function bestThirds(thirds, teams) {
  const T = teams.byCode;
  const ranked = [...thirds].sort((a, b) =>
    b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || T[b.code].elo - T[a.code].elo);
  return ranked.slice(0, 8);
}

// Assign qualified third-place groups to the R32 "3A/B/.." slots via backtracking
// (reproduces FIFA's allocation: each slot lists eligible groups; find a perfect matching).
export function matchThirdsToSlots(slotTokens, qualifiedGroups) {
  const slots = slotTokens.map((tok) => ({
    tok, allow: tok.replace("3", "").split("/"),
  }));
  const avail = new Set(qualifiedGroups);
  const result = {};
  // order slots by fewest options first (constraint propagation)
  const order = [...slots].sort((a, b) => a.allow.length - b.allow.length);
  function solve(i) {
    if (i === order.length) return true;
    for (const g of order[i].allow) {
      if (avail.has(g)) {
        avail.delete(g); result[order[i].tok] = g;
        if (solve(i + 1)) return true;
        avail.add(g); delete result[order[i].tok];
      }
    }
    return false;
  }
  solve(0);
  return result; // { "3A/B/C/D/F": "B", ... }  group letter per slot
}

// ---- knockout simulation ----------------------------------------------------

export function seedKnockout(teams, matches, W, baseMap) {
  const groups = completeGroups(teams, matches.groupMatches, W, baseMap);
  const top8 = bestThirds(groups.thirds, teams);
  const qualifiedGroups = top8.map((t) => t.group);
  const thirdByGroup = {};
  for (const t of top8) thirdByGroup[t.group] = t.code;

  const r32 = matches.knockout.filter((m) => m.round === "Round of 32");
  const slotTokens = [];
  for (const m of r32) for (const tk of [m.team1, m.team2])
    if (/^3[A-L](\/[A-L])+$/.test(tk)) slotTokens.push(tk);
  const slotToGroup = matchThirdsToSlots(slotTokens, qualifiedGroups);

  const resolveStart = (tok) => {
    if (teams.byCode[tok]) return tok;                 // already a real code
    if (/^1[A-L]$/.test(tok)) return groups.winner[tok[1]];
    if (/^2[A-L]$/.test(tok)) return groups.runner[tok[1]];
    if (slotToGroup[tok]) return thirdByGroup[slotToGroup[tok]];
    return null;
  };
  const startPairs = {};
  for (const m of r32) startPairs[m.num] = [resolveStart(m.team1), resolveStart(m.team2)];
  return { groups, top8, startPairs };
}

export function simulateKnockout(teams, matches, W, baseMap, seed, stochastic, randSeed = 1) {
  const T = teams.byCode;
  const rand = rng(randSeed);
  const res = {}; // num -> {t1,t2,pA,winner,loser,round}
  const resolve = (tok, num) => {
    if (T[tok]) return tok;
    if (tok[0] === "W") return res[+tok.slice(1)]?.winner;
    if (tok[0] === "L") return res[+tok.slice(1)]?.loser;
    return seed.startPairs[num] ? null : null; // R32 handled below
  };
  for (const m of matches.knockout) {
    let t1, t2;
    if (m.round === "Round of 32") { [t1, t2] = seed.startPairs[m.num]; }
    else { t1 = resolve(m.team1, m.num); t2 = resolve(m.team2, m.num); }
    if (!t1 || !t2) { res[m.num] = { t1, t2, pA: 0.5, winner: t1 || t2, loser: null, round: m.round }; continue; }

    if (m.played && m.score) {
      const w = m.score[0] >= m.score[1] ? t1 : t2;
      res[m.num] = { t1, t2, pA: m.score[0] >= m.score[1] ? 1 : 0, winner: w, loser: w === t1 ? t2 : t1, round: m.round, real: true };
      continue;
    }
    const A = T[t1], B = T[t2];
    const sA = matchupScore(A, B, W, baseMap, { knockout: true, homeAdv: true });
    const sB = matchupScore(B, A, W, baseMap, { knockout: true, homeAdv: true });
    const { pA } = matchProbability(sA, sB, W.b3.upset);
    const aWins = stochastic ? rand() < pA : pA >= 0.5;
    res[m.num] = { t1, t2, pA, sA, sB, winner: aWins ? t1 : t2, loser: aWins ? t2 : t1, round: m.round };
  }
  return { res, champion: res[104]?.winner };
}

// ---- public: deterministic bracket + Monte-Carlo title odds -----------------

export function predict(teams, matches, weights, N = 2000) {
  const W = weights;
  const baseMap = {};
  for (const c in teams.byCode) baseMap[c] = baseScore(teams.byCode[c], W);

  const seed = seedKnockout(teams, matches, W, baseMap);
  const det = simulateKnockout(teams, matches, W, baseMap, seed, false);

  // Monte-Carlo title odds (KO only; seeding fixed for speed & a stable display bracket)
  const titles = {};
  for (let i = 0; i < N; i++) {
    const { champion } = simulateKnockout(teams, matches, W, baseMap, seed, true, 1000 + i * 2654435761);
    if (champion) titles[champion] = (titles[champion] || 0) + 1;
  }
  const titleOdds = {};
  for (const c in titles) titleOdds[c] = titles[c] / N;

  // sensitivity: a tie inside ~60/40 is a coin-flip a small change could swing
  for (const num in det.res) {
    const r = det.res[num];
    if (!r.t1 || !r.t2 || r.real) { r.razor = false; continue; }
    r.razor = Math.abs(r.pA - 0.5) < 0.12;
  }

  // computation tally (real work done this refresh) for the live counter
  const koCount = matches.knockout.length;
  const groupSims = matches.groupMatches.filter((m) => !m.played).length;
  const matchEvals = groupSims + koCount + N * koCount;     // matchProbability calls
  const baseEvals = Object.keys(baseMap).length;
  const stats = {
    teams: baseEvals,
    mcRuns: N,
    groupSims,
    koMatches: koCount,
    matchEvals,
    scoreEvals: matchEvals * 2,                             // matchupScore calls (2 per match)
    normEvals: baseEvals * 12,                              // metrics normalised across field
    computations: matchEvals * 3 + baseEvals * 13,          // prob + 2·score + base + 12·norm
  };

  return { seed, det, titleOdds, baseMap, stats };
}
