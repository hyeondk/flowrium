export interface TeamWorktree {
  index: number;
  owner: number;
  name: string;
  branch: string;
  directory: string;
  head: string;
  archived: boolean;
  files: { code: string; file: string }[];
  conflicts: string[];
  mergeHead: string;
}
export interface TeamWorktreeBoard {
  base: string;
  baseBranch: string;
  roles: TeamWorktree[];
  integration: TeamWorktree;
}
export interface WorktreeRemote {
  repository: string;
  branch: string;
  pr: null | {
    number: number;
    title: string;
    url: string;
    headRefOid: string;
    state: string;
    mergeable: string;
  };
}
export type TeamWorktreeChange =
  | { action: "restore"; index: number }
  | { action: "diff"; index: number; file?: string }
  | {
      action: "commit";
      index: number;
      head: string;
      files: string[];
      message: string;
    }
  | {
      action: "integrate";
      index: number;
      head: string;
      integrationHead: string;
    }
  | {
      action: "resolve";
      index: number;
      head: string;
      file: string;
      side: "ours" | "theirs" | "manual";
    }
  | {
      action: "finish" | "abort" | "cleanup" | "publish";
      index: number;
      head: string;
    }
  | {
      action: "openPR";
      index: number;
      head: string;
      title: string;
      body: string;
    }
  | { action: "mergePR"; index: number; head: string; number: number };
export interface TeamWorktreesAPI {
  teamWorktrees(projectId: string, runId: string): Promise<TeamWorktreeBoard>;
  teamWorktreeAction(
    projectId: string,
    runId: string,
    input: { action: "remote"; index: -1 },
  ): Promise<WorktreeRemote>;
  teamWorktreeAction(
    projectId: string,
    runId: string,
    input: TeamWorktreeChange,
  ): Promise<string>;
}
