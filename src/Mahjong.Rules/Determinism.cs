using System.Buffers.Binary;
using System.Collections.Immutable;
using System.Security.Cryptography;

namespace Mahjong.Rules;

internal static class Tiles
{
    internal const int FaceCount = 27;
    internal const int TileCount = FaceCount * 4;

    internal static int Rank(int face) => face % 9 + 1;
    internal static int Suit(int face) => face / 9;
    internal static bool IsGeneral(int face) => Rank(face) is 2 or 5 or 8;
    internal static string Face(PhysicalTile tile) => Faces[tile.FaceIndex];

    internal static int Parse(string face) => ("bcd".IndexOf(face[0]) * 9) + face[1] - '1';

    internal static ImmutableArray<PhysicalTile> Sort(IEnumerable<PhysicalTile> tiles) =>
        [.. tiles.OrderBy(tile => tile.Number)];

    private static readonly string[] Faces = [.. from suit in "bcd"
        from rank in "123456789" select new string([suit, rank])];
}

internal static class Determinism
{
    internal const int ShuffleVersion = 1;

    // Domain bytes and field positions are fixed for v1. The seed belongs to the host checkpoint only.
    private const byte WindowDomain = 1, OptionDomain = 2, TileDomain = 3, ShuffleDomain = 4, DiceDomain = 5;

    internal static string WindowId(HandStart start, int window) => Id(start, WindowDomain, -1, window, 0);

    internal static string OptionId(HandStart start, int seat, int window, int option) =>
        Id(start, OptionDomain, seat, window, option);

    internal static string TileId(HandStart start, int seat, PhysicalTile tile) =>
        Id(start, TileDomain, seat, tile.Number, 0);

    internal static PhysicalTile[] Shuffle(HandStart start)
    {
        var tiles = Enumerable.Range(0, Tiles.TileCount).Select(n => new PhysicalTile(n)).ToArray();
        var counter = 0;
        for (var i = tiles.Length - 1; i > 0; i--)
        {
            var j = Bounded(start, ShuffleDomain, 0, ref counter, i + 1);
            (tiles[i], tiles[j]) = (tiles[j], tiles[i]);
        }
        return tiles;
    }

    internal static int RollLowerDie(HandStart start, int window)
    {
        var (first, second) = RollDice(start, window);
        return Math.Min(first, second);
    }

    internal static (int First, int Second) RollDice(HandStart start, int window)
    {
        var counter = 0;
        return (1 + Bounded(start, DiceDomain, window, ref counter, 6),
            1 + Bounded(start, DiceDomain, window, ref counter, 6));
    }

    private static int Bounded(HandStart start, byte domain, int sequence, ref int counter, int bound)
    {
        var size = (uint)bound;
        var threshold = unchecked(0u - size) % size;
        Span<byte> digest = stackalloc byte[32];
        uint sample;
        do
        {
            Digest(start, domain, -1, sequence, counter++, digest);
            sample = BinaryPrimitives.ReadUInt32LittleEndian(digest);
        } while (sample < threshold);
        return (int)(sample % size);
    }

    private static string Id(HandStart start, byte domain, int seat, int sequence, int index)
    {
        Span<byte> digest = stackalloc byte[32];
        Digest(start, domain, seat, sequence, index, digest);
        return Convert.ToHexStringLower(digest[..16]);
    }

    private static void Digest(HandStart start, byte domain, int seat, int sequence, int index, Span<byte> result)
    {
        Span<byte> key = stackalloc byte[16];
        BinaryPrimitives.WriteUInt64LittleEndian(key, start.Seed.Low);
        BinaryPrimitives.WriteUInt64LittleEndian(key[8..], start.Seed.High);
        Span<byte> input = stackalloc byte[17];
        input[0] = domain;
        BinaryPrimitives.WriteInt32LittleEndian(input[1..], start.HandNumber);
        BinaryPrimitives.WriteInt32LittleEndian(input[5..], seat);
        BinaryPrimitives.WriteInt32LittleEndian(input[9..], sequence);
        BinaryPrimitives.WriteInt32LittleEndian(input[13..], index);
        HMACSHA256.HashData(key, input, result);
    }
}
