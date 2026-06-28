#!/usr/bin/env python3
"""Compute real head-to-head records between the 48 teams from the public
martj42/international_results dataset (CC0) and inject them into data/teams.json.

For each ordered pair (A,B) we take the last up-to-10 meetings, recency-weight them
(0.9^k, newest first), and store A's advantage in [-1,1] plus the total meeting count:
    stats.h2h = { OPP_CODE: [advantage, meetings] }
Advantage > 0 means A has the better recent record; it is symmetric (adv_B = -adv_A).
"""
import csv, json, os

CSV = "/tmp/intl.csv"
TEAMS = os.path.join(os.path.dirname(__file__), "data/teams.json")

doc = json.load(open(TEAMS))
teams = doc["teams"]
name2code = {t["name"]: t["code"] for t in teams}

# dataset names that differ from ours (left = name in CSV, right = our team name)
ALIASES = {
    "United States": "USA",
    "Bosnia and Herzegovina": "Bosnia & Herzegovina",
    "West Germany": "Germany",          # predecessor — enriches German history
    "Türkiye": "Turkey",
    "Czechia": "Czech Republic",
}

def to_code(csv_name):
    if csv_name in name2code:
        return name2code[csv_name]
    if csv_name in ALIASES:
        return name2code[ALIASES[csv_name]]
    return None

# collect meetings keyed by the (smaller_code, larger_code); goals stored for smaller code first
meetings = {}
with open(CSV) as f:
    for r in csv.DictReader(f):
        h, a = to_code(r["home_team"]), to_code(r["away_team"])
        if not h or not a or h == a:
            continue
        try:
            hs, as_ = int(r["home_score"]), int(r["away_score"])
        except ValueError:
            continue
        date = r["date"]
        if h < a:
            meetings.setdefault((h, a), []).append((date, hs, as_))
        else:
            meetings.setdefault((a, h), []).append((date, as_, hs))

def advantage(games_for_a):
    """games_for_a: list of (ga, gb) most-recent-first. Returns weighted result in [-1,1]."""
    num = den = 0.0
    for k, (ga, gb) in enumerate(games_for_a[:10]):
        w = 0.9 ** k
        res = 1 if ga > gb else (-1 if ga < gb else 0)
        num += w * res
        den += w
    return round(num / den, 3) if den else 0.0

# build per-team h2h maps
h2h = {t["code"]: {} for t in teams}
pairs_ge1 = pairs_ge3 = 0
for (a, b), games in meetings.items():
    games.sort(key=lambda g: g[0], reverse=True)        # newest first
    n = len(games)
    a_games = [(ga, gb) for (_, ga, gb) in games]
    adv_a = advantage(a_games)
    h2h[a][b] = [adv_a, n]
    h2h[b][a] = [round(-adv_a, 3), n]
    pairs_ge1 += 1
    if n >= 3:
        pairs_ge3 += 1

for t in teams:
    t["stats"]["h2h"] = h2h[t["code"]]

json.dump(doc, open(TEAMS, "w"), ensure_ascii=False, indent=1)

total_pairs = 48 * 47 // 2
print(f"injected H2H into {len(teams)} teams")
print(f"pairs with >=1 meeting: {pairs_ge1}/{total_pairs} ({100*pairs_ge1//total_pairs}%)")
print(f"pairs with >=3 meetings: {pairs_ge3}/{total_pairs} ({100*pairs_ge3//total_pairs}%)")
# spot checks
import_code = {t["code"]: t["name"] for t in teams}
for a, b in [("ARG", "BRA"), ("ENG", "GER"), ("ESP", "POR"), ("USA", "MEX"), ("FRA", "BRA")]:
    rec = h2h[a].get(b)
    if rec:
        print(f"  {a} vs {b}: advantage {rec[0]:+.2f} over {rec[1]} meetings")
