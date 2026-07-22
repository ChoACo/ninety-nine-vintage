[CmdletBinding()]
param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]] $Prompt,

    [ValidateSet('Auto', 'Fast', 'Repeat', 'General', 'Deep', 'Critical')]
    [string] $TaskType = 'Auto',

    [switch] $NonInteractive,

    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$promptText = ($Prompt -join ' ').Trim()

if ([string]::IsNullOrWhiteSpace($promptText)) {
    $promptText = Read-Host 'Codex에 전달할 작업을 입력하세요'
}

if ([string]::IsNullOrWhiteSpace($promptText)) {
    throw '작업 내용이 비어 있습니다.'
}

function Find-CodexCli {
    $command = Get-Command codex -ErrorAction SilentlyContinue
    if ($command -and $command.Source -notlike '*WindowsApps*') {
        return $command.Source
    }

    $candidateRoots = @(
        (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'),
        (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin')
    )

    foreach ($candidateRoot in $candidateRoots) {
        if (-not (Test-Path -LiteralPath $candidateRoot)) {
            continue
        }

        $candidate = Get-ChildItem -LiteralPath $candidateRoot -Filter 'codex.exe' -File -Recurse |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if ($candidate) {
            return $candidate.FullName
        }
    }

    if ($command) {
        return $command.Source
    }

    throw 'Codex CLI를 찾지 못했습니다. Codex 앱 또는 CLI 설치 상태를 확인하세요.'
}

function Get-AutoTaskType([string] $Text) {
    $critical = '(?i)(payment|portone|refund|webhook|auth(?:entication|orization)?|permission|auction|anti[- ]?sniping|bid|order|inventory|database|migration|supabase|drizzle|row[- ]level|rls|결제|환불|웹훅|인증|인가|권한|경매|입찰|낙찰|주문|재고|데이터베이스|마이그레이션)'
    $deep = '(?i)(architecture|architect|system design|product design|security|concurrency|idempotenc|transaction|large refactor|release blocker|아키텍처|시스템 설계|제품 설계|보안|동시성|멱등성|트랜잭션|대규모 리팩터링|출시 차단)'
    $fast = '(?i)(css|spacing|copy|wording|typo|accessibility attribute|find (?:a )?file|locate|single file|문구|오탈자|간격|파일 찾|위치 찾|단일 파일)'
    $repeat = '(?i)(inventory|map(?:ping)?|summari[sz]e logs?|changelog|documentation|lint errors?|test results?|rename across|목록화|매핑|로그 요약|문서화|린트 오류|테스트 결과|반복 변경)'

    if ($Text -match $critical) { return 'Critical' }
    if ($Text -match $deep) { return 'Deep' }
    if ($Text -match $fast) { return 'Fast' }
    if ($Text -match $repeat) { return 'Repeat' }
    return 'General'
}

$routes = @{
    Fast     = @{ Profile = 'codex-fast';     Model = 'gpt-5.3-codex-spark'; Effort = 'low' }
    Repeat   = @{ Profile = 'codex-repeat';   Model = 'gpt-5.6-luna';        Effort = 'medium' }
    General  = @{ Profile = 'codex-general';  Model = 'gpt-5.6-terra';       Effort = 'medium' }
    Deep     = @{ Profile = 'codex-deep';     Model = 'gpt-5.6-sol';         Effort = 'xhigh' }
    Critical = @{ Profile = 'codex-critical'; Model = 'gpt-5.6-sol';         Effort = 'max' }
}

$selectedType = if ($TaskType -eq 'Auto') { Get-AutoTaskType $promptText } else { $TaskType }
$route = $routes[$selectedType]
$codexCli = Find-CodexCli
$catalogVerified = $false
$selectedModel = $route.Model
$selectedEffort = $route.Effort
$useProfile = $true

try {
    $catalogText = (& $codexCli debug models 2>$null | Out-String).Trim()
    $catalog = $catalogText | ConvertFrom-Json
    $available = $catalog.models | Where-Object slug -eq $selectedModel | Select-Object -First 1
    $catalogVerified = $true

    if (-not $available) {
        $fallbackOrder = @('gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6')
        $available = $catalog.models | Where-Object { $_.slug -in $fallbackOrder } |
            Sort-Object { [array]::IndexOf($fallbackOrder, $_.slug) } |
            Select-Object -First 1
        if (-not $available) {
            throw '요청 모델과 안전한 폴백 모델을 현재 카탈로그에서 찾지 못했습니다.'
        }
        $selectedModel = $available.slug
        $useProfile = $false
    }

    $supportedEfforts = @($available.supported_reasoning_levels | ForEach-Object effort)
    if ($selectedEffort -notin $supportedEfforts) {
        $effortOrder = @('max', 'xhigh', 'high', 'medium', 'low')
        $selectedEffort = $effortOrder | Where-Object { $_ -in $supportedEfforts } | Select-Object -First 1
        if (-not $selectedEffort) {
            throw "모델 $selectedModel 에서 사용할 수 있는 추론 강도를 찾지 못했습니다."
        }
        $useProfile = $false
    }
}
catch {
    $catalogVerified = $false
    $useProfile = $false
    Write-Warning "모델 카탈로그를 확인하지 못해 전역 Codex 기본값으로 실행합니다: $($_.Exception.Message)"
}

if ($catalogVerified) {
    Write-Host "[Codex Router] 유형=$selectedType 모델=$selectedModel 추론=$selectedEffort"
} else {
    Write-Host '[Codex Router] 유형만 분류했으며 모델은 현재 전역 기본값을 사용합니다.'
}

if ($DryRun) {
    exit 0
}

$arguments = @()
if ($NonInteractive) {
    $arguments += 'exec'
}

if ($catalogVerified -and $useProfile) {
    $arguments += @('--profile', $route.Profile)
} elseif ($catalogVerified) {
    $arguments += @('--model', $selectedModel, '-c', "model_reasoning_effort=`"$selectedEffort`"")
}

$arguments += @('--cd', $projectRoot, $promptText)
& $codexCli @arguments
exit $LASTEXITCODE
