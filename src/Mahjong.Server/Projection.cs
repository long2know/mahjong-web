using Mahjong.Rules;

namespace Mahjong.Server;

internal static class Projection
{
    public static object Snapshot(RoomCheckpoint room, int seat, DateTimeOffset utc, Func<Guid, bool> connected)
    {
        var table = room.Game is null ? null : ChangshaEngine.ViewPublic(room.Game);
        var view = room.Game is null ? null : ChangshaEngine.ViewSeat(room.Game, seat);
        return new
        {
            v = Wire.Version,
            type = "snapshot",
            roomId = room.Id,
            room.RoomRevision,
            room.GameRevision,
            serverTimeUtc = utc,
            room = new
            {
                room.Visibility,
                room.Status,
                room.HostSeat,
                room.MatchHands,
                room.RulesVersion,
                paused = room.PauseStartedUtc.HasValue,
                room.AutoResumeAtUtc,
                seats = room.Seats.Select((chair, index) => new
                {
                    seat = index,
                    kind = chair.IsBot ? "bot" : chair.IsOpen ? "open" : "human",
                    chair.DisplayName,
                    chair.Ready,
                    connected = chair.GuestId is { } id && connected(id)
                }).ToArray(),
                chat = room.Chat.Select(post => new
                {
                    post.MessageId, post.Seat, post.DisplayName, post.Text, post.SentAtUtc
                }).ToArray()
            },
            game = table is null ? null : new
            {
                table.HandNumber,
                table.DealerSeat,
                table.Phase,
                table.TurnSeat,
                table.WallCount,
                seats = table.Seats.Select(player => new
                {
                    player.Seat,
                    player.ConcealedCount,
                    player.Discards,
                    melds = player.Melds.Select(meld => new
                    {
                        meld.Kind, meld.Method, meld.FromSeat,
                        tiles = meld.Method == "concealed" ? new string?[4] : meld.Tiles.ToArray()
                    }).ToArray(),
                    player.RevealedTiles,
                    total = room.Totals[player.Seat]
                }).ToArray(),
                window = table.Window is not { } window ? null : new
                {
                    windowId = room.PublicWindowId(window),
                    anchorGameRevision = room.WindowAnchor!.Value,
                    window.Reason,
                    deadlineUtc = room.PauseStartedUtc.HasValue ? (DateTimeOffset?)null : room.ToUtc(window.ClosesAtGameTime),
                    window.Trigger
                },
                settlement = table.Settlement is not { } settlement ? null : new
                {
                    settlement.Reason, settlement.NextDealerSeat, settlement.SourceSeat, settlement.Winners, settlement.Birds,
                    seatResults = settlement.SeatResults.Select(result => new
                    {
                        result.Seat, result.Delta, total = room.Totals[result.Seat]
                    }).ToArray(),
                    settlement.Transfers
                }
            },
            self = new
            {
                seat,
                inviteCode = seat == room.HostSeat ? room.InviteCode : null,
                hand = view?.Hand.ToArray() ?? [],
                drawnTileId = view?.DrawnTileId,
                legalOptions = room.PauseStartedUtc.HasValue ? [] : view?.LegalOptions.ToArray() ?? []
            }
        };
    }
}
