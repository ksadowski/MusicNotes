# Prosty serwer plików do testowania aplikacji lokalnie (bez Pythona i Node).
# Uruchom:  powershell -ExecutionPolicy Bypass -File tools\serve.ps1  [-Port 8080]
# Potem otwórz http://localhost:8080/  (localhost jest „bezpieczny”, więc service worker działa).
param([int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 8080 }))
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\app')).Path
$types = @{ '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='text/javascript; charset=utf-8';
  '.json'='application/json'; '.webmanifest'='application/manifest+json'; '.svg'='image/svg+xml'; '.png'='image/png' }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Output "Serwer: http://localhost:$Port/  (Ctrl+C kończy)"
try {
  while ($l.IsListening) {
    $ctx = $l.GetContext()
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($path -eq '' -or $path.EndsWith('/')) { $path += 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path))
    $res = $ctx.Response
    if ($file.StartsWith($root) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $res.ContentLength64 = $bytes.Length
      if ($ctx.Request.HttpMethod -ne 'HEAD') {
        try { $res.OutputStream.Write($bytes, 0, $bytes.Length) } catch { }
      }
    } else { $res.StatusCode = 404 }
    try { $res.Close() } catch { }
  }
} finally { $l.Stop() }
