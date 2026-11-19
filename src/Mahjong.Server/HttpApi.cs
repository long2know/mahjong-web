using System.Buffers;
using System.Text.Json;

namespace Mahjong.Server;

internal static class HttpApi
{
    public static IResult Error(int status, string code) => Results.Json(new { error = new Problem(code) }, Wire.Json, statusCode: status);

    public static void Map(WebApplication app)
    {
        app.MapPost("/api/guest", EnterAsync).RequireRateLimiting("mutate");
        app.MapPatch("/api/profile", ProfileAsync).RequireRateLimiting("mutate");
        app.MapGet("/api/rooms", ListRoomsAsync).RequireRateLimiting("read");
    }

    private static async Task<IResult> EnterAsync(HttpContext context, ServerOptions options, ProtectedIdentity identity, Rooms rooms)
    {
        if (!options.IsSameOrigin(context)) return Error(403, "forbidden");
        if (await ReadProfileAsync(context, allowPreferences: false) is not { } change)
            return Error(400, "invalid_request");
        try
        {
            var entered = await rooms.EnterAsync(identity.ReadGuest(context), change.DisplayName);
            identity.WriteGuest(context, entered.Id);
            return Results.Json(entered.View, Wire.Json);
        }
        catch (Exception ex) when (Rooms.Unavailable(ex))
        {
            return Error(429, "busy");
        }
    }

    private static async Task<IResult> ProfileAsync(HttpContext context, ServerOptions options, ProtectedIdentity identity, Rooms rooms)
    {
        if (identity.ReadGuest(context) is not { } guest) return Error(401, "not_authenticated");
        if (!options.IsSameOrigin(context)) return Error(403, "forbidden");
        if (await ReadProfileAsync(context, allowPreferences: true) is not { } change)
            return Error(400, "invalid_request");
        try
        {
            return await rooms.EditProfileAsync(guest, change) is { } updated
                ? Results.Json(updated, Wire.Json) : Error(401, "not_authenticated");
        }
        catch (Exception ex) when (Rooms.Unavailable(ex))
        {
            return Error(429, "busy");
        }
    }

    private static async Task<IResult> ListRoomsAsync(HttpContext context, ProtectedIdentity identity, Rooms rooms)
    {
        if (identity.ReadGuest(context) is not { } guest) return Error(401, "not_authenticated");
        try
        {
            if (!await rooms.IsGuestAsync(guest, context.RequestAborted)) return Error(401, "not_authenticated");
            return Results.Json(await rooms.DiscoverAsync(context.RequestAborted), Wire.Json);
        }
        catch (Exception ex) when (Rooms.Unavailable(ex))
        {
            return Error(429, "busy");
        }
    }

    private static async Task<ProfileChange?> ReadProfileAsync(HttpContext context, bool allowPreferences)
    {
        const int limit = 4096;
        if (!context.Request.HasJsonContentType() || context.Request.ContentLength > limit) return null;
        var buffer = ArrayPool<byte>.Shared.Rent(limit + 1);
        try
        {
            var length = 0;
            var input = context.Request.Body;
            while (length <= limit)
            {
                var read = await input.ReadAsync(buffer.AsMemory(length, limit + 1 - length), context.RequestAborted);
                if (read == 0) break;
                length += read;
            }
            if (length > limit) return null;
            using var json = JsonDocument.Parse(buffer.AsMemory(0, length), Wire.DocumentOptions);
            Wire.ValidateStrings(json.RootElement);
            return Wire.TryProfile(json.RootElement, allowPreferences, out var change) ? change : null;
        }
        catch (Exception ex) when (ex is JsonException or BadHttpRequestException)
        {
            return null;
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer, clearArray: true);
        }
    }
}
