using Mahjong.Rules;
using static Mahjong.Rules.Tests.Fixture;

namespace Mahjong.Rules.Tests;

public sealed class LastTileTests
{
    [Fact]
    public void FourSeabedPassesDrawAndGiveDealerToFirstOfferedSeat()
    {
        var state = Offer(AtTurn(["", "", "", "b9"], "c5", seat: 3, dealer: 2), 3);
        for (var seat = 0; seat < 4; seat++)
        {
            var view = ChangshaEngine.ViewPublic(state);
            Assert.Equal(1, view.WallCount);
            Assert.Equal("turn", view.Phase);
            Assert.Equal(seat, view.TurnSeat);
            Assert.Equal("lastTile", view.Window!.Reason);
            Assert.Null(view.Window.Trigger);
            var own = ChangshaEngine.ViewSeat(state, seat);
            Assert.Equal(new[] { "draw", "pass" }, own.LegalOptions.Select(option => option.Kind));
            Assert.All(own.LegalOptions, option => Assert.Empty(option.Faces));
            Assert.Empty(ChangshaEngine.ViewSeat(state, (seat + 1) % 4).LegalOptions);
            state = seat % 2 == 0 ? Select(state, seat, "pass") : Expire(RoundTrip(state));
        }
        Assert.Null(state.Window);
        Assert.Equal(0, state.Settlement!.NextDealerSeat);
        Assert.Equal("draw", state.Settlement.Reason);
        Assert.Empty(state.Settlement.Birds);
        Assert.Single(state.Wall);
        AssertBalanced(state.Settlement, 0, 0, 0, 0);
    }

    [Fact]
    public void SeabedSelfDrawUsesTheSamePhysicalTileAsPublicBird()
    {
        var state = Offer(AtTurn(["b9", "", "b1 b2 b3 b4 b5 b6 c1 c2 c3 d7 d8 d9 c5", ""], "c5"), 0);
        state = Select(Select(state, 1, "pass"), 2, "draw");
        var view = ChangshaEngine.ViewPublic(state);
        Assert.Equal(0, view.WallCount);
        Assert.Equal(2, view.TurnSeat);
        Assert.Null(view.Window!.Trigger);
        var active = ChangshaEngine.ViewSeat(state, 2);
        Assert.Equal(Option(state, 2, "discard").TileIds[0], active.DrawnTileId);
        Assert.Equal(2, active.LegalOptions.Length);
        Assert.Empty(ChangshaEngine.ViewSeat(state, 0).LegalOptions);
        var done = Select(state, 2, "hu");
        var settlement = done.Settlement!;
        Assert.Empty(done.Birds);
        Assert.Equal("lastTileDraw", Assert.Single(Assert.Single(settlement.Winners).Patterns).Code);
        Assert.Equal("c5", Assert.Single(settlement.Birds));
        Assert.Equal("c5", Assert.Single(Assert.Single(settlement.Winners).WinningTiles));
        Assert.Equal(2, settlement.NextDealerSeat);
        AssertBalanced(settlement, -8, -3, 14, -3);
    }

    [Fact]
    public void SeabedMissForcesThatTileAndAllowsMultipleHuButNoMelds()
    {
        var state = Offer(AtTurn(
        [
            "b9",
            "b5 b5 b1 b2 b7 b8 c1 c4 c7 d3 d5 d6 d9",
            "b3 b4 c1 c2 c3 d1 d2 d3 d7 d8 d9 c2 c2",
            "b3 b4 c4 c5 c6 d4 d5 d6 d7 d8 d9 c5 c5"
        ], "b5", dealer: 2), 0);
        state = Select(state, 1, "draw");
        Assert.Equal("b5", Assert.Single(Assert.Single(ChangshaEngine.ViewSeat(state, 1).LegalOptions).Faces));
        var pending = Select(state, 1, "discard");
        Assert.Equal("lastTile", ChangshaEngine.ViewPublic(pending).Window!.Reason);
        Assert.Equal("b5", Assert.Single(ChangshaEngine.ViewPublic(pending).Window!.Trigger!.Faces));
        foreach (var seat in new[] { 2, 3 })
            Assert.Equal(new[] { "hu", "pass" }, ChangshaEngine.ViewSeat(pending, seat).LegalOptions.Select(option => option.Kind));
        var done = Select(Select(pending, 3, "hu"), 2, "hu");
        if (done.Window is not null)
            done = Expire(done);
        var settlement = done.Settlement!;
        Assert.Equal("b5", Assert.Single(settlement.Birds));
        Assert.Empty(done.Birds);
        Assert.Equal(1, settlement.SourceSeat);
        Assert.Equal(1, settlement.NextDealerSeat);
        Assert.Equal(new[] { 2, 3 }, settlement.Winners.Select(winner => winner.Seat));
        Assert.All(settlement.Winners, winner => Assert.Equal("lastTileDiscard", Assert.Single(winner.Patterns).Code));
        AssertBalanced(settlement, 0, -20, 14, 6);

        var nobodyWon = Expire(pending);
        Assert.Equal("draw", nobodyWon.Settlement!.Reason);
        Assert.Equal(1, nobodyWon.Settlement.NextDealerSeat);
        Assert.Empty(nobodyWon.Settlement.Birds);
        AssertBalanced(nobodyWon.Settlement, 0, 0, 0, 0);
    }

    [Fact]
    public void LastTileTakenByBuIsNotSeabedAndCannotEnableAnotherKong()
    {
        const string hand = "b9 b9 b9 b9 b1 b2 b3 c1 c2 c3 d1 d2 d3 c5";
        var start = AtTurn([hand, "", "", ""], "c5", dealer: 2);
        var after = Select(start, 0, "bu", "b9");
        Assert.Empty(after.Wall);
        Assert.Equal("turn", ChangshaEngine.ViewPublic(after).Window!.Reason);
        Assert.Equal(11, ChangshaEngine.ViewSeat(after, 0).LegalOptions.Count(option => option.Kind == "discard"));
        Assert.False(Has(after, 0, "bu"));
        Assert.False(Has(after, 0, "gang"));
        var settlement = Select(after, 0, "hu").Settlement!;
        Assert.Equal("plain", Assert.Single(Assert.Single(settlement.Winners).Patterns).Code);
        Assert.Empty(settlement.Birds);
        AssertBalanced(settlement, 4, -1, -2, -1);

        var noWin = Select(AtTurn([hand, "", "", ""], "d5", dealer: 2), 0, "bu", "b9");
        var draw = TimeoutHand(noWin).Settlement!;
        Assert.Equal("draw", draw.Reason);
        Assert.Equal(0, draw.NextDealerSeat);
    }

    [Fact]
    public void RolledKongAtWallEndStillScoresBloomAndNoSeabed()
    {
        var start = AtTurn(
        [
            "b9 b9 b9 b9 b1 b2 b3 c1 c2 c3 d1 d2 d3 c5", "", "", ""
        ], "c5", dealer: 2);
        var after = Select(start, 0, "gang", "b9");
        Assert.Empty(after.Wall);
        Assert.Equal(DrawKind.RolledSupplement, after.Window!.DrawKind);
        Assert.Single(ChangshaEngine.ViewSeat(after, 0).LegalOptions, option => option.Kind == "discard");
        var settlement = Select(after, 0, "hu").Settlement!;
        Assert.Equal("kongBloom", Assert.Single(Assert.Single(settlement.Winners).Patterns).Code);
        Assert.Empty(settlement.Birds);
        AssertBalanced(settlement, 10, -3, -4, -3);
    }

    private static GameState Offer(GameState state, int seat)
    {
        var next = Select(state, seat, "discard", "b9");
        if (next.Window!.Kind == DecisionKind.Discard)
            next = Expire(next);
        Assert.Equal(DecisionKind.LastTileOffer, next.Window!.Kind);
        return next;
    }
}
