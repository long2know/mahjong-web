using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Mahjong.Server.Tests;

public sealed class RealtimeTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("/")]
    public async Task ServesBuiltClientAtRootWithSpaFallbackAndAssetCaching(string? baseUrl)
    {
        await using var server = new Kestrel();
        if (baseUrl is not null) server.WithSetting("BASE_URL", baseUrl);
        await server.StartAsync();
        var guest = new User(server);
        using var root = await guest.Request(HttpMethod.Get, "/");
        root.EnsureSuccessStatusCode();
        Assert.Equal("text/html", root.Content.Headers.ContentType?.MediaType);
        Assert.True(root.Headers.CacheControl?.NoCache);
        var html = await root.Content.ReadAsStringAsync();
        Assert.Contains("data-base=\"/\"", html);
        var script = Regex.Match(html, "/assets/[^\"']+\\.js");
        Assert.True(script.Success, "Root must contain a script from the built client.");

        using var fallback = await guest.Request(HttpMethod.Get, "/play");
        Assert.Equal(html, await fallback.Content.ReadAsStringAsync());
        using var asset = await guest.Request(HttpMethod.Get, script.Value);
        asset.EnsureSuccessStatusCode();
        Assert.True(asset.Content.Headers.ContentLength > 0);
        Assert.Contains("immutable", asset.Headers.GetValues("Cache-Control").Single());
        using var missing = await guest.Request(HttpMethod.Get, "/assets/not-built");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);

        using var version = await guest.Request(HttpMethod.Get, "/api/version");
        Assert.True(version.Headers.CacheControl?.NoStore);
        var info = await version.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, info.GetProperty("protocolVersion").GetInt32());
        Assert.NotEmpty(info.Text("appVersion"));
        Assert.Matches("^(unknown|[a-f0-9]{40})$", info.Text("commitSha"));
        using var health = await guest.Request(HttpMethod.Get, "/health/ready");
        Assert.Equal("ready", (await health.Content.ReadFromJsonAsync<JsonElement>()).Text("status"));
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(server.DataDirectory, "mahjong.db"), Mode = SqliteOpenMode.ReadOnly, Pooling = false
        };
        await using var database = new SqliteConnection(connectionString.ToString());
        await database.OpenAsync();
        await using var command = database.CreateCommand();
        command.CommandText = "SELECT MigrationId FROM __EFMigrationsHistory";
        Assert.Equal("20261119223000_Initial", await command.ExecuteScalarAsync());
    }

    [Fact]
    public async Task RequiresSignedGuestAndSameOriginAndBoundsProtocolMessages()
    {
        await using var server = new Kestrel();
        await server.StartAsync();
        var guest = new User(server);
        await Error(await guest.Request(HttpMethod.Get, "/ws"), HttpStatusCode.Unauthorized, "not_authenticated");
        await Error(await guest.Request(HttpMethod.Get, "/api/rooms"), HttpStatusCode.Unauthorized, "not_authenticated");
        await Error(await guest.Request(HttpMethod.Post, "/api/guest", new { }, origin: "http://localhost:9999"),
            HttpStatusCode.Forbidden, "forbidden");
        await Error(await guest.Request(HttpMethod.Post, "/api/guest",
                new StringContent("""{"displayName":"\uD800"}""", Encoding.UTF8, "application/json")),
            HttpStatusCode.BadRequest, "invalid_request");
        using (var response = await guest.Request(HttpMethod.Post, "/api/guest", new { displayName = "  Player  " }))
        {
            var profile = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("Player", profile.Text("displayName"));
            Assert.Null(profile.Text("resumeRoomId"));
            var prefs = profile.GetProperty("preferences");
            Assert.True(prefs.GetProperty("sound").GetBoolean());
            Assert.False(prefs.GetProperty("music").GetBoolean());
            Assert.Equal(0.7, prefs.GetProperty("volume").GetDouble());
            Assert.False(prefs.GetProperty("reducedMotion").GetBoolean());
            var cookie = response.Headers.GetValues("Set-Cookie").Single().ToLowerInvariant();
            Assert.StartsWith("mahjong_guest=", cookie, StringComparison.Ordinal);
            Assert.Contains("httponly", cookie);
            Assert.Contains("samesite=lax", cookie);
            Assert.Contains("max-age=2592000", cookie);
            Assert.Contains("path=/", cookie.Split(';').Select(attribute => attribute.Trim()));
        }
        await Error(await guest.Request(HttpMethod.Get, "/ws", includeOrigin: false), HttpStatusCode.Forbidden, "forbidden");
        await Error(await guest.Request(HttpMethod.Patch, "/api/profile", new { displayName = "not accepted" },
            origin: "http://localhost:9999"), HttpStatusCode.Forbidden, "forbidden");
        await Error(await guest.Request(HttpMethod.Patch, "/api/profile", new { preferences = new { sound = false } }),
            HttpStatusCode.BadRequest, "invalid_request");
        var tampered = new User(server);
        foreach (var token in new[] { "not-a-protected-cookie", "x" })
        {
            tampered.Cookies.Add(server.Address, new Cookie("mahjong_guest", token, "/"));
            await Error(await tampered.Request(HttpMethod.Get, "/api/rooms"), HttpStatusCode.Unauthorized, "not_authenticated");
        }

        using (var socket = await guest.Connect())
        {
            await socket.SendRaw("[]");
            Assert.Equal("invalid_request", (await socket.Take("error")).Error());
            await socket.SendRaw("""{"v":1,"type":"\uD800"}""");
            Assert.Equal("invalid_request", (await socket.Take("error")).Error());
            await socket.Send(new { v = 2, type = "renewLease" });
            Assert.Equal("unsupported_version", (await socket.Take("error")).Error());
            Assert.Equal((int)WebSocketCloseStatus.ProtocolError, await socket.CloseCode());
        }
        using (var socket = await guest.Connect())
        {
            await socket.SendRaw(new string(' ', 16 * 1024 + 1));
            Assert.Equal((int)WebSocketCloseStatus.MessageTooBig, await socket.CloseCode());
        }
    }

    [Fact]
    public async Task InviteAuthorizationProfileChatAndNewestAttachmentAreIsolated()
    {
        await using var server = new Kestrel();
        await server.StartAsync();
        var hostUser = new User(server);
        var memberUser = new User(server);
        var strangerUser = new User(server);
        await hostUser.Guest("Ari");
        await memberUser.Guest("Bo");
        await strangerUser.Guest("Cai");
        using var host = await hostUser.Connect();
        using var member = await memberUser.Connect();
        using var stranger = await strangerUser.Connect();
        (await host.Command("createRoom", new { visibility = "invite", matchHands = 1 })).Ok();
        var created = await host.Snapshot();
        Assert.Equal("changsha-v1", created.At("room", "rulesVersion").GetString());
        var roomId = created.Text("roomId");
        var inviteCode = created.Private().Text("inviteCode");
        Assert.Matches("^[a-zA-Z0-9_-]{16}$", inviteCode);
        Assert.Equal(1, created.RoomRevision());
        Assert.Equal(0, created.GameRevision());

        Assert.Empty(await Listed(strangerUser));
        Assert.Null((await strangerUser.Guest()).Text("resumeRoomId"));
        foreach (var ack in new[]
        {
            await stranger.Sync(roomId),
            await stranger.Command("joinRoom", new { roomId }),
            await stranger.Command("joinRoom", new { inviteCode = "incorrect" }),
            await stranger.Command("chat", new { roomId, text = "unseated" })
        })
        {
            Assert.Equal("room_not_found", ack.Error());
            Assert.Null(ack.Text("roomId"));
        }

        (await member.Command("joinRoom", new { inviteCode })).Ok();
        var joined = await member.Snapshot();
        Assert.Null(joined.Private().Text("inviteCode"));
        Assert.Equal(1, joined.Private().GetProperty("seat").GetInt32());
        Assert.True(joined.Connected(0));
        Assert.True(joined.Connected(1));
        Assert.Equal(roomId, (await memberUser.Guest()).Text("resumeRoomId"));
        Assert.False(joined.GetRawText().Contains(inviteCode, StringComparison.Ordinal));

        using var replacement = await memberUser.Connect();
        var unbound = await replacement.Command("setReady", new { roomId, expectedRoomRevision = joined.RoomRevision(), ready = true });
        Assert.Equal("invalid_state", unbound.Error());
        Assert.Null(unbound.Text("roomId"));
        var takeover = await replacement.Sync(roomId);
        takeover.Ok();
        var current = await replacement.Snapshot();
        Assert.Equal(joined.RoomRevision(), current.RoomRevision());
        Assert.Equal(4001, await member.CloseCode());
        Assert.True(current.Connected(1));
        using var returned = await memberUser.Connect();
        (await returned.Sync(roomId)).Ok();
        Assert.True((await returned.Snapshot()).Connected(1));
        Assert.Equal(4001, await replacement.CloseCode());

        using var patch = await memberUser.Request(HttpMethod.Patch, "/api/profile",
            new { displayName = "  New name  ", preferences = new { sound = false, music = true, volume = 0.25, reducedMotion = true } });
        patch.EnsureSuccessStatusCode();
        Assert.Equal("New name", (await patch.Content.ReadFromJsonAsync<JsonElement>()).Text("displayName"));
        var renamed = await host.Snapshot(s => s.Chair(1).Text("displayName") == "New name");
        Assert.Equal(current.RoomRevision() + 1, renamed.RoomRevision());
        Assert.DoesNotContain("preferences", renamed.GetRawText());

        for (var index = 0; index < 5; index++)
            (await returned.Command("chat", new { roomId, text = $"  <b>plain text</b> {index}  " })).Ok();
        Assert.Equal("rate_limited", (await returned.Command("chat", new { roomId, text = "sixth" })).Error());
        var chat = (await host.Snapshot(s => s.At("room", "chat").GetArrayLength() == 5)).At("room", "chat");
        Assert.Equal("<b>plain text</b> 0", chat[0].Text("text"));
        Assert.Equal("New name", chat[0].Text("displayName"));
        Assert.Equal(1, chat[0].GetProperty("seat").GetInt32());
        Assert.EndsWith("Z", chat[0].Text("sentAtUtc"), StringComparison.Ordinal);
        Assert.Equal(5, chat.EnumerateArray().Select(post => post.Text("messageId")).Distinct().Count());
    }

    [Fact]
    public async Task ConcurrentAdmissionAndStartReserveAPlayingSeatOnLeave()
    {
        await using var server = new Kestrel(("TurnSeconds", 30), ("ClaimSeconds", 8));
        await server.StartAsync();
        var hostUser = new User(server);
        var userA = new User(server);
        var userB = new User(server);
        await hostUser.Guest("Host");
        await userA.Guest("A");
        await userB.Guest("B");
        using var host = await hostUser.Connect();
        using var duplicateHost = await hostUser.Connect();
        using var clientA = await userA.Connect();
        using var clientB = await userB.Connect();

        var creation = await Task.WhenAll(host.Command("createRoom", new { visibility = "public", matchHands = 1 }),
            duplicateHost.Command("createRoom", new { visibility = "public", matchHands = 1 }));
        Assert.Single(creation, ack => ack.Text("status") == "ok");
        Assert.Single(creation, ack => ack.Text("status") == "error" && ack.Error() == "already_seated");
        var owner = creation[0].Text("status") == "ok" ? host : duplicateHost;
        var snap = await owner.Snapshot();
        var roomId = snap.Text("roomId");
        for (var seat = 1; seat <= 2; seat++)
        {
            (await owner.Command("setBot", new { roomId, expectedRoomRevision = snap.RoomRevision(), seat, enabled = true })).Ok();
            snap = await owner.Snapshot();
        }
        var advertisement = Assert.Single(await Listed(userA));
        Assert.Equal(roomId, advertisement.Text("roomId"));
        Assert.Equal(3, advertisement.GetProperty("occupiedSeats").GetInt32());
        Assert.False(advertisement.TryGetProperty("seats", out _));
        var joins = await Task.WhenAll(clientA.Command("joinRoom", new { roomId }), clientB.Command("joinRoom", new { roomId }));
        Assert.Single(joins, ack => ack.Text("status") == "ok");
        Assert.Single(joins, ack => ack.Text("status") == "error" && ack.Error() == "room_full");
        Assert.Empty(await Listed(userB));
        var winner = joins[0].Text("status") == "ok" ? clientA : clientB;
        var winnerUser = winner == clientA ? userA : userB;
        var winnerSnapshot = await winner.Snapshot();
        Assert.Equal(3, winnerSnapshot.Private().GetProperty("seat").GetInt32());
        (await owner.Command("setReady", new { roomId, expectedRoomRevision = winnerSnapshot.RoomRevision(), ready = true })).Ok();
        snap = await owner.Snapshot(s => s.Chair(0).GetProperty("ready").GetBoolean());
        Assert.Equal("not_ready", (await owner.Command("start", new { roomId, expectedRoomRevision = snap.RoomRevision() })).Error());
        Assert.Equal("forbidden", (await winner.Command("start", new { roomId, expectedRoomRevision = snap.RoomRevision() })).Error());
        (await winner.Command("setReady", new { roomId, expectedRoomRevision = snap.RoomRevision(), ready = true })).Ok();
        snap = await owner.Snapshot(s => s.Chair(3).GetProperty("ready").GetBoolean());

        var firstId = Guid.NewGuid();
        var secondId = Guid.NewGuid();
        var startPayload = new { roomId, expectedRoomRevision = snap.RoomRevision() };
        await owner.Send(new { v = 1, type = "command", requestId = firstId, lease = owner.Lease, op = "start", payload = startPayload });
        await owner.Send(new { v = 1, type = "command", requestId = secondId, lease = owner.Lease, op = "start", payload = startPayload });
        (await owner.Ack(firstId)).Ok();
        Assert.Equal("stale_room", (await owner.Ack(secondId)).Error());
        var playing = await winner.Snapshot(s => s.Status() == "playing");
        Assert.Equal(1, playing.Table().GetProperty("handNumber").GetInt32());
        (await winner.Command("leaveRoom", new { roomId, expectedRoomRevision = playing.RoomRevision() })).Ok();
        var detached = await owner.Snapshot(s => s.Status() == "playing" && !s.Connected(3));
        Assert.Equal(playing.RoomRevision(), detached.RoomRevision());
        Assert.Equal(roomId, (await winnerUser.Guest()).Text("resumeRoomId"));
        (await winner.Sync(roomId)).Ok();
        Assert.True((await winner.Snapshot()).Connected(3));
    }

    private static async Task<JsonElement[]> Listed(User user)
    {
        using var response = await user.Request(HttpMethod.Get, "/api/rooms");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("rooms").EnumerateArray().ToArray();
    }

    private static async Task Error(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        using (response)
        {
            Assert.Equal(status, response.StatusCode);
            Assert.True(response.Headers.CacheControl?.NoStore);
            Assert.Equal(code, (await response.Content.ReadFromJsonAsync<JsonElement>()).Error());
        }
    }
}
