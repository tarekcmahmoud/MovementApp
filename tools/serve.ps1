# Minimal static file server for local development.
# There is no Node or Python on this machine, so this stands in for `npx serve`.
# Service workers and localStorage need a real HTTP origin; file:// will not do.
param(
  [int]$Port = 8123,
  [string]$Root = "$PSScriptRoot\.."
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path

$mime = @{
  ".html"        = "text/html; charset=utf-8"
  ".js"          = "text/javascript; charset=utf-8"
  ".css"         = "text/css; charset=utf-8"
  ".json"        = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".png"         = "image/png"
  ".svg"         = "image/svg+xml"
  ".ico"         = "image/x-icon"
  ".woff2"       = "font/woff2"
  ".txt"         = "text/plain; charset=utf-8"
  ".md"          = "text/plain; charset=utf-8"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
  $listener.Start()
} catch {
  Write-Host "Could not bind port $Port : $($_.Exception.Message)"
  exit 1
}

Write-Host "Serving $Root on http://localhost:$Port/"

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
    if ($rel -eq "/" -or $rel -eq "") { $rel = "/index.html" }

    # Resolve inside $Root only — refuse anything that escapes it.
    $candidate = Join-Path $Root ($rel.TrimStart("/").Replace("/", "\"))
    $full = [System.IO.Path]::GetFullPath($candidate)

    if (-not $full.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
      $res.StatusCode = 403
      $body = [System.Text.Encoding]::UTF8.GetBytes("403 forbidden")
      $res.OutputStream.Write($body, 0, $body.Length)
      $res.Close()
      Write-Host "403 $rel"
      continue
    }

    if (Test-Path -LiteralPath $full -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $type = $mime[$ext]
      if (-not $type) { $type = "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $res.StatusCode = 200
      $res.ContentType = $type
      # No caching locally, so an edit is always the thing you reload.
      $res.Headers.Add("Cache-Control", "no-store, no-cache, must-revalidate")
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host "200 $rel"
    } else {
      $res.StatusCode = 404
      $res.ContentType = "text/plain; charset=utf-8"
      $body = [System.Text.Encoding]::UTF8.GetBytes("404 not found: $rel")
      $res.OutputStream.Write($body, 0, $body.Length)
      Write-Host "404 $rel"
    }
    $res.Close()
  } catch {
    Write-Host "error: $($_.Exception.Message)"
  }
}
