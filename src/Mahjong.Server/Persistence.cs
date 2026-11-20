using Microsoft.EntityFrameworkCore;

namespace Mahjong.Server;

internal sealed class GuestRow
{
    public Guid Id { get; set; }
    public string DisplayName { get; set; } = "Guest";
    public bool Sound { get; set; } = true;
    public bool Music { get; set; }
    public double Volume { get; set; } = 0.7;
    public bool ReducedMotion { get; set; }
    public long ExpiresAtTicks { get; set; }
}

internal sealed class RoomRow
{
    public required string Id { get; init; }
    public string? InviteCode { get; init; }
    public bool IsPublic { get; init; }
    public int MatchHands { get; init; }
    public bool Waiting { get; set; }
    public int OccupiedSeats { get; set; }
    public long ExpiresAtTicks { get; set; }
    public required string Checkpoint { get; set; }
}

internal sealed class MembershipRow
{
    public Guid GuestId { get; init; }
    public required string RoomId { get; init; }
    public int Seat { get; init; }
}

internal sealed class ReceiptRow
{
    public Guid GuestId { get; init; }
    public Guid LeaseId { get; init; }
    public Guid RequestId { get; init; }
    public long ExpiresAtTicks { get; init; }
    public required string Fingerprint { get; init; }
    public required string Acknowledgement { get; init; }
}

internal sealed class ClockRow
{
    public int Id { get; init; }
    public long LeasePruneTicks { get; set; }
}

internal sealed class MahjongDb(DbContextOptions<MahjongDb> options) : DbContext(options)
{
    public DbSet<GuestRow> Guests => Set<GuestRow>();
    public DbSet<RoomRow> Rooms => Set<RoomRow>();
    public DbSet<MembershipRow> Memberships => Set<MembershipRow>();
    public DbSet<ReceiptRow> Receipts => Set<ReceiptRow>();
    public DbSet<ClockRow> Clock => Set<ClockRow>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        builder.Entity<GuestRow>(guest =>
        {
            guest.ToTable("Guests");
            guest.HasIndex(g => g.ExpiresAtTicks);
        });
        builder.Entity<RoomRow>(room =>
        {
            room.ToTable("Rooms");
            room.HasIndex(r => r.InviteCode).IsUnique();
            room.HasIndex(r => r.ExpiresAtTicks);
        });
        builder.Entity<MembershipRow>(member =>
        {
            member.ToTable("Memberships");
            member.HasKey(m => m.GuestId);
            member.HasOne<GuestRow>().WithOne().HasForeignKey<MembershipRow>(m => m.GuestId);
            member.HasOne<RoomRow>().WithMany().HasForeignKey(m => m.RoomId);
            member.HasIndex(m => new { m.RoomId, m.Seat }).IsUnique();
        });
        builder.Entity<ReceiptRow>(receipt =>
        {
            receipt.ToTable("Receipts");
            receipt.HasKey(r => new { r.GuestId, r.LeaseId, r.RequestId });
            receipt.HasIndex(r => r.ExpiresAtTicks);
        });
        builder.Entity<ClockRow>(clock =>
        {
            clock.ToTable("Clock");
            clock.Property(c => c.Id).ValueGeneratedNever();
        });
    }
}

internal sealed class DataDirectory : IDisposable
{
    private readonly FileStream _instanceLock;

    public DataDirectory(ServerOptions options)
    {
        CreatePrivateDirectory(options.DataDirectory);
        Keys = CreatePrivateDirectory(Path.Combine(options.DataDirectory, "keys"));
        DatabasePath = Path.Combine(options.DataDirectory, "mahjong.db");
        try
        {
            _instanceLock = new FileStream(Path.Combine(options.DataDirectory, ".instance.lock"),
                FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        }
        catch (IOException ex)
        {
            throw new InvalidOperationException("Cannot lock the Mahjong data directory. Use one running host per data directory.", ex);
        }
    }

    public string DatabasePath { get; }
    public DirectoryInfo Keys { get; }

    private static DirectoryInfo CreatePrivateDirectory(string path) => OperatingSystem.IsWindows()
        ? Directory.CreateDirectory(path)
        : Directory.CreateDirectory(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);

    public void Dispose() => _instanceLock.Dispose();
}
