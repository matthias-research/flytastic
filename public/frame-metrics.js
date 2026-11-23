// Fixed storage: recording frames allocates nothing and never sorts in the loop.
export class FrameMetrics {
  constructor(capacity=7200){this.samples=new Float32Array(capacity);this.reset();}
  reset(){this.count=0;this.cursor=0;this.over25=0;this.over33=0;this.over50=0;this.over100=0;this.maximum=0;this.total=0;this.previous=undefined;this.longTasks=0;this.longestTask=0;}
  frame(now){
    if(this.previous!==undefined) {
      const ms=now-this.previous;
      this.samples[this.cursor]=ms;this.cursor=(this.cursor+1)%this.samples.length;
      this.count++;this.total+=ms;this.maximum=Math.max(this.maximum,ms);
      if(ms>25)this.over25++;if(ms>1000/30)this.over33++;if(ms>50)this.over50++;if(ms>100)this.over100++;
    }
    this.previous=now;
  }
  longTask(ms){this.longTasks++;this.longestTask=Math.max(this.longestTask,ms);}
  snapshot(){
    const values=Array.from(this.samples.subarray(0,Math.min(this.count,this.samples.length))).sort((a,b)=>a-b);
    return {frames:this.count,meanFrameMs:this.count?this.total/this.count:0,
      p50FrameMs:values[Math.max(0,Math.ceil(values.length*.5)-1)]??0,
      p95FrameMs:values[Math.max(0,Math.ceil(values.length*.95)-1)]??0,
      p99FrameMs:values[Math.max(0,Math.ceil(values.length*.99)-1)]??0,maxFrameMs:this.maximum,
      framesOver25:this.over25,framesOver33:this.over33,framesOver50:this.over50,framesOver100:this.over100,longTasks:this.longTasks,longestTaskMs:this.longestTask};
  }
}
