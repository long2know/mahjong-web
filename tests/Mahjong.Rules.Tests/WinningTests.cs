using Mahjong.Rules;
using static Mahjong.Rules.Tests.Fixture;

namespace Mahjong.Rules.Tests;

public sealed class WinningTests
{
    private const string FourRuns = "b1 b2 b3 b4 b5 b6 c1 c2 c3 d7 d8 d9";

    [Theory]
    [InlineData("c2", true)]
    [InlineData("c5", true)]
    [InlineData("c8", true)]
    [InlineData("c1", false)]
    [InlineData("c3", false)]
    [InlineData("c4", false)]
    [InlineData("c6", false)]
    [InlineData("c7", false)]
    [InlineData("c9", false)]
    public void OrdinaryWinRequiresAGeneralPair(string pair, bool legal)
    {
        var state = AtTurn([$"{FourRuns} {pair} {pair}", "", "", ""], "b9 b8", drawn: pair);
        Assert.Equal(legal, Has(state, 0, "hu"));
        if (!legal)
            return;

        var won = Select(state, 0, "hu");
        var winner = Assert.Single(won.Settlement!.Winners);
        Assert.Equal("plain", Assert.Single(winner.Patterns).Code);
        Assert.Equal(1, Assert.Single(winner.Patterns).Points);
        Assert.Equal(new[] { pair }, winner.WinningTiles);
        Assert.Equal("selfDraw", winner.WinBy);
        Assert.Null(won.Settlement.SourceSeat);
        Assert.Equal(0, won.Settlement.NextDealerSeat);
        Assert.Equal(new[] { "b9" }, won.Settlement.Birds);
        AssertBalanced(won.Settlement, 12, -4, -4, -4);
    }

    [Theory]
    [InlineData("b1 b1 b1 c3 c3 c3 d7 d7 d7 c9 c9 c9 b4 b4", "allPungs")]
    [InlineData("b1 b1 b2 b3 b4 b2 b3 b4 b5 b6 b7 b7 b8 b9", "pureSuit")]
    [InlineData("b2 b2 b5 b8 c2 c5 c5 c8 d2 d5 d8 d8 c2 c8", "allGenerals")]
    [InlineData("b1 b1 b6 b6 c3 c3 c4 c4 c7 c7 d4 d4 d9 d9", "sevenPairs")]
    [InlineData("b1 b1 b1 b1 c3 c3 c3 c3 b5 b5 d7 d7 c9 c9", "sevenPairs luxurySevenPairs luxurySevenPairs")]
    public void StructuralExceptionsDoNotRequireAGeneralPair(string hand, string patterns)
    {
        var state = AtTurn([hand, "", "", ""], "c2 d2", dealer: 2);
        var settlement = Select(state, 0, "hu").Settlement!;
        var winner = Assert.Single(settlement.Winners);
        Assert.Equal(patterns.Split(' '), winner.Patterns.Select(pattern => pattern.Code));
        Assert.All(winner.Patterns, pattern => Assert.Equal(3, pattern.Points));
        AssertBalanced(settlement, 13 * winner.Patterns.Length, -3 * winner.Patterns.Length,
            -4 * winner.Patterns.Length, -6 * winner.Patterns.Length);
        Assert.Equal(0, settlement.NextDealerSeat);
        Assert.Equal(new[] { "c2" }, settlement.Birds);
    }

    [Theory]
    [InlineData("b1 b2 b3 b4 b5 b6 c1 c2 c3 d7 d8 c9 c5 c5")]
    [InlineData("b1 b1 b2 b2 b3 b3 c1 c1 c4 c4 d3 d3 d7 d9")]
    [InlineData("b1 b1 b3 b3 b4 b4 b5 b6 b7 b7 b8 b8 b9 b9")]
    public void InvalidShapesAreNotPromotedByRankOrSuit(string hand)
    {
        var state = AtTurn([hand, "", "", ""], "c8 c9");
        Assert.False(Has(state, 0, "hu"));
    }

    [Fact]
    public void ADeclaredMeldCountsAsOneGroupAndOnlyOpenMeldsCountTowardFullyMelded()
    {
        TestMeld[] melds =
        [
            new(0, "chi", "b1 b2 b3", 3),
            new(0, "chi", "c4 c5 c6", 3),
            new(0, "peng", "b9 b9 b9", 2),
            new(0, "bu", "d3 d3 d3 d3", 2)
        ];
        var hand = new[] { "d4 d4", "", "", "" };
        var open = AtTurn(hand, "b8 d6", melds: melds);
        var winner = Assert.Single(Select(open, 0, "hu").Settlement!.Winners);
        Assert.Equal("fullyMelded", Assert.Single(winner.Patterns).Code);
        melds[3] = melds[3] with { Method = "concealed", FromSeat = null };
        var concealed = AtTurn(hand, "b8 d6", melds: melds);
        Assert.False(Has(concealed, 0, "hu"));
    }

    [Fact]
    public void HeavenAndEarthUseTheirSpecificOpeningContexts()
    {
        var heaven = Deal([$"{FourRuns} c5 c5", "", "", ""], front: "b5");
        if (heaven.Window!.Kind == DecisionKind.Opening)
            heaven = Expire(heaven);
        var win = Select(heaven, 0, "hu").Settlement!;
        Assert.Equal("heavenly", Assert.Single(Assert.Single(win.Winners).Patterns).Code);
        AssertBalanced(win, 24, -8, -8, -8);

        var earth = Deal(["c5", $"{FourRuns} c5", "", ""], front: "d3");
        if (earth.Window!.Kind == DecisionKind.Opening)
            earth = Expire(earth);
        earth = Select(earth, 0, "discard", "c5");
        earth = Select(earth, 1, "hu");
        if (earth.Window is not null)
            earth = Expire(earth);
        var caught = earth.Settlement!;
        Assert.Equal("earthly", Assert.Single(Assert.Single(caught.Winners).Patterns).Code);
        Assert.Equal(1, caught.NextDealerSeat);
        AssertBalanced(caught, -7, 7, 0, 0);
    }
}
