using Mahjong.Rules;
using static Mahjong.Rules.Tests.Fixture;

namespace Mahjong.Rules.Tests;

public sealed class ClaimTests
{
    private const string ChiOnly = "b3 b4 b6 c1 c1 c6 c8 c9 d1 d4 d6 d7 d9";
    private const string WaitOne = "b3 b4 c1 c2 c3 d1 d2 d3 d7 d8 d9 c2 c2";
    private const string WaitThree = "b3 b4 c4 c5 c6 d4 d5 d6 d7 d8 d9 c5 c5";
    private const string PengTwo = "b5 b5 b1 b2 b6 b7 d9 d3 d4 c5 c8 c8 c9";

    [Fact]
    public void ChiIsNextSeatOnlyAndPengTakesPriority()
    {
        var state = Select(AtTurn(["b5", ChiOnly, PengTwo, WaitThree], "c4 b9 c7", dealer: 2), 0, "discard", "b5");
        var window = ChangshaEngine.ViewPublic(state).Window!;
        Assert.Equal("discard", window.Reason);
        Assert.Equal(0, window.Trigger!.Seat);
        Assert.Equal(new[] { "b5" }, window.Trigger.Faces);
        Assert.True(Has(state, 1, "chi"));
        Assert.True(Has(state, 2, "peng"));
        Assert.False(Has(state, 3, "chi"));
        Assert.True(Has(state, 3, "hu"));
        Assert.False(Has(state, 0, "peng"));
        var chi = Select(state, 1, "chi", "b3");
        var peng = Select(Select(chi, 2, "peng"), 3, "pass");
        var publicMeld = Assert.Single(ChangshaEngine.ViewPublic(peng).Seats[2].Melds);
        Assert.Equal(new[] { "b5", "b5", "b5" }, publicMeld.Tiles);
        Assert.Equal("peng", publicMeld.Kind);
        Assert.Equal(0, publicMeld.FromSeat);
        Assert.Null(publicMeld.Method);
        Assert.Equal(2, ChangshaEngine.ViewPublic(peng).TurnSeat);
        Assert.Null(ChangshaEngine.ViewSeat(peng, 2).DrawnTileId);
        Assert.DoesNotContain(state.Window!.Trigger!.Value, peng.Seats[0].Discards);
        Assert.Empty(peng.Seats[1].Melds);

        var chiWon = Select(Select(chi, 2, "pass"), 3, "pass");
        Assert.Equal("chi", Assert.Single(chiWon.Seats[1].Melds).Kind);
        Assert.Equal(1, ChangshaEngine.ViewPublic(chiWon).TurnSeat);
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
        var state = Select(AtTurn(["b5", WaitOne, PengTwo, WaitThree], "c4 b9 c7", dealer: 2), 0, "discard", "b5");
        var first = Select(Select(state, 3, "hu"), 1, "hu");
        var second = Select(Select(state, 1, "hu"), 3, "hu");
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
