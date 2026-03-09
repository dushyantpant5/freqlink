# FreqLink Installer for Windows
# Run with: irm https://freqlink.onrender.com/install.ps1 | iex

$ErrorActionPreference = 'Stop'

$REQUIRED_NODE_MAJOR = 18

function Write-Info    { Write-Host "  $args" -ForegroundColor Cyan }
function Write-Success { Write-Host "  v $args" -ForegroundColor Green }
function Write-Warn    { Write-Host "  ! $args" -ForegroundColor Yellow }
function Write-Err     { Write-Host "  x $args" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  FreqLink - Terminal Encrypted Messaging" -ForegroundColor Cyan
Write-Host ""

# --- Check / install Node.js --------------------------------------------------

function Get-NodeMajor {
  try {
    $version = & node -e "process.stdout.write(process.version.slice(1).split('.')[0])" 2>$null
    return [int]$version
  } catch {
    return 0
  }
}

$nodeMajor = Get-NodeMajor

if ($nodeMajor -ge $REQUIRED_NODE_MAJOR) {
  $nodeVersion = & node --version
  Write-Success "Node.js $nodeVersion found"
} else {
  Write-Warn "Node.js >= $REQUIRED_NODE_MAJOR not found. Attempting install via winget..."

  $wingetAvailable = $null -ne (Get-Command winget -ErrorAction SilentlyContinue)

  if ($wingetAvailable) {
    try {
      winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
      # Refresh PATH so node is available in this session
      $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                  [System.Environment]::GetEnvironmentVariable('Path', 'User')

      $nodeMajor = Get-NodeMajor
      if ($nodeMajor -ge $REQUIRED_NODE_MAJOR) {
        $nodeVersion = & node --version
        Write-Success "Node.js $nodeVersion installed"
      } else {
        Write-Err "Node.js install succeeded but node is not in PATH yet. Open a new terminal and re-run, or install manually from https://nodejs.org"
      }
    } catch {
      Write-Err "winget install failed. Please install Node.js >= $REQUIRED_NODE_MAJOR from https://nodejs.org and re-run."
    }
  } else {
    Write-Err "winget not available. Please install Node.js >= $REQUIRED_NODE_MAJOR from https://nodejs.org, then re-run this script."
  }
}

# --- Launch FreqLink ----------------------------------------------------------

Write-Success "Launching FreqLink..."
Write-Host ""

& npx --yes freqlink
