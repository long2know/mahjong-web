using System.Buffers.Binary;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;

namespace Mahjong.Server;

internal sealed class ProtectedIdentity(IDataProtectionProvider provider, ServerOptions options)
{
    public const string CookieName = "mahjong_guest";
    public static readonly TimeSpan GuestLifetime = TimeSpan.FromDays(30);
    private readonly ITimeLimitedDataProtector _guest = provider.CreateProtector("mahjong.guest.v1").ToTimeLimitedDataProtector();
    private readonly IDataProtector _lease = provider.CreateProtector("mahjong.lease.v1");

    public Guid? ReadGuest(HttpContext context)
    {
        if (!context.Request.Cookies.TryGetValue(CookieName, out var token) || token.Length > 512) return null;
        try
        {
            return Guid.TryParseExact(_guest.Unprotect(token), "N", out var id) ? id : null;
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException)
        {
            return null;
        }
    }

    public void WriteGuest(HttpContext context, Guid id)
    {
        context.Response.Cookies.Append(CookieName, _guest.Protect(id.ToString("N"), GuestLifetime),
            new CookieOptions
            {
                HttpOnly = true, Secure = options.BehindHttpsProxy || context.Request.IsHttps, SameSite = SameSiteMode.Lax,
                Path = options.PathBase.HasValue ? options.PathBase.Value : "/", MaxAge = GuestLifetime, IsEssential = true
            });
    }

    public LeaseMessage NewLease(Guid guestId, DateTimeOffset now, DateTimeOffset effectiveNow)
    {
        var expires = effectiveNow + options.LeaseLimit;
        var bytes = new byte[40];
        guestId.TryWriteBytes(bytes);
        Guid.NewGuid().TryWriteBytes(bytes.AsSpan(16));
        BinaryPrimitives.WriteInt64LittleEndian(bytes.AsSpan(32), expires.UtcTicks);
        return new(WebEncoders.Base64UrlEncode(_lease.Protect(bytes)), expires, now);
    }

    public string? ReadLease(string? token, Guid guestId, DateTimeOffset effectiveNow, out Guid leaseId, out long expiry)
    {
        leaseId = default;
        expiry = 0;
        if (token is not { Length: > 0 and <= 512 })
            return "invalid_request";
        try
        {
            var bytes = _lease.Unprotect(WebEncoders.Base64UrlDecode(token));
            if (bytes.Length != 40) return "invalid_request";
            if (new Guid(bytes.AsSpan(0, 16)) != guestId) return "forbidden";
            leaseId = new Guid(bytes.AsSpan(16, 16));
            expiry = BinaryPrimitives.ReadInt64LittleEndian(bytes.AsSpan(32));
            return expiry <= effectiveNow.UtcTicks ? "request_expired" : null;
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException)
        {
            return "invalid_request";
        }
    }
}
