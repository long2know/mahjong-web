using System.Collections.Immutable;

namespace Mahjong.Rules;

public static class BotPolicy
{
    private static readonly string[] Immediate = ["hu", "reveal", "draw", "gang"];

    public static string? Pick(PublicView table, SeatView seat)
    {
        if (seat.LegalOptions.IsEmpty || table.Window is null)
            return null;
        foreach (var kind in Immediate)
        {
            var preferred = seat.LegalOptions.FirstOrDefault(option => option.Kind == kind);
            if (preferred is not null)
                return preferred.OptionId;
        }

        var privateFaces = seat.Hand.ToDictionary(tile => tile.TileId, tile => Tiles.Parse(tile.Face));
        var counts = new int[Tiles.FaceCount];
        foreach (var face in privateFaces.Values)
            counts[face]++;
        var known = VisibleTiles(table, seat.Seat);
        var melds = table.Seats[seat.Seat].Melds;
        var baseline = SeatValue(counts, melds);
        string? pass = null;
        string? bestDiscard = null;
        var bestDiscardCost = int.MaxValue;
        string? bestMeld = null;
        var bestMeldCost = int.MaxValue;
        foreach (var option in seat.LegalOptions)
        {
            if (option.Kind == "pass")
            {
                pass = option.OptionId;
                continue;
            }
            if (option.Kind == "discard")
            {
                var face = privateFaces[option.TileIds[0]];
                counts[face]--;
                var cost = SeatValue(counts, melds) - Math.Min(known[face], 3);
                counts[face]++;
                if (cost < bestDiscardCost)
                {
                    bestDiscard = option.OptionId;
                    bestDiscardCost = cost;
                }
                continue;
            }

            var after = (int[])counts.Clone();
            foreach (var id in option.TileIds)
                after[privateFaces[id]]--;
            var adding = option.Kind == "bu" && option.TileIds.Length == 1;
            var publicMeld = new PublicMeld(option.Kind, null, [.. option.Faces], null);
            var group = adding ? melds.Select(meld =>
                meld.Kind == "peng" && meld.Tiles[0] == option.Faces[0] ? publicMeld : meld).ToImmutableArray() :
                melds.Add(publicMeld);
            var meldCost = option.Kind is "chi" or "peng" ? AfterDiscard(after, group) : SeatValue(after, group);
            if (meldCost < bestMeldCost)
            {
                bestMeldCost = meldCost;
                bestMeld = option.OptionId;
            }
        }
        if (bestDiscard is not null)
            return bestMeldCost <= bestDiscardCost ? bestMeld : bestDiscard;
        return bestMeldCost < baseline ? bestMeld : pass;
    }

    private static int[] VisibleTiles(PublicView table, int ownSeat)
    {
        var counts = new int[Tiles.FaceCount];
        foreach (var seat in table.Seats)
        {
            foreach (var face in seat.Discards.Concat(seat.Melds.SelectMany(meld => meld.Tiles)).OfType<string>())
                counts[Tiles.Parse(face)]++;
            if (seat.Seat != ownSeat)
                foreach (var face in seat.RevealedTiles)
                    counts[Tiles.Parse(face)]++;
        }
        return counts;
    }

    private static int AfterDiscard(int[] counts, ImmutableArray<PublicMeld> groups)
    {
        var best = int.MaxValue;
        for (var face = 0; face < counts.Length; face++)
        {
            if (counts[face] == 0)
                continue;
            counts[face]--;
            best = Math.Min(best, SeatValue(counts, groups));
            counts[face]++;
        }
        return best;
    }

    private static int SeatValue(int[] counts, ImmutableArray<PublicMeld> groups)
    {
        var distance = ShapeDistance(counts, groups.Length, 0, false, 0);
        if (groups.IsEmpty)
            distance = Math.Min(distance, 6 - counts.Sum(count => count / 2));
        if (groups.All(meld => meld.Kind != "chi"))
        {
            var triplets = counts.Count(count => count >= 3);
            var pairs = counts.Count(count => count == 2);
            var missing = 4 - groups.Length - triplets;
            var tripletDistance = missing * 2 - Math.Min(missing + 1, pairs);
            distance = Math.Min(distance, tripletDistance);
        }
        var neighbors = 0;
        for (var face = 0; face < counts.Length; face++)
        {
            if (counts[face] == 0)
                continue;
            if (counts[face] > 1)
                neighbors += 2;
            if (Tiles.Rank(face) < 9 && counts[face + 1] > 0)
                neighbors += 2;
            if (Tiles.Rank(face) < 8 && counts[face + 2] > 0)
                neighbors++;
        }
        return distance * 100 - neighbors;
    }

    private static int ShapeDistance(int[] counts, int groups, int partial, bool eye, int start)
    {
        while (start < counts.Length && counts[start] == 0)
            start++;
        var missing = 4 - groups;
        if (start == counts.Length)
            return missing * 2 - Math.Min(missing, partial) - (eye ? 1 : 0);

        counts[start]--;
        var best = ShapeDistance(counts, groups, partial, eye, start);
        if (counts[start] > 0)
        {
            counts[start]--;
            if (!eye && Tiles.IsGeneral(start))
                best = Math.Min(best, ShapeDistance(counts, groups, partial, true, start));
            if (partial < 4)
                best = Math.Min(best, ShapeDistance(counts, groups, partial + 1, eye, start));
            if (missing > 0 && counts[start] > 0)
            {
                counts[start]--;
                best = Math.Min(best, ShapeDistance(counts, groups + 1, partial, eye, start));
                counts[start]++;
            }
            counts[start]++;
        }
        var rank = Tiles.Rank(start);
        if (partial < 4)
        {
            if (rank < 9 && counts[start + 1] > 0)
            {
                counts[start + 1]--;
                best = Math.Min(best, ShapeDistance(counts, groups, partial + 1, eye, start));
                counts[start + 1]++;
            }
            if (rank < 8 && counts[start + 2] > 0)
            {
                counts[start + 2]--;
                best = Math.Min(best, ShapeDistance(counts, groups, partial + 1, eye, start));
                counts[start + 2]++;
            }
        }
        if (missing > 0 && rank < 8 && counts[start + 1] > 0 && counts[start + 2] > 0)
        {
            counts[start + 1]--;
            counts[start + 2]--;
            best = Math.Min(best, ShapeDistance(counts, groups + 1, partial, eye, start));
            counts[start + 1]++;
            counts[start + 2]++;
        }
        counts[start]++;
        return best;
    }
}
