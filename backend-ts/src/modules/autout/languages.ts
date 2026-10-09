export type UtLanguage='Java'|'JS';
export function utLanguage(value?:string):UtLanguage|undefined {
 const name=(value??'Java').trim().toLowerCase();
 return name==='java'?'Java':['js','javascript','jsx','javascript/jsx'].includes(name)?'JS':undefined;
}
export function utPlanKey(item:{version:string;repository:string;language?:string}){
 return `${item.version}/${item.repository}${utLanguage(item.language)==='JS'?'/JS':''}`;
}
export function utRepairBranch(base:string,user:string,ticket:string,language?:string){return `${base}_${user}_${ticket}${utLanguage(language)==='JS'?'_js':''}`;}
export function utTestFile(path:string,language?:string){
 const name=path.replaceAll('\\','/');
 if(utLanguage(language)!=='JS')return name.startsWith('src/test/')||name.includes('/src/test/');
 return name.startsWith('website/')&&!name.split('/').some(p=>['..','node_modules','coverage'].includes(p))&&/\.[cm]?[jt]sx?$/.test(name)&&(/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name)||/(?:^|\/)(?:__tests__|__mocks__|tests?|specs?)\//.test(name));
}
export function jsGeneratedFile(path:string){return /^website\/(?:node_modules|coverage)\//.test(path.replaceAll('\\','/'));}
