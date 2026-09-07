# Second pass over the source .xlsx: for every cell, dump the full style
# fingerprint (fill, font weight/colour, borders) so we can work out how the
# chart distinguishes milestones. The tier dots are fills; milestones are not.
#
# Emits TSV: ref, row, col, styleIdx, fill, bold, fontColour, fontSize, borders, value
param(
  [Parameter(Mandatory = $true)][string]$Extracted,
  [string]$Sheet = "sheet1.xml",
  [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = "Stop"

$ssPath = Join-Path $Extracted "xl\sharedStrings.xml"
$shared = @()
if (Test-Path $ssPath) {
  $ssXml = New-Object System.Xml.XmlDocument
  $ssXml.Load($ssPath)
  foreach ($si in $ssXml.DocumentElement.ChildNodes) {
    $shared += (($si.SelectNodes(".//*[local-name()='t']") | ForEach-Object { $_.InnerText }) -join "")
  }
}

$stXml = New-Object System.Xml.XmlDocument
$stXml.Load((Join-Path $Extracted "xl\styles.xml"))

# fills
$fills = @()
foreach ($f in $stXml.SelectNodes("//*[local-name()='fills']/*[local-name()='fill']")) {
  $pf = $f.SelectSingleNode("*[local-name()='patternFill']")
  $rgb = ""
  if ($pf -and $pf.getAttribute("patternType") -notin @("none","")) {
    $fg = $pf.SelectSingleNode("*[local-name()='fgColor']")
    if ($fg) { $rgb = $fg.getAttribute("rgb"); if (-not $rgb) { $rgb = "theme" + $fg.getAttribute("theme") } }
  }
  $fills += $rgb
}

# fonts
$fonts = @()
foreach ($f in $stXml.SelectNodes("//*[local-name()='fonts']/*[local-name()='font']")) {
  $bold = if ($f.SelectSingleNode("*[local-name()='b']")) { "b" } else { "" }
  $ital = if ($f.SelectSingleNode("*[local-name()='i']")) { "i" } else { "" }
  $und  = if ($f.SelectSingleNode("*[local-name()='u']")) { "u" } else { "" }
  $col = $f.SelectSingleNode("*[local-name()='color']")
  $crgb = ""
  if ($col) { $crgb = $col.getAttribute("rgb"); if (-not $crgb) { $crgb = "theme" + $col.getAttribute("theme") } }
  $sz = $f.SelectSingleNode("*[local-name()='sz']")
  $szv = if ($sz) { $sz.getAttribute("val") } else { "" }
  $fonts += [pscustomobject]@{ flags = "$bold$ital$und"; colour = $crgb; size = $szv }
}

# borders — just which edges are present
$borders = @()
foreach ($b in $stXml.SelectNodes("//*[local-name()='borders']/*[local-name()='border']")) {
  $edges = @()
  foreach ($e in @("left","right","top","bottom")) {
    $n = $b.SelectSingleNode("*[local-name()='$e']")
    if ($n -and $n.getAttribute("style") -ne "") { $edges += $e.Substring(0,1).ToUpper() }
  }
  $borders += ($edges -join "")
}

$xfs = @()
foreach ($xf in $stXml.SelectNodes("//*[local-name()='cellXfs']/*[local-name()='xf']")) {
  $g = { param($n) $v = $xf.getAttribute($n); if ($v -eq "") { 0 } else { [int]$v } }
  $xfs += [pscustomobject]@{
    fill   = (& $g "fillId")
    font   = (& $g "fontId")
    border = (& $g "borderId")
  }
}
Write-Host "fills=$($fills.Count) fonts=$($fonts.Count) borders=$($borders.Count) xfs=$($xfs.Count)"

$reader = [System.Xml.XmlReader]::Create((Join-Path $Extracted "xl\worksheets\$Sheet"))
$rows = New-Object System.Collections.Generic.List[string]
$rows.Add("ref`trow`tcol`tstyle`tfill`tfont`tfontcol`tsize`tborder`tvalue")

$ref=""; $style=""; $type=""; $val=""; $inV=$false; $n=0
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
      if ($text -ne "") {
        $si = if ($style -eq "" -or $null -eq $style) { 0 } else { [int]$style }
        $x = if ($si -lt $xfs.Count) { $xfs[$si] } else { $null }
        $fl = ""; $fo = ""; $fc = ""; $sz = ""; $bd = ""
        if ($x) {
          if ($x.fill -lt $fills.Count) { $fl = $fills[$x.fill] }
          if ($x.font -lt $fonts.Count) { $fo = $fonts[$x.font].flags; $fc = $fonts[$x.font].colour; $sz = $fonts[$x.font].size }
          if ($x.border -lt $borders.Count) { $bd = $borders[$x.border] }
        }
        $m = [regex]::Match($ref, '^([A-Z]+)(\d+)$')
        $text = $text -replace "[`t`r`n]", " "
        $rows.Add("$ref`t$($m.Groups[2].Value)`t$($m.Groups[1].Value)`t$si`t$fl`t$fo`t$fc`t$sz`t$bd`t$text")
        $n++
      }
    }
  }
}
$reader.Close()
[System.IO.File]::WriteAllLines($Out, $rows)
Write-Host "wrote $n cells"
