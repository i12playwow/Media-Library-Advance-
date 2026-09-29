Add-Type -AssemblyName System.Drawing

$size = 256
$bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.Color]::Transparent)

$rect = [System.Drawing.RectangleF]::new(8, 8, 240, 240)
$path = [System.Drawing.Drawing2D.GraphicsPath]::new()
$radius = 56.0
$diameter = $radius * 2
$path.AddArc($rect.X, $rect.Y, $diameter, $diameter, 180, 90)
$path.AddArc($rect.Right - $diameter, $rect.Y, $diameter, $diameter, 270, 90)
$path.AddArc($rect.Right - $diameter, $rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
$path.CloseFigure()

$backgroundBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new(0, 0),
    [System.Drawing.PointF]::new($size, $size),
    [System.Drawing.ColorTranslator]::FromHtml("#141b24"),
    [System.Drawing.ColorTranslator]::FromHtml("#0b0f14")
)
$graphics.FillPath($backgroundBrush, $path)

$glowBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.PointF]::new(22, 26),
    [System.Drawing.PointF]::new(214, 210),
    [System.Drawing.ColorTranslator]::FromHtml("#ff7a3d"),
    [System.Drawing.ColorTranslator]::FromHtml("#6cc6bb")
)
$glowColorBlend = [System.Drawing.Drawing2D.ColorBlend]::new()
$glowColorBlend.Positions = [single[]](0.0, 0.55, 1.0)
$glowColorBlend.Colors = [System.Drawing.Color[]](
    [System.Drawing.Color]::FromArgb(255, 255, 122, 61),
    [System.Drawing.Color]::FromArgb(255, 245, 119, 83),
    [System.Drawing.Color]::FromArgb(255, 108, 198, 187)
)
$glowBrush.InterpolationColors = $glowColorBlend

$accentPen = [System.Drawing.Pen]::new($glowBrush, 18)
$accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

$shadowPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(90, 0, 0, 0), 24)
$shadowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$shadowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

$graphics.DrawLine($shadowPen, 70, 188, 70, 76)
$graphics.DrawLine($shadowPen, 70, 76, 128, 146)
$graphics.DrawLine($shadowPen, 128, 146, 186, 76)
$graphics.DrawLine($shadowPen, 186, 76, 186, 188)
$graphics.DrawLine($shadowPen, 118, 188, 138, 188)
$graphics.DrawLine($shadowPen, 128, 176, 128, 200)

$graphics.DrawLine($accentPen, 70, 184, 70, 72)
$graphics.DrawLine($accentPen, 70, 72, 128, 142)
$graphics.DrawLine($accentPen, 128, 142, 186, 72)
$graphics.DrawLine($accentPen, 186, 72, 186, 184)
$graphics.DrawLine($accentPen, 116, 186, 140, 186)
$graphics.DrawLine($accentPen, 128, 174, 128, 198)

$playPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
$playPath.AddPolygon([System.Drawing.Point[]](
    [System.Drawing.Point]::new(100, 106),
    [System.Drawing.Point]::new(100, 152),
    [System.Drawing.Point]::new(142, 129)
))
$graphics.FillPath([System.Drawing.Brushes]::White, $playPath)

$outlinePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(50, 255, 255, 255), 2)
$graphics.DrawPath($outlinePen, $path)

# Write next to this script's repo checkout so the tool is portable:
# no hardcoded user paths, works from any clone location.
$repoRoot = Split-Path -Parent $PSScriptRoot
$pngPath = Join-Path $repoRoot "resources\icon.png"
$icoPath = Join-Path $repoRoot "resources\icon.ico"
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$fs = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$writer = [System.IO.BinaryWriter]::new($fs)

$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Flush()
$writer.Close()
$fs.Close()

$outlinePen.Dispose()
$shadowPen.Dispose()
$accentPen.Dispose()
$glowBrush.Dispose()
$backgroundBrush.Dispose()
$path.Dispose()
$playPath.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
