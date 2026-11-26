export type CodexReference = {kind:'plugin'|'app'; id:string; name:string};
export type CodexPlugin = CodexReference & {
  market?:string;
  description:string;
  installed:boolean;
  enabled:boolean;
  available:boolean;
  install:'direct'|'official'|null;
};
export type CodexPluginList = {rows:CodexPlugin[]; unsupported:boolean; partial:boolean};
export type CodexPluginApp = {id:string; name:string; connected:boolean};
export type CodexPluginManage =
  | {action:'directory'}
  | {action:'details'} & Pick<CodexReference,'kind'|'id'>
  | {action:'install'; confirmed:true} & Pick<CodexReference,'kind'|'id'>
  | {action:'connect'; appId:string} & Pick<CodexReference,'kind'|'id'>;
export interface CodexPluginsAPI {
  readCodexPlugins(input:{view:'suggestions'|'catalog'|'available'; search?:string; refresh?:boolean}):Promise<CodexPluginList>;
  manageCodexPlugin(input:CodexPluginManage):Promise<{apps?:CodexPluginApp[]; installed?:boolean; opened?:boolean; authRequired?:boolean}>;
}
