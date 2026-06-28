#!/usr/bin/env python3
"""
Build data/teams.json and data/matches.json for the World Cup 2026 predictor.

Sources:
  - Match structure + real group results: openfootball/worldcup.json (MIT licence), /tmp/wc2026.json
  - FIFA rank / Elo: curated approximate June 2026 snapshot (clearly labelled approximate)
  - WC pedigree (titles/finals/semis): historical public record, hardcoded for notable nations
  - recentForm: DERIVED from the real played group results (genuine data)
  - Deeper "squad"/"tactical" stats: SYNTHETIC, deterministically derived from Elo + a
    seeded jitter. Illustrative only — documented as such in README.
"""
import json, hashlib, os

SRC = "/tmp/wc2026.json"
OUT = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(OUT, exist_ok=True)

raw = json.load(open(SRC))
matches = raw["matches"]

# ----------------------------------------------------------------------------
# 1. Curated team table (approximate June 2026). elo drives rank.
#    code, name, elo, (titles, finals, semis), flag
# ----------------------------------------------------------------------------
TEAMS = {
    # name: (elo, titles, finals, semis, flag)
    "Argentina":            (2100, 3, 6, 6, "🇦🇷"),
    "Spain":                (2085, 1, 1, 3, "🇪🇸"),
    "France":               (2070, 2, 4, 7, "🇫🇷"),
    "Brazil":               (2035, 5, 7, 11, "🇧🇷"),
    "England":              (2010, 1, 2, 3, "🏴󠁧󠁢󠁥󠁮󠁧󠁿"),
    "Portugal":             (1990, 0, 0, 2, "🇵🇹"),
    "Netherlands":          (1972, 0, 3, 5, "🇳🇱"),
    "Germany":              (1960, 4, 8, 13, "🇩🇪"),
    "Belgium":              (1930, 0, 0, 2, "🇧🇪"),
    "Croatia":              (1882, 0, 1, 3, "🇭🇷"),
    "Uruguay":              (1862, 2, 2, 5, "🇺🇾"),
    "Morocco":              (1852, 0, 0, 1, "🇲🇦"),
    "Colombia":             (1842, 0, 0, 0, "🇨🇴"),
    "Japan":                (1822, 0, 0, 0, "🇯🇵"),
    "Senegal":              (1812, 0, 0, 0, "🇸🇳"),
    "Switzerland":          (1802, 0, 0, 0, "🇨🇭"),
    "USA":                  (1792, 0, 0, 1, "🇺🇸"),
    "Mexico":               (1788, 0, 0, 0, "🇲🇽"),
    "Norway":               (1780, 0, 0, 0, "🇳🇴"),
    "Ecuador":              (1770, 0, 0, 0, "🇪🇨"),
    "Iran":                 (1758, 0, 0, 0, "🇮🇷"),
    "Austria":              (1750, 0, 0, 3, "🇦🇹"),
    "Turkey":               (1745, 0, 0, 1, "🇹🇷"),
    "South Korea":          (1740, 0, 0, 1, "🇰🇷"),
    "Sweden":               (1730, 0, 1, 4, "🇸🇪"),
    "Algeria":              (1722, 0, 0, 0, "🇩🇿"),
    "Australia":            (1718, 0, 0, 0, "🇦🇺"),
    "Canada":               (1710, 0, 0, 0, "🇨🇦"),
    "Czech Republic":       (1702, 0, 2, 3, "🇨🇿"),
    "Ivory Coast":          (1700, 0, 0, 0, "🇨🇮"),
    "Scotland":             (1698, 0, 0, 0, "🏴󠁧󠁢󠁳󠁣󠁴󠁿"),
    "Egypt":                (1695, 0, 0, 0, "🇪🇬"),
    "Bosnia & Herzegovina": (1688, 0, 0, 0, "🇧🇦"),
    "Paraguay":             (1685, 0, 0, 0, "🇵🇾"),
    "Ghana":                (1680, 0, 0, 0, "🇬🇭"),
    "Tunisia":              (1670, 0, 0, 0, "🇹🇳"),
    "DR Congo":             (1668, 0, 0, 0, "🇨🇩"),
    "Panama":               (1660, 0, 0, 0, "🇵🇦"),
    "South Africa":         (1652, 0, 0, 0, "🇿🇦"),
    "Qatar":                (1648, 0, 0, 0, "🇶🇦"),
    "Saudi Arabia":         (1642, 0, 0, 0, "🇸🇦"),
    "Uzbekistan":           (1640, 0, 0, 0, "🇺🇿"),
    "Iraq":                 (1622, 0, 0, 0, "🇮🇶"),
    "Cape Verde":           (1612, 0, 0, 0, "🇨🇻"),
    "Jordan":               (1600, 0, 0, 0, "🇯🇴"),
    "Curaçao":              (1562, 0, 0, 0, "🇨🇼"),
    "New Zealand":          (1558, 0, 0, 0, "🇳🇿"),
    "Haiti":                (1540, 0, 0, 0, "🇭🇹"),
}

CODE = {
    "Argentina":"ARG","Spain":"ESP","France":"FRA","Brazil":"BRA","England":"ENG",
    "Portugal":"POR","Netherlands":"NED","Germany":"GER","Belgium":"BEL","Croatia":"CRO",
    "Uruguay":"URU","Morocco":"MAR","Colombia":"COL","Japan":"JPN","Senegal":"SEN",
    "Switzerland":"SUI","USA":"USA","Mexico":"MEX","Norway":"NOR","Ecuador":"ECU",
    "Iran":"IRN","Austria":"AUT","Turkey":"TUR","South Korea":"KOR","Sweden":"SWE",
    "Algeria":"ALG","Australia":"AUS","Canada":"CAN","Czech Republic":"CZE","Ivory Coast":"CIV",
    "Scotland":"SCO","Egypt":"EGY","Bosnia & Herzegovina":"BIH","Paraguay":"PAR","Ghana":"GHA",
    "Tunisia":"TUN","DR Congo":"COD","Panama":"PAN","South Africa":"RSA","Qatar":"QAT",
    "Saudi Arabia":"KSA","Uzbekistan":"UZB","Iraq":"IRQ","Cape Verde":"CPV","Jordan":"JOR",
    "Curaçao":"CUW","New Zealand":"NZL","Haiti":"HAI",
}

# group membership
group_of = {}
for m in matches:
    g = m.get("group","")
    if g.startswith("Group"):
        letter = g.split()[1]
        group_of[m["team1"]] = letter
        group_of[m["team2"]] = letter

assert len(TEAMS) == 48, f"expected 48 teams, got {len(TEAMS)}"
assert set(TEAMS) == set(group_of), set(TEAMS) ^ set(group_of)

# ----------------------------------------------------------------------------
# REAL Elo — computed via the World Football Elo method over the full match
# history in martj42/international_results (CC0). Replaces the curated estimate.
# ----------------------------------------------------------------------------
import csv
ELO_CSV = "/tmp/intl.csv"
ELO_NORMALIZE = {"Türkiye": "Turkey", "Czechia": "Czech Republic"}
ELO_ALIAS = {"USA": "United States", "Bosnia & Herzegovina": "Bosnia and Herzegovina"}

def compute_real_elo():
    def kf(t):
        t = t.lower()
        if "world cup" in t and "qual" not in t: return 60
        if any(x in t for x in ["copa am", "european champ", "uefa euro", "nations cup", "gold cup", "asian cup"]): return 50
        if "qual" in t or "confederations" in t or "nations league" in t: return 40
        if "friendly" in t: return 20
        return 30
    def gm(gd):
        gd = abs(gd)
        return 1.0 if gd <= 1 else 1.5 if gd == 2 else (11 + gd) / 8
    elo = {}
    rows = list(csv.DictReader(open(ELO_CSV)))
    rows.sort(key=lambda r: r["date"])
    for r in rows:
        h = ELO_NORMALIZE.get(r["home_team"], r["home_team"])
        a = ELO_NORMALIZE.get(r["away_team"], r["away_team"])
        try:
            hs, as_ = int(r["home_score"]), int(r["away_score"])
        except ValueError:
            continue
        neutral = r["neutral"].strip().upper() == "TRUE"
        dr = elo.get(h, 1500.0) - elo.get(a, 1500.0) + (0 if neutral else 100)
        we = 1 / (10 ** (-dr / 400) + 1)
        w = 1.0 if hs > as_ else 0.5 if hs == as_ else 0.0
        ch = kf(r["tournament"]) * gm(hs - as_) * (w - we)
        elo[h] = elo.get(h, 1500.0) + ch
        elo[a] = elo.get(a, 1500.0) - ch
    return elo

_raw_elo = compute_real_elo()
REAL_ELO = {n: round(_raw_elo.get(ELO_ALIAS.get(n, n), 1500.0)) for n in TEAMS}
_elo_lo, _elo_hi = min(REAL_ELO.values()), max(REAL_ELO.values())

# ranks by real elo
ranked = sorted(TEAMS, key=lambda n: -REAL_ELO[n])
rank_of = {n: i+1 for i, n in enumerate(ranked)}

def seed_jitter(code, salt, lo, hi):
    """Deterministic pseudo-random in [lo,hi] from team code + salt."""
    h = int(hashlib.md5(f"{code}:{salt}".encode()).hexdigest()[:8], 16)
    return lo + (h % 10000) / 10000 * (hi - lo)

# ----------------------------------------------------------------------------
# 2. recentForm from REAL played group results
# ----------------------------------------------------------------------------
played = [m for m in matches if m.get("score",{}).get("ft")]
form = {n: {"res": [], "gf": 0, "ga": 0} for n in TEAMS}
for m in played:
    a, b = m["team1"], m["team2"]
    fa, fb = m["score"]["ft"]
    if a in form:
        form[a]["res"].append("W" if fa>fb else "D" if fa==fb else "L"); form[a]["gf"]+=fa; form[a]["ga"]+=fb
    if b in form:
        form[b]["res"].append("W" if fb>fa else "D" if fb==fa else "L"); form[b]["gf"]+=fb; form[b]["ga"]+=fa

# ----------------------------------------------------------------------------
# 3. Assemble teams.json
# ----------------------------------------------------------------------------
teams_out = []
for n in ranked:
    _, titles, finals, semis, flag = TEAMS[n]
    elo = REAL_ELO[n]
    c = CODE[n]
    en = (elo - _elo_lo) / (_elo_hi - _elo_lo)   # 0..1 strength anchor from real elo
    res = form[n]["res"]
    teams_out.append({
        "code": c, "name": n, "flag": flag,
        "fifaRank": rank_of[n], "eloRating": elo, "group": group_of[n],
        "stats": {
            "recentForm": {
                "last5": res[-5:],
                "last10GoalsFor": form[n]["gf"],
                "last10GoalsAgainst": form[n]["ga"],
            },
            "historical": {
                "wcTitles": titles, "wcFinals": finals, "wcSemis": semis,
                "allTimeWinPct": round(0.30 + en*0.45, 3),
                "knockoutWinPct": round(0.30 + en*0.45 + seed_jitter(c,"ko",-0.05,0.05), 3),
            },
            "squad": {
                "keyPlayersAvailable": round(0.78 + seed_jitter(c,"avail",0,0.22), 3),
                "squadDepthScore": round(0.45 + en*0.45 + seed_jitter(c,"depth",-0.05,0.05), 3),
                "tacticalCohesion": round(0.45 + en*0.40 + seed_jitter(c,"cohесion",-0.05,0.08), 3),
            },
            "tactical": {
                "penaltyShootoutWinPct": round(0.35 + seed_jitter(c,"pens",0,0.45), 3),
                "avgPossession": round(44 + en*16 + seed_jitter(c,"poss",-3,3), 1),
                "momentum": 0.0,  # filled live from form by the engine
            },
        },
    })

json.dump({"_note":"eloRating is REAL — World Football Elo computed from the full "
           "martj42/international_results match history (CC0). fifaRank is derived from that Elo. "
           "recentForm is derived from real played group results. squad/tactical fields are "
           "synthetic, Elo-anchored, illustrative only — see README and methodology.",
           "teams": teams_out},
          open(os.path.join(OUT,"teams.json"),"w"), ensure_ascii=False, indent=1)

# ----------------------------------------------------------------------------
# 4. Assemble matches.json — assign canonical match numbers, keep slot codes
#    Group games 1..72 (chronological), knockouts 73..104 in file order.
# ----------------------------------------------------------------------------
group_matches = [m for m in matches if m.get("group","").startswith("Group")]
group_matches.sort(key=lambda m:(m["date"], m.get("time","")))
ko_round_set = {"Round of 32","Round of 16","Quarter-final","Semi-final","Match for third place","Final"}
# IMPORTANT: keep original openfootball file order — it is the canonical FIFA match
# numbering (73..104) that the 'W##' winner references point at. Do NOT sort.
ko_matches = [m for m in matches if m["round"] in ko_round_set]

def team_ref(name):
    """Return code if it's a real qualified team, else keep the slot/winner token."""
    return CODE.get(name, name)

groups_out = []
for i, m in enumerate(group_matches, start=1):
    ft = m.get("score",{}).get("ft")
    groups_out.append({
        "num": i, "group": m["group"].split()[1], "date": m["date"],
        "team1": team_ref(m["team1"]), "team2": team_ref(m["team2"]),
        "played": bool(ft), "score": ft if ft else None,
    })

ko_out = []
n = 73
for m in ko_matches:
    ft = m.get("score",{}).get("ft")
    ko_out.append({
        "num": n, "round": m["round"], "date": m["date"], "ground": m.get("ground",""),
        "team1": team_ref(m["team1"]), "team2": team_ref(m["team2"]),
        "played": bool(ft), "score": ft if ft else None,
    })
    n += 1

json.dump({
    "_note":"Group results with played=true are real (openfootball). Slot tokens like "
            "'1F','2J','3A/B/C/D/F','W74' are resolved at runtime by the prediction engine.",
    "lastSnapshot": max(m["date"] for m in played),
    "source":"openfootball/worldcup.json (MIT)",
    "groupMatches": groups_out,
    "knockout": ko_out,
}, open(os.path.join(OUT,"matches.json"),"w"), ensure_ascii=False, indent=1)

print(f"teams: {len(teams_out)} | group matches: {len(groups_out)} "
      f"(played {sum(g['played'] for g in groups_out)}) | knockout slots: {len(ko_out)}")
print("champion-tier (top 6):", [f"{t['name']}({t['eloRating']})" for t in teams_out[:6]])
