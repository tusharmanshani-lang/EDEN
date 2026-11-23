'use strict';
(() => {
 if(window.eden?.platform!=='win32')return;
 const input=document.getElementById('message-input');
 const send=document.getElementById('send-button');
 if(!input||!send)return;
 const button=document.createElement('button');button.type='button';button.textContent='Record voice';
 const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel recording';cancel.hidden=true;
 const note=document.createElement('p');note.setAttribute('role','status');note.setAttribute('aria-live','polite');
 note.textContent='Windows voice: record up to 15 seconds, review the text, then Send. Audio is sent to Google only after recording.';
 const container=document.createElement('div');container.className='windows-voice-controls';container.append(button,cancel,note);
 send.closest('form').after(container);
 let stream=null,recorder=null,timer=null,epoch=0,busy=false;
 function release(){clearTimeout(timer);timer=null;stream?.getTracks().forEach(track=>track.stop());stream=null;}
 function reset(){recorder=null;release();busy=false;button.disabled=false;button.textContent='Record voice';cancel.hidden=true;}
 function abort(){epoch++;try{if(recorder?.state==='recording')recorder.stop();}catch{}reset();note.textContent='Recording cancelled. No transcript was sent as a command.';}
 cancel.onclick=()=>{abort();void window.eden.cancelVoiceInput().catch(()=>{});};
 button.onclick=async()=>{
  if(recorder?.state==='recording'){button.disabled=true;recorder.stop();release();return;}
  if(busy||send.disabled)return;
  if(!window.confirm('Record a short microphone clip and send it to Google Gemini for transcription? Google quotas and terms apply. You will review the text before sending a command.'))return;
  const request=++epoch;busy=true;button.disabled=true;cancel.hidden=false;
  let mimeType;
  try{
   mimeType=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
   if(!mimeType)throw Error('Audio recording is unavailable. Use Windows+H in the message field or type instead.');
   const captured=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
   if(request!==epoch){captured.getTracks().forEach(track=>track.stop());return;}
   stream=captured;const chunks=[];let bytes=0;
   const recording=new MediaRecorder(stream,{mimeType,audioBitsPerSecond:64000});recorder=recording;
   recording.ondataavailable=event=>{if(request!==epoch)return;if(event.data.size){bytes+=event.data.size;chunks.push(event.data);if(bytes>4*1024*1024){abort();note.textContent='Recording was too large. Try a shorter clip.';}}};
   recording.onerror=()=>{if(request===epoch){abort();note.textContent='Microphone recording failed. Check Windows microphone permissions.';}};
   recording.onstop=async()=>{
    captured.getTracks().forEach(track=>track.stop());if(request!==epoch)return;release();button.disabled=true;note.textContent='Transcribing with Google…';
    try{
     const blob=new Blob(chunks,{type:mimeType});
     const result=await window.eden.transcribeVoice({mimeType:mimeType.split(';')[0],bytes:new Uint8Array(await blob.arrayBuffer())});
     if(request!==epoch)return;
     if(input.value.trim()) {note.textContent='Transcript (existing draft kept): '+result.text;}
     else {input.value=result.text;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();note.textContent='Review the transcript above, correct it if needed, then press Send.';}
    }catch(error){if(request===epoch)note.textContent=error.message;}
    finally{if(request===epoch)reset();}
   };
   recording.start(250);button.disabled=false;button.textContent='Finish recording';note.textContent='Recording microphone · maximum 15 seconds. Click Finish recording when done.';
   timer=setTimeout(()=>{if(request===epoch&&recording.state==='recording'){button.disabled=true;recording.stop();release();}},15000);
  }catch(error){if(request===epoch){reset();note.textContent='Could not record. '+error.message;}}
 };
 window.eden.onInterrupted?.(()=>{if(busy)abort();});
 window.addEventListener('beforeunload',()=>{epoch++;release();try{recorder?.stop();}catch{}});
})();
