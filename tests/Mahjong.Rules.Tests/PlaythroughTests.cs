using Mahjong.Rules;
using Xunit.Abstractions;
using static Mahjong.Rules.Tests.Fixture;

namespace Mahjong.Rules.Tests;

public sealed class PlaythroughTests(ITestOutputHelper output)
{
    [Theory]
    [InlineData(1)]
    [InlineData(19)]
    [InlineData(2026)]
    [InlineData(65537)]
    public void FourSeededBotsReplayRealFourHandMatches(int series)
    {
        var first = Play(series);
        var second = Play(series);
        Assert.Equal(first.trace, second.trace);
        Assert.Equal(first.hands, second.hands);
        Assert.All(first.hands, hand => Assert.True(hand.steps >= 10));
        Assert.Contains(first.hands, hand => hand.outcome == "win");
        Assert.Contains(first.trace, entry => entry.Contains("/chi/") || entry.Contains("/peng/"));
        Assert.Contains(first.trace, entry => entry.Contains("/discard/"));

        output.WriteLine($"Series {series}: {string.Join("; ", first.hands.Select(hand =>
            $"#{hand.number} D{hand.dealer} → D{hand.nextDealer} {hand.outcome} ({hand.ways}), {hand.steps} legal moves"))}");
    }

    private static (List<string> trace, List<HandSummary> hands) Play(int series)
    {
        List<string> trace = [];
        List<HandSummary> hands = [];
        HashSet<string> windowIds = [];
        var dealer = 0;
        var now = Now;
        for (var hand = 1; hand <= 4; hand++)
        {
            var seed = new RoundSeed((ulong)series * 256 + (ulong)hand,
                0x9e3779b97f4a7c15ul ^ (ulong)(series * hand));
            var settings = Start(dealer, hand, seed);
            var state = ChangshaEngine.StartHand(settings, now);
            AssertInventory(state);
            Assert.Equal(dealer, ChangshaEngine.ViewPublic(state).DealerSeat);
            var step = 0;
            string? previousWindow = null;
            while (state.Window is not null && step < 300)
            {
                var table = ChangshaEngine.ViewPublic(state);
                var windowId = table.Window!.WindowId;
                if (windowId != previousWindow)
                    Assert.True(windowIds.Add(windowId));
                previousWindow = windowId;
                var decision = Enumerable.Range(0, 4).Select(seat => ChangshaEngine.ViewSeat(state, seat))
                    .Select(view => (view, choice: BotPolicy.Pick(table, view)))
                    .FirstOrDefault(candidate => candidate.choice is not null);
                Assert.NotNull(decision.choice);
                Assert.NotNull(decision.view);
                var option = Assert.Single(decision.view.LegalOptions, legal => legal.OptionId == decision.choice);
                Assert.All(option.TileIds, id => Assert.Contains(decision.view.Hand, tile => tile.TileId == id));
                Assert.Equal(decision.choice, BotPolicy.Pick(table, decision.view));
                trace.Add($"{hand}/{decision.view.Seat}/{option.Kind}/{windowId}/{option.OptionId}");
                now = now.AddMilliseconds(10);
                state = Move(state, new Choose(decision.view.Seat, windowId, decision.choice), now);
                if (step % 17 == 0)
                    state = RoundTrip(state);
                step++;
            }
            Assert.Null(state.Window);
            var settlement = Assert.IsType<Settlement>(state.Settlement);
            AssertBalanced(settlement);
            if (settlement.Reason == "win")
            {
                Assert.NotEmpty(settlement.Winners);
                Assert.All(settlement.Winners, winner =>
                {
                    Assert.NotEmpty(winner.Patterns);
                    var physical = settlement.SourceSeat.HasValue ? state.ClaimedWinTile : state.Seats[winner.Seat].Drawn;
                    Assert.Equal(Tiles.Face(physical!.Value), Assert.Single(winner.WinningTiles));
                    Assert.Contains(settlement.Transfers, transfer => transfer.Reason == "win" && transfer.ToSeat == winner.Seat);
                });
            }
            else
            {
                Assert.Equal("draw", settlement.Reason);
                Assert.Empty(settlement.Winners);
                Assert.Empty(settlement.Birds);
                Assert.All(settlement.Transfers, transfer => Assert.Equal("opening", transfer.Reason));
            }
            hands.Add(new(hand, dealer, settlement.NextDealerSeat, settlement.Reason,
                string.Join(",", settlement.Winners.Select(winner => $"{winner.Seat}:{winner.WinBy}")), step));
            trace.Add(Checkpoint(settlement));
            dealer = settlement.NextDealerSeat;
        }
        var rematch = ChangshaEngine.StartHand(Start(seed: new((ulong)series, 0xA1B2C3D4)), now);
        Assert.NotNull(rematch.Window);
        Assert.DoesNotContain(rematch.Window!.Id, windowIds);
        Assert.Null(rematch.Settlement);
        Assert.Equal(1, ChangshaEngine.ViewPublic(rematch).HandNumber);
        Assert.Equal(0, ChangshaEngine.ViewPublic(rematch).DealerSeat);
        return (trace, hands);
    }

    private sealed record HandSummary(int number, int dealer, int nextDealer, string outcome, string ways, int steps);
}
