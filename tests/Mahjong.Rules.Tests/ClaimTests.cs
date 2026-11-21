using Mahjong.Rules;
using static Mahjong.Rules.Tests.Fixture;

namespace Mahjong.Rules.Tests;

public sealed class ClaimTests
{
    private const string ChiOnly = "b3 b4 b8 c1 c1 c6 c8 c9 d1 d4 d6 d7 d9";
    private const string WaitThree = "b3 b4 c4 c5 c6 d4 d5 d6 d7 d8 d9 c5 c5";
    private const string PengTwo = "b5 b5 b1 b2 b6 b7 d9 d3 d4 c5 c8 c8 c9";

    [Theory]
    [InlineData(0)]
    [InlineData(3)]
    public void ChiIsNextSeatOnlyAndPengTakesPriority(int source)
    {
        var next = (source + 1) % 4;
        var across = (source + 2) % 4;
        var previous = (source + 3) % 4;
        var hands = new string[4];
        hands[source] = "b5";
        hands[next] = ChiOnly;
        hands[across] = "b5 b5 b3 b4 b8 b9 d9 d3 d4 c5 c8 c8 c9";
        hands[previous] = WaitThree;
        var state = Select(AtTurn(hands, "c4 b9 c7", seat: source, dealer: across), source, "discard", "b5");
        var window = ChangshaEngine.ViewPublic(state).Window!;
        Assert.Equal("discard", window.Reason);
        Assert.Equal(source, window.Trigger!.Seat);
        Assert.Equal(new[] { "b5" }, window.Trigger.Faces);
        var chow = Assert.Single(ChangshaEngine.ViewSeat(state, next).LegalOptions, option => option.Kind == "chi");
        Assert.Equal(new[] { "b3", "b4", "b5" }, chow.Faces);
        Assert.False(Has(state, across, "chi"));
        Assert.False(Has(state, previous, "chi"));
        Assert.True(Has(state, across, "peng"));
        Assert.True(Has(state, previous, "hu"));
        Assert.False(Has(state, source, "peng"));
        var chi = Select(state, next, "chi", "b3");
        var peng = Select(Select(chi, across, "peng"), previous, "pass");
        var publicMeld = Assert.Single(ChangshaEngine.ViewPublic(peng).Seats[across].Melds);
        Assert.Equal(new[] { "b5", "b5", "b5" }, publicMeld.Tiles);
        Assert.Equal("peng", publicMeld.Kind);
        Assert.Equal(source, publicMeld.FromSeat);
        Assert.Null(publicMeld.Method);
        Assert.Equal(across, ChangshaEngine.ViewPublic(peng).TurnSeat);
        Assert.Null(ChangshaEngine.ViewSeat(peng, across).DrawnTileId);
        Assert.DoesNotContain(state.Window!.Trigger!.Value, peng.Seats[source].Discards);
        Assert.Empty(peng.Seats[next].Melds);

        var chiWon = Select(Select(chi, across, "pass"), previous, "pass");
        var chiView = ChangshaEngine.ViewPublic(chiWon);
        var chiMeld = Assert.Single(chiView.Seats[next].Melds);
        Assert.Equal("chi", chiMeld.Kind);
        Assert.Equal(source, chiMeld.FromSeat);
        Assert.Equal(next, chiView.TurnSeat);
        Assert.Equal(state.Wall.Length, chiWon.Wall.Length);
    }

    [Theory]
    [InlineData(1, 2, 3)]
    [InlineData(1, 3, 2)]
    [InlineData(2, 1, 3)]
    [InlineData(2, 3, 1)]
    [InlineData(3, 1, 2)]
    [InlineData(3, 2, 1)]
    public void ClaimOrderIsIndependentOfArrivalAndWinsBeatCalls(int a, int b, int c)
    {
        var state = Select(AtTurn(["b5", ChiOnly, PengTwo, WaitThree], "c4 b9 c7", dealer: 2), 0, "discard", "b5");
        var original = Checkpoint(state);
        var firstWindow = state.Window!;
        string Kind(int seat) => seat switch { 1 => "chi", 2 => "peng", _ => "hu" };
        var decisions = Enumerable.Range(1, 3).Select(seat => Option(state, seat, Kind(seat))).ToArray();
        var move = ChangshaEngine.Apply(state, new Choose(b, firstWindow.Id, decisions[a - 1].OptionId), Now);
        Assert.Equal(MoveStatus.IllegalChoice, move.Status);
        Assert.Same(state, move.State);
        var pending = Select(state, a, Kind(a));
        Assert.Equal(original, Checkpoint(state));
        Assert.Equal(firstWindow.Id, pending.Window!.Id);
        Assert.Equal(firstWindow.ClosesAt, pending.Window.ClosesAt);
        Assert.Equal(decisions[b - 1].OptionId, Option(pending, b, Kind(b)).OptionId);
        Assert.Equal(Checkpoint(ChangshaEngine.ViewPublic(state)), Checkpoint(ChangshaEngine.ViewPublic(pending)));
        Assert.Empty(ChangshaEngine.ViewSeat(pending, a).LegalOptions);
        var resume = RoundTrip(pending);
        var ended = Select(Select(resume, b, Kind(b)), c, Kind(c));
        Assert.Equal(Checkpoint(Select(Select(pending, b, Kind(b)), c, Kind(c))), Checkpoint(ended));
        Assert.Equal(3, Assert.Single(ended.Settlement!.Winners).Seat);
        Assert.Equal(3, ended.Settlement.NextDealerSeat);
        Assert.Equal(0, ended.Settlement.SourceSeat);
        Assert.Equal(firstWindow.Trigger, ended.ClaimedWinTile);
        Assert.DoesNotContain(ended.ClaimedWinTile!.Value, ended.Seats[0].Discards);
        AssertBalanced(ended.Settlement, -1, 0, 0, 1);
        Assert.Equal(new PayerTransfer(0, 3, 1, "win"), Assert.Single(ended.Settlement.Transfers));
    }

    [Fact]
    public void AllWinningSeatsSettleInTableOrderWithOnePhysicalTile()
    {
        const string heldOne = "b3 b4 b5 b6 b7 c1 c2 c2 c2 c3";
        const string heldThree = "b3 b4 c4 c5 c5 c5 c6 d4 d5 d6";
        var state = Select(AtTurn(["b5", heldOne, PengTwo, heldThree], "c4 b9 c7", dealer: 2,
            melds: [new(1, "chi", "d1 d2 d3", 0), new(3, "chi", "d7 d8 d9", 2)]), 0, "discard", "b5");
        var first = Select(Select(state, 3, "hu"), 1, "hu");
        var second = Select(Select(state, 1, "hu"), 3, "hu");
        Assert.Null(ChangshaEngine.ViewPublic(first).Settlement);
        Assert.Equal(Checkpoint(Expire(first)), Checkpoint(Expire(second)));
        var ended = Expire(first);
        var settlement = ended.Settlement!;
        Assert.Equal(new[] { 1, 3 }, settlement.Winners.Select(winner => winner.Seat));
        Assert.All(settlement.Winners, winner => Assert.Equal("b5", Assert.Single(winner.WinningTiles)));
        Assert.Equal("c4", Assert.Single(settlement.Birds));
        Assert.Equal(new PayerTransfer[] { new(0, 1, 2, "win"), new(0, 3, 1, "win") }, settlement.Transfers);
        Assert.Equal(state.Window!.Trigger, ended.ClaimedWinTile);
        Assert.Equal(0, settlement.NextDealerSeat);
        AssertBalanced(settlement, -3, 2, 0, 1);

        var winners = ChangshaEngine.ViewPublic(ended).Settlement!.Winners;
        Assert.Equal(new[] { 1, 3 }, winners.Select(winner => winner.Seat));
        Assert.All(winners, winner => Assert.Equal("b5", Assert.Single(winner.WinningTiles)));
        Assert.Equal(heldOne.Split(' '), winners[0].WinningHand.ConcealedTiles);
        Assert.Equal(heldThree.Split(' '), winners[1].WinningHand.ConcealedTiles);
        var oneMeld = Assert.Single(winners[0].WinningHand.Melds);
        var threeMeld = Assert.Single(winners[1].WinningHand.Melds);
        Assert.Equal(("chi", null, 0), (oneMeld.Kind, oneMeld.Method, oneMeld.FromSeat));
        Assert.Equal(("chi", null, 2), (threeMeld.Kind, threeMeld.Method, threeMeld.FromSeat));
        Assert.Equal(new[] { "d1", "d2", "d3" }, oneMeld.Tiles);
        Assert.Equal(new[] { "d7", "d8", "d9" }, threeMeld.Tiles);
    }

    [Fact]
    public void PassingHuBlocksOnlyTheSameFaceUntilTheSeatDraws()
    {
        var state = Select(AtTurn(
        [
            "b5",
            "b2 b3 b4 b5 b7 b8 c1 c4 c7 c9 d2 d5 d7",
            WaitThree,
            ""
        ], "d1 b9 d2 b7"), 0, "discard", "b5");
        var chi = Select(Select(state, 2, "pass"), 1, "chi", "b3");
        if (chi.Window!.Kind == DecisionKind.Discard)
            chi = Expire(chi);
        Assert.Equal(Tiles.Parse("b5"), Assert.Single(chi.Seats[2].PassedWinFaces));
        var otherFace = Select(chi, 1, "discard", "b2");
        Assert.True(Has(otherFace, 2, "hu"));
        var sameFace = Select(chi, 1, "discard", "b5");
        Assert.False(Has(sameFace, 2, "hu"));
        if (sameFace.Window!.Kind == DecisionKind.Discard)
            sameFace = Expire(sameFace);
        Assert.Equal(2, ChangshaEngine.ViewPublic(sameFace).TurnSeat);
        Assert.Empty(sameFace.Seats[2].PassedWinFaces);
        Assert.NotEmpty(chi.Seats[2].PassedWinFaces);
    }
}
