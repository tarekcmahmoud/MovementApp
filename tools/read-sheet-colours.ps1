# Reads exercise names and their cell fill colours out of the source .xlsx.
# The chart carries two things purely as colour that never survived text
# extraction: the four difficulty tiers, and the milestone markers. See CLAUDE.md.
#
# Emits TSV: ref, row, col, fillRGB, value
param(
  [Parameter(Mandatory = $true)][string]$Extracted,   # unzipped .xlsx directory
  [string]$Sheet = "sheet1.xml",
  [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = "Stop"

# --- shared strings ------------------------------------------------------
$ssPath = Join-Path $Extracted "xl\sharedStrings.xml"
$shared = @()
if (Test-Path $ssPath) {
  $ssXml = New-Object System.Xml.XmlDocument
  $ssXml.Load($ssPath)
  foreach ($si in $ssXml.DocumentElement.ChildNodes) {
    # a string can be split across several <r> runs
    $shared += (($si.SelectNodes(".//*[local-name()='t']") | ForEach-Object { $_.InnerText }) -join "")
  }
}
Write-Host "shared strings: $($shared.Count)"

# --- styles: cellXfs -> fillId -> fill colour ----------------------------
$stXml = New-Object System.Xml.XmlDocument
$stXml.Load((Join-Path $Extracted "xl\styles.xml"))

$fillColours = @()
foreach ($fill in $stXml.SelectNodes("//*[local-name()='fills']/*[local-name()='fill']")) {
  $pf = $fill.SelectSingleNode("*[local-name()='patternFill']")
  $rgb = ""
  if ($pf) {
    $type = $pf.getAttribute("patternType")
    $fg = $pf.SelectSingleNode("*[local-name()='fgColor']")
    if ($type -eq "none" -or $type -eq "") { $rgb = "" }
    elseif ($fg) {
      $rgb = $fg.getAttribute("rgb")
      if (-not $rgb) {
        $t = $fg.getAttribute("theme")
        if ($t -ne "") { $rgb = "theme$t" }
      }
    }
  }
  $fillColours += $rgb
}
Write-Host "fills: $($fillColours.Count)"

$xfFill = @()
foreach ($xf in $stXml.SelectNodes("//*[local-name()='cellXfs']/*[local-name()='xf']")) {
  $fid = $xf.getAttribute("fillId")
  if ($fid -eq "") { $fid = "0" }
  $xfFill += [int]$fid
}
Write-Host "cellXfs: $($xfFill.Count)"

# --- walk the sheet ------------------------------------------------------
# XmlReader rather than [xml]: these sheets are ~2.2 MB each.
$reader = [System.Xml.XmlReader]::Create((Join-Path $Extracted "xl\worksheets\$Sheet"))
$rows = New-Object System.Collections.Generic.List[string]
$rows.Add("ref`trow`tcol`tfill`tvalue")

$ref = ""; $style = ""; $type = ""; $val = ""; $inV = $false; $inIs = $false; $isText = ""
$count = 0

while ($reader.Read()) {
  if ($reader.NodeType -eq [System.Xml.XmlNodeType]::Element) {
    switch ($reader.Name) {
      "c" {
        $ref = $reader.GetAttribute("r")
        $style = $reader.GetAttribute("s")
        $type = $reader.GetAttribute("t")
        $val = ""; $isText = ""
      }
      "v"  { $inV = $true }
      "is" { $inIs = $true }
      "t"  { if ($inIs) { $isText += $reader.ReadElementContentAsString(); $inIs = $true } }
    }
  }
  elseif ($reader.NodeType -eq [System.Xml.XmlNodeType]::Text) {
    if ($inV) { $val += $reader.Value }
  }
  elseif ($reader.NodeType -eq [System.Xml.XmlNodeType]::EndElement) {
    if ($reader.Name -eq "v") { $inV = $false }
    if ($reader.Name -eq "is") { $inIs = $false }
    if ($reader.Name -eq "c") {
      # resolve the display text
      $text = ""
      if ($type -eq "s" -and $val -ne "") {
        $idx = [int]$val
        if ($idx -lt $shared.Count) { $text = $shared[$idx] }
      }
      elseif ($type -eq "inlineStr") { $text = $isText }
      elseif ($val -ne "") { $text = $val }

      $fill = ""
      if ($style -ne "" -and $null -ne $style) {
        $si = [int]$style
        if ($si -lt $xfFill.Count) {
          $fi = $xfFill[$si]
          if ($fi -lt $fillColours.Count) { $fill = $fillColours[$fi] }
        }
      }

      $text = $text -replace "[`t`r`n]", " "
      if ($text -ne "" -or $fill -ne "") {
        $m = [regex]::Match($ref, '^([A-Z]+)(\d+)$')
        $col = if ($m.Success) { $m.Groups[1].Value } else { "" }
        $rownum = if ($m.Success) { $m.Groups[2].Value } else { "" }
        $rows.Add("$ref`t$rownum`t$col`t$fill`t$text")
        $count++
      }
    }
  }
}
$reader.Close()

[System.IO.File]::WriteAllLines($Out, $rows)
Write-Host "wrote $count cells to $Out"
