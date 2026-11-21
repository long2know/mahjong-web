using System.Net;
using System.Text.RegularExpressions;

namespace Mahjong.Server;

internal sealed record ServerOptions(string DataDirectory, Uri? PublicOrigin, IPAddress[] TrustedProxies, PathString PathBase,
    TimeSpan TurnLimit, TimeSpan ClaimLimit, TimeSpan BotDelay, TimeSpan PauseLimit, TimeSpan LeaseLimit,
    TimeSpan TickInterval, TimeSpan PruneInterval, TimeSpan TestClockOffset,
    bool AllowDevelopmentHttp, bool AllowHttpLoopbackOrigin)
{
    public const int MessageLimit = 16 * 1024;
    public static readonly TimeSpan RoomIdleLimit = TimeSpan.FromHours(24);
    public string BaseHref => PathBase.Value + "/";

    public static ServerOptions Read(IConfiguration config, IWebHostEnvironment environment)
    {
        foreach (var key in new[] { "Mahjong:PathBase", "PathBase", "ASPNETCORE_PATHBASE" })
            if (config[key] is { Length: > 0 } path && path != "/")
                throw new InvalidOperationException($"Use BASE_URL instead of {key} to configure the path prefix.");
        var pathBase = ReadPathBase(config["BASE_URL"]);

        var defaultRoot = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (defaultRoot.Length == 0)
            defaultRoot = Path.Combine(environment.ContentRootPath, "..");
        var directory = config["Mahjong:DataDirectory"] ?? Path.Combine(defaultRoot, "mahjong-web");
        if (string.IsNullOrWhiteSpace(directory))
            throw new InvalidOperationException("Mahjong:DataDirectory must not be empty.");

        var testing = config.GetSection("Mahjong:Testing");
        if (testing.Exists() && !environment.IsEnvironment("Testing"))
            throw new InvalidOperationException("Mahjong:Testing overrides require the Testing environment.");

        Uri? origin = null;
        if (config["Mahjong:PublicOrigin"] is { } value && !TryOrigin(value, out origin))
            throw new InvalidOperationException("Mahjong:PublicOrigin must be an HTTP(S) origin with no path or credentials.");

        var proxies = config.GetSection("Mahjong:TrustedProxies").GetChildren()
            .Select(c => IPAddress.TryParse(c.Value, out var address) ? address
                : throw new InvalidOperationException("Mahjong:TrustedProxies entries must be explicit IP addresses."))
            .ToArray();

        return new ServerOptions(Path.GetFullPath(directory), origin, proxies, pathBase,
            TimeSpan.FromSeconds(ReadInt("TurnSeconds", 30, 1, 120)),
            TimeSpan.FromSeconds(ReadInt("ClaimSeconds", 8, 1, 30)),
            TimeSpan.FromMilliseconds(ReadInt("BotDelayMilliseconds", 700, 10, 5000)),
            TimeSpan.FromSeconds(ReadInt("PauseSeconds", 60, 1, 60)),
            TimeSpan.FromSeconds(ReadInt("LeaseSeconds", 600, 1, 600)),
            TimeSpan.FromMilliseconds(ReadInt("TickMilliseconds", 100, 10, 1000)),
            TimeSpan.FromSeconds(ReadInt("PruneSeconds", 30, 1, 60)),
            TimeSpan.FromSeconds(ReadInt("UtcOffsetSeconds", 0, -172_800, 172_800)),
            environment.IsDevelopment() || environment.IsEnvironment("Testing"),
            config.GetValue<bool>("Mahjong:AllowHttpLoopbackOrigin"));

        int ReadInt(string key, int fallback, int minimum, int maximum)
        {
            if (testing[key] is not { } raw) return fallback;
            return int.TryParse(raw, out var number) && number >= minimum && number <= maximum
                ? number : throw new InvalidOperationException($"Mahjong:Testing:{key} must be in [{minimum}, {maximum}].");
        }
    }

    private static PathString ReadPathBase(string? value)
    {
        if (string.IsNullOrEmpty(value) || value == "/") return PathString.Empty;
        if (!Regex.IsMatch(value, @"\A(?:/[a-zA-Z0-9._~-]+)+/?\z", RegexOptions.CultureInvariant)
            || value.Split('/').Any(segment => segment is "." or ".."))
            throw new InvalidOperationException(
                "BASE_URL must be / or a path such as /mahjong, with unescaped URL-safe segments and no origin, query, or fragment.");
        return new PathString(value.TrimEnd('/'));
    }

    public static bool TryOrigin(string raw, out Uri? origin)
    {
        origin = null;
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https") || uri.Host.Length == 0
            || uri.AbsolutePath != "/" || uri.UserInfo.Length != 0 || raw.Contains('@')
            || raw.Contains('?') || raw.Contains('#') || raw.Contains(',') || raw.Contains('\\')
            || raw.Any(char.IsWhiteSpace))
            return false;
        origin = uri;
        return true;
    }

    public bool IsSameOrigin(HttpContext context)
    {
        var request = context.Request;
        if (!request.IsHttps && !AllowDevelopmentHttp)
        {
            if (!TryOrigin($"http://{request.Host}", out var local) || !local!.IsLoopback
                || !(AllowHttpLoopbackOrigin || context.Connection.RemoteIpAddress is { } remote && IPAddress.IsLoopback(remote)))
                return false;
        }
        var headers = request.Headers.Origin;
        if (headers.Count != 1 || !TryOrigin(headers[0]!, out var supplied))
            return false;
        var expected = PublicOrigin;
        return (expected is not null || TryOrigin($"{request.Scheme}://{request.Host}", out expected))
            && request.Scheme == expected!.Scheme && expected.Scheme == supplied!.Scheme
            && expected.IdnHost.Equals(supplied.IdnHost, StringComparison.OrdinalIgnoreCase)
            && expected.Port == supplied.Port;
    }
}

internal sealed class OffsetClock(TimeSpan offset) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => DateTimeOffset.UtcNow + offset;
}
