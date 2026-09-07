# Generates the PWA icons. No image tooling on this machine (no Node, no Python,
# no ImageMagick), so this draws them with System.Drawing.
# Motif and palette come straight from the app: cool grey paper, deep slate ink,
# highlighter yellow reserved for "your next step".
Add-Type -AssemblyName System.Drawing

$paper = [System.Drawing.ColorTranslator]::FromHtml("#E5E9E7")
$ink   = [System.Drawing.ColorTranslator]::FromHtml("#16262A")
$rail  = [System.Drawing.ColorTranslator]::FromHtml("#C0CAC7")
$mark  = [System.Drawing.ColorTranslator]::FromHtml("#F3E15A")

function New-LadderIcon {
  param(
    [int]$Size,
    [string]$Path,
    # Fraction of the canvas to leave empty on each edge. Maskable icons get a
    # bigger margin so Android can crop to a circle without clipping the ladder.
    [double]$Inset = 0.14
  )

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  $g.Clear($paper)

  $pad = $Size * $Inset
  $box = $Size - (2 * $pad)

  # Two rails, inset from the content box so the rungs can overhang slightly.
  $railW = [Math]::Max(2.0, $box * 0.055)
  $leftX = $pad + ($box * 0.20)
  $rightX = $pad + ($box * 0.80) - $railW
  $top = $pad
  $height = $box

  $brushRail = New-Object System.Drawing.SolidBrush($rail)
  $brushInk = New-Object System.Drawing.SolidBrush($ink)
  $brushMark = New-Object System.Drawing.SolidBrush($mark)

  $g.FillRectangle($brushRail, $leftX, $top, $railW, $height)
  $g.FillRectangle($brushRail, $rightX, $top, $railW, $height)

  # Five rungs, bottom to top. The bottom three are cleared, the fourth is the
  # next step (highlighted), the top one is still ahead.
  $count = 5
  $rungH = $box * 0.085
  $spanX = $leftX
  $spanW = ($rightX + $railW) - $leftX
  $first = $top + ($height * 0.09)
  $last = $top + $height - ($height * 0.09) - $rungH
  $step = ($last - $first) / ($count - 1)

  for ($i = 0; $i -lt $count; $i++) {
    # $i = 0 is the top rung
    $y = $first + ($step * $i)
    $fromBottom = ($count - 1) - $i

    if ($fromBottom -le 2) {
      $g.FillRectangle($brushInk, $spanX, $y, $spanW, $rungH)
    }
    elseif ($fromBottom -eq 3) {
      # The next step: a highlighter swipe, as in the app. Slightly taller than
      # a cleared rung so it carries at 48px in the launcher.
      $padY = $rungH * 0.18
      $g.FillRectangle($brushMark, $spanX, ($y - $padY), $spanW, ($rungH + (2 * $padY)))
    }
    else {
      $g.FillRectangle($brushRail, $spanX, ($y + ($rungH * 0.28)), $spanW, ($rungH * 0.44))
    }
  }

  $dir = Split-Path -Parent $Path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

  $brushRail.Dispose(); $brushInk.Dispose(); $brushMark.Dispose()
  $g.Dispose(); $bmp.Dispose()
  Write-Host "wrote $Path ($Size x $Size)"
}

$root = Join-Path $PSScriptRoot ".."
New-LadderIcon -Size 192 -Path (Join-Path $root "icons\icon-192.png") -Inset 0.14
New-LadderIcon -Size 512 -Path (Join-Path $root "icons\icon-512.png") -Inset 0.14
# Maskable: Android may crop to a circle, so keep the art inside the safe zone.
New-LadderIcon -Size 512 -Path (Join-Path $root "icons\maskable-512.png") -Inset 0.26
