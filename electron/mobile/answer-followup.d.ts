interface LocalFollowup { source:'conversation'; title:string; prompt:string; reason:string }
type FollowupMessage={id?:string;role:string;text:string;progressCommentary?:boolean;sourceOnly?:boolean};
type FollowupSession={messages:FollowupMessage[];completedContinuationId?:string};
export function latestFollowupAnswer<T extends FollowupMessage>(session?:{messages:T[]}):T|undefined;
export function publicLines(text:string):string[];
export function isAdvisoryFollowup(text:string):boolean;
export function followupFromAnswer(text:string):LocalFollowup|undefined;
export function canOfferFollowup(session?:FollowupSession):boolean;
export function originalAnswerFollowups(session?:FollowupSession):LocalFollowup[];
export function prepareAnswerFollowup(session:FollowupSession|undefined,onProgress:(percent:number)=>void,signal?:AbortSignal):Promise<LocalFollowup|undefined>;
