export type RepoChange = { code: string; file: string };
export type PullRequest = {
  number: number;
  title: string;
  headRefOid: string;
  headRefName: string;
  baseRefName: string;
  url: string;
};
export type RepoAction = (
  | { action: "changes" | "prs" | "push" | "terminal" }
  | { action: "commit" | "diff"; files: string[]; message?: string }
  | { action: "createPR"; base: string; title: string; body: string }
  | { action: "merge"; number: number; head: string }) & { repositoryId?: string };
export interface RepositoryAPI {
  repositoryAction(
    id: string,
    input: { action: "changes" },
  ): Promise<RepoChange[]>;
  repositoryAction(
    id: string,
    input: { action: "prs" },
  ): Promise<PullRequest[]>;
  repositoryAction(id: string, input: RepoAction): Promise<string>;
}

export type RepositoryKind = "repo" | "issue" | "pull" | "run";
export type RepositoryQuery = (
  | { action: "repoLocal" | "repoActivity" }
  | { action: "repoIssue" | "repoPull"; number: number }
  | { action: "repoOpen"; kind: RepositoryKind; number?: number }
  | { action: "repoConnect"; repository: string; connectionKey: string }) & { repositoryId?: string };
export interface LocalRepository {
  branch: string;
  head: string;
  upstream: string;
  ahead: number | null;
  behind: number | null;
  commits: { hash: string; author: string; date: string; subject: string }[];
  repository: string;
  hasOrigin: boolean;
  connectionKey: string;
}
export interface ActivityRow {
  number: number;
  title: string;
  state: string;
  branch?: string;
  isDraft?: boolean;
  reviewDecision?: string;
}
export type ActivitySection =
  | "pulls"
  | "merged"
  | "issues"
  | "runs"
  | "deployments";
export type RepositoryActivity = { repository: string } & Record<
  ActivitySection,
  { rows: ActivityRow[]; error: string }
>;
export interface RepositoryItem {
  number: number;
  title: string;
  state: string;
  body: string;
  review: string;
  labels: string[];
  assignees: string[];
  files: { name: string; added: number; deleted: number }[];
  checks: { name: string; state: string }[];
}
export interface RepositoryAPI {
  repositoryAction(
    id: string,
    input: { action: "repoLocal" },
  ): Promise<LocalRepository>;
  repositoryAction(
    id: string,
    input: { action: "repoActivity" },
  ): Promise<RepositoryActivity>;
  repositoryAction(
    id: string,
    input: { action: "repoIssue" | "repoPull"; number: number },
  ): Promise<RepositoryItem>;
  repositoryAction(
    id: string,
    input: Extract<RepositoryQuery, { action: "repoOpen" | "repoConnect" }>,
  ): Promise<string>;
}

export interface RepositoryDefinition { id:string; name:string; path:string; github:string; account:string; base:string; hidden?:boolean;projectId:string }
export interface RepositoryAccount { login:string; active:boolean; state:string; protocol:string }
export interface RepositoryIdentity {name:string;email:string;account:string;warnings:string[]}
export interface RepositoryAPI {
 repositoryAction(id:string,input:{action:"repositories"}):Promise<RepositoryDefinition[]>;
 repositoryAction(id:string,input:{action:"accounts";repositoryId?:string}):Promise<RepositoryAccount[]>;
 repositoryAction(id:string,input:{action:"identity";repositoryId?:string}):Promise<RepositoryIdentity>;
 repositoryAction(id:string,input:RepoAction|RepositoryQuery):Promise<any>;
 repositoryFlow(input:any):Promise<any>;
}
