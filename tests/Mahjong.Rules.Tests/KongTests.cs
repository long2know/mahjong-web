using Mahjong.Rules;
using static Mahjong.Rules.Tests.Fixture;

namespace Mahjong.Rules.Tests;

public sealed class KongTests
{
    private static readonly RoundSeed RolledSeed = new(0x0123456789abcdef, 0xfedcba9876543210);
    private const string AddedReadyHand = "b5 d1 d2 d3 c1 c2 c3 b6 b7 b8 d5";
    private const string CanRob = "b3 b4 c4 c5 c6 d4 d5 d6 d7 d8 d9 c5 c5";

    [Fact]
    public void OpenBuTakesTheDiscardAndOneTailTileWithoutRequiringReadyShape()
    {
        var state = AtTurn(
        [
            "b7", "", "b7 b7 b7 b1 b2 b3 c1 c2 c3 d1 d2 d3 c9", ""
        ], "d7 c7 d9");
        var offered = Select(state, 0, "discard", "b7");
        Assert.True(Has(offered, 2, "bu"));
        Assert.False(Has(offered, 2, "gang"));
        var done = Select(offered, 2, "bu");
        if (done.Window!.Kind == DecisionKind.Discard)
            done = Expire(done);
        var meld = Assert.Single(ChangshaEngine.ViewPublic(done).Seats[2].Melds);
        Assert.Equal("bu", meld.Kind);
        Assert.Equal("open", meld.Method);
        Assert.Equal(0, meld.FromSeat);
        Assert.Equal(new[] { "b7", "b7", "b7", "b7" }, meld.Tiles);
        Assert.Equal("d9", Tiles.Face(done.Seats[2].Drawn!.Value));
        Assert.Equal(new[] { "d7", "c7" }, done.Wall.Select(tile => Tiles.Face(tile.Tile)));
        Assert.DoesNotContain(offered.Window!.Trigger!.Value, done.Seats[0].Discards);
        Assert.Equal(DecisionKind.Turn, done.Window!.Kind);
        Assert.Equal(2, done.Window.Seat);
    }

    [Fact]
    public void OpenReadyGangCannotBeRobbedAndUsesRolledSupplement()
    {
        var state = AtTurn(
        [
            "b7", "", "b7 b7 b7 b1 b2 b3 c1 c2 c3 d1 d2 d3 c5", ""
        ], "c9 c5");
        var offered = Select(state, 0, "discard", "b7");
        Assert.Contains("b7", Option(offered, 2, "gang").Faces);
        var done = Select(offered, 2, "gang");
        if (done.Window!.Kind == DecisionKind.Discard)
            done = Expire(done);
        Assert.Equal(DecisionKind.Turn, done.Window!.Kind);
        Assert.Equal(DrawKind.RolledSupplement, done.Window.DrawKind);
        Assert.Equal("gang", Assert.Single(done.Seats[2].Melds).Kind);
        Assert.Equal("open", Assert.Single(done.Seats[2].Melds).Method);
        Assert.Equal("c5", Tiles.Face(done.Seats[2].Drawn!.Value));
        Assert.True(Has(done, 2, "hu"));
    }

    [Fact]
    public void HuOnTheOriginalDiscardBeatsOpenGangBeforeReplacement()
    {
        var state = AtTurn(
        [
            "b7",
            "b6 b8 c1 c2 c3 d1 d2 d3 d7 d8 d9 c2 c2",
            "b7 b7 b7 b1 b2 b3 c1 c2 c3 d1 d2 d3 c5",
            ""
        ], "c9 c5");
        var offered = Select(state, 0, "discard", "b7");
        var both = Select(Select(offered, 2, "gang"), 1, "hu");
        if (both.Window is not null)
            both = Expire(both);
        Assert.Empty(both.Seats[2].Melds);
        Assert.Equal("discard", Assert.Single(both.Settlement!.Winners).WinBy);
        Assert.Equal("c5", Tiles.Face(Assert.Single(both.Wall).Tile));
    }

    [Fact]
    public void ConcealedBuDoesNotOfferRobAndKeepsFacesRedacted()
    {
        var state = AtTurn(
        [
            "b9 b9 b9 b9 b1 b2 b3 c1 c2 c3 d1 d2 d3 c5",
            "b7 b8 c1 c2 c3 d1 d2 d3 d4 d5 d6 c8 c8", "", ""
        ], "d9 c5");
        var old = Checkpoint(state);
        var done = Select(state, 0, "bu", "b9");
        Assert.Equal(old, Checkpoint(state));
        Assert.Equal(DecisionKind.Turn, done.Window!.Kind);
        var meld = Assert.Single(ChangshaEngine.ViewPublic(done).Seats[0].Melds);
        Assert.Equal("concealed", meld.Method);
        Assert.Null(meld.FromSeat);
        Assert.Equal(new string?[] { null, null, null, null }, meld.Tiles);
        Assert.Empty(ChangshaEngine.ViewSeat(done, 1).LegalOptions);
        var settlement = Select(done, 0, "hu").Settlement!;
        Assert.Equal("plain", Assert.Single(Assert.Single(settlement.Winners).Patterns).Code);
        Assert.Equal("c5", Assert.Single(Assert.Single(settlement.Winners).WinningTiles));
    }

    [Theory]
    [InlineData("bu", "plain", 1)]
    [InlineData("gang", "robKong", 6)]
    public void RobbingAnAddedKongKeepsOriginalPengAndOnlyTakesTheAddedTile(string kind, string code, int points)
    {
        var state = Added();
        var pending = Select(state, 0, kind, "b5");
        var view = ChangshaEngine.ViewPublic(pending);
        Assert.Equal("kong", view.Window!.Reason);
        Assert.Equal("b5", Assert.Single(view.Window.Trigger!.Faces));
        Assert.Equal("peng", Assert.Single(view.Seats[0].Melds).Kind);
        Assert.Equal(state.Wall.Length, pending.Wall.Length);
        Assert.Equal(state.Seats[0].Hand, pending.Seats[0].Hand);
        Assert.Equal(new[] { "hu", "pass" }, ChangshaEngine.ViewSeat(pending, 1).LegalOptions.Select(option => option.Kind));
        var resumed = RoundTrip(pending);
        var robbed = Select(resumed, 1, "hu");
        if (robbed.Window is not null)
            robbed = Expire(robbed);
        var settlement = robbed.Settlement!;
        var winner = Assert.Single(settlement.Winners);
        Assert.Equal("robKong", winner.WinBy);
        Assert.Equal(code, Assert.Single(winner.Patterns).Code);
        Assert.Equal(0, settlement.SourceSeat);
        Assert.Equal(1, settlement.NextDealerSeat);
        Assert.Equal(state.Wall.Length - 1, robbed.Wall.Length);
        Assert.Equal("peng", Assert.Single(robbed.Seats[0].Melds).Kind);
        Assert.Equal(pending.Window!.Trigger, robbed.ClaimedWinTile);
        Assert.DoesNotContain(pending.Window.Trigger!.Value, robbed.Seats[0].Hand);
        AssertBalanced(settlement, -points, points, 0, 0);
    }

    [Fact]
    public void AddedBuFinishesAfterPassAndRetainsSourceOfTheOriginalMeld()
    {
        var pending = Select(Added(), 0, "bu", "b5");
        var done = Expire(pending);
        Assert.Equal(Checkpoint(done), Checkpoint(Expire(RoundTrip(pending))));
        var meld = Assert.Single(ChangshaEngine.ViewPublic(done).Seats[0].Melds);
        Assert.Equal("bu", meld.Kind);
        Assert.Equal("added", meld.Method);
        Assert.Equal(3, meld.FromSeat);
        Assert.Equal(new[] { "b5", "b5", "b5", "b5" }, meld.Tiles);
        Assert.Equal("c9", Tiles.Face(done.Seats[0].Drawn!.Value));
        Assert.Equal(DecisionKind.Turn, done.Window!.Kind);
    }

    [Fact]
    public void APreviouslyHeldFourthTileCannotUpgradeAPeng()
    {
        var state = AtTurn([AddedReadyHand, "", "", ""], "d5 c2 c8 d6 d7 c9", drawn: "d5",
            melds: [new(0, "peng", "b5 b5 b5", 3)]);
        Assert.False(Has(state, 0, "bu"));
        Assert.False(Has(state, 0, "gang"));
    }

    [Fact]
    public void SeededDiceChooseTheReplacementStackAndScoreKongBloom()
    {
        var state = AtTurn(
        [
            "b9 b9 b9 b9 b1 b2 b3 c1 c2 c3 d1 d2 d3 c5", "", "", ""
        ], "b5 d7 d8 c5 b7 b8", dealer: 2, seed: RolledSeed);
        var after = Select(state, 0, "gang", "b9");
        Assert.Equal("c5", Tiles.Face(after.Seats[0].Drawn!.Value));
        Assert.Equal(new[] { "b5", "d7", "d8", "b7", "b8" }, after.Wall.Select(tile => Tiles.Face(tile.Tile)));
        Assert.Single(ChangshaEngine.ViewSeat(after, 0).LegalOptions, option => option.Kind == "discard");
        var settle = Select(after, 0, "hu").Settlement!;
        Assert.Equal("kongBloom", Assert.Single(Assert.Single(settle.Winners).Patterns).Code);
        AssertBalanced(settle, 14, -3, -8, -3);
    }

    [Fact]
    public void RolledKongMissForcesOnlyItsReplacementAndRestrictsFutureDraws()
    {
        var state = AtTurn(
        [
            "b9 b9 b9 b9 b1 b2 b3 c1 c2 c3 d1 d2 d3 d5",
            "b4 b5 b6 c4 c6 d4 d5 d6 d7 d8 d9 c8 c8", "c5 c5", ""
        ], "b5 d7 d8 c5 b7 b8", dealer: 2, seed: RolledSeed);
        var missed = Select(state, 0, "gang", "b9");
        Assert.False(Has(missed, 0, "hu"));
        Assert.Equal("c5", Assert.Single(Assert.Single(ChangshaEngine.ViewSeat(missed, 0).LegalOptions).Faces));
        var cannon = Select(missed, 0, "discard");
        Assert.Equal("kong", ChangshaEngine.ViewPublic(cannon).Window!.Reason);
        Assert.Equal(new[] { "hu", "pass" }, ChangshaEngine.ViewSeat(cannon, 1).LegalOptions.Select(option => option.Kind));
        Assert.Empty(ChangshaEngine.ViewSeat(cannon, 2).LegalOptions);
        var win = Select(cannon, 1, "hu");
        if (win.Window is not null)
            win = Expire(win);
        Assert.Equal("kongCannon", Assert.Single(Assert.Single(win.Settlement!.Winners).Patterns).Code);
        AssertBalanced(win.Settlement, -6, 6, 0, 0);

        var continued = Expire(cannon);
        for (var step = 0; step < 20 && ChangshaEngine.ViewPublic(continued).TurnSeat != 0; step++)
            continued = Expire(continued);
        Assert.Equal(0, ChangshaEngine.ViewPublic(continued).TurnSeat);
        Assert.True(continued.Seats[0].FrozenAfterGang);
        Assert.Single(ChangshaEngine.ViewSeat(continued, 0).LegalOptions, option => option.Kind == "discard");
    }

    [Fact]
    public void EarthlyWinStacksWhenTheDealersFirstDiscardIsKongCannon()
    {
        var dealt = Deal(
        [
            "b9 b9 b9 b9 b1 b2 b3 c1 c2 c3 d1 d2 d3 d5",
            "b4 b5 b6 c4 c6 d4 d5 d6 d7 d8 d9 c8 c8", "", ""
        ], front: "c2", rearDrawOrder: "b7 b8 d8 d7 c5");
        var after = Select(Expire(dealt), 0, "gang", "b9");
        Assert.Equal("c5", Tiles.Face(after.Seats[0].Drawn!.Value));
        var claim = Select(after, 0, "discard");
        var settled = Select(claim, 1, "hu");
        if (settled.Window is not null)
            settled = Expire(settled);
        Assert.Equal(new[] { "earthly", "kongCannon" },
            Assert.Single(settled.Settlement!.Winners).Patterns.Select(pattern => pattern.Code));
        AssertBalanced(settled.Settlement, -28, 28, 0, 0);
    }

    [Fact]
    public void FourRealConcealedKongsCanWinWithoutCreatingExtraTiles()
    {
        var state = Deal(["b1 b1 b1 b1 b3 b3 b3 b3 c4 c4 c4 c4 d8 d8", "", "", ""],
            rearDrawOrder: "d8 d8 c7 c7");
        state = Expire(state);
        foreach (var face in new[] { "b1", "b3", "c4", "d8" })
            state = Select(state, 0, "bu", face);
        Assert.Equal(4, state.Seats[0].Melds.Length);
        Assert.Equal(51, state.Wall.Length);
        Assert.All(ChangshaEngine.ViewPublic(state).Seats[0].Melds, meld => Assert.All(meld.Tiles, Assert.Null));
        Assert.Equal(new[] { "c7", "c7" }, ChangshaEngine.ViewSeat(state, 0).Hand.Select(tile => tile.Face));
        var complete = Select(state, 0, "hu");
        Assert.Equal("allPungs", Assert.Single(Assert.Single(complete.Settlement!.Winners).Patterns).Code);
        Assert.Equal("c7", Assert.Single(Assert.Single(complete.Settlement.Winners).WinningTiles));
    }

    private static GameState Added() => AtTurn([AddedReadyHand, CanRob, "", ""], "d5 c2 c8 d6 d7 c9",
        dealer: 2, drawn: "b5", melds: [new(0, "peng", "b5 b5 b5", 3)]);
}
