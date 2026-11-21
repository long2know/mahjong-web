using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text.Json;

namespace Mahjong.Server.Tests;

public sealed class HttpsProxyTests
{
    private const string Authority = "games.example.test:8443";
    private const string Origin = "https://" + Authority;
    private const string Mount = "/mahjong";

    [Fact]
    public async Task MountedHttpUpstreamRequiresTheActualHostAndOneHttpsBrowserOrigin()
    {
        await using var server = ProxyServer().InProduction()
            .WithSetting("Mahjong__AllowHttpLoopbackOrigin", "true");
        await server.StartAsync();
        using var http = Http(server);

        using var enter = Request(HttpMethod.Post, Mount + "/api/guest", "GAMES.example.test:8443", [Origin]);
        using var guest = await http.SendAsync(enter);
        Assert.Equal(HttpStatusCode.OK, guest.StatusCode);
        Assert.Equal("Proxy Guest", (await guest.Content.ReadFromJsonAsync<JsonElement>()).Text("displayName"));
        var cookieParts = Assert.Single(guest.Headers.GetValues("Set-Cookie")).Split(';');
        var cookie = cookieParts[0];
        Assert.StartsWith("mahjong_guest=", cookie, StringComparison.Ordinal);
        Assert.Contains("secure", cookieParts.Select(Attribute));
        Assert.Contains("httponly", cookieParts.Select(Attribute));
        Assert.Contains("samesite=lax", cookieParts.Select(Attribute));
        Assert.Contains("path=/mahjong", cookieParts.Select(Attribute));
        Assert.DoesNotContain(cookieParts.Select(Attribute), part => part.StartsWith("domain=", StringComparison.Ordinal));

        using var defaultPort = Request(HttpMethod.Post, Mount + "/api/guest", "games.example.test:443",
            ["https://games.example.test"], cookie);
        using var existing = await http.SendAsync(defaultPort);
        Assert.Equal("Proxy Guest", (await existing.Content.ReadFromJsonAsync<JsonElement>()).Text("displayName"));

        (string Host, string[] Origins)[] invalid =
        [
            (Authority, []),
            (Authority, [Origin, Origin]),
            (Authority, ["null"]),
            (Authority, ["http://" + Authority]),
            (Authority, ["https://games.example.test"]),
            (Authority, ["https://other.example.test:8443"]),
            (Authority, [Origin + "/ignored/.."]),
            ("other.example.test:8443", [Origin]),
            ("games.example.test", [Origin]),
            ("games.example.test:443", [Origin]),
            (server.Address.Authority, [server.Origin])
        ];
        foreach (var (host, origins) in invalid)
        {
            foreach (var (method, path) in new[]
            {
                (HttpMethod.Post, "/api/guest"), (HttpMethod.Patch, "/api/profile"), (HttpMethod.Get, "/ws")
            })
            {
                using var rejected = Request(method, Mount + path, host, origins, cookie);
                rejected.Headers.Add("X-Forwarded-Host", Authority);
                rejected.Headers.Add("X-Forwarded-Proto", "https");
                using var response = await http.SendAsync(rejected, HttpCompletionOption.ResponseHeadersRead);
                Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
                Assert.Equal("forbidden", (await response.Content.ReadFromJsonAsync<JsonElement>()).Error());
                Assert.False(response.Headers.Contains("Set-Cookie"));
            }
        }

        using var profile = Request(HttpMethod.Patch, Mount + "/api/profile", Authority, [Origin], cookie);
        profile.Headers.Add("X-Forwarded-Host", "wrong.example.test");
        profile.Headers.Add("X-Forwarded-Proto", "http");
        profile.Headers.Add("X-Forwarded-Prefix", ["/wrong", "/mahjong"]);
        using var edit = await http.SendAsync(profile);
        Assert.Equal("Updated Guest", (await edit.Content.ReadFromJsonAsync<JsonElement>()).Text("displayName"));

        using var naked = Request(HttpMethod.Post, "/api/guest", Authority, [Origin]);
        naked.Headers.Add("X-Forwarded-Prefix", Mount);
        using var outsideMount = await http.SendAsync(naked);
        Assert.Equal(HttpStatusCode.NotFound, outsideMount.StatusCode);
        Assert.False(outsideMount.Headers.Contains("Set-Cookie"));

        var websocket = new ClientWebSocket();
        using var socket = new Client(websocket);
        websocket.Options.Proxy = null;
        websocket.Options.SetRequestHeader("Host", Authority);
        websocket.Options.SetRequestHeader("Origin", Origin);
        websocket.Options.SetRequestHeader("Cookie", cookie);
        websocket.Options.SetRequestHeader("X-Forwarded-Prefix", Mount);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await websocket.ConnectAsync(new UriBuilder(server.Address) { Scheme = "ws", Path = Mount + "/ws" }.Uri, timeout.Token);
        Assert.NotEmpty((await socket.Take("lease")).Text("lease"));

        static string Attribute(string value) => value.Trim().ToLowerInvariant();
    }

    [Fact]
    public async Task OptionalPublicOriginPinsBothTheRawHostAndTheBrowserOrigin()
    {
        await using var server = ProxyServer().WithSetting("Mahjong__PublicOrigin", Origin + "/");
        await server.StartAsync();
        using var http = Http(server);
        using var matching = Request(HttpMethod.Post, Mount + "/api/guest", Authority, [Origin]);
        using var accepted = await http.SendAsync(matching);
        Assert.Equal("Proxy Guest", (await accepted.Content.ReadFromJsonAsync<JsonElement>()).Text("displayName"));

        using var different = Request(HttpMethod.Post, Mount + "/api/guest", "other.example.test:8443",
            ["https://other.example.test:8443"]);
        different.Headers.Add("X-Forwarded-Host", Authority);
        different.Headers.Add("X-Forwarded-Proto", "https");
        using var denied = await http.SendAsync(different);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.Equal("forbidden", (await denied.Content.ReadFromJsonAsync<JsonElement>()).Error());
        Assert.False(denied.Headers.Contains("Set-Cookie"));
    }

    [Fact]
    public async Task ForwardedForCannotSplitTheActualPeersRateLimit()
    {
        await using var server = ProxyServer();
        await server.StartAsync();
        using var http = Http(server);
        for (var attempt = 1; attempt <= 61; attempt++)
        {
            using var request = Request(HttpMethod.Post, Mount + "/api/guest", Authority, []);
            request.Headers.Add("X-Forwarded-For", $"198.51.100.{attempt}");
            using var response = await http.SendAsync(request);
            var error = (await response.Content.ReadFromJsonAsync<JsonElement>()).Error();
            Assert.Equal(attempt <= 60 ? (HttpStatusCode.Forbidden, "forbidden") : (HttpStatusCode.TooManyRequests, "busy"),
                (response.StatusCode, error));
        }
    }

    [Fact]
    public async Task ProductionWithoutTheSettingStillRejectsHttpFromAnEffectiveRemotePeer()
    {
        await using var server = new Kestrel().InProduction();
        await server.StartAsync();
        using var http = Http(server);
        using var remote = Request(HttpMethod.Post, "/api/guest", server.Address.Authority, [server.Origin]);
        remote.Headers.Add("X-Forwarded-For", "198.51.100.1");
        using var denied = await http.SendAsync(remote);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.Equal("forbidden", (await denied.Content.ReadFromJsonAsync<JsonElement>()).Error());
        Assert.False(denied.Headers.Contains("Set-Cookie"));

        using var loopback = Request(HttpMethod.Post, "/api/guest", server.Address.Authority, [server.Origin]);
        using var guest = await http.SendAsync(loopback);
        Assert.Equal("Proxy Guest", (await guest.Content.ReadFromJsonAsync<JsonElement>()).Text("displayName"));
        Assert.DoesNotContain(Assert.Single(guest.Headers.GetValues("Set-Cookie")).Split(';'),
            part => part.Trim().Equals("secure", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData("")]
    [InlineData("http://games.example.test")]
    [InlineData("https://games.example.test/mahjong")]
    [InlineData("https://games.example.test/ignored/..")]
    [InlineData("https://games.example.test?")]
    [InlineData("https://games.example.test#")]
    [InlineData("https://user@games.example.test")]
    [InlineData("https://*.example.test")]
    [InlineData("https://games.example.test:")]
    [InlineData("https://games.example.test:65536")]
    [InlineData("https://games.example.test,https://other.example.test")]
    public async Task InvalidPinnedOriginFailsBeforeOpeningData(string value)
    {
        await using var server = ProxyServer().WithSetting("Mahjong__PublicOrigin", value);
        var failure = await Assert.ThrowsAsync<InvalidOperationException>(server.StartAsync);
        Assert.Contains("Mahjong:BehindHttpsProxy", failure.Message);
        Assert.Contains("Mahjong:PublicOrigin", failure.Message);
        Assert.False(Directory.Exists(server.DataDirectory));
    }

    [Theory]
    [InlineData("Mahjong__TrustedProxies__0", "127.0.0.1", "Mahjong:TrustedProxies")]
    [InlineData("ASPNETCORE_FORWARDEDHEADERS_ENABLED", "true", "ASPNETCORE_FORWARDEDHEADERS_ENABLED")]
    [InlineData("FORWARDEDHEADERS_ENABLED", "true", "ASPNETCORE_FORWARDEDHEADERS_ENABLED")]
    public async Task ContradictoryForwardingSettingsFailBeforeOpeningData(string setting, string value, string diagnostic)
    {
        await using var server = ProxyServer().WithSetting(setting, value);
        var failure = await Assert.ThrowsAsync<InvalidOperationException>(server.StartAsync);
        Assert.Contains("Mahjong:BehindHttpsProxy", failure.Message);
        Assert.Contains(diagnostic, failure.Message);
        Assert.False(Directory.Exists(server.DataDirectory));
    }

    [Fact]
    public async Task NonBooleanProxySwitchFailsBeforeOpeningData()
    {
        await using var server = ProxyServer().WithSetting("Mahjong__BehindHttpsProxy", "https");
        var failure = await Assert.ThrowsAsync<InvalidOperationException>(server.StartAsync);
        Assert.Contains("Mahjong:BehindHttpsProxy", failure.Message);
        Assert.False(Directory.Exists(server.DataDirectory));
    }

    private static Kestrel ProxyServer() => new Kestrel().WithSetting("BASE_URL", Mount)
        .WithSetting("Mahjong__BehindHttpsProxy", "true");

    private static HttpClient Http(Kestrel server) => new(new HttpClientHandler { UseProxy = false, UseCookies = false })
    {
        BaseAddress = server.Address, Timeout = TimeSpan.FromSeconds(10)
    };

    private static HttpRequestMessage Request(HttpMethod method, string path, string host, string[] origins, string? cookie = null)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Host = host;
        if (origins.Length > 0) request.Headers.Add("Origin", origins);
        if (cookie is not null) request.Headers.Add("Cookie", cookie);
        if (method == HttpMethod.Get)
        {
            request.Headers.Add("Connection", "Upgrade");
            request.Headers.Add("Upgrade", "websocket");
            request.Headers.Add("Sec-WebSocket-Version", "13");
            request.Headers.Add("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==");
        }
        else
        {
            request.Content = JsonContent.Create(new { displayName = method == HttpMethod.Post ? "Proxy Guest" : "Updated Guest" });
        }
        return request;
    }
}
