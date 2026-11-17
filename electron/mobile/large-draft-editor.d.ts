export const largeDraftThreshold: number;
export const draftWindowSize: number;
export function draftWindow(text: string, page: number): {start:number;end:number;page:number;count:number};
