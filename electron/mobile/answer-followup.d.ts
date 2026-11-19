interface LocalFollowup { source:'conversation'; title:string; prompt:string; reason:string }
type FollowupMessage={id?:string;role:string;text:string;progressCommentary?:boolean};
type FollowupSession={messages:FollowupMessage[];completedContinuationId?:string};
export function latestFollowupAnswer<T extends FollowupMessage>(session?:{messages:T[]}):T|undefined;
export function publicLines(text:string):string[];
export function followupFromAnswer(text:string):LocalFollowup|undefined;
export function canOfferFollowup(session?:FollowupSession):boolean;
export function originalAnswerFollowups(session?:FollowupSession):LocalFollowup[];
