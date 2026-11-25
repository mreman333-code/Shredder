param([string]$OutFile = (Join-Path $PSScriptRoot '..\build\icon.ico'))

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$directory = Split-Path -Parent $OutFile
if (-not (Test-Path -LiteralPath $directory)) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$frames = [System.Collections.Generic.List[byte[]]]::new()
$preview = $null

foreach ($size in $sizes) {
  $bmp = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = [Math]::Max(1, [int]($size * 0.035))
  $radius = [Math]::Max(2, [int]($size * 0.22))
  $edge = $size - 2 * $pad - 1

  $background = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $background.AddArc($pad, $pad, $radius * 2, $radius * 2, 180, 90)
  $background.AddArc($pad + $edge - $radius * 2, $pad, $radius * 2, $radius * 2, 270, 90)
  $background.AddArc($pad + $edge - $radius * 2, $pad + $edge - $radius * 2, $radius * 2, $radius * 2, 0, 90)
  $background.AddArc($pad, $pad + $edge - $radius * 2, $radius * 2, $radius * 2, 90, 90)
  $background.CloseFigure()
  $bgBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 19, 20, 25))
  $g.FillPath($bgBrush, $background)

  # Isometric cube: blue body with an orange front face (the app's accent colors).
  $cx = [single]($size / 2.0)
  $cy = [single]($size * 0.52)
  $cw = [single]($size * 0.30)
  $ch = [single]($size * 0.16)

  $top = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $top.AddPolygon([System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new($cx, $cy - $ch * 2),
    [System.Drawing.PointF]::new($cx + $cw, $cy - $ch),
    [System.Drawing.PointF]::new($cx, $cy),
    [System.Drawing.PointF]::new($cx - $cw, $cy - $ch)
  ))
  $left = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $left.AddPolygon([System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new($cx - $cw, $cy - $ch),
    [System.Drawing.PointF]::new($cx, $cy),
    [System.Drawing.PointF]::new($cx, $cy + $ch * 2),
    [System.Drawing.PointF]::new($cx - $cw, $cy + $ch)
  ))
  $right = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $right.AddPolygon([System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new($cx, $cy),
    [System.Drawing.PointF]::new($cx + $cw, $cy - $ch),
    [System.Drawing.PointF]::new($cx + $cw, $cy + $ch),
    [System.Drawing.PointF]::new($cx, $cy + $ch * 2)
  ))

  $topBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 111, 168, 220))
  $leftBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 59, 110, 165))
  $rightBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 240, 166, 60))
  $g.FillPath($topBrush, $top)
  $g.FillPath($leftBrush, $left)
  $g.FillPath($rightBrush, $right)

  if ($size -ge 48) {
    $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(70, 12, 13, 17), [single][Math]::Max(1, $size * 0.018))
    $g.DrawPath($pen, $top)
    $g.DrawPath($pen, $left)
    $g.DrawPath($pen, $right)
    $pen.Dispose()
  }

  $stream = [System.IO.MemoryStream]::new()
  $bmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $frames.Add($stream.ToArray())
  if ($size -eq 256) {
    $previewPath = [System.IO.Path]::ChangeExtension($OutFile, '.png')
    [System.IO.File]::WriteAllBytes($previewPath, $stream.ToArray())
    $preview = $previewPath
  }

  $stream.Dispose()
  $top.Dispose()
  $left.Dispose()
  $right.Dispose()
  $topBrush.Dispose()
  $leftBrush.Dispose()
  $rightBrush.Dispose()
  $bgBrush.Dispose()
  $background.Dispose()
  $g.Dispose()
  $bmp.Dispose()
}

$file = [System.IO.File]::Create($OutFile)
$writer = [System.IO.BinaryWriter]::new($file)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$frames.Count)

$offset = 6 + 16 * $frames.Count
for ($i = 0; $i -lt $frames.Count; $i++) {
  $dimension = $sizes[$i]
  $byteDimension = if ($dimension -ge 256) { 0 } else { $dimension }
  $writer.Write([byte]$byteDimension)
  $writer.Write([byte]$byteDimension)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$frames[$i].Length)
  $writer.Write([UInt32]$offset)
  $offset += $frames[$i].Length
}
foreach ($frame in $frames) { $writer.Write($frame) }
$writer.Dispose()
$file.Dispose()

Write-Output "wrote $OutFile ($($frames.Count) sizes) and $preview"
