using Mahjong.Rules;
using static Mahjong.Rules.Tests.Fixture;

namespace Mahjong.Rules.Tests;

public sealed class ContractTests
{
    [Fact]
    public void CatalogueAndGoldenDealAreStable()
    {
        var settings = Start(2, seed: new(0x0123456789abcdef, 0xfedcba9876543210));
        var state = ChangshaEngine.StartHand(settings, Now);
        var view = ChangshaEngine.ViewPublic(state);
        Assert.Equal(2, view.DealerSeat);
        Assert.Equal(55, view.WallCount);
        Assert.Equal(new[] { 13, 13, 14, 13 }, view.Seats.Select(seat => seat.ConcealedCount));
        Assert.Equal(new[] { "d5", "d9", "d1", "d4" }, state.Wall.Take(4).Select(slot => Tiles.Face(slot.Tile)));
        Assert.Equal("2ec25a05f5215a80b5ac5f91b5a3ccab", view.Window!.WindowId);
        var dealer = ChangshaEngine.ViewSeat(state, 2);
        Assert.Equal(new HandTile("a5a3874aaa998108972b33f0bfce12de", "c2"),
            Assert.Single(dealer.Hand, tile => tile.TileId == dealer.DrawnTileId));
        var catalogue = state.Wall.Select(slot => slot.Tile).Concat(state.Seats.SelectMany(seat => seat.Hand))
            .GroupBy(Tiles.Face).OrderBy(group => group.Key).ToArray();
        Assert.Equal(from suit in "bcd" from rank in "123456789" select new string([suit, rank]),
            catalogue.Select(group => group.Key));
        Assert.All(catalogue, group => Assert.Equal(4, group.Count()));
        AssertInventory(state);
        Assert.Equal(Checkpoint(state), Checkpoint(ChangshaEngine.StartHand(settings, Now.ToOffset(TimeSpan.FromHours(2)))));
    }

    [Fact]
    public void ProjectionIdsAreScopedAndNoCheckpointDataIsProjected()
    {
        var state = ChangshaEngine.StartHand(Start(), Now);
        var views = Enumerable.Range(0, 4).Select(seat => ChangshaEngine.ViewSeat(state, seat)).ToArray();
        var ownIds = views.SelectMany(view => view.Hand.Select(tile => tile.TileId)).ToArray();
        Assert.Equal(53, ownIds.Distinct().Count());
        Assert.All(ownIds, id => Assert.Matches("^[0-9a-f]{32}$", id));
        foreach (var view in views)
            Assert.All(view.LegalOptions.SelectMany(option => option.TileIds),
                id => Assert.Contains(view.Hand, tile => tile.TileId == id));
        var publicJson = Checkpoint(ChangshaEngine.ViewPublic(state));
        Assert.All(ownIds, id => Assert.DoesNotContain(id, publicJson));
        Assert.DoesNotContain("checkpointVersion", publicJson);
        Assert.DoesNotContain("seed", publicJson);
        Assert.DoesNotContain("trigger\":{\"", publicJson);

        var next = ChangshaEngine.StartHand(Start(hand: 2), Now);
        Assert.NotEqual(state.Window!.Id, next.Window!.Id);
        Assert.NotEqual(Determinism.TileId(state.Start, 2, new(1)), Determinism.TileId(state.Start, 3, new(1)));
        Assert.NotEqual(Determinism.TileId(state.Start, 2, new(1)), Determinism.TileId(next.Start, 2, new(1)));
        Assert.NotEqual(state.Window.Id, ChangshaEngine.StartHand(Start(seed: new(18, 30)), Now).Window!.Id);
    }

    [Fact]
    public void DeadlinesEnforceChoiceBoundaryAndTimeoutRecovery()
    {
        var opening = ChangshaEngine.StartHand(Start(), Now);
        var state = opening.Window!.Kind == DecisionKind.Opening ? Expire(opening) : opening;
        var window = state.Window!;
        var source = window.Seat;
        var chosen = Option(state, source, "discard");
        var choose = new Choose(source, window.Id, chosen.OptionId);
        var expiry = new Expire(window.Id);
        Check(MoveStatus.NotDue, state, expiry, window.ClosesAt.AddTicks(-1));
        Check(MoveStatus.WindowElapsed, state, choose, window.ClosesAt);
        Check(MoveStatus.StaleWindow, state, choose with { WindowId = "old" }, state.AdvancedAtGameTime);
        Check(MoveStatus.IllegalChoice, state, choose with { Seat = (source + 1) % 4 }, state.AdvancedAtGameTime);
        Check(MoveStatus.IllegalChoice, state, choose with { OptionId = "old" }, state.AdvancedAtGameTime);
        Check(MoveStatus.IllegalChoice, state, choose, state.AdvancedAtGameTime.AddTicks(-1));
        Assert.Equal(MoveStatus.Accepted, ChangshaEngine.Apply(state, choose, window.ClosesAt.AddTicks(-1)).Status);
        var drawn = state.Seats[source].Drawn!.Value;
        var resumed = Expire(RoundTrip(state), window.ClosesAt.AddMinutes(2));
        Assert.Contains(drawn, resumed.Seats[source].Discards);
        Assert.Equal(window.ClosesAt, resumed.AdvancedAtGameTime);
        Assert.Equal(window.ClosesAt + (resumed.Window!.Kind == DecisionKind.Turn
            ? state.Start.TurnLimit : state.Start.ClaimLimit), resumed.Window.ClosesAt);
        Assert.Equal(Checkpoint(Expire(state)), Checkpoint(resumed));
        Check(MoveStatus.StaleWindow, resumed, choose, resumed.AdvancedAtGameTime);
    }

    [Fact]
    public void UnsupportedVersionsAndProfilesFailClosed()
    {
        Assert.Throws<ArgumentException>(() => ChangshaEngine.StartHand(Start() with { Profile = "other" }, Now));
        Assert.Throws<ArgumentOutOfRangeException>(() => ChangshaEngine.StartHand(Start(dealer: 4), Now));
        var state = ChangshaEngine.StartHand(Start(), Now);
        Assert.Throws<NotSupportedException>(() => ChangshaEngine.ViewPublic(state with { CheckpointVersion = 2 }));
        Assert.Throws<NotSupportedException>(() => ChangshaEngine.Apply(state with { ShuffleVersion = 2 },
            new Expire(state.Window!.Id), Now));
    }

    private static void Check(MoveStatus status, GameState state, GameAction action, DateTimeOffset at)
    {
        var result = ChangshaEngine.Apply(state, action, at);
        Assert.Equal(status, result.Status);
        Assert.Same(state, result.State);
    }
}
