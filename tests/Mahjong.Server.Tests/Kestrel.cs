using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Mahjong.Server.Tests;

internal sealed class Kestrel : IAsyncDisposable
{
    private readonly Dictionary<string, string> _configuration = new(StringComparer.Ordinal)
    {
        ["ASPNETCORE_ENVIRONMENT"] = "Testing",
        ["DOTNET_ENVIRONMENT"] = "Testing",
        ["Mahjong__Testing__TickMilliseconds"] = "20",
        ["Logging__LogLevel__Microsoft.AspNetCore"] = "Warning"
    };
    private Process? _process;
    public string DataDirectory { get; } = Path.GetFullPath(Path.Combine("server-test-data", Guid.NewGuid().ToString("N")));
    public Uri Address { get; private set; } = null!;
    public string Origin => Address.GetLeftPart(UriPartial.Authority);

    public Kestrel(params (string Name, int Value)[] timers)
    {
        foreach (var (name, value) in timers) _configuration["Mahjong__Testing__" + name] = value.ToString();
    }

    public void SetClockOffset(int seconds) => _configuration["Mahjong__Testing__UtcOffsetSeconds"] = seconds.ToString();

    public async Task StartAsync()
    {
        Assert.Null(_process);
        var executable = Path.Combine(AppContext.BaseDirectory, "Mahjong.Server.dll");
        Assert.True(File.Exists(executable), "The server executable must be built before running integration tests.");
        var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet")
        {
            UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true,
            WorkingDirectory = AppContext.BaseDirectory
        };
        start.ArgumentList.Add(executable);
        start.ArgumentList.Add("--urls");
        start.ArgumentList.Add("http://127.0.0.1:0");
        start.ArgumentList.Add("--Mahjong:DataDirectory");
        start.ArgumentList.Add(DataDirectory);
        foreach (var (key, value) in _configuration) start.Environment[key] = value;

        var ready = new TaskCompletionSource<Uri>(TaskCreationOptions.RunContinuationsAsynchronously);
        var output = new List<string>();
        var process = new Process { StartInfo = start, EnableRaisingEvents = true };
        void ReadOutput(object _, DataReceivedEventArgs entry)
        {
            if (entry.Data is null) return;
            lock (output) output.Add(entry.Data);
            const string listening = "Now listening on: ";
            if (entry.Data.IndexOf(listening, StringComparison.Ordinal) is var i and >= 0)
                ready.TrySetResult(new Uri(entry.Data[(i + listening.Length)..]));
        }
        process.OutputDataReceived += ReadOutput;
        process.ErrorDataReceived += ReadOutput;
        Assert.True(process.Start());
        _process = process;
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        try
        {
            var exit = process.WaitForExitAsync();
            if (await Task.WhenAny(ready.Task, exit).WaitAsync(TimeSpan.FromSeconds(15)) == exit)
                throw new InvalidOperationException($"Server exited with {process.ExitCode}:\n{string.Join('\n', output)}");
            Address = await ready.Task;
        }
        catch (TimeoutException)
        {
            lock (output) throw new InvalidOperationException($"Server did not start:\n{string.Join('\n', output)}");
        }
    }

    public async Task StopAsync()
    {
        if (_process is not { } process) return;
        if (!process.HasExited) process.Kill(entireProcessTree: true);
        await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
        process.Dispose();
        _process = null;
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        if (Directory.Exists(DataDirectory)) Directory.Delete(DataDirectory, recursive: true);
    }
}

internal sealed class User(Kestrel server)
{
    public CookieContainer Cookies { get; } = new();

    public async Task<HttpResponseMessage> Request(HttpMethod method, string path, object? body = null, string? origin = null,
        bool includeOrigin = true)
    {
        using var handler = new HttpClientHandler { CookieContainer = Cookies, UseProxy = false };
        using var http = new HttpClient(handler) { BaseAddress = server.Address, Timeout = TimeSpan.FromSeconds(10) };
        using var request = new HttpRequestMessage(method, path);
        if (includeOrigin) request.Headers.TryAddWithoutValidation("Origin", origin ?? server.Origin);
        if (body is not null) request.Content = body as HttpContent ?? JsonContent.Create(body);
        return await http.SendAsync(request);
    }

    public async Task<JsonElement> Guest(string? name = null)
    {
        using var response = await Request(HttpMethod.Post, "/api/guest", name is null ? new { } : new { displayName = name });
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    public async Task<Client> Connect()
    {
        var ws = new ClientWebSocket();
        ws.Options.Cookies = Cookies;
        ws.Options.Proxy = null;
        ws.Options.SetRequestHeader("Origin", server.Origin);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await ws.ConnectAsync(new UriBuilder(server.Address) { Scheme = "ws", Path = "/ws" }.Uri, timeout.Token);
        var client = new Client(ws);
        var lease = await client.Take("lease");
        client.Lease = lease.GetProperty("lease").GetString()!;
        client.LeaseExpiry = lease.GetProperty("expiresAtUtc").GetDateTimeOffset();
        Assert.EndsWith("Z", lease.GetProperty("serverTimeUtc").GetString(), StringComparison.Ordinal);
        return client;
    }
}

internal sealed class Client(ClientWebSocket socket) : IDisposable
{
    public string Lease { get; set; } = "";
    public DateTimeOffset LeaseExpiry { get; set; }

    public Task Send(object envelope) => SendRaw(JsonSerializer.Serialize(envelope));

    public async Task SendRaw(string value)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await socket.SendAsync(Encoding.UTF8.GetBytes(value).AsMemory(), WebSocketMessageType.Text, true, timeout.Token);
    }

    public async Task<JsonElement> Command(string op, object payload, Guid? requestId = null, string? lease = null)
    {
        var id = requestId ?? Guid.NewGuid();
        await Send(new { v = 1, type = "command", requestId = id, lease = lease ?? Lease, op, payload });
        return await Ack(id);
    }

    public async Task<JsonElement> Sync(string roomId)
    {
        var requestId = Guid.NewGuid();
        await Send(new { v = 1, type = "sync", requestId, roomId });
        return await Ack(requestId);
    }

    public Task<JsonElement> Ack(Guid requestId) =>
        Take("ack", message => message.GetProperty("requestId").GetGuid() == requestId);

    public Task<JsonElement> Snapshot(Func<JsonElement, bool>? predicate = null) => Take("snapshot", predicate);

    public async Task<JsonElement> Take(string type, Func<JsonElement, bool>? predicate = null)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        while (true)
        {
            var message = await Read(timeout.Token);
            Assert.True(message.HasValue, $"Socket closed with code {socket.CloseStatus} while awaiting {type}.");
            var value = message.Value;
            if (value.Text("type") == type && (predicate is null || predicate(value))) return value;
        }
    }

    public async Task<int> CloseCode()
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (await Read(timeout.Token) is not null) { }
        var status = socket.CloseStatus!.Value;
        if (socket.State == WebSocketState.CloseReceived)
            await socket.CloseOutputAsync(status, socket.CloseStatusDescription, timeout.Token);
        return (int)status;
    }

    private async Task<JsonElement?> Read(CancellationToken cancellationToken)
    {
        var buffer = new byte[8192];
        using var stream = new MemoryStream();
        ValueWebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(buffer.AsMemory(), cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            stream.Write(buffer, 0, result.Count);
        }
        while (!result.EndOfMessage);
        using var message = JsonDocument.Parse(stream.ToArray());
        return message.RootElement.Clone();
    }

    public void Dispose() => socket.Dispose();
}

internal static class JsonTest
{
    public static string Text(this JsonElement value, string name) => value.GetProperty(name).GetString()!;
    public static string Error(this JsonElement value) => value.GetProperty("error").Text("code");
    public static long RoomRevision(this JsonElement value) => value.GetProperty("roomRevision").GetInt64();
    public static long GameRevision(this JsonElement value) => value.GetProperty("gameRevision").GetInt64();
    public static JsonElement Chair(this JsonElement value, int seat) => value.GetProperty("room").GetProperty("seats")[seat];
    public static JsonElement Table(this JsonElement value) => value.GetProperty("game");
    public static JsonElement Private(this JsonElement value) => value.GetProperty("self");
    public static JsonElement Window(this JsonElement value) => value.Table().GetProperty("window");
    public static string Status(this JsonElement value) => value.GetProperty("room").Text("status");
    public static bool Connected(this JsonElement value, int seat) => value.Chair(seat).GetProperty("connected").GetBoolean();
    public static JsonElement At(this JsonElement value, string first, string second) => value.GetProperty(first).GetProperty(second);
    public static void Ok(this JsonElement value) => Assert.Equal("ok", value.Text("status"));
}
