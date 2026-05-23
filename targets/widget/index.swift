import WidgetKit
import SwiftUI

// MARK: - App Group constants
// Shared with the JS layer via react-native-shared-group-preferences.
// Keep keys in sync with src/widgetBridge.js.
private let APP_GROUP = "group.app.livenew.mobile"
private let KEY_PAYLOAD = "livenew_widget_payload_v2"

// MARK: - Data model
//
// The JS bridge writes the FULL day's plan once at plan-generation time.
// The widget then computes the "current" zone client-side from the system
// clock, so the displayed zone updates throughout the day even if the
// host app is never reopened.
struct ZoneSlot: Codable {
    let id: String          // "morning" | "peak" | ...
    let label: String       // "Peak focus"
    let headline: String    // 5-10 word headline from today's plan
    let startHour: Double   // decimal hours, e.g. 8.0
    let endHour: Double     // decimal hours; > 24 means wraps past midnight
}

struct DayPayload: Codable {
    let dateISO: String     // "YYYY-MM-DD" in user's local timezone
    let score: Int
    let zones: [ZoneSlot]
    let updatedAt: Double   // ms epoch
}

// Read the latest payload from the shared App Group. Returns nil if there's
// no payload at all (brand-new install before first plan) — the views handle
// that as a "Check in to start your day" prompt.
func readPayload() -> DayPayload? {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return nil }
    guard let raw = defaults.string(forKey: KEY_PAYLOAD) else { return nil }
    guard let data = raw.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(DayPayload.self, from: data)
}

// Today's date as YYYY-MM-DD in the user's local timezone, matching the
// dateISO format the JS side writes.
func todayISO() -> String {
    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd"
    fmt.timeZone = TimeZone.current
    return fmt.string(from: Date())
}

// Is the payload for today specifically? If false, widget shows "check in."
func isPayloadForToday(_ payload: DayPayload?) -> Bool {
    guard let p = payload else { return false }
    return p.dateISO == todayISO()
}

// Pick the zone that contains `date` from the day's slots. Handles the
// sleep zone that wraps past midnight.
func currentSlot(in zones: [ZoneSlot], at date: Date) -> ZoneSlot? {
    let cal = Calendar.current
    let comps = cal.dateComponents([.hour, .minute], from: date)
    let hour = Double(comps.hour ?? 0) + Double(comps.minute ?? 0) / 60.0
    // Pre-dawn (0–5.5am) maps to the sleep zone since it wraps.
    if hour < 5.5 {
        if let sleep = zones.first(where: { $0.id == "sleep" }) { return sleep }
    }
    for z in zones {
        if z.endHour > 24 {
            let endWrap = z.endHour - 24
            if hour >= z.startHour || hour < endWrap { return z }
        } else if hour >= z.startHour && hour < z.endHour {
            return z
        }
    }
    return zones.first
}

// MARK: - Timeline entry
struct DayEntry: TimelineEntry {
    let date: Date
    let payload: DayPayload?
    let activeSlot: ZoneSlot?
    let isToday: Bool
}

// MARK: - Provider
struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> DayEntry {
        let placeholderSlot = ZoneSlot(
            id: "peak",
            label: "Peak focus",
            headline: "Don't drink coffee for 90 minutes after waking.",
            startHour: 8, endHour: 11
        )
        let placeholderPayload = DayPayload(
            dateISO: todayISO(),
            score: 78,
            zones: [placeholderSlot],
            updatedAt: Date().timeIntervalSince1970 * 1000
        )
        return DayEntry(
            date: Date(),
            payload: placeholderPayload,
            activeSlot: placeholderSlot,
            isToday: true
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (DayEntry) -> ()) {
        completion(makeEntry(for: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DayEntry>) -> ()) {
        // Compose entries: one at "now," then one at every upcoming zone
        // boundary today. This means the widget transitions to the next
        // zone exactly as iOS hits its start time — no waiting for the host
        // app to refresh it.
        let now = Date()
        let cal = Calendar.current
        let startOfDay = cal.startOfDay(for: now)
        var entries: [DayEntry] = [makeEntry(for: now)]

        let payload = readPayload()
        if isPayloadForToday(payload), let zones = payload?.zones {
            for z in zones {
                let fireAt = startOfDay.addingTimeInterval(z.startHour * 3600)
                if fireAt > now { entries.append(makeEntry(for: fireAt)) }
            }
        }

        // Refresh at 4am tomorrow so the "check in" empty state lands
        // promptly after midnight when the dateISO no longer matches today.
        let refreshDate = cal.date(byAdding: .day, value: 1, to: startOfDay)!
            .addingTimeInterval(4 * 3600)

        completion(Timeline(entries: entries, policy: .after(refreshDate)))
    }

    private func makeEntry(for date: Date) -> DayEntry {
        let payload = readPayload()
        let isToday = isPayloadForToday(payload)
        let slot = isToday ? currentSlot(in: payload?.zones ?? [], at: date) : nil
        return DayEntry(date: date, payload: payload, activeSlot: slot, isToday: isToday)
    }
}

// MARK: - Helpers
private func displayLabel(_ slot: ZoneSlot?) -> String {
    return (slot?.label ?? "").uppercased()
}

// Lock-screen widgets are tightly space-constrained; we trim the headline
// to a sensible upper bound to avoid getting cut off awkwardly mid-word.
private func trimHeadline(_ text: String?, max: Int) -> String {
    guard let t = text, !t.isEmpty else { return "" }
    if t.count <= max { return t }
    let idx = t.index(t.startIndex, offsetBy: max - 1)
    return String(t[..<idx]).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
}

// MARK: - LOCK SCREEN — accessoryRectangular
// Two-line widget that sits under the time on the lock screen. Top line is
// the zone label in tracked caps; bottom is the headline of the current
// zone. Empty state prompts a check-in.
@available(iOSApplicationExtension 16.0, *)
struct LockRectangularView: View {
    let entry: DayEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if entry.isToday, let slot = entry.activeSlot {
                Text(displayLabel(slot))
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1.5)
                    .widgetAccentable()
                Text(trimHeadline(slot.headline, max: 80))
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
            } else {
                Text("IRIS")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1.5)
                    .widgetAccentable()
                Text("Check in to start your day.")
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .containerBackground(.clear, for: .widget)
    }
}

// MARK: - LOCK SCREEN — accessoryCircular
// The smallest lock screen surface. Shows the score number when a plan is
// present; a dot otherwise.
@available(iOSApplicationExtension 16.0, *)
struct LockCircularView: View {
    let entry: DayEntry

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            if entry.isToday, let payload = entry.payload {
                VStack(spacing: 0) {
                    Text("\(payload.score)")
                        .font(.system(size: 22, weight: .bold))
                        .widgetAccentable()
                    Text("SCORE")
                        .font(.system(size: 7, weight: .semibold))
                        .tracking(0.6)
                        .opacity(0.7)
                }
            } else {
                Image(systemName: "circle.dotted")
                    .font(.system(size: 22, weight: .light))
                    .widgetAccentable()
            }
        }
        .containerBackground(.clear, for: .widget)
    }
}

// MARK: - LOCK SCREEN — accessoryInline
// Single line of text that shows above the lock-screen clock. Pure system
// font, no styling — iOS controls the look.
@available(iOSApplicationExtension 16.0, *)
struct LockInlineView: View {
    let entry: DayEntry

    var body: some View {
        if entry.isToday, let slot = entry.activeSlot {
            Text("Iris · \(slot.label) · \(trimHeadline(slot.headline, max: 40))")
                .containerBackground(.clear, for: .widget)
        } else {
            Text("Iris · Tap to check in")
                .containerBackground(.clear, for: .widget)
        }
    }
}

// MARK: - HOME SCREEN — small
struct HomeSmallView: View {
    let entry: DayEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("LIVENEW")
                    .font(.system(size: 9, weight: .bold))
                    .tracking(2.4)
                    .foregroundColor(Color("$accent"))
                Spacer()
                if entry.isToday, let p = entry.payload {
                    Text("\(p.score)")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(Color("widgetForeground"))
                }
            }
            Spacer(minLength: 0)
            if entry.isToday, let slot = entry.activeSlot {
                Text(displayLabel(slot))
                    .font(.system(size: 9, weight: .bold))
                    .tracking(1.8)
                    .foregroundColor(Color("widgetForeground").opacity(0.5))
                Text(slot.headline)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color("widgetForeground"))
                    .lineLimit(4)
                    .multilineTextAlignment(.leading)
            } else {
                Text("Open LiveNew to start your day.")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundColor(Color("widgetForeground").opacity(0.6))
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 4)
        .containerBackground(for: .widget) { Color("widgetBackground") }
    }
}

// MARK: - HOME SCREEN — medium
struct HomeMediumView: View {
    let entry: DayEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("LIVENEW")
                    .font(.system(size: 10, weight: .bold))
                    .tracking(3)
                    .foregroundColor(Color("$accent"))
                Spacer()
                if entry.isToday, let p = entry.payload {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("\(p.score)")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundColor(Color("$accent"))
                        Text("SCORE")
                            .font(.system(size: 8, weight: .bold))
                            .tracking(1.4)
                            .foregroundColor(Color("widgetForeground").opacity(0.5))
                    }
                }
            }
            Spacer(minLength: 0)
            if entry.isToday, let slot = entry.activeSlot {
                Text(displayLabel(slot))
                    .font(.system(size: 9, weight: .bold))
                    .tracking(2)
                    .foregroundColor(Color("$accent"))
                Text(slot.headline)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Color("widgetForeground"))
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
            } else {
                Text("Open LiveNew to start your day.")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundColor(Color("widgetForeground").opacity(0.6))
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 4)
        .containerBackground(for: .widget) { Color("widgetBackground") }
    }
}

// MARK: - Entry view dispatcher
struct LiveNewWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: DayEntry

    var body: some View {
        switch family {
        case .systemSmall:
            HomeSmallView(entry: entry)
        case .systemMedium:
            HomeMediumView(entry: entry)
        default:
            if #available(iOSApplicationExtension 16.0, *) {
                switch family {
                case .accessoryRectangular:
                    LockRectangularView(entry: entry)
                case .accessoryCircular:
                    LockCircularView(entry: entry)
                case .accessoryInline:
                    LockInlineView(entry: entry)
                default:
                    HomeSmallView(entry: entry)
                }
            } else {
                HomeSmallView(entry: entry)
            }
        }
    }
}

// MARK: - Widget definition
@main
struct LiveNewWidget: Widget {
    let kind: String = "LiveNewWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            LiveNewWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("LiveNew")
        .description("Current zone of your day, on your Lock Screen or Home Screen.")
        .supportedFamilies(supportedFamilies)
    }

    private var supportedFamilies: [WidgetFamily] {
        if #available(iOSApplicationExtension 16.0, *) {
            return [
                .accessoryRectangular,
                .accessoryCircular,
                .accessoryInline,
                .systemSmall,
                .systemMedium,
            ]
        } else {
            return [.systemSmall, .systemMedium]
        }
    }
}
