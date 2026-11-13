import type { LinkDeliveryAPI } from './link-delivery';
export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  account?: string;
  authorizing: boolean;
  calendarWrite?: boolean;
  mailSend?: boolean;
}
export interface RemoteItem {
  id: string;
  title: string;
  detail: string;
  url?: string;
  at?: string;
  mimeType?: string;
  end?: string;
  etag?: string;
  calendarId?: string;
  description?: string;
  location?: string;
  allDay?: boolean;
  from?: string;
}
export interface GoogleCalendar { id: string; title: string; primary: boolean; role: string; timeZone?: string; writable: boolean }
export interface GoogleDocument { id: string; name: string; mimeType: string; extension: string; body: string; size: number }
export interface GoogleEventInput { action: "create" | "update" | "delete"; calendarId?: string; eventId?: string; etag?: string; summary?: string; start?: string; end?: string; description?: string; location?: string }
export interface GoogleEventPreview { id: string; action: GoogleEventInput["action"]; calendarId: string; calendarName: string; expiresAt: number; previous?: RemoteItem; event?: RemoteItem }
export interface IntegrationAPI extends LinkDeliveryAPI {
  macPimStatus(): Promise<{ available: boolean; enabled: boolean }>;
  configureMacPim(enabled: boolean): Promise<{ available: boolean; enabled: boolean }>;
  macPim(input: { action: "calendars"; }): Promise<GoogleCalendar[]>;
  macPim(input: { action: "events" | "mails"; calendarId?: string; query?: string; from?: string; to?: string }): Promise<RemoteItem[] | null>;
  macPim(input: { action: "mail"; id: string }): Promise<RemoteItem & { body: string }>;
  prepareMacEvent(input: GoogleEventInput): Promise<GoogleEventPreview>;
  commitMacEvent(ticket: string): Promise<RemoteItem | { deleted: true }>;
  googleCalendars(): Promise<GoogleCalendar[]>;
  googleMail(id: string): Promise<{ id: string; title: string; from: string; to: string; at: string; body: string; url: string }>;
  googleDocument(id: string, format?: "text" | "pdf"): Promise<GoogleDocument>;
  importGoogleFile(projectId: string, id: string, format?: "text" | "pdf"): Promise<{ path: string; body: string }>;
  prepareGoogleEvent(input: GoogleEventInput): Promise<GoogleEventPreview>;
  commitGoogleEvent(ticket: string): Promise<RemoteItem | { deleted: true; id: string }>;
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
    calendarId?: string;
  }): Promise<RemoteItem[]>;
  importGoogleDocument(
    projectId: string,
    fileId: string,
  ): Promise<{ path: string }>;
}
