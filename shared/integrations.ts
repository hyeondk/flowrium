import type {LinkDeliveryAPI} from './link-delivery';
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
export interface CalendarEntry { id: string; title: string; primary: boolean; role: string; timeZone?: string; writable: boolean }
export interface CalendarEventInput { action: "create" | "update" | "delete"; calendarId?: string; eventId?: string; etag?: string; summary?: string; start?: string; end?: string; description?: string; location?: string }
export interface CalendarEventPreview { id: string; action: CalendarEventInput["action"]; calendarId: string; calendarName: string; expiresAt: number; previous?: RemoteItem; event?: RemoteItem }
export interface IntegrationAPI extends LinkDeliveryAPI {
  macPimStatus(): Promise<{ available: boolean; enabled: boolean }>;
  configureMacPim(enabled: boolean): Promise<{ available: boolean; enabled: boolean }>;
  macPim(input: { action: "calendars"; }): Promise<CalendarEntry[]>;
  macPim(input: { action: "events" | "mails"; calendarId?: string; query?: string; from?: string; to?: string }): Promise<RemoteItem[] | null>;
  macPim(input: { action: "mail"; id: string }): Promise<RemoteItem & { body: string }>;
  prepareMacEvent(input: CalendarEventInput): Promise<CalendarEventPreview>;
  commitMacEvent(ticket: string): Promise<RemoteItem | { deleted: true }>;
}
