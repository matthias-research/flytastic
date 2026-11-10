// Pointer/keyboard controls based on Swiss Explorer's rectangular flight pad.
import { clamp } from './flight.js';

export function configureFlightControls({activate,brake,setHeight}) {
  const pad=document.getElementById('flight-pad'),stick=document.getElementById('flight-stick');
  const heightPad=document.getElementById('flight-height-pad'),heightStick=document.getElementById('flight-height-stick');
  let pointer,heightPointer,x=0,y=0,enabled=false,targetHeight=650;
  const range=element=>element.getBoundingClientRect().height*44/144;
  const heightFromEvent=e=>{
    const rect=heightPad.getBoundingClientRect(),travel=range(heightPad);
    return 100+clamp((rect.top+rect.height/2+travel-e.clientY)/(2*travel),0,1)*1900;
  };
  const move=e=>{
    const rect=pad.getBoundingClientRect(),travel=range(pad);
    x=clamp((e.clientX-rect.left-rect.width/2)/travel,-1,1);
    y=clamp((rect.top+rect.height/2+travel-e.clientY)/(travel*2),0,1);
    if(y<=.02)brake();
  };
  pad.addEventListener('pointerdown',e=>{
    if(!enabled||pointer!==undefined||e.button!==0)return;
    e.preventDefault();activate();pad.focus();pointer=e.pointerId;pad.setPointerCapture(pointer);move(e);
  });
  pad.addEventListener('pointermove',e=>{if(e.pointerId===pointer)move(e);});
  heightPad.addEventListener('pointerdown',e=>{
    if(!enabled||heightPointer!==undefined||e.button!==0)return;
    e.preventDefault();heightPad.focus();heightPointer=e.pointerId;heightPad.setPointerCapture(heightPointer);setHeight(heightFromEvent(e));
  });
  heightPad.addEventListener('pointermove',e=>{if(e.pointerId===heightPointer)setHeight(heightFromEvent(e));});
  for(const event of ['pointerup','pointercancel','lostpointercapture']) {
    pad.addEventListener(event,e=>{if(e.pointerId===pointer)pointer=undefined;});
    heightPad.addEventListener(event,e=>{if(e.pointerId===heightPointer)heightPointer=undefined;});
  }
  heightPad.addEventListener('keydown',e=>{
    const changes={ArrowUp:50,ArrowRight:50,ArrowDown:-50,ArrowLeft:-50,PageUp:200,PageDown:-200};
    if(!enabled||e.ctrlKey||e.metaKey||e.altKey)return;
    if(Object.hasOwn(changes,e.code)||e.code==='Home'||e.code==='End') {
      e.preventDefault();e.stopPropagation();setHeight(e.code==='Home'?100:e.code==='End'?2000:targetHeight+changes[e.code]);
    }
  });
  return {
    enable(){enabled=true;pad.setAttribute('aria-disabled','false');heightPad.setAttribute('aria-disabled','false');},
    reset(){
      for(const [element,id] of [[pad,pointer],[heightPad,heightPointer]])if(id!==undefined&&element.hasPointerCapture(id))element.releasePointerCapture(id);
      pointer=heightPointer=undefined;x=y=0;
    },
    input(dt){if(pointer===undefined){x*=Math.exp(-5*dt);y*=Math.exp(-5*dt);}return {x,y};},
    render(status) {
      const travel=range(pad),heightTravel=range(heightPad);
      stick.style.transform=`translate(-50%,-50%) translate(${status.x*travel}px,${-status.y*travel*2}px)`;
      targetHeight=status.clearance;
      const bounded=clamp(targetHeight,100,2000);
      heightStick.style.transform=`translate(-50%,-50%) translateY(${-((bounded-100)/1900)*heightTravel*2}px)`;
      heightPad.setAttribute('aria-valuenow',String(Math.round(bounded)));
      heightPad.setAttribute('aria-valuetext',`${Math.round(targetHeight)} metres above ground`);
      document.getElementById('flight-speed').textContent=`${Math.round(status.speed).toLocaleString()} km/h`;
      document.getElementById('flight-clearance').textContent=`${Math.round(targetHeight).toLocaleString()} m target`;
      document.getElementById('flight-status').textContent=status.active?(status.cruise?'Cruise · Space to stop':'Manual flight'):'Paused · drag disk to fly';
    },
  };
}
