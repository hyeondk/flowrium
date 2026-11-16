export function interleaveLocalMessages<T extends {createdAt:string}>(source:T[],local:T[]):T[];
export function withLiveTurn<T extends {turnId?:string;createdAt:string}>(messages:T[],turnId:string,rows:T[]):T[];
