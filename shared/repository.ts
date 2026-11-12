export type RepoChange = {code:string;file:string};
export type PullRequest = {number:number;title:string;headRefOid:string;headRefName:string;baseRefName:string;url:string};
export type RepoAction = {action:"changes"|"prs"|"push"|"terminal"} | {action:"commit"|"diff";files:string[];message?:string} | {action:"createPR";base:string;title:string;body:string} | {action:"merge";number:number;head:string};
export interface RepositoryAPI {
  repositoryAction(id:string, input:{action:"changes"}): Promise<RepoChange[]>;
  repositoryAction(id:string, input:{action:"prs"}): Promise<PullRequest[]>;
  repositoryAction(id:string, input:RepoAction): Promise<string>;
}
