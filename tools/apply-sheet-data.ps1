# Recovers the two things the chart carries only as formatting, and writes them
# into chart.json:
#
#   difficulty tier  <- fill colour of the "dot" cell next to each exercise
#   milestone        <- the exercise name being BOLD
#
# On the milestone finding: the legend defines "Milestone" as a grey dot, but no
# grey dot appears anywhere in v5.4, v5.3 or v5.2. What does partition the
# exercises is bold: 46 names in v5.2, 49 in v5.3, 55 in v5.4 - a curated list
# that grew each release, and which reads exactly like a milestone set (Pull Up,
# Dip, Muscle Up, Front Lever, Planche, Iron Cross, Manna...). That inference is
# the basis for the flags. See CLAUDE.md.
#
# Usage:
#   apply-sheet-data.ps1 -Extracted <unzipped xlsx dir> -Chart chart.json
param(
  [Parameter(Mandatory = $true)][string]$Extracted,
  [Parameter(Mandatory = $true)][string]$Chart,
  [string]$Sheet = "sheet1.xml"
)
$ErrorActionPreference = "Stop"

$TIER = @{
  "FFC5E0B3" = "Beginner"
  "FFB4C6E7" = "Intermediate"
  "FFFFD965" = "Advanced"
  "FFF4B083" = "Elite"
}

function ColNum([string]$s) {
  $n = 0
  foreach ($ch in $s.ToCharArray()) { $n = $n * 26 + ([int][char]$ch - 64) }
  return $n
}

# ---- shared strings, styles -------------------------------------------------
$ssXml = New-Object System.Xml.XmlDocument
$ssXml.Load((Join-Path $Extracted "xl\sharedStrings.xml"))
$shared = @()
foreach ($si in $ssXml.DocumentElement.ChildNodes) {
  $shared += (($si.SelectNodes(".//*[local-name()='t']") | ForEach-Object { $_.InnerText }) -join "")
}

$stXml = New-Object System.Xml.XmlDocument
$stXml.Load((Join-Path $Extracted "xl\styles.xml"))

$fills = @()
foreach ($f in $stXml.SelectNodes("//*[local-name()='fills']/*[local-name()='fill']")) {
  $pf = $f.SelectSingleNode("*[local-name()='patternFill']")
  $rgb = ""
  if ($pf -and $pf.getAttribute("patternType") -notin @("none", "")) {
    $fg = $pf.SelectSingleNode("*[local-name()='fgColor']")
    if ($fg) { $rgb = $fg.getAttribute("rgb") }
  }
  $fills += $rgb
}
$fontBold = @()
foreach ($f in $stXml.SelectNodes("//*[local-name()='fonts']/*[local-name()='font']")) {
  $fontBold += [bool]$f.SelectSingleNode("*[local-name()='b']")
}
$xfFill = @(); $xfFont = @()
foreach ($xf in $stXml.SelectNodes("//*[local-name()='cellXfs']/*[local-name()='xf']")) {
  $a = $xf.getAttribute("fillId"); $xfFill += $(if ($a -eq "") { 0 } else { [int]$a })
  $b = $xf.getAttribute("fontId"); $xfFont += $(if ($b -eq "") { 0 } else { [int]$b })
}

# ---- merged ranges ----------------------------------------------------------
$sheetPath = Join-Path $Extracted "xl\worksheets\$Sheet"
$raw = [System.IO.File]::ReadAllText($sheetPath)
$spanStart = @{}   # "row:c0" -> c1
$spanEnd = @{}     # "row:c1" -> c0
foreach ($m in [regex]::Matches($raw, '<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"')) {
  if ($m.Groups[2].Value -ne $m.Groups[4].Value) { continue }   # multi-row: legend blocks
  $r = [int]$m.Groups[2].Value
  $c0 = ColNum $m.Groups[1].Value
  $c1 = ColNum $m.Groups[3].Value
  $spanStart["$r`:$c0"] = $c1
  $spanEnd["$r`:$c1"] = $c0
}

# ---- walk cells -------------------------------------------------------------
$names = @{}     # "row:c0" -> [pscustomobject] name cell
$nameEnd = @{}   # "row:c1" -> key into $names
$dots = New-Object System.Collections.Generic.List[object]

$reader = [System.Xml.XmlReader]::Create($sheetPath)
$ref = ""; $style = ""; $type = ""; $val = ""; $inV = $false
while ($reader.Read()) {
  if ($reader.NodeType -eq [System.Xml.XmlNodeType]::Element) {
    if ($reader.Name -eq "c") {
      $ref = $reader.GetAttribute("r"); $style = $reader.GetAttribute("s")
      $type = $reader.GetAttribute("t"); $val = ""
    } elseif ($reader.Name -eq "v") { $inV = $true }
  } elseif ($reader.NodeType -eq [System.Xml.XmlNodeType]::Text) {
    if ($inV) { $val += $reader.Value }
  } elseif ($reader.NodeType -eq [System.Xml.XmlNodeType]::EndElement) {
    if ($reader.Name -eq "v") { $inV = $false }
    if ($reader.Name -eq "c") {
      $text = ""
      if ($type -eq "s" -and $val -ne "") { $i = [int]$val; if ($i -lt $shared.Count) { $text = $shared[$i] } }
      elseif ($val -ne "") { $text = $val }
      $text = $text.Trim()
      if ($text -ne "") {
        $m = [regex]::Match($ref, '^([A-Z]+)(\d+)$')
        $row = [int]$m.Groups[2].Value
        $col = ColNum $m.Groups[1].Value
        $si = $(if ($style -eq "" -or $null -eq $style) { 0 } else { [int]$style })
        $fill = ""; $bold = $false
        if ($si -lt $xfFill.Count) {
          $fi = $xfFill[$si]; if ($fi -lt $fills.Count) { $fill = $fills[$fi] }
          $fo = $xfFont[$si]; if ($fo -lt $fontBold.Count) { $bold = $fontBold[$fo] }
        }

        if ($text -eq [char]0x2022) {
          # a tier dot - but not the five legend swatches
          if ($TIER.ContainsKey($fill) -and -not ($ref -match '^(DE|DG)(48|50|52|54|56)$')) {
            $dots.Add([pscustomobject]@{ ref = $ref; row = $row; col = $col; tier = $TIER[$fill] })
          }
        }
        elseif ($text.Length -gt 2 -and $row -ge 7 -and -not ($row -ge 45 -and $col -ge 102)) {
          # candidate exercise name; skip markers and the legend/footer block
          # Markers, by codepoint so this file stays pure ASCII (PowerShell 5.1
          # reads a BOM-less .ps1 as ANSI, which would corrupt literals):
          # horizontal bar, em dash, en dash, bullet, increment, pipe, equals.
          if ($text -notmatch '^[\u2015\u2014\u2013\u2022\u2206|=]+$') {
            $c1 = $col
            if ($spanStart.ContainsKey("$row`:$col")) { $c1 = $spanStart["$row`:$col"] }
            $key = "$row`:$col"
            $names[$key] = [pscustomobject]@{ ref = $ref; row = $row; c0 = $col; c1 = $c1; name = $text; bold = $bold }
            $nameEnd["$row`:$c1"] = $key
          }
        }
      }
    }
  }
}
$reader.Close()
Write-Host "name cells: $($names.Count)   tier dots: $($dots.Count)"

# ---- pair each dot with the adjacent name range -----------------------------
# The dot sits immediately after the name's merged range, or immediately before it.
$claimed = @{}
$found = @{}   # normalised name -> pscustomobject
$orphans = 0

function NormName([string]$s) {
  $abbr = @{
    "2h"="two hand"; "adv"="advanced"; "bl"="back lever"; "c2b"="chest to bar"
    "fl"="front lever"; "hes"="headstand"; "hlr"="hanging leg raise"; "hs"="handstand"
    "icm"="ice cream maker"; "int"="intermediate"; "mu"="muscle up"; "nc"="nordic curl"
    "neg"="negative"; "oa"="one arm"; "ol"="one leg"; "pl"="planche"
    "pp"="pseudo planche"; "pu"="push up"; "rev"="reverse"; "rto"="rings turned out"
    "sa"="straight arm"; "shld"="shoulder"; "str"="straddle"; "sup"="support"
    "t2b"="toes to bar"
  }
  $t = $s.ToLowerInvariant()
  $t = [regex]::Replace($t, '[\u00B0/&.,()\-]', ' ')
  $words = $t -split '\s+' | Where-Object { $_ -ne "" } | ForEach-Object { if ($abbr.ContainsKey($_)) { $abbr[$_] } else { $_ } }
  $t = ($words -join " ")
  $t = [regex]::Replace($t, '[^a-z0-9 ]', '')
  return ([regex]::Replace($t, '\s+', ' ')).Trim()
}

foreach ($d in $dots) {
  $after = "$($d.row)`:$($d.col + 1)"
  $beforeKey = "$($d.row)`:$($d.col - 1)"
  $pick = $null
  if ($names.ContainsKey($after) -and -not $claimed.ContainsKey($after)) { $pick = $after }
  elseif ($nameEnd.ContainsKey($beforeKey) -and -not $claimed.ContainsKey($nameEnd[$beforeKey])) { $pick = $nameEnd[$beforeKey] }
  elseif ($names.ContainsKey($after)) { $pick = $after }
  elseif ($nameEnd.ContainsKey($beforeKey)) { $pick = $nameEnd[$beforeKey] }

  if ($null -eq $pick) { $orphans++; continue }
  $claimed[$pick] = $true
  $n = $names[$pick]
  $k = NormName $n.name
  if (-not $found.ContainsKey($k)) {
    $found[$k] = [pscustomobject]@{ name = $n.name; tier = $d.tier; bold = $n.bold }
  }
}
# bold names that never got a dot (a shared dot went to a neighbour) still count
foreach ($k in $names.Keys) {
  $n = $names[$k]
  $nk = NormName $n.name
  if (-not $found.ContainsKey($nk) -and $n.bold) {
    $found[$nk] = [pscustomobject]@{ name = $n.name; tier = $null; bold = $true }
  }
}
Write-Host "paired: $($found.Count)   orphan dots: $orphans"

# ---- aliases: chart.json name -> the sheet's spelling -----------------------
# The sheet abbreviates differently, and has two genuine typos ("Font Lever").
$alias = @{
  "Straight One Arm Row"              = "Str OA Row"
  "Tuck Front Lever"                  = "Tuck Font Lever"          # typo in source
  "Straddle Front Lever"              = "Straddle Font Lever"      # typo in source
  "Hanging Pull FL to Inverted"       = "Hanging Pull FL to Inv"
  "Foot Supported L-Sit"              = "Foot Sup L-Sit"
  "Ring Straight OA Push Up"          = "Ring Str OA PU"
  "Straight Arm Planche to Handstand" = "SA Str PL to HS"
  "Hanging Leg Raise to Bar"          = "Hanging Leg Raise T2B"
  "Ankle Weight HLR"                  = "Ankle Weight HLR T2B"
  "One Arm HLR"                       = "One Arm HLR T2B"
}
# Not on the source chart at all (added on request); no tier to recover.
$notOnChart = @("Straight Bar Dip")
# Shares its dot with a neighbour; every exercise around it is Elite.
$tierOverride = @{ "Inverted Cross" = "Elite" }

# ---- rewrite chart.json -----------------------------------------------------
# Explicit UTF-8 both ways. PowerShell 5.1 defaults to ANSI here, which
# double-encodes the degree signs in names like "RTO 75 Dip" and "360 Pull".
$doc = [System.IO.File]::ReadAllText($Chart, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

$stats = [ordered]@{ matched = 0; missing = 0; msNew = 0; msRemoved = 0; msKept = 0 }
$missing = New-Object System.Collections.Generic.List[string]
$tierCount = @{}

$sb = New-Object System.Text.StringBuilder
$null = $sb.AppendLine("{")
$null = $sb.AppendLine('  "meta": {')
$null = $sb.AppendLine('    "chart": "Bodyweight Fitness Progressions v5.4",')
$null = $sb.AppendLine('    "author": "u/shellerik",')
$null = $sb.AppendLine('    "published": "2019-03",')
$null = $sb.AppendLine('    "derivedFrom": [')
$null = $sb.AppendLine('      "Overcoming Gravity, 2nd ed. (Steven Low)",')
$null = $sb.AppendLine('      "r/bodyweightfitness Recommended Routine",')
$null = $sb.AppendLine('      "r/bodyweightfitness Exercise Wiki",')
$null = $sb.AppendLine('      "Antranik"')
$null = $sb.AppendLine('    ],')
$null = $sb.AppendLine('    "sourceSheet": "https://docs.google.com/spreadsheets/d/1a8tlZ-zbF695HA3Lmm20OIYeYYxo1lmUOczUXKLoL4s/edit",')
$null = $sb.AppendLine('    "schema": "A rung is [\"Name\", milestone(0|1), \"tier\"]. Tier is Beginner|Intermediate|Advanced|Elite, or null where the source chart has no entry. Prerequisites are [Category, Ladder, Move] triples and may cross categories.",')
$null = $sb.AppendLine('    "tiers": ["Beginner", "Intermediate", "Advanced", "Elite"],')
$null = $sb.AppendLine('    "provenance": "Tiers are the fill colour of each exercise dot in the source sheet - recovered, high confidence. Milestones are the source sheet BOLD names - recovered by inference, medium-high confidence; the legend defines milestone as a grey dot but no grey dot exists in any sheet version. See CLAUDE.md before editing.",')
$null = $sb.AppendLine('    "recoveredBy": "tools/apply-sheet-data.ps1"')
$null = $sb.AppendLine('  },')
$null = $sb.AppendLine('  "categories": [')

$esc = { param($s) $s -replace '\\', '\\' -replace '"', '\"' }

$catLines = @()
foreach ($cat in $doc.categories) {
  $ladLines = @()
  foreach ($lad in $cat.ladders) {
    $parts = @()
    foreach ($mv in $lad.m) {
      $nm = if ($mv -is [array]) { $mv[0] } else { $mv }

      $lookup = $nm
      if ($alias.ContainsKey($nm)) { $lookup = $alias[$nm] }
      $k = NormName $lookup

      $tier = $null; $ms = $false; $hit = $false
      if ($found.ContainsKey($k)) {
        $hit = $true
        $tier = $found[$k].tier
        $ms = $found[$k].bold
      }
      if ($tierOverride.ContainsKey($nm)) { $tier = $tierOverride[$nm] }

      if ($hit) { $stats.matched++ }
      elseif ($notOnChart -contains $nm) { $hit = $true }
      else { $stats.missing++; $missing.Add($nm) }

      $wasMs = ($mv -is [array])
      if ($ms -and -not $wasMs) { $stats.msNew++ }
      elseif (-not $ms -and $wasMs) { $stats.msRemoved++ }
      elseif ($ms -and $wasMs) { $stats.msKept++ }

      if ($tier) { $tierCount[$tier] = 1 + $(if ($tierCount.ContainsKey($tier)) { $tierCount[$tier] } else { 0 }) }

      $tierTok = if ($tier) { '"' + $tier + '"' } else { 'null' }
      $parts += ('["' + (& $esc $nm) + '",' + $(if ($ms) { 1 } else { 0 }) + ',' + $tierTok + ']')
    }
    $fromTok = ""
    if ($lad.PSObject.Properties.Name -contains "from" -and $lad.from) {
      $fromParts = @()
      foreach ($p in $lad.from) {
        $fromParts += ('["' + (& $esc $p[0]) + '","' + (& $esc $p[1]) + '","' + (& $esc $p[2]) + '"]')
      }
      $fromTok = ' "from": [' + ($fromParts -join ',') + '],'
    }
    $ladLines += ('      { "n": "' + (& $esc $lad.n) + '",' + $fromTok + ' "m": [' + ($parts -join ',') + '] }')
  }
  $catLines += ('    { "g": "' + (& $esc $cat.g) + '", "ladders": [' + "`n" + ($ladLines -join ",`n") + "`n" + '    ]}')
}
$null = $sb.AppendLine(($catLines -join ",`n"))
$null = $sb.AppendLine('  ]')
$null = $sb.AppendLine("}")

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($Chart, $sb.ToString(), $utf8NoBom)

Write-Host ""
Write-Host "matched:        $($stats.matched)"
Write-Host "unmatched:      $($stats.missing)"
if ($missing.Count) { Write-Host "  -> $($missing -join ', ')" }
Write-Host "milestones kept:   $($stats.msKept)"
Write-Host "milestones added:  $($stats.msNew)"
Write-Host "milestones dropped:$($stats.msRemoved)"
Write-Host "tiers: $(($tierCount.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join '  ')"
