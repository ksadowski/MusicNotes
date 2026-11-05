# Generuje ikony PNG aplikacji (ten sam rysunek co app/icons/icon.svg).
# Uruchom z katalogu projektu:  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing

function RoundRect([System.Drawing.Drawing2D.GraphicsPath]$p, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
}

function Draw([int]$size, [string]$out, [bool]$maskable) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $blue = [System.Drawing.ColorTranslator]::FromHtml('#2944C4')
  $k = $size / 512.0

  if ($maskable) {
    $g.Clear($blue)
    # rysunek w strefie bezpiecznej (środkowe ~70%)
    $s = 0.72; $off = (512 - 512 * $s) / 2
  } else {
    $bg = New-Object System.Drawing.Drawing2D.GraphicsPath
    RoundRect $bg 0 0 $size $size (112 * $k)
    $g.FillPath((New-Object System.Drawing.SolidBrush $blue), $bg)
    $s = 1.0; $off = 0
  }
  $T = { param($v) ($off + $v * $s) * $k }
  $L = { param($v) $v * $s * $k }

  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(77, 255, 255, 255)), (& $L 8)
  foreach ($y in 166, 216, 266, 316, 366) { $g.DrawLine($pen, (& $T 80), (& $T $y), (& $T 432), (& $T $y)) }

  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $soft = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(179, 255, 255, 255))
  foreach ($b in @(@(100, 176, 88, 176, $white), @(210, 132, 66, 264, $soft), @(298, 176, 114, 176, $white))) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    RoundRect $p (& $T $b[0]) (& $T $b[1]) (& $L $b[2]) (& $L $b[3]) (& $L 26)
    $g.FillPath($b[4], $p)
  }
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

$dir = Join-Path $PSScriptRoot '..\app\icons'
Draw 192 (Join-Path $dir 'icon-192.png') $false
Draw 512 (Join-Path $dir 'icon-512.png') $false
Draw 512 (Join-Path $dir 'maskable-512.png') $true
Write-Output 'Gotowe.'
