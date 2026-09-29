import {createHash} from 'node:crypto';
import {z} from 'zod';
export interface DiscussionReply {id:string;author:string;body:string;system:boolean;bot:boolean;}
export interface ClosureDiscussion {id:string;body:string;author:string;resolved:boolean;replies?:DiscussionReply[];}
export interface OwnedDiscussion {id:string;author:string;body:string;entryId:string;}
export const reviewAssessment=z.object({sha:z.string().regex(/^[a-f0-9]{40}$/i),assessments:z.array(z.object({id:z.string().min(1).max(200),status:z.enum(['FIXED','UNFIXED','UNCERTAIN']),reason:z.string().trim().min(1).max(4000)}).strict()).max(1000)}).strict();
export type ReviewAssessment=z.infer<typeof reviewAssessment>;
export function parseReviewAssessment(answer:string):ReviewAssessment|undefined {
 const matches=[...answer.matchAll(/<ops-studio-review-result>\s*([\s\S]*?)\s*<\/ops-studio-review-result>/g)];
 if(matches.length!==1)return;
 try{const parsed=reviewAssessment.safeParse(JSON.parse(matches[0]![1]!));if(parsed.success&&new Set(parsed.data.assessments.map(a=>a.id)).size===parsed.data.assessments.length)return parsed.data;}catch{/* Unstructured answers never authorize closing a discussion. */}
}
export function discussionFingerprint(note:ClosureDiscussion){return createHash('sha256').update(JSON.stringify({body:note.body,author:note.author,replies:note.replies??[]})).digest('hex');}
export function ownsDiscussion(note:ClosureDiscussion,owned:OwnedDiscussion|undefined){return !!owned&&note.id===owned.id&&note.author.toLowerCase()===owned.author.toLowerCase()&&note.body===owned.body;}
export function developerReplied(note:ClosureDiscussion,authorizedSender:string){return (note.replies??[]).some(reply=>!!reply.author&&!reply.system&&!reply.bot&&reply.author.toLowerCase()!==note.author.toLowerCase()&&reply.author.toLowerCase()!==authorizedSender.toLowerCase());}
