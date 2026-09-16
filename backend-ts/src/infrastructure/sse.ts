import type {FastifyReply} from 'fastify';

export interface Sequenced {sequence: number}
export function durableSse<T extends Sequenced>(reply: FastifyReply, events: (after: number) => T[], terminal: () => boolean,
                                                 after = 0): void {
  reply.hijack();
  const response = reply.raw;
  response.writeHead(200, {'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','x-accel-buffering':'no'});
  response.flushHeaders();
  let cursor = after, closed = false, blocked = false, heartbeat = Date.now();
  const close = () => {if (closed) return; closed = true; clearInterval(timer); response.end();};
  const flush = () => {
    if (closed || blocked) return;
    for (const event of events(cursor)) {
      cursor = event.sequence;
      if (!response.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`)) {blocked = true; break;}
    }
    if (terminal() && events(cursor).length === 0) {close(); return;}
    if (!blocked && Date.now()-heartbeat >= 15000) {blocked=!response.write(': heartbeat\n\n'); heartbeat=Date.now();}
  };
  const timer=setInterval(flush,250); timer.unref();
  response.on('drain',()=>{blocked=false;flush();}).once('close',close); flush();
}
