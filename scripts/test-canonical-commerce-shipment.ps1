[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$composeFile = Join-Path $PSScriptRoot '..\docker-compose.canonical-commerce-shipment-test.yml'
$service = 'canonical-commerce-shipment-postgres'
$psqlBase = @('-T', $service, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'canonical_commerce_shipment_test', '-d', 'canonical_commerce_shipment_test')

function Invoke-SqlFile([string]$File) {
  Write-Host "[canonical-commerce-shipment] applying $File"
  & docker compose -f $composeFile exec @psqlBase -f "/workspace/$File"
  if ($LASTEXITCODE -ne 0) { throw "psql failed for $File" }
}

try {
  & docker compose -f $composeFile up --detach --wait --remove-orphans
  if ($LASTEXITCODE -ne 0) { throw 'Docker PostgreSQL 17 did not become healthy.' }

  @(
    'tests/sql/central-fulfillment-intake/00-bootstrap.sql',
    'tests/sql/central-fulfillment-intake/05-legacy-state.sql',
    'supabase/migrations/20260722030000_add_central_fulfillment_foundation.sql',
    'supabase/migrations/20260722040000_add_store_memberships_permissions.sql',
    'supabase/migrations/20260722050000_activate_central_fulfillment_intake.sql',
    'tests/sql/canonical-commerce-shipment/00-bootstrap.sql',
    'supabase/migrations/20260722060000_add_canonical_commerce_shipments.sql',
    'supabase/migrations/20260722070000_activate_canonical_commerce_shipments.sql',
    'tests/sql/canonical-commerce-shipment/10-contract.sql',
    'tests/sql/canonical-commerce-shipment/20-concurrency.sql'
  ) | ForEach-Object { Invoke-SqlFile $_ }
  Write-Host '[canonical-commerce-shipment] PostgreSQL 17 contracts passed'
}
finally {
  & docker compose -f $composeFile down --volumes --remove-orphans | Out-Host
}
