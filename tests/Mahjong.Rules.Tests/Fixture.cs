using System.Collections.Immutable;
using System.Text.Json;
using Mahjong.Rules;

namespace Mahjong.Rules.Tests;

internal static class Fixture
{
    internal static readonly DateTimeOffset Now = new(2026, 11, 19, 20, 0, 0, TimeSpan.Zero);
    internal static readonly JsonSerializerOptions CheckpointJson = new(JsonSerializerDefaults.Web);

    internal static HandStart Start(int dealer = 0, int hand = 1, RoundSeed? seed = null) =>
        new(hand, dealer, seed ?? new RoundSeed(17, 29), ChangshaEngine.Profile,
            TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(8));

    internal static GameState Deal(string[] hands, string front = "", string rearDrawOrder = "", int dealer = 0)
    {
        var pool = new Pool();
        var dealt = hands.Select(pool.Take).ToArray();
        var frontTiles = pool.Take(front);
        var rearTiles = pool.Take(rearDrawOrder).AsEnumerable().Reverse().ToArray();
        for (var seat = 0; seat < 4; seat++)
            pool.Fill(dealt[seat], seat == dealer ? 14 : 13);

        var order = Enumerable.Range(0, 4).Select(offset => (dealer + offset) % 4).ToArray();
        List<PhysicalTile> deck = [];
        for (var packet = 0; packet < 3; packet++)
        {
            foreach (var seat in order)
                deck.AddRange(dealt[seat].Skip(packet * 4).Take(4));
        }
        deck.AddRange(order.Select(seat => dealt[seat][12]));
        deck.Add(dealt[dealer][13]);
        deck.AddRange(frontTiles);
        deck.AddRange(pool.Remaining);
        deck.AddRange(rearTiles);
        return ChangshaEngine.Deal(Start(dealer), Now, deck.ToArray());
    }

    internal static GameState AtTurn(string[] hands, string wall, int seat = 0, int dealer = 0,
        string? drawn = null, DrawKind kind = DrawKind.Ordinary, TestMeld[]? melds = null, RoundSeed? seed = null)
    {
        var pool = new Pool();
        var concealed = hands.Select(pool.Take).ToArray();
        var stock = pool.Take(wall);
        var declared = (melds ?? []).Select(meld => (meld.Seat, Meld: new Meld(meld.Kind, meld.Method, meld.FromSeat,
            [.. pool.Take(meld.Faces)]))).ToLookup(entry => entry.Seat, entry => entry.Meld);
        for (var i = 0; i < 4; i++)
            pool.Fill(concealed[i], 13 - declared[i].Count() * 3 + (i == seat ? 1 : 0));
        var physicalDraw = drawn is null ? concealed[seat][^1] :
            concealed[seat].Last(tile => Tiles.Face(tile) == drawn);
        var settings = Start(dealer, seed: seed);
        var state = new GameState(ChangshaEngine.CheckpointVersion, ChangshaEngine.ShuffleVersion, settings,
            [.. stock.Select((tile, index) => new WallTile(tile, 108 - stock.Count + index))],
            [.. concealed.Select((hand, i) => new SeatState(Tiles.Sort(hand), i == seat ? physicalDraw : null,
                [.. declared[i]], [.. pool.Remaining.Where((_, index) => index % 4 == i)], [], [], [], false))],
            null, 0, Now, pool.Remaining.Count, null, null, [], null);
        AssertInventory(state);
        return ChangshaEngine.BeginTurn(state, seat, kind, Now);
    }

    internal static LegalOption Option(GameState state, int seat, string kind, string? face = null) =>
        ChangshaEngine.ViewSeat(state, seat).LegalOptions.First(option => option.Kind == kind &&
            (face is null || option.Faces.Contains(face)));

    internal static bool Has(GameState state, int seat, string kind) =>
        ChangshaEngine.ViewSeat(state, seat).LegalOptions.Any(option => option.Kind == kind);

    internal static GameState Select(GameState state, int seat, string kind, string? face = null,
        DateTimeOffset? now = null) => Move(state, new Choose(seat, state.Window!.Id, Option(state, seat, kind, face).OptionId),
            now ?? state.AdvancedAtGameTime);

    internal static GameState Expire(GameState state, DateTimeOffset? now = null) =>
        Move(state, new Expire(state.Window!.Id), now ?? state.Window.ClosesAt);

    internal static GameState Move(GameState state, GameAction action, DateTimeOffset now)
    {
        var result = ChangshaEngine.Apply(state, action, now);
        Assert.Equal(MoveStatus.Accepted, result.Status);
        Assert.NotSame(state, result.State);
        AssertInventory(result.State);
        return result.State;
    }

    internal static GameState TimeoutHand(GameState state)
    {
        for (var step = 0; state.Window is not null && step < 300; step++)
            state = Expire(state);
        Assert.Null(state.Window);
        Assert.NotNull(state.Settlement);
        return state;
    }

    internal static string Checkpoint<T>(T value) => JsonSerializer.Serialize(value, CheckpointJson);

    internal static GameState RoundTrip(GameState state) =>
        JsonSerializer.Deserialize<GameState>(Checkpoint(state), CheckpointJson)!;

    internal static void AssertInventory(GameState state)
    {
        IEnumerable<PhysicalTile> owned = state.Seats.SelectMany(seat =>
            seat.Hand.Concat(seat.Discards).Concat(seat.Melds.SelectMany(meld => meld.Tiles)))
            .Concat(state.Wall.Select(wall => wall.Tile))
            .Concat(state.Birds);
        if (state.ClaimedWinTile is { } claimed)
            owned = owned.Append(claimed);
        Assert.Equal(Enumerable.Range(0, 108), owned.Select(tile => tile.Number).Order());
        var extraTileSeat = state.Window?.Kind switch
        {
            DecisionKind.Opening => state.Start.DealerSeat,
            DecisionKind.Turn or DecisionKind.RobKong => state.Window.Seat,
            _ => state.Settlement is { Reason: "win", SourceSeat: null } win ? win.Winners[0].Seat : (int?)null
        };
        for (var index = 0; index < state.Seats.Length; index++)
        {
            var seat = state.Seats[index];
            Assert.All(seat.Revealed, tile => Assert.Contains(tile, seat.Hand));
            if (seat.Drawn is { } drawn)
                Assert.Contains(drawn, seat.Hand);
            if (state.Window is not null || state.Settlement is not null)
                Assert.Equal(extraTileSeat == index ? 14 : 13, seat.Hand.Length + 3 * seat.Melds.Length);
        }
    }

    internal static void AssertBalanced(Settlement settlement, params int[] expected)
    {
        Assert.Equal(new[] { 0, 1, 2, 3 }, settlement.SeatResults.Select(seat => seat.Seat));
        Assert.Equal(0, settlement.SeatResults.Sum(seat => seat.Delta));
        Assert.All(settlement.Transfers, transfer =>
        {
            Assert.NotEqual(transfer.FromSeat, transfer.ToSeat);
            Assert.InRange(transfer.Points, 1, int.MaxValue);
        });
        foreach (var result in settlement.SeatResults)
            Assert.Equal(result.Delta, settlement.Transfers.Sum(transfer =>
                transfer.ToSeat == result.Seat ? transfer.Points :
                transfer.FromSeat == result.Seat ? -transfer.Points : 0));
        if (expected.Length > 0)
            Assert.Equal(expected, settlement.SeatResults.Select(seat => seat.Delta));
    }

    internal sealed record TestMeld(int Seat, string Kind, string Faces, int? FromSeat, string Method = "open");

    private sealed class Pool
    {
        internal List<PhysicalTile> Remaining { get; } = Determinism.Shuffle(Start()).ToList();

        internal List<PhysicalTile> Take(string faces) => faces.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(face =>
            {
                var index = Remaining.FindIndex(tile => Tiles.Face(tile) == face);
                Assert.True(index >= 0, $"Fixture has too many copies of {face}.");
                var tile = Remaining[index];
                Remaining.RemoveAt(index);
                return tile;
            }).ToList();

        internal void Fill(List<PhysicalTile> hand, int count)
        {
            Assert.InRange(hand.Count, 0, count);
            while (hand.Count < count)
            {
                hand.Add(Remaining[0]);
                Remaining.RemoveAt(0);
            }
        }
    }
}
