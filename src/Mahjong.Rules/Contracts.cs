using System.Collections.Immutable;

namespace Mahjong.Rules;

public readonly record struct RoundSeed(ulong Low, ulong High);

public sealed record HandStart(int HandNumber, int DealerSeat, RoundSeed Seed,
    string Profile, TimeSpan TurnLimit, TimeSpan ClaimLimit);

public abstract record GameAction;

public sealed record Choose(int Seat, string WindowId, string OptionId) : GameAction;

public sealed record Expire(string WindowId) : GameAction;

public enum MoveStatus
{
    Accepted,
    StaleWindow,
    IllegalChoice,
    WindowElapsed,
    NotDue
}

public sealed record MoveResult(MoveStatus Status, GameState State);

public sealed record PublicView(int HandNumber, int DealerSeat, string Phase, int? TurnSeat,
    int WallCount, ImmutableArray<PublicSeat> Seats, PublicWindow? Window, PublicSettlement? Settlement,
    PublicKongRoll? KongRoll);

public sealed record PublicSeat(int Seat, int ConcealedCount, ImmutableArray<string> Discards,
    ImmutableArray<PublicMeld> Melds, ImmutableArray<string> RevealedTiles);

public sealed record PublicMeld(string Kind, int? FromSeat, ImmutableArray<string?> Tiles, string? Method);

public sealed record PublicWindow(string WindowId, string Reason, DateTimeOffset ClosesAtGameTime,
    PublicTrigger? Trigger);

public sealed record PublicTrigger(int Seat, ImmutableArray<string> Faces);

public sealed record PublicKongRoll(int Seat, ImmutableArray<int> Dice, int LowerDie);

public sealed record PublicSettlement(string Reason, int NextDealerSeat, int? SourceSeat,
    ImmutableArray<PublicWinner> Winners, ImmutableArray<string> Birds, ImmutableArray<SeatResult> SeatResults,
    ImmutableArray<PayerTransfer> Transfers);

public sealed record PublicWinner(int Seat, string WinBy, ImmutableArray<string> WinningTiles,
    ImmutableArray<WinPattern> Patterns, PublicWinningHand WinningHand);

public sealed record PublicWinningHand(ImmutableArray<string> ConcealedTiles, ImmutableArray<PublicWinningMeld> Melds);

public sealed record PublicWinningMeld(string Kind, string? Method, int? FromSeat, ImmutableArray<string> Tiles);

public sealed record SeatView(int Seat, ImmutableArray<HandTile> Hand, string? DrawnTileId,
    ImmutableArray<LegalOption> LegalOptions);

public sealed record HandTile(string TileId, string Face);

public sealed record LegalOption(string OptionId, string Kind, ImmutableArray<string> TileIds,
    ImmutableArray<string> Faces);

public sealed record Settlement(string Reason, int NextDealerSeat, int? SourceSeat,
    ImmutableArray<Winner> Winners, ImmutableArray<string> Birds, ImmutableArray<SeatResult> SeatResults,
    ImmutableArray<PayerTransfer> Transfers);

public sealed record Winner(int Seat, string WinBy, ImmutableArray<string> WinningTiles,
    ImmutableArray<WinPattern> Patterns);

public sealed record WinPattern(string Code, string Label, int Points);

public sealed record SeatResult(int Seat, int Delta);

public sealed record PayerTransfer(int FromSeat, int ToSeat, int Points, string Reason);
