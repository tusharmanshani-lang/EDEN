$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Send-Event($kind, $text) { [Console]::WriteLine((@{kind=$kind;text=$text} | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
try {
 Add-Type -AssemblyName System.Speech
 $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
 $english = $installed | Where-Object { $_.Culture.Name -like 'en-*' } | Select-Object -First 1
 if (!$english) { throw 'Install an English speech recognition language in Windows Settings, then restart EDEN.' }
 $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($english)
 $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
 $recognizer.SetInputToDefaultAudioDevice()
 Send-Event 'ready' ''
 while ($true) {
  $result = $recognizer.Recognize([TimeSpan]::FromSeconds(10))
  if ($result -and $result.Confidence -ge 0.55) { Send-Event 'transcript' $result.Text }
 }
} catch { Send-Event 'error' 'Windows speech input unavailable. Allow desktop microphone access and install an English speech recognition language.'; exit 1 }
finally { if ($recognizer) { $recognizer.Dispose() } }
