# Native Windows entrypoint: no Bash or system Node installation required.
$ErrorActionPreference = 'Stop'
$pluginRoot = Split-Path -Parent $PSScriptRoot
$runtimeHome = $env:USERPROFILE
if (-not $runtimeHome) { $runtimeHome = $env:HOME }
if (-not $runtimeHome) { $runtimeHome = [Environment]::GetFolderPath('UserProfile') }
$candidates = @(
  $env:ANIMATION_NODE_BINARY
)
if ($runtimeHome) {
  $candidates += Join-Path $runtimeHome '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
}
$pathNode = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
if ($pathNode) { $candidates += $pathNode.Source }
foreach ($candidate in $candidates) {
  if (-not $candidate -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
  try { $nodeVersion = & $candidate --version 2>$null } catch { continue }
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.(\d+)\.') { continue }
  if ([int]$Matches[1] -lt 20 -or ([int]$Matches[1] -eq 20 -and [int]$Matches[2] -lt 19)) { continue }
  $entrypoint = Join-Path $pluginRoot 'run.mjs'
  if (-not (Test-Path -LiteralPath $entrypoint)) { $entrypoint = Join-Path $pluginRoot 'dist/server.js' }
  & $candidate $entrypoint @args
  exit $LASTEXITCODE
}
[Console]::Error.WriteLine('Animation Builder requires Node.js >=20.19. Restore the Codex runtime or set ANIMATION_NODE_BINARY to its absolute path, then reconnect the plugin.')
exit 127
