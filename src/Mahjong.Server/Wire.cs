using System.Buffers;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Mahjong.Server;

internal sealed record Problem(string Code);
internal sealed record Fault(Problem Error)
{
    public int V => Wire.Version;
    public string Type => "error";
}

internal sealed record Acknowledgement(Guid RequestId, string Status, Problem? Error,
    string? RoomId, long? RoomRevision, long? GameRevision)
{
    public int V => Wire.Version;
    public string Type => "ack";

    public static Acknowledgement For(Guid requestId, string? code, RoomCheckpoint? room = null) =>
        new(requestId, code is null ? "ok" : "error", code is null ? null : new Problem(code),
            room?.Id, room?.RoomRevision, room?.GameRevision);
}

internal sealed record LeaseMessage(string Lease, DateTimeOffset ExpiresAtUtc, DateTimeOffset ServerTimeUtc)
{
    public int V => Wire.Version;
    public string Type => "lease";
}

internal sealed record Preferences(bool Sound, bool Music, double Volume, bool ReducedMotion);
internal sealed record GuestView(string DisplayName, Preferences Preferences, string? ResumeRoomId);
internal sealed record ProfileChange(string? DisplayName, Preferences? Preferences);

internal sealed record Intent(string Op, string? RoomId = null, string? InviteCode = null,
    string? Visibility = null, int MatchHands = 0, bool Flag = false, int Seat = 0,
    long Revision = 0, string? WindowId = null, string? OptionId = null, string? Text = null);

internal static class Wire
{
    public const int Version = 1;
    public const long MaxRevision = 9_007_199_254_740_991L;
    public static readonly JsonSerializerOptions Json = MakeOptions();
    public static readonly JsonDocumentOptions DocumentOptions = new() { MaxDepth = 12 };

    public static Fault Error(string code) => new(new Problem(code));

    public static void ValidateStrings(JsonElement value)
    {
        try { Visit(value); }
        catch (InvalidOperationException)
        {
            throw new JsonException("JSON strings must contain valid Unicode.");
        }

        static void Visit(JsonElement node)
        {
            switch (node.ValueKind)
            {
                case JsonValueKind.String:
                    _ = node.GetString();
                    break;
                case JsonValueKind.Object:
                    foreach (var member in node.EnumerateObject())
                    {
                        _ = member.Name;
                        Visit(member.Value);
                    }
                    break;
                case JsonValueKind.Array:
                    foreach (var item in node.EnumerateArray()) Visit(item);
                    break;
            }
        }
    }

    private static JsonSerializerOptions MakeOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new UtcConverter());
        return options;
    }

    private sealed class UtcConverter : JsonConverter<DateTimeOffset>
    {
        public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
            => reader.GetDateTimeOffset().ToUniversalTime();

        public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options)
            => writer.WriteStringValue(value.UtcDateTime);
    }

    public static bool Fields(JsonElement json, params string[] allowed)
    {
        if (json.ValueKind != JsonValueKind.Object) return false;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var member in json.EnumerateObject())
            if (!allowed.Contains(member.Name, StringComparer.Ordinal) || !seen.Add(member.Name))
                return false;
        return true;
    }

    public static JsonElement Get(this JsonElement json, string name) =>
        json.ValueKind == JsonValueKind.Object && json.TryGetProperty(name, out var value) ? value : default;

    public static string? AsString(this JsonElement json) =>
        json.ValueKind == JsonValueKind.String ? json.GetString() : null;

    public static bool TryFlag(this JsonElement json, out bool flag)
    {
        flag = json.ValueKind == JsonValueKind.True;
        return json.ValueKind is JsonValueKind.True or JsonValueKind.False;
    }

    private static bool Int(this JsonElement json, out int result)
    {
        result = -1;
        return json.ValueKind == JsonValueKind.Number && json.TryGetInt32(out result);
    }

    private static bool Revision(JsonElement json, out long result)
    {
        result = -1;
        return json.ValueKind == JsonValueKind.Number && json.TryGetInt64(out result)
            && result >= 0 && result <= MaxRevision;
    }

    public static bool IsLocator(string? value) => value is { Length: > 0 and <= 128 };

    private static bool Opaque(string? value) => value is { Length: > 0 and <= 128 }
        && value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or ':' or '.');

    private static string? SafeText(JsonElement value, int limit)
    {
        var text = value.AsString()?.Trim();
        if (text is null) return null;
        var count = 0;
        foreach (var rune in text.EnumerateRunes())
        {
            if (++count > limit || Rune.GetUnicodeCategory(rune) is UnicodeCategory.Control
                or UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator
                || rune.Value is >= 0x202A and <= 0x202E or >= 0x2066 and <= 0x2069)
                return null;
        }
        return count == 0 ? null : text;
    }

    public static bool TryProfile(JsonElement body, bool allowPreferences, out ProfileChange change)
    {
        change = new(null, null);
        if (!Fields(body, allowPreferences ? ["displayName", "preferences"] : ["displayName"])) return false;
        var nameValue = body.Get("displayName");
        var name = SafeText(nameValue, 24);
        if (nameValue.ValueKind != JsonValueKind.Undefined && name is null) return false;
        var prefs = body.Get("preferences");
        if (prefs.ValueKind == JsonValueKind.Undefined)
        {
            change = new(name, null);
            return true;
        }
        var volume = prefs.Get("volume");
        if (!Fields(prefs, "sound", "music", "volume", "reducedMotion")
            || !prefs.Get("sound").TryFlag(out var sound) || !prefs.Get("music").TryFlag(out var music)
            || !prefs.Get("reducedMotion").TryFlag(out var reducedMotion) || volume.ValueKind != JsonValueKind.Number
            || !volume.TryGetDouble(out var amount) || amount is < 0 or > 1 || !double.IsFinite(amount))
            return false;
        change = new(name, new Preferences(sound, music, amount, reducedMotion));
        return true;
    }

    public static Intent? ParseIntent(string op, JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object) return null;
        var roomId = payload.Get("roomId").AsString();
        switch (op)
        {
            case "createRoom":
                var visibility = payload.Get("visibility").AsString();
                var fill = payload.Get("fillBots");
                var fillBots = false;
                return Fields(payload, "visibility", "matchHands", "fillBots")
                    && visibility is "public" or "invite"
                    && payload.Get("matchHands").Int(out var hands) && hands is 1 or 4
                    && (fill.ValueKind == JsonValueKind.Undefined || fill.TryFlag(out fillBots))
                    ? new(op, Visibility: visibility, MatchHands: hands, Flag: fillBots) : null;
            case "joinRoom":
                var inviteCode = payload.Get("inviteCode").AsString();
                if (Fields(payload, "roomId") && IsLocator(roomId)) return new(op, RoomId: roomId);
                if (Fields(payload, "inviteCode") && IsLocator(inviteCode)) return new(op, InviteCode: inviteCode);
                return null;
            case "choose":
                var windowId = payload.Get("windowId").AsString();
                var optionId = payload.Get("optionId").AsString();
                return Fields(payload, "roomId", "windowId", "anchorGameRevision", "optionId")
                    && IsLocator(roomId) && Opaque(windowId) && Opaque(optionId)
                    && Revision(payload.Get("anchorGameRevision"), out var anchor)
                    ? new(op, roomId, Revision: anchor, WindowId: windowId, OptionId: optionId) : null;
            case "chat":
                var text = SafeText(payload.Get("text"), 300);
                return Fields(payload, "roomId", "text") && IsLocator(roomId) && text is not null
                    ? new(op, roomId, Text: text) : null;
        }

        if (!IsLocator(roomId) || !Revision(payload.Get("expectedRoomRevision"), out var revision))
            return null;
        if (op is "start" or "nextHand" or "leaveRoom" or "rematch")
            return Fields(payload, "roomId", "expectedRoomRevision") ? new(op, roomId, Revision: revision) : null;
        var flagField = op switch { "setReady" => "ready", "setPaused" => "paused", "setBot" => "enabled", _ => null };
        if (flagField is null || !payload.Get(flagField).TryFlag(out var flag)) return null;
        if (op == "setBot")
            return Fields(payload, "roomId", "expectedRoomRevision", "seat", flagField)
                && payload.Get("seat").Int(out var seat) && seat is >= 0 and <= 3
                ? new(op, roomId, Flag: flag, Seat: seat, Revision: revision) : null;
        return Fields(payload, "roomId", "expectedRoomRevision", flagField)
            ? new(op, roomId, Flag: flag, Revision: revision) : null;
    }

    public static string Fingerprint(string op, JsonElement payload, Intent? intent)
    {
        if (intent is not null)
            return Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(intent, Json)));
        var bytes = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(bytes))
        {
            writer.WriteStartArray();
            writer.WriteStringValue(op);
            Canonical(writer, payload);
            writer.WriteEndArray();
        }
        return Convert.ToHexString(SHA256.HashData(bytes.WrittenSpan));
    }

    private static void Canonical(Utf8JsonWriter writer, JsonElement node)
    {
        switch (node.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in node.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal))
                {
                    writer.WritePropertyName(property.Name);
                    Canonical(writer, property.Value);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in node.EnumerateArray()) Canonical(writer, item);
                writer.WriteEndArray();
                break;
            case JsonValueKind.Number when node.TryGetDecimal(out var number):
                writer.WriteRawValue(number.ToString("G29", CultureInfo.InvariantCulture));
                break;
            case JsonValueKind.Undefined:
                writer.WriteNullValue();
                break;
            default:
                node.WriteTo(writer);
                break;
        }
    }
}
