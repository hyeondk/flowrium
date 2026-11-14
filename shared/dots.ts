export interface DotsState {available:boolean;visible:boolean;loading:boolean;error?:string;externalHost?:string}
export interface DotsBounds {x:number;y:number;width:number;height:number}
export interface DotsAPI {
 readDotsState():Promise<DotsState>;
 showDotsView(bounds:DotsBounds):Promise<DotsState>;
 hideDotsView():Promise<DotsState>;
 reloadDotsView():Promise<DotsState>;
 openDotsExternal():Promise<{opened:boolean}>;
}
