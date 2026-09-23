import {z} from 'zod';
export const dtsVersion=z.string().trim().toUpperCase().regex(/^R\d{2}C(?:00|10)$/);
const productId=z.string().trim().regex(/^\d+$/);
export const dtsProduct=z.object({rNo:productId,cNo:productId,bNo:productId});
export type DtsProduct=z.infer<typeof dtsProduct>;
export function dtsProductNames(version:string){const v=dtsVersion.parse(version);const r=`MAE-NEM V100R0${v.slice(1,3)}`,c=r+v.slice(3);return {r,c,b:c+'B001'};}
