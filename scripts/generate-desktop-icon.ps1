Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$assetDir = Join-Path $repoRoot "apps\desktop\assets"
$iconPath = Join-Path $assetDir "icon.ico"
$svgPath = Join-Path $assetDir "icon.svg"

New-Item -ItemType Directory -Force -Path $assetDir | Out-Null

$svg = @'
<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="18" y="18" width="220" height="220" rx="54" fill="#08090c"/>
  <rect x="18" y="18" width="220" height="220" rx="54" fill="url(#bg)"/>
  <circle cx="128" cy="128" r="78" stroke="#8f7dff" stroke-opacity=".34" stroke-width="6"/>
  <circle cx="128" cy="128" r="43" stroke="#31c7e8" stroke-opacity=".2" stroke-width="5"/>
  <path d="M64 168V86h63c31 0 56 25 56 56v26" stroke="url(#shell)" stroke-width="22" stroke-linecap="round"/>
  <path d="M104 168v-57h27c17 0 30 13 30 30v27" stroke="#eef0f5" stroke-width="14" stroke-linecap="round" opacity=".96"/>
  <path d="M128 128l61-45" stroke="#34d399" stroke-width="8" stroke-linecap="round"/>
  <circle cx="189" cy="83" r="13" fill="#34d399"/>
  <circle cx="82" cy="184" r="10" fill="#8f7dff"/>
  <circle cx="197" cy="177" r="9" fill="#31c7e8"/>
  <defs>
    <radialGradient id="bg" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(86 62) rotate(57) scale(213)">
      <stop stop-color="#8f7dff" stop-opacity=".42"/>
      <stop offset=".58" stop-color="#31c7e8" stop-opacity=".11"/>
      <stop offset="1" stop-color="#08090c" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="shell" x1="67" y1="79" x2="190" y2="176" gradientUnits="userSpaceOnUse">
      <stop stop-color="#eef0f5"/>
      <stop offset="1" stop-color="#8f7dff" stop-opacity=".32"/>
    </linearGradient>
  </defs>
</svg>
'@
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($svgPath, $svg, $utf8NoBom)

function New-IconPngBytes {
  param([int]$Size)

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

  $scale = $Size / 256.0
  function S([float]$value) { return [float]($value * $script:scale) }
  $script:scale = $scale

  $rect = New-Object System.Drawing.RectangleF (S 18), (S 18), (S 220), (S 220)
  $radius = S 54
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $radius * 2
  $path.AddArc($rect.X, $rect.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($rect.Right - $diameter, $rect.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($rect.Right - $diameter, $rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()

  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 8, 9, 12)), ([System.Drawing.Color]::FromArgb(255, 28, 29, 50)), 45
  $graphics.FillPath($bg, $path)

  $glowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(56, 143, 125, 255))
  $graphics.FillEllipse($glowBrush, (S 25), (S 20), (S 160), (S 160))

  $ringPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(92, 143, 125, 255)), (S 6)
  $graphics.DrawEllipse($ringPen, (S 50), (S 50), (S 156), (S 156))
  $innerPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(58, 49, 199, 232)), (S 5)
  $graphics.DrawEllipse($innerPen, (S 85), (S 85), (S 86), (S 86))

  $shellPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(230, 238, 240, 245)), (S 22)
  $shellPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $shellPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $shellPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $shellPath.AddLine((S 64), (S 168), (S 64), (S 86))
  $shellPath.AddLine((S 64), (S 86), (S 127), (S 86))
  $shellPath.AddBezier((S 127), (S 86), (S 158), (S 86), (S 183), (S 117), (S 183), (S 142))
  $shellPath.AddLine((S 183), (S 142), (S 183), (S 168))
  $graphics.DrawPath($shellPen, $shellPath)

  $pilotPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(245, 255, 255, 255)), (S 14)
  $pilotPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pilotPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pilotPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $pilotPath.AddLine((S 104), (S 168), (S 104), (S 111))
  $pilotPath.AddLine((S 104), (S 111), (S 131), (S 111))
  $pilotPath.AddBezier((S 131), (S 111), (S 148), (S 111), (S 161), (S 124), (S 161), (S 141))
  $pilotPath.AddLine((S 161), (S 141), (S 161), (S 168))
  $graphics.DrawPath($pilotPen, $pilotPath)

  $sweepPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(220, 52, 211, 153)), (S 8)
  $sweepPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $sweepPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($sweepPen, (S 128), (S 128), (S 189), (S 83))

  foreach ($node in @(
    @{ X = 189; Y = 83; R = 13; C = [System.Drawing.Color]::FromArgb(255, 52, 211, 153) },
    @{ X = 82; Y = 184; R = 10; C = [System.Drawing.Color]::FromArgb(255, 143, 125, 255) },
    @{ X = 197; Y = 177; R = 9; C = [System.Drawing.Color]::FromArgb(255, 49, 199, 232) }
  )) {
    $brush = New-Object System.Drawing.SolidBrush $node.C
    $graphics.FillEllipse($brush, (S ($node.X - $node.R)), (S ($node.Y - $node.R)), (S ($node.R * 2)), (S ($node.R * 2)))
    $brush.Dispose()
  }

  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  [byte[]]$bytes = $stream.ToArray()

  $graphics.Dispose()
  $bitmap.Dispose()
  $stream.Dispose()
  # PowerShell enumerates arrays returned through the pipeline. The leading
  # comma keeps each PNG as one byte[] object so the ICO writer receives the
  # full image payload.
  return ,$bytes
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = foreach ($size in $sizes) {
  [byte[]]$bytes = New-IconPngBytes -Size $size
  [PSCustomObject]@{ Size = $size; Bytes = $bytes }
}

$iconStream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($iconStream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$images.Count)

$offset = 6 + ($images.Count * 16)
foreach ($image in $images) {
  $dimension = if ($image.Size -eq 256) { 0 } else { $image.Size }
  $writer.Write([byte]$dimension)
  $writer.Write([byte]$dimension)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$image.Bytes.Length)
  $writer.Write([UInt32]$offset)
  $offset += $image.Bytes.Length
}

foreach ($image in $images) {
  $writer.Write([byte[]]$image.Bytes)
}

$writer.Flush()
[System.IO.File]::WriteAllBytes($iconPath, $iconStream.ToArray())
$writer.Dispose()
$iconStream.Dispose()

Write-Host "Generated $iconPath and $svgPath"
