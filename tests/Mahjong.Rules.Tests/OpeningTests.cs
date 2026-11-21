using Mahjong.Rules;
using static Mahjong.Rules.Tests.Fixture;

namespace Mahjong.Rules.Tests;

public sealed class OpeningTests
{
    [Fact]
    public void OpeningRevealsOnlyAfterResolutionAndPaysWithoutEndingHand()
    {
        var initial = Deal(
        [
            "b1 b1 b1 b1 c3 c3 c3 b4 b5 c6 c7 d7 d8 d9",
            "b2 b2 b3 b4 b5 b6 c2 c4 c5 c6 c7 c8 c9",
            "",
            ""
        ]);
        var publicOpening = ChangshaEngine.ViewPublic(initial);
        Assert.Null(publicOpening.Settlement);
        var opening = publicOpening.Window!;
        Assert.Equal("opening", opening.Reason);
        Assert.Null(opening.Trigger);
        Assert.Equal(Now + initial.Start.ClaimLimit, opening.ClosesAtGameTime);
        Assert.Equal(new[] { "b1", "b1", "b1", "b1", "c3", "c3", "c3" }, Option(initial, 0, "reveal").Faces);
        Assert.Equal(13, Option(initial, 1, "reveal").Faces.Length);
        var otherBefore = Checkpoint(ChangshaEngine.ViewSeat(initial, 1));
        var pending = Select(initial, 0, "reveal");
        Assert.Equal(Checkpoint(ChangshaEngine.ViewPublic(initial)), Checkpoint(ChangshaEngine.ViewPublic(pending)));
        Assert.Equal(otherBefore, Checkpoint(ChangshaEngine.ViewSeat(pending, 1)));
        Assert.Empty(ChangshaEngine.ViewSeat(pending, 0).LegalOptions);
        Assert.NotEmpty(ChangshaEngine.ViewSeat(initial, 0).LegalOptions);
        var duplicate = ChangshaEngine.Apply(pending, new Choose(0, opening.WindowId, Option(initial, 0, "pass").OptionId), Now);
        Assert.Equal(MoveStatus.IllegalChoice, duplicate.Status);
        Assert.Same(pending, duplicate.State);

        var restored = RoundTrip(pending);
        var continued = Expire(restored);
        Assert.Equal(Checkpoint(Expire(pending)), Checkpoint(continued));
        var gameplay = ChangshaEngine.ViewPublic(continued);
        Assert.Equal("turn", gameplay.Phase);
        Assert.Equal(0, gameplay.TurnSeat);
        Assert.Null(gameplay.Settlement);
        Assert.Equal(55, gameplay.WallCount);
        Assert.Equal(7, gameplay.Seats[0].RevealedTiles.Length);
        Assert.Empty(gameplay.Seats[1].RevealedTiles);

        var ended = TimeoutHand(continued);
        Assert.Equal("draw", ended.Settlement!.Reason);
        Assert.Empty(ended.Settlement.Birds);
        Assert.Empty(ended.Settlement.Winners);
        Assert.All(ended.Settlement.Transfers, transfer => Assert.Equal("opening", transfer.Reason));
        AssertBalanced(ended.Settlement, 12, -4, -4, -4);
        var publicDraw = ChangshaEngine.ViewPublic(ended);
        Assert.Null(publicDraw.KongRoll);
        Assert.Equal("draw", publicDraw.Settlement!.Reason);
        Assert.Empty(publicDraw.Settlement.Winners);
    }

    [Fact]
    public void TwoSeatsCanRevealOpeningEvidenceWithoutRacingEachOther()
    {
        var initial = Deal(
        [
            "b1 b1 b1 b1 c3 c3 c3 b4 b5 c6 c7 d7 d8 d9",
            "b3 b4 b6 b7 b9 c1 c4 c6 c9 d1 d3 d4 d6",
            "",
            ""
        ]);
        Assert.Equal(new[] { "noGenerals" }, initial.Window!.Decisions.Single(entry => entry.Seat == 1).Options
            .Single(option => option.Kind == "reveal").OpeningAwards.Select(award => award.Code));
        var first = Select(Select(initial, 0, "reveal"), 1, "reveal");
        var second = Select(Select(initial, 1, "reveal"), 0, "reveal");
        if (first.Window!.Kind == DecisionKind.Opening)
        {
            first = Expire(first);
            second = Expire(second);
        }
        Assert.Equal(Checkpoint(first), Checkpoint(second));
        Assert.Equal(13, ChangshaEngine.ViewPublic(first).Seats[1].RevealedTiles.Length);
        AssertBalanced(TimeoutHand(first).Settlement!, 10, 0, -5, -5);
    }
}
