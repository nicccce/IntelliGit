$ErrorActionPreference = "Continue"

$root = Get-Location

$repos = @(
  @{ Repo = "tree-sitter-python"; Out = "tree-sitter-python.wasm" },
  @{ Repo = "tree-sitter-go";     Out = "tree-sitter-go.wasm" },
  @{ Repo = "tree-sitter-java";   Out = "tree-sitter-java.wasm" },
  @{ Repo = "tree-sitter-c";      Out = "tree-sitter-c.wasm" },
  @{ Repo = "tree-sitter-cpp";    Out = "tree-sitter-cpp.wasm" }
)

$outDir = Join-Path $root "src\renderer\public\tree-sitter"
if (-not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}

function Find-ExistingWasm {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SearchRoot
  )

  $files = Get-ChildItem -Path $SearchRoot -Recurse -File -Filter "*.wasm" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.FullName -notmatch "\\node_modules\\" -and
      $_.FullName -notmatch "\\.git\\" -and
      $_.FullName -notmatch "\\dist\\" -and
      $_.FullName -notmatch "\\build\\" -and
      $_.FullName -notmatch "\\out\\"
    } |
    Sort-Object LastWriteTime -Descending

  if ($files.Count -gt 0) {
    return $files[0].FullName
  }

  return $null
}

function Try-BuildRepo {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath
  )

  $commands = @(
    "npm run build-wasm",
    "npm run build"
  )

  foreach ($cmd in $commands) {
    Write-Host "Trying: $cmd" -ForegroundColor Cyan
    Push-Location $RepoPath
    try {
      cmd /c $cmd
      if ($LASTEXITCODE -eq 0) {
        return $true
      }
    }
    catch {
      Write-Host "Failed: $cmd" -ForegroundColor Yellow
    }
    finally {
      Pop-Location
    }
  }

  return $false
}

foreach ($item in $repos) {
  $repoPath = Join-Path $root $item.Repo
  $targetName = $item.Out

  Write-Host "`n==============================" -ForegroundColor Magenta
  Write-Host "Processing $($item.Repo)" -ForegroundColor Magenta
  Write-Host "Path: $repoPath" -ForegroundColor Magenta
  Write-Host "==============================" -ForegroundColor Magenta

  if (-not (Test-Path $repoPath)) {
    Write-Host "Repo not found, skip." -ForegroundColor Red
    continue
  }

  $wasm = Find-ExistingWasm -SearchRoot $repoPath

  if (-not $wasm) {
    Write-Host "No existing wasm found, try build script..." -ForegroundColor Yellow
    $built = Try-BuildRepo -RepoPath $repoPath
    if ($built) {
      $wasm = Find-ExistingWasm -SearchRoot $repoPath
    }
  }

  if (-not $wasm) {
    Write-Host "Still no wasm found, skip $($item.Repo)." -ForegroundColor Red
    continue
  }

  $dest = Join-Path $outDir $targetName
  Copy-Item -Path $wasm -Destination $dest -Force

  Write-Host "Copied:" -ForegroundColor Green
  Write-Host "  Source: $wasm"
  Write-Host "  Target: $dest"
}

Write-Host "`nDone." -ForegroundColor Green