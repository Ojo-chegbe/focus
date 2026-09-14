Add-Type -AssemblyName System.Drawing

$sourcePath = "C:\Users\ogwuo\Downloads\Focus.png"
if (-not (Test-Path $sourcePath)) {
    Write-Error "Source icon not found at $sourcePath"
    exit 1
}

$src = [System.Drawing.Bitmap]::FromFile($sourcePath)
$size = [Math]::Max($src.Width, $src.Height)
$target = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($target)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

$x = [Math]::Floor(($size - $src.Width) / 2)
$y = [Math]::Floor(($size - $src.Height) / 2)
$g.DrawImage($src, $x, $y, $src.Width, $src.Height)
$g.Dispose()
$src.Dispose()

# Ensure directories exist
$buildDir = Join-Path $PSScriptRoot "..\build"
$publicDir = Join-Path $PSScriptRoot "..\public"
$assetsDir = Join-Path $PSScriptRoot "..\src\renderer\assets"
if (-not (Test-Path $buildDir)) { New-Item -ItemType Directory -Path $buildDir }
if (-not (Test-Path $publicDir)) { New-Item -ItemType Directory -Path $publicDir }
if (-not (Test-Path $assetsDir)) { New-Item -ItemType Directory -Path $assetsDir }

$outBuildPng = Join-Path $buildDir "icon.png"
$outPublicPng = Join-Path $publicDir "icon.png"
$outAssetsPng = Join-Path $assetsDir "icon.png"

$target.Save($outBuildPng, [System.Drawing.Imaging.ImageFormat]::Png)
Copy-Item $outBuildPng $outPublicPng -Force
Copy-Item $outBuildPng $outAssetsPng -Force
Copy-Item $outBuildPng (Join-Path $buildDir "Focus.png") -Force
Copy-Item $outBuildPng (Join-Path $publicDir "Focus.png") -Force

$target.Dispose()

Write-Output "Successfully saved square PNG to build, public, and src/renderer/assets ($size x $size)"
