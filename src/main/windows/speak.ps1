$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
 Add-Type -AssemblyName System.Speech
 $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
 try { $speaker.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female) } catch {}
 $text = [Console]::In.ReadToEnd()
 $speaker.Speak($text)
 $speaker.Dispose()
} catch { [Console]::Error.WriteLine('Windows speech failed. Check installed speech voices.'); exit 1 }
