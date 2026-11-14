export interface FollowupSuggestion {title:string;prompt:string;reason:string}
export interface FollowupSuggestions {sessionId:string;messageId:string;source:'model';suggestions:FollowupSuggestion[]}
