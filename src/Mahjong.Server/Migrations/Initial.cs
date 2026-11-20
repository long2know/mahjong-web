using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Mahjong.Server.Migrations;

[DbContext(typeof(MahjongDb))]
[Migration("20261119223000_Initial")]
internal sealed class Initial : Migration
{
    protected override void Up(MigrationBuilder migration)
    {
        migration.CreateTable("Guests", table => new
        {
            Id = table.Column<Guid>(nullable: false),
            DisplayName = table.Column<string>(nullable: false),
            Sound = table.Column<bool>(nullable: false),
            Music = table.Column<bool>(nullable: false),
            Volume = table.Column<double>(nullable: false),
            ReducedMotion = table.Column<bool>(nullable: false),
            ExpiresAtTicks = table.Column<long>(nullable: false)
        }, constraints: table => table.PrimaryKey("PK_Guests", r => r.Id));

        migration.CreateTable("Rooms", table => new
        {
            Id = table.Column<string>(nullable: false),
            InviteCode = table.Column<string>(nullable: true),
            IsPublic = table.Column<bool>(nullable: false),
            MatchHands = table.Column<int>(nullable: false),
            Waiting = table.Column<bool>(nullable: false),
            OccupiedSeats = table.Column<int>(nullable: false),
            ExpiresAtTicks = table.Column<long>(nullable: false),
            Checkpoint = table.Column<string>(nullable: false)
        }, constraints: table => table.PrimaryKey("PK_Rooms", r => r.Id));

        migration.CreateTable("Memberships", table => new
        {
            GuestId = table.Column<Guid>(nullable: false),
            RoomId = table.Column<string>(nullable: false),
            Seat = table.Column<int>(nullable: false)
        }, constraints: table =>
        {
            table.PrimaryKey("PK_Memberships", m => m.GuestId);
            table.ForeignKey("FK_Memberships_Guests_GuestId", m => m.GuestId, "Guests", "Id",
                onDelete: ReferentialAction.Cascade);
            table.ForeignKey("FK_Memberships_Rooms_RoomId", m => m.RoomId, "Rooms", "Id",
                onDelete: ReferentialAction.Cascade);
        });

        migration.CreateTable("Receipts", table => new
        {
            GuestId = table.Column<Guid>(nullable: false),
            LeaseId = table.Column<Guid>(nullable: false),
            RequestId = table.Column<Guid>(nullable: false),
            ExpiresAtTicks = table.Column<long>(nullable: false),
            Fingerprint = table.Column<string>(nullable: false),
            Acknowledgement = table.Column<string>(nullable: false)
        }, constraints: table => table.PrimaryKey("PK_Receipts", r => new { r.GuestId, r.LeaseId, r.RequestId }));

        migration.CreateTable("Clock", table => new
        {
            Id = table.Column<int>(nullable: false),
            LeasePruneTicks = table.Column<long>(nullable: false)
        }, constraints: table => table.PrimaryKey("PK_Clock", r => r.Id));

        migration.InsertData("Clock", ["Id", "LeasePruneTicks"], [1, 0L]);
        migration.CreateIndex("IX_Guests_ExpiresAtTicks", "Guests", "ExpiresAtTicks");
        migration.CreateIndex("IX_Rooms_InviteCode", "Rooms", "InviteCode", unique: true);
        migration.CreateIndex("IX_Rooms_ExpiresAtTicks", "Rooms", "ExpiresAtTicks");
        migration.CreateIndex("IX_Memberships_RoomId_Seat", "Memberships", new[] { "RoomId", "Seat" }, unique: true);
        migration.CreateIndex("IX_Receipts_ExpiresAtTicks", "Receipts", "ExpiresAtTicks");
    }

    protected override void Down(MigrationBuilder migration)
    {
        migration.DropTable("Clock");
        migration.DropTable("Memberships");
        migration.DropTable("Receipts");
        migration.DropTable("Guests");
        migration.DropTable("Rooms");
    }

    protected override void BuildTargetModel(ModelBuilder modelBuilder) => InitialSchema.Build(modelBuilder);
}

[DbContext(typeof(MahjongDb))]
internal sealed class MahjongDbModelSnapshot : ModelSnapshot
{
    protected override void BuildModel(ModelBuilder modelBuilder) => InitialSchema.Build(modelBuilder);
}

internal static class InitialSchema
{
    public static void Build(ModelBuilder builder)
    {
        builder.HasAnnotation("ProductVersion", "10.0.15");
        builder.Entity("Mahjong.Server.GuestRow", guest =>
        {
            guest.Property<Guid>("Id").ValueGeneratedOnAdd().HasColumnType("TEXT");
            guest.Property<string>("DisplayName").IsRequired().HasColumnType("TEXT");
            guest.Property<bool>("Sound").HasColumnType("INTEGER");
            guest.Property<bool>("Music").HasColumnType("INTEGER");
            guest.Property<double>("Volume").HasColumnType("REAL");
            guest.Property<bool>("ReducedMotion").HasColumnType("INTEGER");
            guest.Property<long>("ExpiresAtTicks").HasColumnType("INTEGER");
            guest.HasKey("Id");
            guest.HasIndex("ExpiresAtTicks");
            guest.ToTable("Guests");
        });
        builder.Entity("Mahjong.Server.RoomRow", room =>
        {
            room.Property<string>("Id").HasColumnType("TEXT");
            room.Property<string>("InviteCode").HasColumnType("TEXT");
            room.Property<bool>("IsPublic").HasColumnType("INTEGER");
            room.Property<int>("MatchHands").HasColumnType("INTEGER");
            room.Property<bool>("Waiting").HasColumnType("INTEGER");
            room.Property<int>("OccupiedSeats").HasColumnType("INTEGER");
            room.Property<long>("ExpiresAtTicks").HasColumnType("INTEGER");
            room.Property<string>("Checkpoint").IsRequired().HasColumnType("TEXT");
            room.HasKey("Id");
            room.HasIndex("InviteCode").IsUnique();
            room.HasIndex("ExpiresAtTicks");
            room.ToTable("Rooms");
        });
        builder.Entity("Mahjong.Server.MembershipRow", member =>
        {
            member.Property<Guid>("GuestId").HasColumnType("TEXT");
            member.Property<string>("RoomId").IsRequired().HasColumnType("TEXT");
            member.Property<int>("Seat").HasColumnType("INTEGER");
            member.HasKey("GuestId");
            member.HasIndex("RoomId", "Seat").IsUnique();
            member.HasOne("Mahjong.Server.GuestRow", null).WithOne()
                .HasForeignKey("Mahjong.Server.MembershipRow", "GuestId").OnDelete(DeleteBehavior.Cascade).IsRequired();
            member.HasOne("Mahjong.Server.RoomRow", null).WithMany()
                .HasForeignKey("RoomId").OnDelete(DeleteBehavior.Cascade).IsRequired();
            member.ToTable("Memberships");
        });
        builder.Entity("Mahjong.Server.ReceiptRow", receipt =>
        {
            receipt.Property<Guid>("GuestId").HasColumnType("TEXT");
            receipt.Property<Guid>("LeaseId").HasColumnType("TEXT");
            receipt.Property<Guid>("RequestId").HasColumnType("TEXT");
            receipt.Property<long>("ExpiresAtTicks").HasColumnType("INTEGER");
            receipt.Property<string>("Fingerprint").IsRequired().HasColumnType("TEXT");
            receipt.Property<string>("Acknowledgement").IsRequired().HasColumnType("TEXT");
            receipt.HasKey("GuestId", "LeaseId", "RequestId");
            receipt.HasIndex("ExpiresAtTicks");
            receipt.ToTable("Receipts");
        });
        builder.Entity("Mahjong.Server.ClockRow", clock =>
        {
            clock.Property<int>("Id").HasColumnType("INTEGER");
            clock.Property<long>("LeasePruneTicks").HasColumnType("INTEGER");
            clock.HasKey("Id");
            clock.ToTable("Clock");
        });
    }
}
