using System.Buffers;
using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.Channels;
using System.Threading.RateLimiting;

namespace Mahjong.Server;

internal sealed class Peer(Guid guestId)
{
    private readonly Channel<object> _outgoing = Channel.CreateBounded<object>(new BoundedChannelOptions(32)
    {
        SingleReader = true,
        FullMode = BoundedChannelFullMode.Wait
    });
    private sealed record Termination(int Code, string Reason, Fault? Final);
    private Termination? _termination;

    public Guid GuestId { get; } = guestId;
    public string? RoomId { get; set; }
    public bool IsClosing => Volatile.Read(ref _termination) is not null;

    public void Send(object message)
    {
        if (!IsClosing && !_outgoing.Writer.TryWrite(message))
            Close(1013, "busy");
    }

    public void Close(int code, string reason, Fault? final = null)
    {
        if (Interlocked.CompareExchange(ref _termination, new Termination(code, reason, final), null) is null)
            _outgoing.Writer.TryComplete();
    }

    public async Task WriteAsync(WebSocket socket)
    {
        try
        {
            while (!IsClosing && await _outgoing.Reader.WaitToReadAsync())
                while (!IsClosing && _outgoing.Reader.TryRead(out var message))
                    await WriteMessageAsync(socket, message);

            var closing = Volatile.Read(ref _termination);
            if (closing is null || socket.State is WebSocketState.Aborted or WebSocketState.Closed) return;
            if (closing.Final is not null && socket.State == WebSocketState.Open)
                await WriteMessageAsync(socket, closing.Final);
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await socket.CloseOutputAsync((WebSocketCloseStatus)closing.Code, closing.Reason, timeout.Token);
        }
        catch (OperationCanceledException)
        {
            Close(1013, "busy");
            if (socket.State == WebSocketState.Open)
            {
                try
                {
                    using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(250));
                    await socket.CloseOutputAsync((WebSocketCloseStatus)1013, "busy", timeout.Token);
                }
                catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or InvalidOperationException)
                {
                    socket.Abort();
                }
            }
        }
        catch (WebSocketException)
        {
            Close(1001, "disconnected");
            socket.Abort();
        }
    }

    private static async Task WriteMessageAsync(WebSocket socket, object message)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        var bytes = JsonSerializer.SerializeToUtf8Bytes(message, message.GetType(), Wire.Json);
        await socket.SendAsync(bytes.AsMemory(), WebSocketMessageType.Text, true, timeout.Token);
    }
}

internal sealed class Realtime(Rooms rooms, ServerOptions options, ProtectedIdentity identity, IHostApplicationLifetime lifetime)
{
    private readonly SemaphoreSlim _connections = new(256);

    public async Task InvokeAsync(HttpContext context)
    {
        if (identity.ReadGuest(context) is not { } guest)
        {
            await HttpApi.Error(401, "not_authenticated").ExecuteAsync(context);
            return;
        }
        try
        {
            if (!await rooms.IsGuestAsync(guest, context.RequestAborted))
            {
                await HttpApi.Error(401, "not_authenticated").ExecuteAsync(context);
                return;
            }
        }
        catch (Exception ex) when (Rooms.Unavailable(ex))
        {
            await HttpApi.Error(429, "busy").ExecuteAsync(context);
            return;
        }
        if (!options.IsSameOrigin(context))
        {
            await HttpApi.Error(403, "forbidden").ExecuteAsync(context);
            return;
        }
        if (!context.WebSockets.IsWebSocketRequest)
        {
            await HttpApi.Error(400, "invalid_request").ExecuteAsync(context);
            return;
        }
        if (!_connections.Wait(0))
        {
            await HttpApi.Error(429, "busy").ExecuteAsync(context);
            return;
        }

        try
        {
            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            var peer = new Peer(guest);
            using var stop = CancellationTokenSource.CreateLinkedTokenSource(lifetime.ApplicationStopping, context.RequestAborted);
            rooms.IssueLease(peer);
            var writer = peer.WriteAsync(socket);
            var reader = ReadAsync(peer, socket, stop.Token);
            try
            {
                await Task.WhenAny(reader, writer);
                await writer.WaitAsync(TimeSpan.FromSeconds(5));
                await FinishCloseAsync(socket, reader, stop.Token);
            }
            finally
            {
                await stop.CancelAsync();
                try { await reader; }
                finally { await rooms.DisconnectAsync(peer); }
            }
        }
        finally
        {
            _connections.Release();
        }
    }

    private static async Task FinishCloseAsync(WebSocket socket, Task reader, CancellationToken stop)
    {
        if (socket.State != WebSocketState.CloseSent) return;
        using var grace = CancellationTokenSource.CreateLinkedTokenSource(stop);
        grace.CancelAfter(TimeSpan.FromSeconds(1));
        try
        {
            // Cancelling the active receive immediately after CloseOutputAsync can reset the socket
            // before a browser observes the close code. Let it acknowledge first.
            await reader.WaitAsync(grace.Token);
            var buffer = new byte[512];
            while (socket.State == WebSocketState.CloseSent)
            {
                var result = await socket.ReceiveAsync(buffer.AsMemory(), grace.Token);
                if (result.MessageType == WebSocketMessageType.Close) break;
            }
        }
        catch (Exception ex) when (ex is OperationCanceledException or WebSocketException)
        {
        }
    }

    private async Task ReadAsync(Peer peer, WebSocket socket, CancellationToken stop)
    {
        using var limit = new TokenBucketRateLimiter(new TokenBucketRateLimiterOptions
        {
            TokenLimit = 64, TokensPerPeriod = 16, ReplenishmentPeriod = TimeSpan.FromSeconds(1),
            AutoReplenishment = true, QueueLimit = 0
        });
        var buffer = ArrayPool<byte>.Shared.Rent(ServerOptions.MessageLimit + 1);
        try
        {
            while (!peer.IsClosing && !stop.IsCancellationRequested)
            {
                var length = 0;
                ValueWebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(buffer.AsMemory(length, ServerOptions.MessageLimit + 1 - length), stop);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        peer.Close(1000, "closed");
                        return;
                    }
                    if (result.MessageType != WebSocketMessageType.Text)
                    {
                        peer.Close(1003, "text_required");
                        return;
                    }
                    length += result.Count;
                    if (length > ServerOptions.MessageLimit)
                    {
                        peer.Close(1009, "message_too_large");
                        return;
                    }
                }
                while (!result.EndOfMessage);
                if (peer.IsClosing) return;

                using var permit = limit.AttemptAcquire();
                if (!permit.IsAcquired)
                {
                    peer.Close(1013, "busy", Wire.Error("busy"));
                    return;
                }

                try
                {
                    using var message = JsonDocument.Parse(buffer.AsMemory(0, length), Wire.DocumentOptions);
                    Wire.ValidateStrings(message.RootElement);
                    await DispatchAsync(peer, message.RootElement);
                }
                catch (JsonException)
                {
                    peer.Send(Wire.Error("invalid_request"));
                }
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested)
        {
            peer.Close(1001, "disconnected");
        }
        catch (WebSocketException)
        {
            peer.Close(1001, "disconnected");
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer, clearArray: true);
            peer.Close(1000, "closed");
        }
    }

    private async Task DispatchAsync(Peer peer, JsonElement message)
    {
        var version = message.Get("v");
        if (version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var v))
        {
            peer.Send(Wire.Error("invalid_request"));
            return;
        }
        if (v != Wire.Version)
        {
            peer.Close(1002, "unsupported_version", Wire.Error("unsupported_version"));
            return;
        }

        var type = message.Get("type").AsString();
        if (type == "renewLease" && Wire.Fields(message, "v", "type"))
        {
            rooms.IssueLease(peer);
            return;
        }
        var requestId = message.Get("requestId").AsString();
        if (!Guid.TryParseExact(requestId, "D", out var id))
        {
            peer.Send(Wire.Error("invalid_request"));
            return;
        }

        var roomId = message.Get("roomId").AsString();
        if (type == "sync" && Wire.Fields(message, "v", "type", "requestId", "roomId") && Wire.IsLocator(roomId))
            await rooms.SyncAsync(peer, id, roomId!);
        else if (type == "command" && Wire.Fields(message, "v", "type", "requestId", "lease", "op", "payload")
            && message.Get("op").AsString() is { Length: > 0 and <= 48 } op)
            await rooms.CommandAsync(peer, id, message.Get("lease").AsString(), op, message.Get("payload"));
        else
            peer.Send(Acknowledgement.For(id, "invalid_request"));
    }
}
