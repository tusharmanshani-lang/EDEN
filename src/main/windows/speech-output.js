'use strict';
// Fixed application code only. Spoken user text is passed through stdin, never interpolated.
const command = "$ErrorActionPreference='Stop'; [Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false); try { Add-Type -AssemblyName System.Speech; $voice=[System.Speech.Synthesis.SpeechSynthesizer]::new(); try { $voice.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female) } catch {}; $voice.Speak([Console]::In.ReadToEnd()); $voice.Dispose() } catch { [Console]::Error.WriteLine('Windows speech output unavailable. Check installed voices.'); exit 1 }";
module.exports={args:['-NoProfile','-NonInteractive','-Command',command]};
