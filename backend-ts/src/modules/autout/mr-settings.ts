import {z} from 'zod';
import type {TaskStore} from '../../platform/store.js';
const account=z.string().trim().regex(/^[A-Za-z][A-Za-z0-9._-]{1,79}$/);
const people=z.array(account).max(30).transform(v=>[...new Set(v)]);
export const rolesSchema=z.object({reviewers:people,approvers:people,assignees:people});
export const mrSettingsSchema=z.object({
 roles:rolesSchema,
 repositories:z.array(z.object({repository:z.string().regex(/^[A-Za-z0-9._-]+$/),roles:rolesSchema.partial()})).max(200).refine(rows=>new Set(rows.map(r=>r.repository.toLowerCase())).size===rows.length),
 notifications:z.boolean(),autoRepair:z.boolean(),contact:account.or(z.literal('')),
 pipelineSeconds:z.number().int().min(30).max(900),reviewSeconds:z.number().int().min(60).max(1800),
 maxRepairRounds:z.number().int().min(1).max(10),reminderMinutes:z.number().int().min(10).max(1440),
 // Legacy API field retained for existing clients; notification scheduling ignores it.
 workHours:z.object({weekdaysOnly:z.boolean(),start:z.number().int().min(0).max(23),end:z.number().int().min(1).max(24)}).refine(v=>v.start<v.end).default({weekdaysOnly:false,start:0,end:24}),
 welinkAccounts:z.record(account,account)
});
export type MrSettings=z.infer<typeof mrSettingsSchema>;
export type MrRoles=z.infer<typeof rolesSchema>;
export class MrConfiguration {
 constructor(private store:TaskStore){}
 get():MrSettings {const split=(v:string|undefined)=>(v||'').split(',').map(s=>s.trim()).filter(Boolean);return this.store.getRecord<MrSettings>('auto-ut-mr-settings','main')??mrSettingsSchema.parse({roles:{reviewers:split(process.env.AUTO_UT_CODEHUB_REVIEWERS),approvers:split(process.env.AUTO_UT_CODEHUB_APPROVERS),assignees:split(process.env.AUTO_UT_CODEHUB_ASSIGNEES)},repositories:[],notifications:true,autoRepair:true,contact:'',pipelineSeconds:60,reviewSeconds:300,maxRepairRounds:3,reminderMinutes:120,workHours:{weekdaysOnly:false,start:0,end:24},welinkAccounts:{}});}
 save(value:unknown){const config=mrSettingsSchema.parse(value);this.store.putRecord('auto-ut-mr-settings','main',config);return config;}
 snapshot(repository:string):MrSettings {const config=this.get(),override=config.repositories.find(r=>r.repository.toLowerCase()===repository.toLowerCase());return {...config,roles:{reviewers:override?.roles.reviewers??config.roles.reviewers,approvers:override?.roles.approvers??config.roles.approvers,assignees:override?.roles.assignees??config.roles.assignees}};}
}
