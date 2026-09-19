$bodyObj = @{ prompt = 'simple flat educational illustration of a blue circle on white background, no text'; model = 'narwhal'; n = 1; size = '1024x1024'; response_format = 'b64_json' }
$body = $bodyObj | ConvertTo-Json -Compress
$sw = [Diagnostics.Stopwatch]::StartNew()
$jobs = @()
foreach ($i in 1..2) {
  $jobs += Start-Job -ScriptBlock {
    param($idx,$payload)
    $t = [Diagnostics.Stopwatch]::StartNew()
    try {
      $headers = @{ 'X-Client-Id' = 'client-samgke'; 'Idempotency-Key' = ('autosub-live-concurrency-' + $idx + '-' + [guid]::NewGuid().ToString('N')) }
      $resp = Invoke-RestMethod 'http://127.0.0.1:8001/v1/images/generations' -Method Post -ContentType 'application/json' -Headers $headers -Body $payload -TimeoutSec 300
      [PSCustomObject]@{ i = $idx; ok = $true; sec = [math]::Round($t.Elapsed.TotalSeconds,1); count = @($resp.data).Count }
    } catch {
      [PSCustomObject]@{ i = $idx; ok = $false; sec = [math]::Round($t.Elapsed.TotalSeconds,1); error = $_.Exception.Message }
    }
  } -ArgumentList $i,$body
}
$results = $jobs | Wait-Job -Timeout 330 | Receive-Job
$sw.Stop()
'WALL=' + [math]::Round($sw.Elapsed.TotalSeconds,1)
$results | Format-List
