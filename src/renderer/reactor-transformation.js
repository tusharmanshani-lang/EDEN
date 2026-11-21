// EDEN_NANOTECH_V3 — body-following mesh reveal with a restrained reactor pulse.
export function createReactorTransformation({stage,reducedMotion}) {
  const canvas=document.createElement('canvas');
  canvas.className='eden-reactor-transformation';canvas.hidden=true;
  canvas.setAttribute('aria-hidden','true');stage.appendChild(canvas);
  const c=canvas.getContext('2d');let active=null,disposed=false,w=1,h=1;
  const classes=['eden-reactor-transforming','eden-reactor-mask','eden-reactor-reveal','eden-reactor-minimal'];
  function resize(){const rect=stage.getBoundingClientRect();w=Math.max(1,rect.width);h=Math.max(1,rect.height);const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);c?.setTransform(dpr,0,0,dpr,0,0);}
  const observer=new ResizeObserver(resize);observer.observe(stage);
  function clear(){c?.clearRect(0,0,w,h);canvas.hidden=true;stage.classList.remove(...classes);}
  function finish(run,ok,error){
    if(active!==run)return;active=null;cancelAnimationFrame(run.frame);
    if(!ok&&!run.committed&&!run.reveal?.committed){run.reveal?.cancel();run.onCancel?.();}
    clear();if(error)run.reject(error);else run.resolve(ok);
  }
  function draw(run,p){
    if(!c)return;c.clearRect(0,0,w,h);const actual=run.targets?.chest||{x:w*.5,y:h*.38};
    const t=Math.min(1,p/.22),ease=t*t*(3-2*t);
    const chest=run.from==='energy'?{x:w*.5+(actual.x-w*.5)*ease,y:h*.5+(actual.y-h*.5)*ease}:actual;
    const colour=run.to==='original'?[255,213,156]:[105,225,255];
    const alpha=p<.18?Math.sin(p/.18*Math.PI)*.7:p>.86?Math.sin(Math.min(1,(p-.86)/.14)*Math.PI)*.75:0;
    c.save();c.globalCompositeOperation='lighter';
    if(alpha>0){
      const radius=p<.18?16+p*100:18+(p-.86)*80;
      const glow=c.createRadialGradient(chest.x,chest.y,0,chest.x,chest.y,radius*2);
      glow.addColorStop(0,`rgba(${colour},${alpha*.45})`);glow.addColorStop(1,`rgba(${colour},0)`);
      c.fillStyle=glow;c.fillRect(chest.x-radius*2,chest.y-radius*2,radius*4,radius*4);
      c.strokeStyle=`rgba(${colour},${alpha})`;c.lineWidth=1.2;c.beginPath();c.arc(chest.x,chest.y,radius,0,Math.PI*2);c.stroke();
    }
    for(let i=0;i<(run.edge||[]).length;i+=2){
      const point=run.edge[i],x=point.x*w,y=point.y*h;
      c.fillStyle=`rgba(${colour},.65)`;c.fillRect(x,y,1.5,1.5);
      if(i%8===0){c.strokeStyle=`rgba(${colour},.3)`;c.lineWidth=.7;c.beginPath();c.moveTo(x,y);c.lineTo(x+3,y-3);c.stroke();}
    }
    c.restore();
  }
  function play({from='human',to='reactor',begin,getTargets,isCancelled=()=>false,onCancel}){
    if(disposed)return Promise.resolve(false);if(active)finish(active,false);
    if(typeof begin!=='function')return Promise.reject(new Error('The mesh reveal is not connected.'));
    resize();return new Promise((resolve,reject)=>{
      const run={from,to,resolve,reject,onCancel,frame:0,elapsed:0,last:null,starting:false,reveal:null,completing:false,committed:false,endedAt:null,edge:[],targets:null};
      active=run;stage.classList.add('eden-reactor-transforming');canvas.hidden=reducedMotion.matches||!c;
      try{run.targets=getTargets?.();}catch(error){finish(run,false,error);return;}
      const start=()=>{
        if(run.starting)return;run.starting=true;
        Promise.resolve().then(()=>active===run&&!isCancelled()?begin():null).then(reveal=>{
          if(active!==run){reveal?.cancel();return;}
          if(!reveal||isCancelled()){reveal?.cancel();finish(run,false);return;}
          run.reveal=reveal;resize();run.targets=getTargets?.()||run.targets;
        }).catch(error=>finish(run,false,error));
      };
      const complete=()=>{
        if(run.completing||!run.reveal)return;run.completing=true;
        run.reveal.update(1);
        Promise.resolve(run.reveal.complete()).then(ok=>{
          if(active!==run)return;
          if(!ok||isCancelled()){finish(run,false);return;}
          run.committed=true;
        }).catch(error=>finish(run,false,error));
      };
      const tick=now=>{
        if(active!==run)return;
        try{
          if(isCancelled()){finish(run,false);return;}
          const delta=run.last===null?0:Math.max(0,Math.min(50,now-run.last));run.last=now;
          if(reducedMotion.matches){
            canvas.hidden=true;start();if(run.reveal)complete();
            if(run.committed){stage.classList.add('eden-reactor-minimal');run.endedAt??=now;if(now-run.endedAt>=180){finish(run,true);return;}}
          }else{
            if(!(run.starting&&!run.reveal)&&!(run.completing&&!run.committed))run.elapsed+=delta;
            const p=Math.max(0,Math.min(1,run.elapsed/(to==='original'?2600:2800)));
            if(p>=.16)start();
            if(run.reveal&&!run.completing)run.edge=run.reveal.update(Math.max(0,Math.min(1,(p-.16)/.72)))||[];
            if(p>=.9)complete();draw(run,p);
            if(p>=1&&run.committed){finish(run,true);return;}
          }
          run.frame=requestAnimationFrame(tick);
        }catch(error){finish(run,false,error);}
      };
      run.frame=requestAnimationFrame(tick);
    });
  }
  return{play,cancel(){if(active)finish(active,false);},dispose(){disposed=true;if(active)finish(active,false);observer.disconnect();canvas.remove();}};
}
