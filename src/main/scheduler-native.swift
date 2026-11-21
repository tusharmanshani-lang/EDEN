
import AppKit
import EventKit
import Foundation
import Darwin

struct ScheduleError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

func fail(_ message: String) -> ScheduleError {
    ScheduleError(message: message)
}

let arguments = CommandLine.arguments
if arguments.count != 4 { exit(2) }

let inputPath = arguments[1]
let outputPath = arguments[2]
let cancelPath = arguments[3]

@MainActor func checkCancellation() throws {
    if FileManager.default.fileExists(atPath: cancelPath) {
        throw fail("Cancelled before saving.")
    }
}

@MainActor func authorize(
    _ store: EKEventStore,
    _ type: EKEntityType
) async throws {
    let allowed: Bool = try await withCheckedThrowingContinuation {
        continuation in

        let completion: EKEventStoreRequestAccessCompletionHandler = {
            granted, error in

            if let error = error {
                continuation.resume(throwing: error)
            } else {
                continuation.resume(returning: granted)
            }
        }

        if #available(macOS 14.0, *) {
            if type == .reminder {
                store.requestFullAccessToReminders(completion: completion)
            } else {
                store.requestFullAccessToEvents(completion: completion)
            }
        } else {
            store.requestAccess(to: type, completion: completion)
        }
    }

    if !allowed {
        throw fail(
            "Allow EDEN Scheduler access in System Settings → Privacy & Security → Calendars or Reminders."
        )
    }
}

func recurrence(
    _ request: [String: Any]
) throws -> EKRecurrenceRule? {
    guard
        let name = request["repeat"] as? String,
        name != "none"
    else { return nil }

    let frequency: EKRecurrenceFrequency

    switch name {
    case "daily": frequency = .daily
    case "weekly": frequency = .weekly
    case "monthly": frequency = .monthly
    case "yearly": frequency = .yearly
    default: throw fail("Unsupported repeat pattern.")
    }

    let interval = (request["interval"] as? NSNumber)?.intValue ?? 1

    guard interval >= 1 && interval <= 52 else {
        throw fail("Invalid repeat interval.")
    }

    return EKRecurrenceRule(
        recurrenceWith: frequency,
        interval: interval,
        end: nil
    )
}

func repeatName(_ item: EKCalendarItem) -> String {
    guard let rule = item.recurrenceRules?.first else {
        return "none"
    }

    switch rule.frequency {
    case .daily: return "daily"
    case .weekly: return "weekly"
    case .monthly: return "monthly"
    case .yearly: return "yearly"
    @unknown default: return "unknown"
    }
}

func reminderDate(_ reminder: EKReminder) -> Date? {
    guard let components = reminder.dueDateComponents else {
        return nil
    }

    return Calendar.current.date(from: components)
}

func reminderRow(_ reminder: EKReminder) -> [String: Any] {
    var row: [String: Any] = [
        "id": reminder.calendarItemIdentifier,
        "calendarId": reminder.calendar.calendarIdentifier,
        "calendarName": reminder.calendar.title,
        "writable": reminder.calendar.allowsContentModifications,
        "recurring": reminder.hasRecurrenceRules,
        "title": reminder.title ?? "",
        "repeat": repeatName(reminder),
        "interval": reminder.recurrenceRules?.first?.interval ?? 1
    ]

    if let due = reminderDate(reminder) {
        row["start"] = due.timeIntervalSince1970
    }

    if let alarm = reminder.alarms?.first?.absoluteDate {
        row["alarm"] = alarm.timeIntervalSince1970
    }

    return row
}

func eventRow(_ event: EKEvent) -> [String: Any] {
    return [
        "id": event.calendarItemIdentifier,
        "calendarId": event.calendar.calendarIdentifier,
        "calendarName": event.calendar.title,
        "writable": event.calendar.allowsContentModifications,
        "recurring": event.hasRecurrenceRules || event.isDetached,
        "title": event.title ?? "",
        "start": event.startDate.timeIntervalSince1970,
        "end": event.endDate.timeIntervalSince1970,
        "repeat": repeatName(event),
        "interval": event.recurrenceRules?.first?.interval ?? 1,
        "alert": event.alarms?.contains(where: {
            $0.absoluteDate == nil && $0.relativeOffset == 0
        }) ?? false
    ]
}

@MainActor func execute(
    _ request: [String: Any]
) async throws -> [String: Any] {
    guard let action = request["action"] as? String else {
        throw fail("Missing schedule action.")
    }

    let reminderAction =
        action == "create-reminder" ||
        action == "list-reminders" ||
        action == "delete-reminder"

    let eventAction =
        action == "create-event" ||
        action == "list-events" ||
        action == "delete-event"

    guard reminderAction || eventAction else {
        throw fail("Unsupported schedule action.")
    }

    let store = EKEventStore()

    try await authorize(
        store,
        reminderAction ? .reminder : .event
    )

    try checkCancellation()


    if action == "delete-reminder" || action == "delete-event" {
        guard
            let expected = request["expected"] as? [String: Any],
            let id = expected["id"] as? String,
            !id.isEmpty,
            let scope = request["scope"] as? String
        else {
            throw fail("Missing confirmed item.")
        }

        func unchanged(_ current: [String: Any]) throws {
            let first = try JSONSerialization.data(
                withJSONObject: current,
                options: [.sortedKeys]
            )
            let second = try JSONSerialization.data(
                withJSONObject: expected,
                options: [.sortedKeys]
            )

            guard first == second else {
                throw fail(
                    "The item changed after it was selected. Nothing was deleted. Please search again."
                )
            }
        }

        if action == "delete-reminder" {
            guard
                let item = store.calendarItem(
                    withIdentifier: id
                ) as? EKReminder,
                !item.isCompleted,
                item.calendar.allowsContentModifications
            else {
                throw fail("The reminder is missing, completed or read-only.")
            }

            try unchanged(reminderRow(item))

            guard
                (item.hasRecurrenceRules && scope == "reminder") ||
                (!item.hasRecurrenceRules && scope == "one")
            else {
                throw fail("The repeating-reminder deletion scope is invalid.")
            }

            try checkCancellation()
            try store.remove(item, commit: true)
            store.reset()

            guard store.calendarItem(withIdentifier: id) == nil else {
                throw fail(
                    "Removal could not be verified. Check Reminders before retrying."
                )
            }

            return ["deleted": true, "id": id]
        }

        guard
            let number = expected["start"] as? NSNumber,
            let calendarId = expected["calendarId"] as? String,
            scope == "one" || scope == "future"
        else {
            throw fail("Invalid event occurrence or deletion scope.")
        }

        let selectedStart = Date(
            timeIntervalSince1970: number.doubleValue
        )

        let predicate = store.predicateForEvents(
            withStart: selectedStart.addingTimeInterval(-1),
            end: selectedStart.addingTimeInterval(1),
            calendars: nil
        )

        let matches = store.events(matching: predicate).filter {
            $0.calendarItemIdentifier == id &&
            $0.calendar.calendarIdentifier == calendarId &&
            abs($0.startDate.timeIntervalSince(selectedStart)) < 1
        }

        guard
            matches.count == 1,
            let item = matches.first,
            item.calendar.allowsContentModifications
        else {
            throw fail(
                "The exact event occurrence is missing, ambiguous or read-only."
            )
        }

        try unchanged(eventRow(item))

        if scope == "future" &&
            !(item.hasRecurrenceRules || item.isDetached) {
            throw fail("This event is no longer repeating. Please search again.")
        }

        let span: EKSpan = scope == "future" ? .futureEvents : .thisEvent

        try checkCancellation()
        try store.remove(item, span: span, commit: true)
        store.reset()

        let verification = store.predicateForEvents(
            withStart: selectedStart.addingTimeInterval(-1),
            end: selectedStart.addingTimeInterval(1),
            calendars: nil
        )

        let remains = store.events(matching: verification).contains {
            $0.calendarItemIdentifier == id &&
            $0.calendar.calendarIdentifier == calendarId &&
            abs($0.startDate.timeIntervalSince(selectedStart)) < 1
        }

        guard !remains else {
            throw fail(
                "Removal could not be verified. Check Calendar before retrying."
            )
        }

        return ["deleted": true, "id": id]
    }

    if action == "list-reminders" {
        let predicate = store.predicateForReminders(in: nil)

        let items: [EKReminder] = await withCheckedContinuation {
            continuation in

            store.fetchReminders(matching: predicate) {
                continuation.resume(returning: $0 ?? [])
            }
        }

        let rangeStart = (request["start"] as? NSNumber).map {
            Date(timeIntervalSince1970: $0.doubleValue)
        }

        let rangeEnd = (request["end"] as? NSNumber).map {
            Date(timeIntervalSince1970: $0.doubleValue)
        }

        let query = (request["query"] as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        let incomplete = items.filter {
            if $0.isCompleted { return false }
            if !query.isEmpty &&
                !($0.title ?? "").localizedCaseInsensitiveContains(query) {
                return false
            }

            if let start = rangeStart, let end = rangeEnd {
                guard let due = reminderDate($0) else {
                    return false
                }

                return due >= start && due < end
            }

            return true
        }.sorted {
            (reminderDate($0) ?? .distantFuture) <
            (reminderDate($1) ?? .distantFuture)
        }

        return [
            "items": Array(incomplete.prefix(50)).map(reminderRow),
            "total": incomplete.count
        ]
    }

    guard let startNumber = request["start"] as? NSNumber else {
        throw fail("Missing date.")
    }

    let start = Date(
        timeIntervalSince1970: startNumber.doubleValue
    )

    if action == "list-events" {
        guard let endNumber = request["end"] as? NSNumber else {
            throw fail("Missing date range.")
        }

        let end = Date(
            timeIntervalSince1970: endNumber.doubleValue
        )

        let predicate = store.predicateForEvents(
            withStart: start,
            end: end,
            calendars: nil
        )

        let query = (request["query"] as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        let items = store.events(matching: predicate).filter {
            query.isEmpty ||
            ($0.title ?? "").localizedCaseInsensitiveContains(query)
        }.sorted {
            $0.startDate < $1.startDate
        }

        return [
            "items": Array(items.prefix(50)).map(eventRow),
            "total": items.count
        ]
    }

    guard
        let title = request["title"] as? String,
        !title.isEmpty,
        title.count <= 300
    else {
        throw fail("Invalid title.")
    }

    guard start > Date() else {
        throw fail(
            "That time has already passed. Please choose a future time."
        )
    }

    if action == "create-reminder" {
        guard
            let calendar = store.defaultCalendarForNewReminders(),
            calendar.allowsContentModifications
        else {
            throw fail(
                "Set up a writable default list in Apple Reminders first."
            )
        }

        let item = EKReminder(eventStore: store)
        item.calendar = calendar
        item.title = title
        item.notes = "Created by EDEN."

        var components = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute, .second],
            from: start
        )

        components.timeZone = TimeZone.current
        item.dueDateComponents = components
        item.addAlarm(EKAlarm(absoluteDate: start))

        if let rule = try recurrence(request) {
            item.addRecurrenceRule(rule)
        }

        try checkCancellation()
        try store.save(item, commit: true)

        guard let saved = store.calendarItem(
            withIdentifier: item.calendarItemIdentifier
        ) as? EKReminder else {
            throw fail(
                "Reminder save could not be read back. Check Reminders before retrying."
            )
        }

        return ["item": reminderRow(saved)]
    }

    guard let endNumber = request["end"] as? NSNumber else {
        throw fail("Missing end time.")
    }

    let end = Date(
        timeIntervalSince1970: endNumber.doubleValue
    )

    guard end > start else {
        throw fail("The event must end after it starts.")
    }

    guard
        let calendar = store.defaultCalendarForNewEvents,
        calendar.allowsContentModifications
    else {
        throw fail(
            "Set up a writable default calendar in Apple Calendar first."
        )
    }

    let item = EKEvent(eventStore: store)
    item.calendar = calendar
    item.title = title
    item.startDate = start
    item.endDate = end
    item.timeZone = TimeZone.current
    item.notes = "Created by EDEN."
    item.addAlarm(EKAlarm(relativeOffset: 0))

    if let rule = try recurrence(request) {
        item.addRecurrenceRule(rule)
    }

    try checkCancellation()
    try store.save(item, span: .thisEvent, commit: true)

    guard let saved = store.calendarItem(
        withIdentifier: item.calendarItemIdentifier
    ) as? EKEvent else {
        throw fail(
            "Event save could not be read back. Check Calendar before retrying."
        )
    }

    return ["item": eventRow(saved)]
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)

Task { @MainActor in
    var result: [String: Any]

    do {
        let data = try Data(
            contentsOf: URL(fileURLWithPath: inputPath)
        )

        guard let request = try JSONSerialization.jsonObject(
            with: data
        ) as? [String: Any] else {
            throw fail("Invalid request.")
        }

        result = try await execute(request)
        result["ok"] = true
    } catch {
        result = [
            "ok": false,
            "error": error.localizedDescription
        ]
    }

    do {
        let data = try JSONSerialization.data(
            withJSONObject: result
        )

        try data.write(
            to: URL(fileURLWithPath: outputPath),
            options: .atomic
        )
    } catch {
        exit(3)
    }

    exit(0)
}

application.run()
