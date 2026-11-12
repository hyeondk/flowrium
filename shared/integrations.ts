export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  account?: string;
  authorizing: boolean;
}
export interface RemoteItem {
  id: string;
  title: string;
  detail: string;
  url?: string;
  at?: string;
  mimeType?: string;
}
export interface IntegrationAPI {
  openGoogleItem(url: string): Promise<void>;
  googleStatus(): Promise<GoogleStatus>;
  configureGoogle(input: {
    clientId: string;
    clientSecret: string;
  }): Promise<GoogleStatus>;
  connectGoogle(): Promise<void>;
  disconnectGoogle(): Promise<void>;
  readGoogle(input: {
    kind: "calendar" | "drive" | "mail";
    query?: string;
    from?: string;
    to?: string;
  }): Promise<RemoteItem[]>;
  importGoogleDocument(
    projectId: string,
    fileId: string,
  ): Promise<{ path: string }>;
}
