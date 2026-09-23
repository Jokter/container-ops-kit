// FIFO permits shared by initial governance and repairs after MR creation.
export class RepairQueue {
 private active=0;
 private readonly waiting:Array<()=>void>=[];
 constructor(private readonly limit=2){}
 acquire(signal:AbortSignal):Promise<()=>void>{
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
   const cancel=()=>{const i=this.waiting.indexOf(start);if(i>=0)this.waiting.splice(i,1);reject(signal.reason);};
   const start=()=>{signal.removeEventListener('abort',cancel);this.active++;let released=false;resolve(()=>{if(released)return;released=true;this.active--;this.waiting.shift()?.();});};
   if(this.active<this.limit)start();else{this.waiting.push(start);signal.addEventListener('abort',cancel,{once:true});}
  });
 }
}
