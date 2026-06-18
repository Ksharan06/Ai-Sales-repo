param(
    [string]$pptPath,
    [string]$outputDir,
    [string]$lessonId
)

# Force stdout to use UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Resolve absolute paths
$pptPath = [System.IO.Path]::GetFullPath($pptPath)

# Create output folder if it doesn't exist
$destDir = Join-Path $outputDir $lessonId
if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
}
$destDir = [System.IO.Path]::GetFullPath($destDir)

# Start PowerPoint COM
$powerpoint = New-Object -ComObject PowerPoint.Application
# WithWindow = False (0)
# Open(filename, ReadOnly, Untitled, WithWindow)
$presentation = $powerpoint.Presentations.Open($pptPath, 0, 0, 0)

$slidesData = @()

for ($i = 1; $i -le $presentation.Slides.Count; $i++) {
    $slide = $presentation.Slides.Item($i)
    
    # Export slide to PNG image
    $imageFileName = "slide_$i.png"
    $imagePath = Join-Path $destDir $imageFileName
    $slide.Export($imagePath, "PNG")
    
    # Extract text from slide shapes
    $slideText = ""
    foreach ($shape in $slide.Shapes) {
        # Regular text shapes
        if ($shape.HasTextFrame -eq -1) {
            if ($shape.TextFrame.HasText -eq -1) {
                $slideText += $shape.TextFrame.TextRange.Text + "`n"
            }
        }
        # Table shapes
        if ($shape.HasTable -eq -1) {
            for ($row = 1; $row -le $shape.Table.Rows.Count; $row++) {
                for ($col = 1; $col -le $shape.Table.Columns.Count; $col++) {
                    $cell = $shape.Table.Cell($row, $col)
                    if ($cell.Shape.HasTextFrame -eq -1) {
                        $slideText += $cell.Shape.TextFrame.TextRange.Text + " "
                    }
                }
                $slideText += "`n"
            }
        }
    }
    
    # Clean up text
    $slideText = $slideText.Trim()
    
    $slidesData += [PSCustomObject]@{
        slideNumber = $i
        imageUrl = "/uploads/$lessonId/$imageFileName"
        extractedText = $slideText
    }
}

# Close and Quit
$presentation.Close()
$powerpoint.Quit()

# Output slides details to stdout as JSON
$slidesData | ConvertTo-Json -Compress
