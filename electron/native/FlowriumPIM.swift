import Foundation
import EventKit
import CryptoKit

enum PIMError: Error { case message(String) }
func fail(_ text: String) throws -> Never { throw PIMError.message(text) }
func eventView(_ event: EKEvent) throws -> [String: Any] {
    let formatter = ISO8601DateFormatter()
    var result: [String: Any] = ["id": event.eventIdentifier ?? "", "calendarId": event.calendar.calendarIdentifier,
        "title": event.title ?? "제목 없음", "at": formatter.string(from: event.startDate), "end": formatter.string(from: event.endDate),
        "description": event.notes ?? "", "location": event.location ?? "", "allDay": event.isAllDay, "recurring": event.hasRecurrenceRules]
    let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    result["etag"] = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    return result
}
func permission(_ store: EKEventStore) throws {
    let status = EKEventStore.authorizationStatus(for: .event)
    if #available(macOS 14.0, *) { if status == .fullAccess { return } }
    else if status == .authorized { return }
    if status != .notDetermined { try fail("캘린더 접근 권한이 필요합니다. 시스템 설정의 개인정보 보호 및 보안에서 Flowrium을 확인해 주세요.") }
    let semaphore = DispatchSemaphore(value: 0)
    var allowed = false
    if #available(macOS 14.0, *) { store.requestFullAccessToEvents { grant, _ in allowed = grant; semaphore.signal() } }
    else { store.requestAccess(to: .event) { grant, _ in allowed = grant; semaphore.signal() } }
    let deadline = Date().addingTimeInterval(90)
    while semaphore.wait(timeout: .now() + 0.05) == .timedOut && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
    if !allowed { try fail("캘린더 접근이 허용되지 않았습니다.") }
}
func run(_ input: [String: Any]) throws -> Any {
    guard let action = input["action"] as? String else { try fail("일정 작업이 필요합니다.") }
    let store = EKEventStore()
    try permission(store)
    func calendar() throws -> EKCalendar {
        if let id = input["calendarId"] as? String, !id.isEmpty, id != "primary", let value = store.calendar(withIdentifier: id) { return value }
        guard let value = store.defaultCalendarForNewEvents else { try fail("사용할 캘린더가 없습니다.") }
        return value
    }
    func numberDate(_ key: String) throws -> Date {
        guard let number = input[key] as? NSNumber, number.doubleValue.isFinite else { try fail("일정 시각을 확인해 주세요.") }
        return Date(timeIntervalSince1970: number.doubleValue / 1000)
    }
    if action == "calendars" {
        return store.calendars(for: .event).map { ["id": $0.calendarIdentifier, "title": $0.title, "account": $0.source.title,
            "writable": $0.allowsContentModifications, "primary": $0.calendarIdentifier == store.defaultCalendarForNewEvents?.calendarIdentifier,
            "role": $0.allowsContentModifications ? "writer" : "reader"] as [String: Any] }
    }
    if action == "events" {
        let from = try numberDate("from"), to = try numberDate("to")
        if to <= from || to.timeIntervalSince(from) > 366 * 86400 { try fail("일정 조회 기간을 확인해 주세요.") }
        let chosen = (input["calendarId"] as? String).flatMap { $0.isEmpty ? nil : store.calendar(withIdentifier: $0) }
        let values = store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: chosen.map { [$0] }))
        let query = (input["query"] as? String ?? "").lowercased()
        return try values.sorted { $0.startDate < $1.startDate }.filter { query.isEmpty || [$0.title, $0.notes, $0.location].compactMap { $0 }.joined(separator: " ").lowercased().contains(query) }.prefix(200).map { try eventView($0) }
    }
    var event: EKEvent
    if action == "create" { event = EKEvent(eventStore: store); event.calendar = try calendar() }
    else {
        guard let id = input["eventId"] as? String, let found = store.event(withIdentifier: id) else { try fail("일정을 찾지 못했습니다. 목록을 다시 확인해 주세요.") }
        event = found
    }
    if action == "event" { return try eventView(event) }
    if !["create", "update", "delete"].contains(action) { try fail("지원하지 않는 일정 작업입니다.") }
    if !event.calendar.allowsContentModifications { try fail("이 캘린더에는 쓰기 권한이 없습니다.") }
    if action != "create" {
        if event.hasRecurrenceRules { try fail("반복 일정은 캘린더 앱에서 변경해 주세요.") }
        guard let expected = input["etag"] as? String, expected == (try eventView(event))["etag"] as? String else { try fail("다른 곳에서 일정을 변경했습니다. 다시 검토해 주세요.") }
    }
    if action == "delete" { try store.remove(event, span: .thisEvent, commit: true); return ["deleted": true] }
    if let summary = input["summary"] as? String { event.title = summary }
    if let notes = input["description"] as? String { event.notes = notes }
    if let location = input["location"] as? String { event.location = location }
    if input["start"] != nil { event.startDate = try numberDate("start") }
    if input["end"] != nil { event.endDate = try numberDate("end") }
    if let allDay = input["allDay"] as? Bool { event.isAllDay = allDay }
    if event.startDate == nil || event.endDate == nil || event.endDate <= event.startDate || (event.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { try fail("일정 제목과 시작 / 종료를 확인해 주세요.") }
    try store.save(event, span: .thisEvent, commit: true)
    return try eventView(event)
}
do {
    let value: Any
    if CommandLine.arguments.contains("--self-test") { value = ["ready": true, "platform": "mac-arm64", "schema": 1] as [String: Any] }
    else {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        guard data.count <= 100000, let input = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { try fail("입력 크기와 형식을 확인해 주세요.") }
        value = try run(input)
    }
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: ["ok": true, "value": value], options: [.sortedKeys]))
} catch {
    let message: String
    if case PIMError.message(let text) = error { message = text } else { message = error.localizedDescription }
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: ["ok": false, "error": message]))
}
