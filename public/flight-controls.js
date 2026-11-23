// Shared pointer/keyboard controls for flight, pitch and target clearance.
import { clamp,MIN_PITCH,MAX_PITCH } from './flight.js';

export function configureFlightControls({activate,brake,setHeight,setPitch}) {
  const byId=id=>document.getElementById(id),pad=byId('flight-pad'),stick=byId('flight-stick');
  let pointer,x=0,y=0,enabled=false;
  const range=element=>element.getBoundingClientRect().height*44/144;
  function vertical(id,min,max,step,pageStep,setValue,format) {
    const element=byId(`flight-${id}-pad`),knob=byId(`flight-${id}-stick`);let held,value=min;
    const move=e=>{
      const rect=element.getBoundingClientRect(),travel=range(element);
      setValue(min+clamp((rect.top+rect.height/2+travel-e.clientY)/(2*travel),0,1)*(max-min));
    };
    element.addEventListener('pointerdown',e=>{
      if(!enabled||held!==undefined||e.button!==0)return;
      e.preventDefault();element.focus();held=e.pointerId;element.setPointerCapture(held);move(e);
    });
    element.addEventListener('pointermove',e=>{if(e.pointerId===held)move(e);});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])element.addEventListener(event,e=>{if(e.pointerId===held)held=undefined;});
    element.addEventListener('keydown',e=>{
      if(!enabled||e.ctrlKey||e.metaKey||e.altKey)return;
      const changes={ArrowUp:step,ArrowRight:step,ArrowDown:-step,ArrowLeft:-step,PageUp:pageStep,PageDown:-pageStep};
      if(Object.hasOwn(changes,e.code)||e.code==='Home'||e.code==='End') {
        e.preventDefault();e.stopPropagation();setValue(clamp(e.code==='Home'?min:e.code==='End'?max:value+changes[e.code],min,max));
      }
    });
    return {
      enable(){element.setAttribute('aria-disabled','false');},
      reset(){if(held!==undefined&&element.hasPointerCapture(held))element.releasePointerCapture(held);held=undefined;},
      render(next){
        value=clamp(next,min,max);
        knob.style.transform=`translate(-50%,-50%) translateY(${-((value-min)/(max-min))*range(element)*2}px)`;
        element.setAttribute('aria-valuenow',String(Math.round(value)));element.setAttribute('aria-valuetext',format(value));
      },
    };
  }
  const height=vertical('height',100,2000,50,200,setHeight,v=>`${Math.round(v)} metres above ground`);
  const pitch=vertical('pitch',-60,60,1,10,v=>setPitch(v*Math.PI/180),v=>`${Math.round(v)} degrees pitch`);
  const move=e=>{
    const rect=pad.getBoundingClientRect(),travel=range(pad);
    x=clamp((e.clientX-rect.left-rect.width/2)/travel,-1,1);y=clamp((rect.top+rect.height/2+travel-e.clientY)/(travel*2),0,1);
    if(y<=.02)brake();
  };
  pad.addEventListener('pointerdown',e=>{
    if(!enabled||pointer!==undefined||e.button!==0)return;
    e.preventDefault();activate();pad.focus();pointer=e.pointerId;pad.setPointerCapture(pointer);move(e);
  });
  pad.addEventListener('pointermove',e=>{if(e.pointerId===pointer)move(e);});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(event,e=>{if(e.pointerId===pointer)pointer=undefined;});
  return {
    enable(){enabled=true;pad.setAttribute('aria-disabled','false');height.enable();pitch.enable();},
    reset(){if(pointer!==undefined&&pad.hasPointerCapture(pointer))pad.releasePointerCapture(pointer);pointer=undefined;x=y=0;height.reset();pitch.reset();},
    input(dt){if(pointer===undefined){x*=Math.exp(-5*dt);y*=Math.exp(-5*dt);}return {x,y};},
    render(status) {
      stick.style.transform=`translate(-50%,-50%) translate(${status.x*range(pad)}px,${-status.y*range(pad)*2}px)`;
      height.render(status.clearance);pitch.render(clamp(status.pitch,MIN_PITCH,MAX_PITCH)*180/Math.PI);
      byId('flight-pitch-value').textContent=`${Math.round(status.pitch*180/Math.PI)}° pitch`;
      byId('flight-speed').textContent=`${Math.round(status.speed).toLocaleString()} km/h`;
      byId('flight-clearance').textContent=`${Math.round(status.clearance).toLocaleString()} m target`;
      byId('flight-status').textContent=status.active?(status.cruise?'Cruise · Space to stop':'Manual flight'):'Paused · drag disk to fly';
    },
  };
}
