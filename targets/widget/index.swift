import WidgetKit
import SwiftUI

// MARK: - App Group constants
// Shared with the JS layer via react-native-shared-group-preferences.
// Keep keys in sync with src/widgetBridge.js.
private let APP_GROUP = "group.app.livenew.mobile"
private let KEY_PAYLOAD = "livenew_widget_payload_v1"

// MARK: - Data model
struct ZonePayload: Codable {
    let headline: String
    let pullQuote: String?
    let zoneLabel: String
    let score: Int
    let updatedAt: Double // ms epoch
}

func readPayload() -> ZonePayload? {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return nil }
    guard let raw = defaults.string(forKey: KEY_PAYLOAD) else { return nil }
    guard let data = raw.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(ZonePayload.self, from: data)
}

// MARK: - Timeline entry
struct ZoneEntry: TimelineEntry {
    let date: Date
    let payload: ZonePayload?
}

// MARK: - Provider
struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> ZoneEntry {
        ZoneEntry(date: Date(), payload: ZonePayload(
            headline: "Cortisol crashes between 2 and 4pm.",
            pullQuote: nil,
            zoneLabel: "Afternoon",
            score: 78,
            updatedAt: Date().timeIntervalSince1970 * 1000
        ))
    }

    func getSnapshot(in context: Context, completion: @escaping (ZoneEntry) -> ()) {
        let entry = ZoneEntry(date: Date(), payload: readPayload())
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ZoneEntry>) -> ()) {
        // Refresh every hour so widget never goes stale beyond a zone window.
        let now = Date()
        let payload = readPayload()
        let entries = (0..<6).map { offset -> ZoneEntry in
            let date = Calendar.current.date(byAdding: .hour, value: offset, to: now)!
            return ZoneEntry(date: date, payload: payload)
        }
        let refreshDate = Calendar.current.date(byAdding: .hour, value: 6, to: now)!
        completion(Timeline(entries: entries, policy: .after(refreshDate)))
    }
}

// MARK: - Views
struct SmallWidgetView: View {
    let entry: ZoneEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("LIVENEW")
                    .font(.system(size: 9, weight: .bold))
                    .tracking(2.4)
                    .foregroundColor(Color("$accent"))
                Spacer()
                if let p = entry.payload {
                    Text("\(p.score)")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(Color("widgetForeground"))
                }
            }
            Spacer(minLength: 0)
            if let p = entry.payload {
                Text(p.zoneLabel.uppercased())
                    .font(.system(size: 9, weight: .bold))
                    .tracking(1.8)
                    .foregroundColor(Color("widgetForeground").opacity(0.5))
                Text(p.headline)
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
    }
}

struct MediumWidgetView: View {
    let entry: ZoneEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("LIVENEW")
                    .font(.system(size: 10, weight: .bold))
                    .tracking(3)
                    .foregroundColor(Color("$accent"))
                Spacer()
                if let p = entry.payload {
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
            if let p = entry.payload {
                Text(p.zoneLabel.uppercased())
                    .font(.system(size: 9, weight: .bold))
                    .tracking(2)
                    .foregroundColor(Color("$accent"))
                Text(p.headline)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Color("widgetForeground"))
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
                if let q = p.pullQuote, !q.isEmpty {
                    Text("\u{201C}" + q + "\u{201D}")
                        .font(.system(size: 11, weight: .regular))
                        .italic()
                        .foregroundColor(Color("widgetForeground").opacity(0.7))
                        .lineLimit(2)
                }
            } else {
                Text("Open LiveNew to start your day.")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundColor(Color("widgetForeground").opacity(0.6))
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 4)
    }
}

struct LiveNewWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: ZoneEntry

    var body: some View {
        Group {
            switch family {
            case .systemSmall:
                SmallWidgetView(entry: entry)
            case .systemMedium:
                MediumWidgetView(entry: entry)
            default:
                SmallWidgetView(entry: entry)
            }
        }
        .containerBackground(for: .widget) {
            Color("widgetBackground")
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
        .configurationDisplayName("LiveNew — Today")
        .description("Iris's read on this moment of your day.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
