export interface CitationFile {path:string;name:string;image:boolean;attachmentId:string;artifactId:string;index:number}
export interface CitationGroup {key:string;files:CitationFile[]}
export function presentCitations(text:string,role?:string,streaming?:boolean):{text:string;references:Omit<CitationFile,'index'>[];groups:CitationGroup[]};
