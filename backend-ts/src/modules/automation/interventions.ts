import {randomUUID} from 'node:crypto';
import type {TaskStore} from '../../platform/store.js';
export function intervention(store:TaskStore,taskId:string,kind:string){const id=randomUUID();store.putRecord('automation-intervention',id,{id,taskId,kind,time:new Date().toISOString()});}
