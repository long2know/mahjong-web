using System.Collections.Immutable;

namespace Mahjong.Rules;

internal static class Winning
{
    internal static bool IsWinning(SeatState seat, int? addedFace) =>
        Classify(seat, addedFace, out _).Length != 0;

    internal static ImmutableArray<string> Classify(SeatState seat, int? addedFace, out bool generalShape)
    {
        var groups = 4 - seat.Melds.Length;
        generalShape = false;
        if (groups < 0 || seat.Hand.Length + (addedFace.HasValue ? 1 : 0) != groups * 3 + 2)
            return [];

        Span<int> concealed = stackalloc int[Tiles.FaceCount];
        concealed.Clear();
        foreach (var tile in seat.Hand)
            concealed[tile.FaceIndex]++;
        if (addedFace is { } added)
            concealed[added]++;
        Span<int> all = stackalloc int[Tiles.FaceCount];
        concealed.CopyTo(all);
        foreach (var meld in seat.Melds)
        {
            foreach (var tile in meld.Tiles)
                all[tile.FaceIndex]++;
        }

        var generals = true;
        var suit = -1;
        var flush = true;
        var pairs = groups == 4;
        var quads = 0;
        for (var face = 0; face < all.Length; face++)
        {
            if (all[face] > 4)
                return [];
            if (all[face] == 0)
                continue;
            generals &= Tiles.IsGeneral(face);
            if (suit < 0)
                suit = Tiles.Suit(face);
            else
                flush &= suit == Tiles.Suit(face);
            pairs &= concealed[face] % 2 == 0;
            if (concealed[face] == 4)
                quads++;
        }

        var allPungs = seat.Melds.All(meld => meld.Kind != "chi") && TripletsAndPair(concealed);
        var fullyMelded = groups == 0 && seat.Melds.All(meld => meld.Method != "concealed") &&
            HasShape(concealed, generalsOnly: false);
        generalShape = HasShape(concealed, generalsOnly: true);
        var pure = flush && (pairs || generalShape || HasShape(concealed, generalsOnly: false));

        var patterns = ImmutableArray.CreateBuilder<string>();
        if (allPungs)
            patterns.Add("allPungs");
        if (generals)
            patterns.Add("allGenerals");
        if (pure)
            patterns.Add("pureSuit");
        if (fullyMelded)
            patterns.Add("fullyMelded");
        if (pairs)
        {
            patterns.Add("sevenPairs");
            for (var i = 0; i < quads; i++)
                patterns.Add("luxurySevenPairs");
        }
        if (patterns.Count == 0 && generalShape)
            patterns.Add("plain");
        return patterns.ToImmutable();
    }

    private static bool TripletsAndPair(ReadOnlySpan<int> counts)
    {
        var hasPair = false;
        foreach (var count in counts)
        {
            if (count is 0 or 3)
                continue;
            if (count != 2 || hasPair)
                return false;
            hasPair = true;
        }
        return hasPair;
    }

    internal static bool HasShape(Span<int> counts, bool generalsOnly)
    {
        for (var face = 0; face < counts.Length; face++)
        {
            if (counts[face] < 2 || (generalsOnly && !Tiles.IsGeneral(face)))
                continue;
            counts[face] -= 2;
            var valid = CompleteSets(counts, faceHint: 0);
            counts[face] += 2;
            if (valid)
                return true;
        }
        return false;
    }

    private static bool CompleteSets(Span<int> counts, int faceHint)
    {
        var face = faceHint;
        while (face < counts.Length && counts[face] == 0)
            face++;
        if (face == counts.Length)
            return true;
        if (counts[face] >= 3)
        {
            counts[face] -= 3;
            var valid = CompleteSets(counts, face);
            counts[face] += 3;
            if (valid)
                return true;
        }
        if (Tiles.Rank(face) > 7 || counts[face + 1] == 0 || counts[face + 2] == 0)
            return false;
        counts[face]--;
        counts[face + 1]--;
        counts[face + 2]--;
        var sequence = CompleteSets(counts, face);
        counts[face]++;
        counts[face + 1]++;
        counts[face + 2]++;
        return sequence;
    }

    internal static bool IsReady(SeatState seat)
    {
        Span<int> owned = stackalloc int[Tiles.FaceCount];
        owned.Clear();
        foreach (var tile in seat.Hand.Concat(seat.Melds.SelectMany(meld => meld.Tiles)))
            owned[tile.FaceIndex]++;
        for (var face = 0; face < Tiles.FaceCount; face++)
        {
            if (owned[face] < 4 && IsWinning(seat, face))
                return true;
        }
        return false;
    }

    internal static ImmutableArray<OpeningAward> Opening(ImmutableArray<PhysicalTile> hand)
    {
        var groups = Tiles.Sort(hand).GroupBy(tile => tile.FaceIndex).ToArray();
        var awards = ImmutableArray.CreateBuilder<OpeningAward>();
        foreach (var group in groups.Where(group => group.Count() == 4))
            awards.Add(new("fourJoys", [.. group]));
        if (groups.All(group => !Tiles.IsGeneral(group.Key)))
            awards.Add(new("noGenerals", Tiles.Sort(hand)));
        if (groups.Select(group => Tiles.Suit(group.Key)).Distinct().Count() < 3)
            awards.Add(new("missingSuit", Tiles.Sort(hand)));
        var pungs = groups.Where(group => group.Count() >= 3).Take(2).ToArray();
        if (pungs.Length == 2)
            awards.Add(new("sixSix", [.. pungs.SelectMany(group => group.Take(3))]));
        return awards.ToImmutable();
    }
}
