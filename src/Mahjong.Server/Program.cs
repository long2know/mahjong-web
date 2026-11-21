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
if (!options.BehindHttpsProxy)
{
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
}
builder.Services.AddRateLimiter(rate =>
{
    rate.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    rate.OnRejected = (context, _) => new ValueTask(HttpApi.Error(429, "busy").ExecuteAsync(context.HttpContext));
    rate.AddPolicy("mutate", context => PerAddress(context, 60));
    rate.AddPolicy("read", context => PerAddress(context, 120));
});

await using var app = builder.Build();
var shell = ReadShell(options.BaseHref);
await app.Services.GetRequiredService<Rooms>().InitializeAsync(app.Lifetime.ApplicationStopping);

AppMount.Use(app, options);
app.Use(async (context, next) =>
{
    if (IsApi(context.Request.Path)) context.Response.Headers.CacheControl = "no-store";
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
string[] shellMethods = [HttpMethods.Get, HttpMethods.Head];
app.MapMethods("/index.html", shellMethods, ClientShell);
app.MapFallback(ClientShell).WithMetadata(new HttpMethodMetadata(shellMethods));
await app.RunAsync();

IResult ClientShell(HttpContext context)
{
    if (shell is null) return Results.NotFound();
    context.Response.Headers.CacheControl = "no-cache";
    return Results.Content(shell, "text/html; charset=utf-8");
}

static string? ReadShell(string baseHref)
{
    var path = Path.Combine(AppContext.BaseDirectory, "index.html");
    if (!File.Exists(path)) return null;
    var html = File.ReadAllText(path);
    const string marker = "data-base=\"/\"";
    if (!html.Contains(marker, StringComparison.Ordinal))
        throw new InvalidOperationException("The built client index.html is missing its data-base marker.");
    // Vite's entry URLs must resolve from the mount even on a nested SPA URL.
    return html.Replace(marker, $"data-base=\"{baseHref}\"", StringComparison.Ordinal)
        .Replace("\"./assets/", $"\"{baseHref}assets/", StringComparison.Ordinal);
}

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
