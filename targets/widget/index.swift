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

// The next upcoming zone's actual fire Date — used by the countdown widget
// so SwiftUI can render a live-relative timer ("in 47 min") without us
// having to schedule timeline entries every minute.
func nextSlotFireDate(after date: Date, in zones: [ZoneSlot]) -> (slot: ZoneSlot, fireAt: Date)? {
    guard !zones.isEmpty else { return nil }
    let cal = Calendar.current
    let startOfDay = cal.startOfDay(for: date)
    let sorted = zones.sorted { $0.startHour < $1.startHour }
    for z in sorted {
        let fireAt = startOfDay.addingTimeInterval(z.startHour * 3600)
        if fireAt > date { return (z, fireAt) }
    }
    // Past every zone start today → first zone tomorrow.
    if let first = sorted.first {
        let tomorrow = cal.date(byAdding: .day, value: 1, to: startOfDay)!
        let fireAt = tomorrow.addingTimeInterval(first.startHour * 3600)
        return (first, fireAt)
    }
    return nil
}

// Current zone + the next `count` upcoming slots, in display order. Used by
// the day-strip lock screen widget.
func currentAndUpcoming(_ count: Int, in zones: [ZoneSlot], at date: Date) -> [ZoneSlot] {
    guard let current = currentSlot(in: zones, at: date) else { return [] }
    let cal = Calendar.current
    let comps = cal.dateComponents([.hour, .minute], from: date)
    let hour = Double(comps.hour ?? 0) + Double(comps.minute ?? 0) / 60.0
    let sorted = zones.sorted { $0.startHour < $1.startHour }
    // "Upcoming" = anything whose start is strictly later than now, skipping
    // the current zone itself.
    let later = sorted.filter { $0.startHour > hour && $0.id != current.id }
    var out: [ZoneSlot] = [current]
    out.append(contentsOf: later.prefix(count))
    // If we don't have enough upcoming today (e.g. we're in wind-down),
    // wrap into tomorrow's morning by reusing the earliest-start zones we
    // haven't shown yet.
    if out.count < count + 1 {
        let alreadyShown = Set(out.map { $0.id })
        for z in sorted where !alreadyShown.contains(z.id) {
            out.append(z)
            if out.count >= count + 1 { break }
        }
    }
    return out
}

// Decimal hour (e.g. 11.5) → locale-aware short time string (e.g. "11:30 AM"
// or "11:30"). Used by the day-strip widget so the user sees their plan
// anchored in real clock time.
func formatHour(_ decimal: Double) -> String {
    let cal = Calendar.current
    let startOfDay = cal.startOfDay(for: Date())
    let wrapped = decimal >= 24 ? decimal - 24 : decimal
    let date = startOfDay.addingTimeInterval(wrapped * 3600)
    let fmt = DateFormatter()
    fmt.timeStyle = .short
    fmt.dateStyle = .none
    return fmt.string(from: date)
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
// Shows a live countdown to the next zone transition so the user can see at
// a glance when the next phase of their day starts. Uses Text's relative
// style so SwiftUI auto-updates the number without us needing minute-level
// timeline entries. Empty state shows a dot.
@available(iOSApplicationExtension 16.0, *)
struct LockCircularView: View {
    let entry: DayEntry

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            if entry.isToday,
               let zones = entry.payload?.zones,
               let next = nextSlotFireDate(after: entry.date, in: zones) {
                VStack(spacing: 0) {
                    // .timer auto-ticks in SwiftUI without us scheduling
                    // per-minute timeline entries. Renders as "MM:SS" under
                    // an hour and "H:MM:SS" beyond — monospaced so the
                    // width stays stable as digits change.
                    Text(next.fireAt, style: .timer)
                        .font(.system(size: 13, weight: .bold))
                        .monospacedDigit()
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .multilineTextAlignment(.center)
                        .widgetAccentable()
                    Text("NEXT")
                        .font(.system(size: 7, weight: .semibold))
                        .tracking(0.6)
                        .opacity(0.7)
                }
                .padding(.horizontal, 3)
            } else {
                Image(systemName: "circle.dotted")
                    .font(.system(size: 22, weight: .light))
                    .widgetAccentable()
            }
        }
        .containerBackground(.clear, for: .widget)
    }
}

// MARK: - LOCK SCREEN — accessoryRectangular (DAY STRIP)
// Denser variant that shows the current zone plus the next two upcoming
// zones with their start times. Lets the user see the shape of their day
// from the lock screen without unlocking. Same physical slot as the "Now"
// rectangular widget — the user picks which one to pin.
@available(iOSApplicationExtension 16.0, *)
struct LockRectangularDayView: View {
    let entry: DayEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            if entry.isToday, let zones = entry.payload?.zones {
                let strip = currentAndUpcoming(2, in: zones, at: entry.date)
                if strip.isEmpty {
                    fallback
                } else {
                    ForEach(Array(strip.enumerated()), id: \.offset) { idx, slot in
                        row(slot: slot, isCurrent: idx == 0)
                    }
                }
            } else {
                fallback
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .containerBackground(.clear, for: .widget)
    }

    @ViewBuilder
    private func row(slot: ZoneSlot, isCurrent: Bool) -> some View {
        HStack(spacing: 6) {
            Text(isCurrent ? "NOW" : formatHour(slot.startHour).uppercased())
                .font(.system(size: 9, weight: .bold))
                .tracking(0.8)
                .frame(width: 42, alignment: .leading)
                .opacity(isCurrent ? 1.0 : 0.6)
                .widgetAccentable()
            Text(slot.label)
                .font(.system(size: 12, weight: isCurrent ? .bold : .medium))
                .opacity(isCurrent ? 1.0 : 0.75)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var fallback: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("IRIS")
                .font(.system(size: 10, weight: .semibold))
                .tracking(1.5)
                .widgetAccentable()
            Text("Check in to start your day.")
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(2)
        }
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

// MARK: - Widget definitions
//
// We ship TWO widgets so the user can pick which lock-screen experience they
// want when they hit "+" in the widget gallery:
//
//   • "LiveNew: Now"  → current zone only (focused).
//                       Also serves the home-screen sizes + circular/inline
//                       lock-screen surfaces.
//   • "LiveNew: Day"  → rectangular lock-screen only; shows current + next
//                       two upcoming zones so the user can see the rhythm
//                       of their day at a glance without unlocking.

struct LiveNewWidget: Widget {
    let kind: String = "LiveNewWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            LiveNewWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("LiveNew: Now")
        .description("Your current zone, on your Lock Screen or Home Screen.")
        .supportedFamilies(nowSupportedFamilies)
    }

    private var nowSupportedFamilies: [WidgetFamily] {
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

@available(iOSApplicationExtension 16.0, *)
struct LiveNewDayWidget: Widget {
    let kind: String = "LiveNewDayWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            LockRectangularDayView(entry: entry)
        }
        .configurationDisplayName("LiveNew: Day")
        .description("Your current and next two zones, on the Lock Screen.")
        .supportedFamilies([.accessoryRectangular])
    }
}

// MARK: - Widget bundle (extension entry point)
@main
struct LiveNewWidgetBundle: WidgetBundle {
    @WidgetBundleBuilder
    var body: some Widget {
        LiveNewWidget()
        if #available(iOSApplicationExtension 16.0, *) {
            LiveNewDayWidget()
        }
    }
}
