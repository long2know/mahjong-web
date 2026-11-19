using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading.RateLimiting;
using Mahjong.Server;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    WebRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot")
});
var options = ServerOptions.Read(builder.Configuration, builder.Environment);
using var data = new DataDirectory(options);
builder.Services.AddSingleton(options);
builder.Services.AddSingleton<TimeProvider>(options.TestClockOffset == TimeSpan.Zero
    ? TimeProvider.System : new OffsetClock(options.TestClockOffset));
builder.Services.AddDataProtection()
    .SetApplicationName("mahjong-web")
    .PersistKeysToFileSystem(data.Keys);
builder.Services.AddDbContextFactory<MahjongDb>(db =>
    db.UseSqlite(new SqliteConnectionStringBuilder
    {
        DataSource = data.DatabasePath, ForeignKeys = true, DefaultTimeout = 5
    }.ToString()));
builder.Services.AddSingleton<ProtectedIdentity>();
builder.Services.AddSingleton<RoomGame>();
builder.Services.AddSingleton<Rooms>();
builder.Services.AddSingleton<Realtime>();
builder.Services.AddHostedService<RoomClock>();

builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.Warning);
builder.Logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Warning);
builder.WebHost.ConfigureKestrel(server => server.Limits.MaxRequestBodySize = ServerOptions.MessageLimit);
builder.Services.Configure<ForwardedHeadersOptions>(forwarded =>
{
    forwarded.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
        | ForwardedHeaders.XForwardedHost | ForwardedHeaders.XForwardedPrefix;
    forwarded.ForwardLimit = 1;
    if (options.PublicOrigin is { } origin) forwarded.AllowedHosts.Add(origin.IdnHost);
    forwarded.KnownIPNetworks.Clear();
    forwarded.KnownProxies.Clear();
    if (options.TrustedProxies.Length != 0)
    {
        foreach (var address in options.TrustedProxies) forwarded.KnownProxies.Add(address);
    }
    else
    {
        var defaults = new ForwardedHeadersOptions();
        foreach (var network in defaults.KnownIPNetworks) forwarded.KnownIPNetworks.Add(network);
        foreach (var address in defaults.KnownProxies) forwarded.KnownProxies.Add(address);
    }
});
builder.Services.AddRateLimiter(rate =>
{
    rate.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    rate.OnRejected = (context, _) => new ValueTask(HttpApi.Error(429, "busy").ExecuteAsync(context.HttpContext));
    rate.AddPolicy("mutate", context => PerAddress(context, 60));
    rate.AddPolicy("read", context => PerAddress(context, 120));
});

await using var app = builder.Build();
await app.Services.GetRequiredService<Rooms>().InitializeAsync(app.Lifetime.ApplicationStopping);

app.UseForwardedHeaders();
app.Use(async (context, next) =>
{
    context.Response.Headers.XContentTypeOptions = "nosniff";
    if (IsApi(context.Request.Path)) context.Response.Headers.CacheControl = "no-store";
    if (context.Request.PathBase.HasValue && context.Request.PathBase.Value != "/")
    {
        await HttpApi.Error(400, "invalid_request").ExecuteAsync(context);
        return;
    }
    await next(context);
});
var staticFiles = new StaticFileOptions
{
    OnPrepareResponse = file =>
    {
        if (file.Context.Request.Path.StartsWithSegments("/assets")
            && Regex.IsMatch(file.File.Name, @"-[\w-]{8,}\.[^.]+$", RegexOptions.CultureInvariant))
            file.Context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        else
            file.Context.Response.Headers.CacheControl = "no-cache";
    }
};
app.UseWhen(context => !IsApi(context.Request.Path), branch => branch.UseStaticFiles(staticFiles));
app.UseRouting();
app.UseRateLimiter();
app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromSeconds(20),
    KeepAliveTimeout = TimeSpan.FromSeconds(20)
});

HttpApi.Map(app);
app.MapGet("/ws", (HttpContext context, Realtime realtime) => realtime.InvokeAsync(context)).RequireRateLimiting("read");
app.MapGet("/health/live", () => Results.Json(new { status = "live" }, Wire.Json));
app.MapGet("/health/ready", async (Rooms rooms, HttpContext context) =>
    await rooms.IsReadyAsync(context.RequestAborted)
        ? Results.Json(new { status = "ready" }, Wire.Json)
        : Results.Json(new { status = "notReady" }, Wire.Json, statusCode: 503));
var version = VersionInfo();
app.MapGet("/api/version", () => Results.Json(version, Wire.Json));
app.Map("/api/{**path}", () => HttpApi.Error(404, "invalid_request"));
app.Map("/health/{**path}", () => HttpApi.Error(404, "invalid_request"));
app.Map("/ws/{**path}", () => HttpApi.Error(404, "invalid_request"));
app.Map("/assets/{**path}", () => Results.NotFound());
app.MapFallbackToFile("index.html", staticFiles);
await app.RunAsync();

static bool IsApi(PathString path) => path.StartsWithSegments("/api")
    || path.StartsWithSegments("/health") || path.StartsWithSegments("/ws");

static RateLimitPartition<string> PerAddress(HttpContext context, int limit) =>
    RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "(local)",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = limit, Window = TimeSpan.FromMinutes(1), AutoReplenishment = true, QueueLimit = 0
        });

static object VersionInfo()
{
    var version = Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()
        ?.InformationalVersion.Split('+', 2) ?? ["0.1.0"];
    var sha = version.Length == 2 && Regex.IsMatch(version[1], "^[a-f0-9]{40}$", RegexOptions.CultureInvariant)
        ? version[1] : "unknown";
    return new { appVersion = version[0], protocolVersion = Wire.Version, commitSha = sha };
}
