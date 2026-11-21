using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Mahjong.Server.Tests;

public sealed class MountTests
{
    [Fact]
    public async Task PreservesPrefixOnSegmentBoundariesAndScopesShellAssetsAndGuest()
    {
        await using var server = new Kestrel().WithSetting("BASE_URL", "/tables/mahjong/");
        await server.StartAsync();
        var cookies = new CookieContainer();
        using var http = Http(server, cookies);
        const string mount = "/tables/mahjong";

        using var redirect = await http.GetAsync(mount + "?from=guest%2Flink&x=2");
        Assert.Equal(HttpStatusCode.PermanentRedirect, redirect.StatusCode);
        Assert.Equal(mount + "/?from=guest%2Flink&x=2", redirect.Headers.Location?.OriginalString);

        using var root = await http.GetAsync(mount + "/");
        Assert.Equal("text/html", root.Content.Headers.ContentType?.MediaType);
        Assert.True(root.Headers.CacheControl?.NoCache);
        var html = await root.Content.ReadAsStringAsync();
        Assert.Contains($"data-base=\"{mount}/\"", html);
        foreach (var route in new[] { "/play/reconnect", "/index.html" })
            Assert.Equal(html, await http.GetStringAsync(mount + route));

        var script = Regex.Match(html, "src=\"(/tables/mahjong/assets/[^\"]+\\.js)\"");
        Assert.True(script.Success, "The shell script must be scoped to the configured mount.");
        using var asset = await http.GetAsync(script.Groups[1].Value);
        Assert.Matches("^(text|application)/javascript$", asset.Content.Headers.ContentType?.MediaType ?? "");
        Assert.True(asset.Headers.CacheControl?.Extensions.Any(extension => extension.Name == "immutable"));
        Assert.NotEmpty(await asset.Content.ReadAsByteArrayAsync());
        foreach (var route in new[] { "/", "/api/version", "/health/ready", "/tables/mahjong-more/",
            "/tables/Mahjong/", mount + "/api/missing", mount + "/assets/missing", mount + "/ws/missing" })
        {
            using var missing = await http.GetAsync(route);
            Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
            Assert.NotEqual("text/html", missing.Content.Headers.ContentType?.MediaType);
        }
        Assert.Equal("ready", (await http.GetFromJsonAsync<JsonElement>(mount + "/health/ready")).Text("status"));

        using var enter = new HttpRequestMessage(HttpMethod.Post, mount + "/api/guest")
        {
            Content = JsonContent.Create(new { displayName = "Mounted Guest" })
        };
        enter.Headers.Add("Origin", server.Origin);
        using var guest = await http.SendAsync(enter);
        Assert.Equal("Mounted Guest", (await guest.Content.ReadFromJsonAsync<JsonElement>()).Text("displayName"));
        var cookie = Assert.Single(cookies.GetCookies(new Uri(server.Address, mount + "/api/rooms")).Cast<Cookie>());
        Assert.Equal("mahjong_guest", cookie.Name);
        Assert.Equal(mount, cookie.Path);
        Assert.True(cookie.HttpOnly);
        Assert.Empty(cookies.GetCookies(new Uri(server.Address, mount + "-more")));
        using var rooms = await http.GetAsync(mount + "/api/rooms");
        Assert.Equal(HttpStatusCode.OK, rooms.StatusCode);
        Assert.True(rooms.Headers.CacheControl?.NoStore);
    }

    [Fact]
    public async Task StrippedRoutesRequireAnExactSinglePrefixFromTheTrustedPeer()
    {
        const string publicOrigin = "https://tables.example.test";
        await using var server = new Kestrel().WithSetting("BASE_URL", "/mahjong")
            .WithSetting("Mahjong__TrustedProxies__0", "127.0.0.1")
            .WithSetting("Mahjong__PublicOrigin", publicOrigin);
        await server.StartAsync();
        using var http = Http(server);
        using var shell = await Forward(http, "/", ["/mahjong"]);
        Assert.Contains("data-base=\"/mahjong/\"", await shell.Content.ReadAsStringAsync());
        using var version = await Forward(http, "/api/version", ["/mahjong"]);
        Assert.Equal(1, (await version.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("protocolVersion").GetInt32());
        using var naked = await http.GetAsync("/api/version");
        Assert.Equal(HttpStatusCode.NotFound, naked.StatusCode);
        string[][] invalidPrefixes = [["/other"], ["/mahjong/"], ["/%6dahjong"], ["/mahjong", "/mahjong"]];
        foreach (var supplied in invalidPrefixes)
        {
            using var rejected = await Forward(http, "/", supplied);
            Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
            Assert.Equal("invalid_request", (await rejected.Content.ReadFromJsonAsync<JsonElement>()).Error());
        }
        using var guest = await Forward(http, "/api/guest", ["/mahjong"], publicOrigin);
        Assert.Equal(HttpStatusCode.OK, guest.StatusCode);
        var attributes = guest.Headers.GetValues("Set-Cookie").Single().Split(';').Skip(1)
            .Select(attribute => attribute.Trim().ToLowerInvariant());
        Assert.Contains("path=/mahjong", attributes);
        Assert.Contains("secure", attributes);
        Assert.Contains("httponly", attributes);
        Assert.Contains("samesite=lax", attributes);
    }

    [Fact]
    public async Task UntrustedPeerCannotMountUsingForwardedHeaders()
    {
        await using var server = new Kestrel().WithSetting("BASE_URL", "/mahjong")
            .WithSetting("Mahjong__TrustedProxies__0", "198.51.100.1");
        await server.StartAsync();
        using var http = Http(server);
        using var forged = await Forward(http, "/", ["/mahjong"]);
        Assert.Equal(HttpStatusCode.BadRequest, forged.StatusCode);
        using var preserved = await http.GetAsync("/mahjong/");
        Assert.Contains("data-base=\"/mahjong/\"", await preserved.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task RootProxyMayForwardRootButCannotChooseAnotherMount()
    {
        await using var server = new Kestrel().WithSetting("BASE_URL", "/");
        await server.StartAsync();
        using var http = Http(server);
        using var root = await Forward(http, "/", ["/"]);
        Assert.Contains("data-base=\"/\"", await root.Content.ReadAsStringAsync());
        using var injected = await Forward(http, "/", ["/mahjong"]);
        Assert.Equal(HttpStatusCode.BadRequest, injected.StatusCode);
    }

    [Theory]
    [InlineData("https://example.test/mahjong")]
    [InlineData("mahjong")]
    [InlineData("//mahjong")]
    [InlineData("/mahjong//")]
    [InlineData("/tables/../mahjong")]
    [InlineData("/mah%6aong")]
    [InlineData("/mahjong?from=invite")]
    [InlineData("/mahjong#invite")]
    [InlineData("/mahjong\\other")]
    [InlineData("/mahjong\"")]
    public async Task InvalidMountFailsStartupBeforeOpeningData(string baseUrl)
    {
        await using var server = new Kestrel().WithSetting("BASE_URL", baseUrl);
        var failure = await Assert.ThrowsAsync<InvalidOperationException>(server.StartAsync);
        Assert.Contains("BASE_URL must be / or a path such as /mahjong", failure.Message);
        Assert.False(Directory.Exists(server.DataDirectory));
    }

    private static HttpClient Http(Kestrel server, CookieContainer? cookies = null) => new(
        new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false, CookieContainer = cookies ?? new() })
    {
        BaseAddress = server.Address, Timeout = TimeSpan.FromSeconds(10)
    };

    private static async Task<HttpResponseMessage> Forward(HttpClient http, string path, string[] prefixes, string? origin = null)
    {
        using var request = new HttpRequestMessage(origin is null ? HttpMethod.Get : HttpMethod.Post, path);
        request.Headers.Add("X-Forwarded-For", "198.51.100.1");
        request.Headers.Add("X-Forwarded-Proto", "https");
        request.Headers.Add("X-Forwarded-Host", "tables.example.test");
        request.Headers.Add("X-Forwarded-Prefix", prefixes);
        if (origin is not null)
        {
            request.Headers.Add("Origin", origin);
            request.Content = JsonContent.Create(new { });
        }
        return await http.SendAsync(request);
    }
}
