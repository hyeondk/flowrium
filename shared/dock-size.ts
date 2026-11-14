export function dockSizeBounds(viewport:number,sidebar=72,overlay=false){
 const available=Math.max(0,viewport-(overlay?24:sidebar));
 return {min:Math.min(320,available),max:Math.max(Math.min(320,available),Math.min(1200,available-(overlay?0:280)))};
}
export function clampDockSize(value:number,bounds:{min:number;max:number}){return Math.round(Math.max(bounds.min,Math.min(bounds.max,value)));}
