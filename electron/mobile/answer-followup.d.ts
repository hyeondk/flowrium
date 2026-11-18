interface LocalFollowup { source:'conversation'; title:string; prompt:string; reason:string }
type FollowupMessage={id?:string;role:string;text:string};
export function latestFollowupAnswer<T extends FollowupMessage>(session?:{messages:T[]}):T|undefined;
export function followupFromAnswer(text:string):LocalFollowup|undefined;
export function originalAnswerFollowups(session?:{messages:{id?:string;role:string;text:string}[];completedContinuationId?:string;workflow?:{status?:string}}):LocalFollowup[];
