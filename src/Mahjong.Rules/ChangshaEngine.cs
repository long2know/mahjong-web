using System.Collections.Immutable;

namespace Mahjong.Rules;

public static class ChangshaEngine
{
    public const string Profile = "changsha-v1";
    public const int CheckpointVersion = 1;
    public const int ShuffleVersion = Determinism.ShuffleVersion;

    public static GameState StartHand(HandStart input, DateTimeOffset gameNow)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (input.Profile != Profile)
            throw new ArgumentException($"Unsupported rules profile '{input.Profile}'.", nameof(input));
        if (input.HandNumber < 1 || !ValidSeat(input.DealerSeat) ||
            input.TurnLimit <= TimeSpan.Zero || input.ClaimLimit <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(input));
        return Deal(input, gameNow, Determinism.Shuffle(input));
    }

    internal static GameState Deal(HandStart input, DateTimeOffset gameNow, PhysicalTile[] shuffled)
    {
        var hands = Enumerable.Range(0, 4).Select(_ => new List<PhysicalTile>(14)).ToArray();
        var index = 0;
        for (var packet = 0; packet < 3; packet++)
        {
            foreach (var seat in Clockwise(input.DealerSeat))
                for (var i = 0; i < 4; i++)
                    hands[seat].Add(shuffled[index++]);
        }
        foreach (var seat in Clockwise(input.DealerSeat))
            hands[seat].Add(shuffled[index++]);
        var firstDraw = shuffled[index++];
        hands[input.DealerSeat].Add(firstDraw);
        var seats = hands.Select((hand, seat) => new SeatState(Tiles.Sort(hand),
            seat == input.DealerSeat ? firstDraw : null, [], [], [], [], [], false)).ToImmutableArray();
        var wall = shuffled.Skip(index).Select((tile, offset) => new WallTile(tile, offset + index)).ToImmutableArray();
        var now = gameNow.ToUniversalTime();
        var state = new GameState(CheckpointVersion, ShuffleVersion, input, wall, seats, null, 0,
            now, 0, null, null, [], null);

        var opening = ImmutableArray.CreateBuilder<SeatDecision>();
        foreach (var seat in Enumerable.Range(0, 4))
        {
            var awards = Winning.Opening(seats[seat].Hand);
            if (awards.IsEmpty)
                continue;
            var evidence = Tiles.Sort(awards.SelectMany(award => award.Evidence).Distinct());
            opening.Add(new(seat, [Option("reveal", evidence, evidence, awards: awards), Option("pass")], null));
        }
        return opening.Count == 0 ? BeginTurn(state, input.DealerSeat, DrawKind.Initial, now) :
            OpenWindow(state, DecisionKind.Opening, input.DealerSeat, now, opening.ToImmutable());
    }

    public static MoveResult Apply(GameState state, GameAction action, DateTimeOffset gameNow)
    {
        CheckVersion(state);
        var now = gameNow.ToUniversalTime();
        var windowId = action switch
        {
            Choose choice => choice.WindowId,
            Expire expiry => expiry.WindowId,
            _ => null
        };
        if (windowId is null)
            return new(MoveStatus.IllegalChoice, state);
        if (state.Window is not { } window || window.Id != windowId)
            return new(MoveStatus.StaleWindow, state);
        if (action is Expire)
        {
            if (now < window.ClosesAt)
                return new(MoveStatus.NotDue, state);
            // Catch up at the recorded deadline, never granting a restarted table extra time.
            return new(MoveStatus.Accepted, OnExpire(state, window, window.ClosesAt));
        }
        if (now >= window.ClosesAt)
            return new(MoveStatus.WindowElapsed, state);

        var choose = (Choose)action;
        if (now < state.AdvancedAtGameTime || !ValidSeat(choose.Seat))
            return new(MoveStatus.IllegalChoice, state);
        var decision = window.Decisions.FirstOrDefault(entry => entry.Seat == choose.Seat);
        var option = decision?.Options.FirstOrDefault(entry => entry.Id == choose.OptionId);
        if (decision is null || decision.Response is not null || option is null)
            return new(MoveStatus.IllegalChoice, state);

        state = state with { AdvancedAtGameTime = now };
        if (window.Kind == DecisionKind.Turn)
            return new(MoveStatus.Accepted, OnTurn(state, window, option, now));
        if (window.Kind == DecisionKind.LastTileOffer)
            return new(MoveStatus.Accepted, OnLastTileOffer(state, window, option, now));

        var decisions = window.Decisions.Replace(decision, decision with { Response = option.Id });
        window = window with { Decisions = decisions };
        return new(MoveStatus.Accepted, decisions.All(entry => entry.Response is not null)
            ? ResolveResponses(state, window, now)
            : state with { Window = window });
    }

    private static GameState OnExpire(GameState state, DecisionWindow window, DateTimeOffset at)
    {
        state = state with { AdvancedAtGameTime = at };
        if (window.Kind == DecisionKind.Turn)
        {
            var discard = window.Decisions[0].Options.Where(option => option.Kind == "discard").ToArray();
            var drawn = state.Seats[window.Seat].Drawn;
            return OnTurn(state, window,
                discard.FirstOrDefault(option => option.OwnTiles[0] == drawn) ?? discard[0], at);
        }
        if (window.Kind == DecisionKind.LastTileOffer)
            return OnLastTileOffer(state, window, window.Decisions[0].Options.Single(option => option.Kind == "pass"), at);

        var decisions = window.Decisions.Select(entry => entry.Response is not null ? entry :
            entry with { Response = entry.Options.Single(option => option.Kind == "pass").Id }).ToImmutableArray();
        return ResolveResponses(state, window with { Decisions = decisions }, at);
    }

    private static GameState ResolveResponses(GameState state, DecisionWindow window, DateTimeOffset at)
    {
        var responses = window.Decisions.Select(entry =>
            (entry.Seat, Option: entry.Options.Single(option => option.Id == entry.Response))).ToArray();
        if (window.Kind == DecisionKind.Opening)
        {
            foreach (var (seat, option) in responses)
            {
                if (option.Kind == "reveal")
                    state = ReplaceSeat(state, seat,
                        state.Seats[seat] with { Revealed = option.OwnTiles, OpeningAwards = option.OpeningAwards });
            }
            return BeginTurn(state, state.Start.DealerSeat, DrawKind.Initial, at);
        }

        var tile = window.Trigger!.Value;
        foreach (var response in responses)
        {
            var decision = window.Decisions.Single(entry => entry.Seat == response.Seat);
            if (response.Option.Kind == "hu" || !decision.Options.Any(option => option.Kind == "hu"))
                continue;
            var holder = state.Seats[response.Seat];
            state = ReplaceSeat(state, response.Seat, holder with { PassedWinFaces = holder.PassedWinFaces.Add(tile.FaceIndex) });
        }

        var winners = responses.Where(response => response.Option.Kind == "hu")
            .OrderBy(response => Distance(window.Seat, response.Seat)).Select(response => response.Seat).ToImmutableArray();
        if (window.Kind == DecisionKind.RobKong)
        {
            if (winners.IsEmpty)
                return CompleteAddedKong(state, window.Seat, tile, window.PendingKongKind!, at);
            state = ReplaceSeat(state, window.Seat, RemoveFromHand(state.Seats[window.Seat], [tile]));
            return Scoring.Settle(state with { ClaimedWinTile = tile }, winners, tile, window.Seat,
                window.PendingKongKind == "gang" ? WinContext.RobGang : WinContext.RobBu);
        }
        if (!winners.IsEmpty)
        {
            state = RemoveDiscard(state, window.Seat, tile);
            return Scoring.Settle(state with { ClaimedWinTile = tile }, winners, tile, window.Seat, Context(window.DrawKind));
        }

        var best = responses.Where(response => response.Option.Kind != "pass")
            .OrderByDescending(response => response.Option.Kind == "chi" ? 1 : 2)
            .ThenBy(response => Distance(window.Seat, response.Seat)).FirstOrDefault();
        if (best.Option is null)
            return NextDraw(state, Next(window.Seat), at);

        state = RemoveDiscard(state, window.Seat, tile);
        var meld = MeldFrom(best.Option, tile, window.Seat);
        var taken = AddMeld(state.Seats[best.Seat], best.Option.OwnTiles, meld);
        state = ReplaceSeat(state, best.Seat, taken);
        return best.Option.Kind is "gang" or "bu"
            ? Supplement(state, best.Seat, best.Option.Kind, at)
            : BeginTurn(state, best.Seat, DrawKind.None, at);
    }

    private static GameState OnTurn(GameState state, DecisionWindow window, DecisionOption option, DateTimeOffset at)
    {
        var seat = window.Seat;
        var holder = state.Seats[seat];
        if (option.Kind == "hu")
            return Scoring.Settle(state, [seat], holder.Drawn!.Value, null, Context(window.DrawKind));
        if (option.Kind == "discard")
        {
            var tile = option.OwnTiles[0];
            var change = RemoveFromHand(holder, [tile]) with { Discards = holder.Discards.Add(tile) };
            state = ReplaceSeat(state with { DiscardCount = state.DiscardCount + 1 }, seat, change);
            var responses = OtherTileDecisions(state, seat, tile, DecisionKind.Discard, window.DrawKind);
            return responses.IsEmpty ? NextDraw(state, Next(seat), at) :
                OpenWindow(state, DecisionKind.Discard, seat, at, responses, tile, window.DrawKind);
        }
        if (option.Method == "added")
        {
            var tile = option.OwnTiles[0];
            var responses = OtherTileDecisions(state, seat, tile, DecisionKind.RobKong, DrawKind.None);
            return responses.IsEmpty ? CompleteAddedKong(state, seat, tile, option.Kind, at) :
                OpenWindow(state, DecisionKind.RobKong, seat, at, responses, tile, pendingKongKind: option.Kind);
        }

        var formed = AddMeld(holder, option.OwnTiles, MeldFrom(option, null, null));
        return Supplement(ReplaceSeat(state, seat, formed), seat, option.Kind, at);
    }

    private static GameState NextDraw(GameState state, int seat, DateTimeOffset at) => state.Wall.Length switch
    {
        0 => Scoring.SettleDraw(state),
        1 => LastTileOffer(state with { LastTileSeat = seat }, seat, 0, at),
        _ => Draw(state, seat, 0, DrawKind.Ordinary, at)
    };

    private static GameState LastTileOffer(GameState state, int seat, int previousOffers, DateTimeOffset at) =>
        OpenWindow(state, DecisionKind.LastTileOffer, seat, at,
            [new(seat, [Option("draw"), Option("pass")], null)], lastTileOffers: previousOffers);

    private static GameState OnLastTileOffer(GameState state, DecisionWindow window, DecisionOption option, DateTimeOffset at)
    {
        if (option.Kind == "draw")
            return Draw(state with { LastTileSeat = window.Seat }, window.Seat, 0, DrawKind.LastTile, at);
        return window.LastTileOffers == 3 ? Scoring.SettleDraw(state) :
            LastTileOffer(state, Next(window.Seat), window.LastTileOffers + 1, at);
    }

    private static GameState Draw(GameState state, int seat, int wallIndex, DrawKind kind, DateTimeOffset at)
    {
        var tile = state.Wall[wallIndex].Tile;
        var change = state.Seats[seat] with
        {
            Hand = Tiles.Sort(state.Seats[seat].Hand.Add(tile)),
            Drawn = tile,
            PassedWinFaces = [],
            FrozenAfterGang = state.Seats[seat].FrozenAfterGang || kind == DrawKind.RolledSupplement
        };
        state = ReplaceSeat(state with { Wall = state.Wall.RemoveAt(wallIndex) }, seat, change);
        return BeginTurn(state, seat, kind, at);
    }

    private static GameState Supplement(GameState state, int seat, string kind, DateTimeOffset at)
    {
        if (state.Wall.Length == 1)
            state = state with { LastTileSeat = seat };
        var tail = state.Wall.Length - 1;
        if (kind == "bu")
            return Draw(state, seat, tail, DrawKind.Supplement, at);

        var stack = state.Wall[tail].Slot / 2;
        var rolled = Determinism.RollLowerDie(state.Start, state.WindowNumber);
        for (var i = tail - 1; i >= 0; i--)
        {
            var candidate = state.Wall[i].Slot / 2;
            if (candidate == stack)
                continue;
            stack = candidate;
            if (--rolled == 0)
                return Draw(state, seat, i, DrawKind.RolledSupplement, at);
        }
        return Draw(state, seat, tail, DrawKind.RolledSupplement, at);
    }

    private static GameState CompleteAddedKong(GameState state, int seat, PhysicalTile tile, string kind, DateTimeOffset at)
    {
        var holder = state.Seats[seat];
        var updated = Upgrade(holder, Option(kind, [tile], method: "added"));
        return Supplement(ReplaceSeat(state, seat, updated), seat, kind, at);
    }

    internal static GameState BeginTurn(GameState state, int seat, DrawKind draw, DateTimeOffset at)
    {
        var holder = state.Seats[seat];
        var options = ImmutableArray.CreateBuilder<DecisionOption>();
        if (holder.Drawn is { } currentDraw && Winning.IsWinning(holder, null))
            options.Add(Option("hu", [currentDraw], [currentDraw]));

        var forcedDiscard = draw == DrawKind.LastTile || holder.FrozenAfterGang;
        var discards = forcedDiscard ? [holder.Drawn!.Value] : holder.Hand;
        foreach (var tile in discards)
            options.Add(Option("discard", [tile], [tile]));

        if (!forcedDiscard && state.Wall.Length > 0 && holder.Drawn is { } drawn)
        {
            foreach (var group in holder.Hand.GroupBy(tile => tile.FaceIndex).Where(group => group.Count() == 4))
            {
                var tiles = group.ToImmutableArray();
                AddKongOptions(options, holder, Option("bu", tiles, tiles, "concealed"), null, null);
            }
            var peng = holder.Melds.FirstOrDefault(meld => meld.Kind == "peng" && meld.Tiles[0].FaceIndex == drawn.FaceIndex);
            if (peng is not null)
            {
                var added = Option("bu", [drawn], Tiles.Sort(peng.Tiles.Add(drawn)), "added");
                AddKongOptions(options, holder, added, null, null);
            }
        }
        return OpenWindow(state, DecisionKind.Turn, seat, at, [new(seat, options.ToImmutable(), null)], drawKind: draw);
    }

    private static ImmutableArray<SeatDecision> OtherTileDecisions(GameState state, int source, PhysicalTile trigger,
        DecisionKind kind, DrawKind draw)
    {
        var decisions = ImmutableArray.CreateBuilder<SeatDecision>();
        var face = trigger.FaceIndex;
        var huOnly = kind == DecisionKind.RobKong || draw is DrawKind.LastTile or DrawKind.RolledSupplement ||
            state.Wall.IsEmpty;
        foreach (var seat in Clockwise(Next(source)).Take(3))
        {
            var holder = state.Seats[seat];
            var options = ImmutableArray.CreateBuilder<DecisionOption>();
            if (!holder.PassedWinFaces.Contains(face) && Winning.IsWinning(holder, face))
                options.Add(Option("hu", preview: [trigger]));

            if (!huOnly && !holder.FrozenAfterGang)
            {
                var matching = holder.Hand.Where(tile => tile.FaceIndex == face).ToImmutableArray();
                if (matching.Length >= 2)
                {
                    var peng = matching[..2];
                    options.Add(Option("peng", peng, Tiles.Sort(peng.Add(trigger)), "open"));
                }
                if (matching.Length == 3)
                {
                    var open = Option("bu", matching, Tiles.Sort(matching.Add(trigger)), "open");
                    AddKongOptions(options, holder, open, trigger, source);
                }
                if (seat == Next(source))
                    AddChiOptions(options, holder, trigger);
            }
            if (options.Count != 0)
            {
                options.Add(Option("pass"));
                decisions.Add(new(seat, options.ToImmutable(), null));
            }
        }
        return decisions.ToImmutable();
    }

    private static void AddKongOptions(ImmutableArray<DecisionOption>.Builder options, SeatState holder,
        DecisionOption bu, PhysicalTile? claimed, int? source)
    {
        options.Add(bu);
        var simulated = bu.Method == "added" ? Upgrade(holder, bu) :
            AddMeld(holder, bu.OwnTiles, MeldFrom(bu, claimed, source));
        if (Winning.IsReady(simulated))
            options.Add(bu with { Kind = "gang" });
    }

    private static void AddChiOptions(ImmutableArray<DecisionOption>.Builder options, SeatState holder, PhysicalTile trigger)
    {
        var face = trigger.FaceIndex;
        var firstInSuit = Tiles.Suit(face) * 9;
        for (var start = Math.Max(firstInSuit, face - 2); start <= Math.Min(face, firstInSuit + 6); start++)
        {
            var own = ImmutableArray.CreateBuilder<PhysicalTile>(2);
            for (var candidate = start; candidate < start + 3; candidate++)
            {
                if (candidate == face)
                    continue;
                own.AddRange(holder.Hand.Where(tile => tile.FaceIndex == candidate).Take(1));
            }
            if (own.Count == 2)
            {
                var tiles = own.MoveToImmutable();
                options.Add(Option("chi", tiles, Tiles.Sort(tiles.Add(trigger)), "open"));
            }
        }
    }

    private static DecisionOption Option(string kind, ImmutableArray<PhysicalTile> own = default,
        ImmutableArray<PhysicalTile> preview = default, string? method = null, ImmutableArray<OpeningAward> awards = default) =>
        new("", kind, own.IsDefault ? [] : own, preview.IsDefault ? [] : preview, method, awards.IsDefault ? [] : awards);

    private static GameState OpenWindow(GameState state, DecisionKind kind, int seat, DateTimeOffset at,
        ImmutableArray<SeatDecision> decisions, PhysicalTile? trigger = null, DrawKind drawKind = DrawKind.None,
        int lastTileOffers = 0, string? pendingKongKind = null)
    {
        var sequence = checked(state.WindowNumber + 1);
        var bound = decisions.Select(decision => decision with
        {
            Options = decision.Options.Select((option, index) => option with
            {
                Id = Determinism.OptionId(state.Start, decision.Seat, sequence, index)
            }).ToImmutableArray()
        }).ToImmutableArray();
        var duration = kind == DecisionKind.Turn ? state.Start.TurnLimit : state.Start.ClaimLimit;
        return state with
        {
            WindowNumber = sequence,
            Window = new(Determinism.WindowId(state.Start, sequence), kind, seat, at + duration,
                trigger, lastTileOffers, drawKind, pendingKongKind, bound)
        };
    }

    private static Meld MeldFrom(DecisionOption option, PhysicalTile? claimed, int? source) =>
        new(option.Kind, option.Method!, source,
            claimed is { } tile ? Tiles.Sort(option.OwnTiles.Add(tile)) : option.OwnTiles);

    private static SeatState AddMeld(SeatState seat, ImmutableArray<PhysicalTile> own, Meld meld) =>
        RemoveFromHand(seat, own) with { Melds = seat.Melds.Add(meld) };

    private static SeatState Upgrade(SeatState holder, DecisionOption option)
    {
        var drawn = option.OwnTiles[0];
        var peng = holder.Melds.Single(meld => meld.Kind == "peng" && meld.Tiles[0].FaceIndex == drawn.FaceIndex);
        var complete = peng with { Kind = option.Kind, Method = "added", Tiles = Tiles.Sort(peng.Tiles.Add(drawn)) };
        return RemoveFromHand(holder, option.OwnTiles) with { Melds = holder.Melds.Replace(peng, complete) };
    }

    private static SeatState RemoveFromHand(SeatState seat, ImmutableArray<PhysicalTile> own) => seat with
    {
        Hand = seat.Hand.RemoveRange(own),
        Revealed = seat.Revealed.RemoveRange(own),
        Drawn = null
    };

    private static GameState RemoveDiscard(GameState state, int seat, PhysicalTile tile)
    {
        var holder = state.Seats[seat];
        return ReplaceSeat(state, seat, holder with { Discards = holder.Discards.Remove(tile) });
    }

    private static GameState ReplaceSeat(GameState state, int seat, SeatState change) =>
        state with { Seats = state.Seats.SetItem(seat, change) };

    private static WinContext Context(DrawKind draw) => draw switch
    {
        DrawKind.Initial => WinContext.Initial,
        DrawKind.LastTile => WinContext.LastTile,
        DrawKind.RolledSupplement => WinContext.RolledSupplement,
        DrawKind.Supplement => WinContext.Supplement,
        _ => WinContext.Ordinary
    };

    private static bool ValidSeat(int seat) => (uint)seat < 4;
    private static int Next(int seat) => (seat + 1) % 4;
    private static int Distance(int from, int to) => (to - from + 4) % 4;
    private static IEnumerable<int> Clockwise(int first) => Enumerable.Range(0, 4).Select(offset => (first + offset) % 4);

    private static void CheckVersion(GameState state)
    {
        ArgumentNullException.ThrowIfNull(state);
        if (state.CheckpointVersion != CheckpointVersion || state.ShuffleVersion != ShuffleVersion ||
            state.Start.Profile != Profile)
            throw new NotSupportedException("Unsupported Changsha rules checkpoint or profile.");
    }

    public static PublicView ViewPublic(GameState state)
    {
        CheckVersion(state);
        var seats = state.Seats.Select((holder, seat) => new PublicSeat(seat, holder.Hand.Length,
            [.. holder.Discards.Select(Tiles.Face)], [.. holder.Melds.Select(ProjectMeld)],
            [.. holder.Revealed.Select(Tiles.Face)])).ToImmutableArray();
        var window = state.Window;
        var turn = window?.Kind is DecisionKind.Turn or DecisionKind.LastTileOffer;
        return new(state.Start.HandNumber, state.Start.DealerSeat,
            window is null ? "settled" : turn ? "turn" : "claim", turn ? window!.Seat : null, state.Wall.Length,
            seats, window is null ? null : new(window.Id, Reason(window), window.ClosesAt,
                window.Trigger is { } tile ? new(window.Seat, [Tiles.Face(tile)]) : null), state.Settlement);
    }

    private static PublicMeld ProjectMeld(Meld meld) => new(meld.Kind, meld.FromSeat,
        [.. meld.Tiles.Select(tile => meld.Method == "concealed" ? null : Tiles.Face(tile))],
        meld.Kind is "gang" or "bu" ? meld.Method : null);

    private static string Reason(DecisionWindow window) => window.Kind switch
    {
        DecisionKind.Opening => "opening",
        DecisionKind.RobKong => "kong",
        DecisionKind.LastTileOffer => "lastTile",
        _ when window.DrawKind == DrawKind.LastTile => "lastTile",
        DecisionKind.Discard when window.DrawKind == DrawKind.RolledSupplement => "kong",
        DecisionKind.Discard => "discard",
        _ => "turn"
    };

    public static SeatView ViewSeat(GameState state, int seat)
    {
        CheckVersion(state);
        if (!ValidSeat(seat))
            throw new ArgumentOutOfRangeException(nameof(seat));
        var holder = state.Seats[seat];
        string Id(PhysicalTile tile) => Determinism.TileId(state.Start, seat, tile);
        var hand = holder.Hand.Select(tile => new HandTile(Id(tile), Tiles.Face(tile))).ToImmutableArray();
        var decision = state.Window?.Decisions.FirstOrDefault(entry => entry.Seat == seat && entry.Response is null);
        var options = decision is null ? [] : decision.Options.Select(option =>
            new LegalOption(option.Id, option.Kind, [.. option.OwnTiles.Select(Id)], [.. option.Preview.Select(Tiles.Face)]))
            .ToImmutableArray();
        return new(seat, hand, holder.Drawn is { } drawn && state.Window is not null ? Id(drawn) : null, options);
    }
}
