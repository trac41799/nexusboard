#Requires -Version 5.1
<#
  orchestrate.ps1 — Monolith Wave Orchestrator
  Uses SourceForge conventions (worktrees, .acc/GUIDELINE.md, HANDOFF_*.md)
  Spawns real OpenCode agents to implement each step.
#>

param(
    [string]$SpecFile = "spec\GAP_CLOSURE_PLAN.md",
    [string]$Agent = "opencode",
    [string]$Model = "deepseek-v4-pro",
    [int]$MaxAgentsPerWave = 2
)

$ErrorActionPreference = "Stop"
$repoDir = Resolve-Path "."

# ── Phase 1 ── Parse the spec ──────────────────────────────────────────
Write-Host "═══ NexusBoard — SourceForge Wave Orchestrator ═══" -ForegroundColor Cyan
Write-Host ""

Write-Host "📋 Parsing spec: $SpecFile" -ForegroundColor Yellow
$specContent = Get-Content $SpecFile -Raw
$lines = $specContent -split "`r?`n"

$phases = @{}
$currentPhase = $null
$currentStep = $null
$currentBody = @()
$tasks = @()

foreach ($line in $lines) {
    $trimmed = $line.TrimStart(' ')
    
    # Phase header: ### Phase N: Name (WAVE N)
    if ($trimmed -match '^##+\s+Phase\s+(\d+):?\s*(.+)$') {
        $phaseId = $Matches[1]
        $phaseName = $Matches[2]
        $phases[$phaseId] = @{ name = $phaseName; tasks = @() }
        $currentPhase = $phaseId
        continue
    }
    
    # Step header: #### Step X.Y: Title
    if ($trimmed -match '^####\s+Step\s+([\d.]+):?\s*(.+)$') {
        if ($currentStep -and $currentPhase) {
            $tasks += @{
                phase = $currentPhase
                step  = $currentStep.id
                title = $currentStep.title
                body  = $currentBody -join "`n"
            }
        }
        $currentStep = @{ id = $Matches[1]; title = $Matches[2] }
        $currentBody = @()
        continue
    }
    
    if ($currentStep) { $currentBody += $line }
}

# Flush last task
if ($currentStep -and $currentPhase) {
    $tasks += @{
        phase = $currentPhase
        step  = $currentStep.id
        title = $currentStep.title
        body  = $currentBody -join "`n"
    }
}

Write-Host "   Found $($tasks.Count) tasks in $($phases.Count) phases"
foreach ($t in $tasks) { Write-Host "     Phase $($t.phase) Step $($t.step): $($t.title)" }

# ── Phase 2 ── Seed the initial project skeleton ────────────────────────
Write-Host ""
Write-Host "🏗️  Seeding project skeleton..." -ForegroundColor Yellow

$packageJson = @{
    name = "nexusboard"
    version = "0.1.0"
    private = $true
    scripts = @{
        dev = "tsx watch src/server.ts"
        build = "tsc"
        start = "node dist/server.js"
    }
    dependencies = @{
        express = "^4.18.2"
        cors = "^2.8.5"
        "cookie-parser" = "^1.4.6"
        bcrypt = "^5.1.1"
        jsonwebtoken = "^9.0.2"
        passport = "^0.7.0"
        "passport-google-oauth20" = "^2.0.0"
        "passport-github2" = "^0.1.12"
        "socket.io" = "^4.7.4"
        zod = "^3.22.4"
        "@prisma/client" = "^5.10.0"
    }
    devDependencies = @{
        typescript = "^5.3.3"
        "@types/express" = "^4.17.21"
        "@types/cors" = "^2.8.17"
        "@types/cookie-parser" = "^1.4.6"
        "@types/bcrypt" = "^5.0.2"
        "@types/jsonwebtoken" = "^9.0.5"
        "@types/passport" = "^1.0.16"
        "@types/passport-google-oauth20" = "^2.0.14"
        "@types/passport-github2" = "^1.2.5"
        tsx = "^4.7.0"
        prisma = "^5.10.0"
    }
}

$json = $packageJson | ConvertTo-Json -Depth 4
$json = ($json -replace '"', '""')  # escape for JSON in JSON

# Write package.json
$packageJson | ConvertTo-Json -Depth 4 | Set-Content "$repoDir\package.json" -Encoding UTF8
$tsconfig = @{ compilerOptions = @{ target="ES2022"; module="commonjs"; outDir="./dist"; rootDir="./src"; strict=$true; esModuleInterop=$true; skipLibCheck=$true; forceConsistentCasingInFileNames=$true; resolveJsonModule=$true; declaration=$true } } | ConvertTo-Json -Depth 3
Set-Content "$repoDir\tsconfig.json" -Value $tsconfig -Encoding UTF8

# .env template
@"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/nexusboard"
JWT_SECRET="dev-secret-change-in-production"
JWT_REFRESH_SECRET="dev-refresh-secret-change-in-production"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
PORT=3000
CORS_ORIGIN="http://localhost:5173"
"@ | Set-Content "$repoDir\.env" -Encoding UTF8

# Create minimal source structure
New-Item -ItemType Directory -Force -Path "$repoDir\src", "$repoDir\src\auth", "$repoDir\src\middleware", "$repoDir\src\workspaces", "$repoDir\src\tasks", "$repoDir\src\socket", "$repoDir\prisma" | Out-Null

# Create .gitignore
@"
node_modules/
dist/
.env
*.db
*.db-journal
"@ | Set-Content "$repoDir\.gitignore" -Encoding UTF8

# Initial commit with skeleton
Set-Location $repoDir
git add -A 2>&1 | Out-Null
git commit -m "feat: initial skeleton for NexusBoard" 2>&1 | Out-Null
Write-Host "   ✅ Committed skeleton"

# ── Phase 3 ── Extract file lists from each task ───────────────────────
Write-Host ""
Write-Host "🔍 Extracting file plans from specs..." -ForegroundColor Yellow

foreach ($t in $tasks) {
    $create = @()
    $modify = @()
    foreach ($l in ($t.body -split "`n")) {
        if ($l -match 'Files to create.*?:\s*(.+)$') {
            $create = ($Matches[1] -split ',\s*') -replace '^`|`$' -replace "'"
        }
        if ($l -match 'Files to modify.*?:\s*(.+)$') {
            $modify = ($Matches[1] -split ',\s*') -replace '^`|`$' -replace "'"
        }
    }
    $t.create = $create
    $t.modify = $modify
    Write-Host "   Step $($t.step): +$($create.Count) files, ~$($modify.Count) files"
}

# ── Phase 4 ── Execute WAVE 1 (parallel) ──────────────────────────────
$wave1Tasks = $tasks | Where-Object { $_.phase -eq "1" }
$worktreeBase = Join-Path $repoDir ".worktrees"

Write-Host ""
Write-Host "═══ WAVE 1: Foundation (Parallel) ═══" -ForegroundColor Green
Write-Host ""

$jobs = @()

foreach ($task in $wave1Tasks) {
    $wtName = "wave1-$($task.step -replace '\.','-')"
    $wtPath = Join-Path $worktreeBase $wtName
    $agentRef = "agent-$($task.step)"
    
    Write-Host "🚀 Step $($task.step): $($task.title)" -ForegroundColor Cyan
    
    # Create worktree
    if (Test-Path $wtPath) { Remove-Item -Recurse -Force $wtPath }
    git worktree add $wtPath -b "agent/wave1/$($task.step -replace '\.','')" 2>&1 | Out-Null
    
    # Write GUIDELINE.md
    $accDir = Join-Path $wtPath ".acc"
    New-Item -ItemType Directory -Force -Path $accDir | Out-Null
    
    $guideline = @"
# $($task.title)

**Agent Ref:** $agentRef
**Phase:** 1 (Foundation)
**Step:** $($task.step)
**Wave:** 1

## Objective
$($task.body -split "`n" | Where-Object { $_ -match "Objective" } | ForEach-Object { ($_ -split ":\s*", 2)[1] })`

## Task
Implement the following in this worktree:

$($task.body -split "`n" | ForEach-Object { if ($_ -match "^\*\*") { $_ } })`

## Files to Create
$($task.create -join ", ")

## Files to Modify  
$($task.modify -join ", ")

## Communication Protocol
Use `[ACC:STATUS from=$agentRef] <message>` for status updates.
Use `[ACC:BLOCKER from=$agentRef] <message>` when blocked.

## Handoff
When complete, write a `HANDOFF_$($task.step).md` file in this worktree root with sections:
- Completed Work
- Test Results
- Interface Contracts Exposed
- Files Modified
- Design Decisions
- Handoff Instructions

## Environment
- Working directory: $wtPath
- Project root: $repoDir
- The project uses TypeScript, Express, Prisma, PostgreSQL, JWT, Socket.IO
"@
    
    $guideline | Set-Content (Join-Path $accDir "GUIDELINE.md") -Encoding UTF8
    Write-Host "   📝 Wrote GUIDELINE.md to $accDir"
    
    Write-Host "   🟢 Spawning OpenCode agent with model: $Model"
    
    # Spawn opencode agent as a background job
    $job = Start-Job -Name $agentRef -ScriptBlock {
        param($worktree, $model, $stepRef, $taskTitle, $taskBody)
        
        Set-Location $worktree
        
        # Build the task prompt
        $prompt = @"
You are implementing step $stepRef of a full-stack team collaboration platform called NexusBoard.

TASK: $taskTitle

Read the .acc/GUIDELINE.md file for complete instructions. Then:

1. Read the project structure and understand the existing code
2. Implement ALL the files listed in "Files to Create" in GUIDELINE.md
3. Modify ALL the files listed in "Files to Modify" in GUIDELINE.md  
4. Make sure the code compiles and is properly structured
5. Write tests if applicable
6. When done, create a HANDOFF_$stepRef.md file summarizing what you did

TECHNICAL DETAILS (from spec):
$taskBody

PROJECT CONTEXT:
- Tech stack: Node.js, Express, TypeScript, Prisma, PostgreSQL, JWT, Socket.IO
- All backend routes should follow REST conventions
- Use Zod for request validation
- All responses should be JSON
- Use bcrypt for password hashing
- JWT tokens in Authorization: Bearer header
"@
        
        # Run opencode with the prompt
        $tempPrompt = Join-Path $worktree ".acc\task_prompt.txt"
        $prompt | Set-Content $tempPrompt -Encoding UTF8
        
        $cmd = "opencode"
        $args = @("--model", $model, "--title", "wave1-$stepRef")
        
        # Use opencode run with the full prompt
        & $cmd run $prompt 2>&1 | Out-File (Join-Path $worktree ".acc\agent_output.log") -Encoding UTF8 -Append
        
        # Check for handoff
        $handoffPath = Join-Path $worktree "HANDOFF_$stepRef.md"
        if (Test-Path $handoffPath) {
            return "OK: Handoff created at $handoffPath"
        } else {
            return "WARN: No handoff found. Check output log."
        }
        
    } -ArgumentList $wtPath, $Model, $task.step, $task.title, $task.body
    
    $jobs += @{ job = $job; ref = $agentRef; step = $task.step; path = $wtPath }
    Write-Host "   🔵 Agent $agentRef started (Job $($job.Id))"
    Write-Host ""
    
    if ($jobs.Count -ge $MaxAgentsPerWave) { break }
}

# ── Phase 5 ── Wait for WAVE 1 agents ─────────────────────────────────
Write-Host "⏳ Waiting for WAVE 1 agents to complete..." -ForegroundColor Yellow
Write-Host ""

$results = @()
$timeout = 600  # 10 minutes max per agent
$startTime = Get-Date

while ($jobs.Count -gt 0) {
    $remaining = @()
    foreach ($j in $jobs) {
        if ($j.job.State -eq "Completed") {
            $out = Receive-Job -Job $j.job
            Write-Host "   ✅ $($j.ref) (Step $($j.step)): $out" -ForegroundColor Green
            $handoffFile = Join-Path $j.path "HANDOFF_$($j.step).md"
            if (Test-Path $handoffFile) {
                Write-Host "      📄 Handoff: $(Get-Item $handoffFile).Length bytes" -ForegroundColor Green
                $results += @{ step = $j.step; status = "done"; path = $j.path; handoff = $handoffFile }
            } else {
                $results += @{ step = $j.step; status = "no-handoff"; path = $j.path; handoff = $null }
            }
            Remove-Job -Job $j.job
        }
        elseif ($j.job.State -eq "Failed") {
            Write-Host "   ❌ $($j.ref) (Step $($j.step)) FAILED" -ForegroundColor Red
            $err = Receive-Job -Job $j.job
            Write-Host "      Error: $err"
            $results += @{ step = $j.step; status = "failed"; path = $j.path; handoff = $null }
            Remove-Job -Job $j.job
        }
        else {
            $remaining += $j
            $elapsed = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 0)
        }
    }
    $jobs = $remaining
    if ($jobs.Count -gt 0 -and ((Get-Date) - $startTime).TotalSeconds -gt $timeout) {
        Write-Host "   ⏰ Timeout reached. Killing remaining agents..." -ForegroundColor Red
        foreach ($j in $jobs) { Stop-Job -Job $j.job; Remove-Job -Job $j.job }
        break
    }
    if ($jobs.Count -gt 0) { Start-Sleep -Seconds 5 }
}

# ── Phase 6 ── Report ──────────────────────────────────────
Write-Host ""
Write-Host "═══ WAVE 1 Report ═══" -ForegroundColor Cyan
Write-Host ""
foreach ($r in $results) {
    $statusColor = if ($r.status -eq "done") { "Green" } else { "Red" }
    Write-Host "   Step $($r.step): $($r.status)" -ForegroundColor $statusColor
    if ($r.handoff -and (Test-Path $r.handoff)) {
        Get-Content $r.handoff | ForEach-Object { Write-Host "     $_" }
    }
}

Write-Host ""
Write-Host "═══ Orchestration Complete ═══" -ForegroundColor Cyan
Write-Host "Results: $(($results | Where-Object { $_.status -eq 'done' }).Count)/$($results.Count) tasks completed"
Write-Host "Worktrees in: $worktreeBase"
Write-Host "To clean up: git worktree prune ; Remove-Item -Recurse .worktrees -Force"
