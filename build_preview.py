#!/usr/bin/env python3
"""Bundle the multi-file app into ONE self-contained HTML that runs by double-click
(file://) — no server, no ES modules, no fetch. Data is embedded inline."""
import re, pathlib

root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text()
css = (root / "styles.css").read_text()
teams = (root / "data/teams.json").read_text()
matches = (root / "data/matches.json").read_text()

def strip_module(src):
    src = re.sub(r'^\s*import\s.*?;\s*$', '', src, flags=re.M)   # drop import lines
    src = re.sub(r'^\s*export\s+', '', src, flags=re.M)          # drop the export keyword
    return src

utils      = strip_module((root / "js/utils.js").read_text())
prediction = strip_module((root / "js/prediction.js").read_text())
data       = strip_module((root / "js/data.js").read_text())
ui         = strip_module((root / "js/ui.js").read_text())

# loadData() should read embedded globals instead of fetching files
data = data.replace(
    '''const [teamsJson, matchesJson] = await Promise.all([
    fetch("./data/teams.json").then((r) => r.json()),
    fetch("./data/matches.json").then((r) => r.json()),
  ]);''',
    'const teamsJson = window.__TEAMS__, matchesJson = window.__MATCHES__;')
assert "window.__TEAMS__" in data, "loadData fetch block not replaced — check source"

bundle = "\n".join([utils, prediction, data, ui])

out = html
out = out.replace('<link rel="stylesheet" href="./styles.css" />', f"<style>\n{css}\n</style>")
# the methodology link won't exist as a separate file here — make it open in the same standalone note
out = out.replace('href="./methodology.html" target="_blank" rel="noopener"',
                  'href="https://github.com/" target="_blank" rel="noopener" onclick="alert(\'The full methodology page ships with the deployable folder (methodology.html). This single file is the quick local preview.\');return false;"')
data_block = f'<script>window.__TEAMS__={teams};\nwindow.__MATCHES__={matches};</script>\n'
out = out.replace('<script type="module" src="./js/ui.js"></script>',
                  data_block + f'<script>\n{bundle}\n</script>')

(root / "wc2026_local.html").write_text(out)
print("wrote wc2026_local.html  (%.0f KB, self-contained)" % (len(out) / 1024))
