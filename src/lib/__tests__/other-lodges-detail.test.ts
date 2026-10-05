import { describe, it, expect } from "vitest";
import {
  AMENITIES_PER_LODGE_MAX,
  amenitiesDiffer,
  amenitiesInputSchema,
  formatLodgeDate,
  lodgeDetailColumns,
  lodgeDetailDiffers,
  otherLodgeCreateSchema,
  otherLodgeUpdateSchema,
  otherLodgeUploadItemSchema,
  parseLodgeDate,
  serializeOtherLodgeForClient,
  type OtherLodgeRecord,
} from "@/lib/other-lodges";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

describe("detail field validation (create, update and upload accept the same values)", () => {
  const schemas = {
    create: otherLodgeCreateSchema,
    update: otherLodgeUpdateSchema,
    upload: otherLodgeUploadItemSchema,
  };

  for (const [label, schema] of Object.entries(schemas)) {
    describe(label, () => {
      const base = { name: "Lodge" };

      it("accepts http and https site URLs and rejects every other scheme", () => {
        expect(ok(schema, { ...base, siteUrl: "https://lodge.example/x" })).toBe(true);
        expect(ok(schema, { ...base, siteUrl: "http://lodge.example" })).toBe(true);
        for (const bad of [
          "javascript:alert(1)",
          "data:text/html,hi",
          "ftp://lodge.example",
          "lodge.example",
          "//lodge.example",
        ]) {
          expect(ok(schema, { ...base, siteUrl: bad }), bad).toBe(false);
        }
      });

      it("folds a blank site URL to null (clearing the field is not an error)", () => {
        const parsed = schema.safeParse({ ...base, siteUrl: "  " });
        expect(parsed.success).toBe(true);
        expect((parsed as { data: { siteUrl: unknown } }).data.siteUrl).toBeNull();
      });

      it("accepts real calendar dates and rejects impossible or mis-shaped ones", () => {
        expect(ok(schema, { ...base, winterSeasonStart: "2026-06-01" })).toBe(true);
        expect(ok(schema, { ...base, summerSeasonStart: "2028-02-29" })).toBe(true);
        for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-6-1", "01/06/2026", "2026-06-01T00:00:00Z"]) {
          expect(ok(schema, { ...base, winterSeasonStart: bad }), bad).toBe(false);
        }
      });

      it("enforces text length caps", () => {
        expect(ok(schema, { ...base, bookingPath: "x".repeat(300) })).toBe(true);
        expect(ok(schema, { ...base, bookingPath: "x".repeat(301) })).toBe(false);
        expect(ok(schema, { ...base, cancellationPeriod: "x".repeat(200) })).toBe(true);
        expect(ok(schema, { ...base, cancellationPeriod: "x".repeat(201) })).toBe(false);
      });

      it("accepts booleans only", () => {
        expect(ok(schema, { ...base, freeWifi: true, dinnerIncluded: false })).toBe(true);
        expect(ok(schema, { ...base, freeWifi: "yes" })).toBe(false);
        expect(ok(schema, { ...base, quietRoom: 1 })).toBe(false);
      });

      it("still rejects an unknown key", () => {
        expect(ok(schema, { ...base, hotTub: true })).toBe(false);
      });
    });
  }
});

describe("amenity list validation", () => {
  it("accepts a normal list and an empty one", () => {
    expect(ok(amenitiesInputSchema, [{ name: "Sauna", description: "Wood fired" }])).toBe(true);
    expect(ok(amenitiesInputSchema, [])).toBe(true);
    expect(ok(amenitiesInputSchema, [{ name: "Sauna" }])).toBe(true);
  });

  it("rejects duplicate names, ignoring case and surrounding space", () => {
    expect(ok(amenitiesInputSchema, [{ name: "Sauna" }, { name: "sauna" }])).toBe(false);
    expect(ok(amenitiesInputSchema, [{ name: "Sauna" }, { name: "  Sauna " }])).toBe(false);
  });

  it("rejects an empty name, an over-long name or description, and an unknown key", () => {
    expect(ok(amenitiesInputSchema, [{ name: "  " }])).toBe(false);
    expect(ok(amenitiesInputSchema, [{ name: "x".repeat(121) }])).toBe(false);
    expect(ok(amenitiesInputSchema, [{ name: "a", description: "x".repeat(1001) }])).toBe(false);
    expect(ok(amenitiesInputSchema, [{ name: "a", icon: "x" }])).toBe(false);
  });

  it("allows exactly the maximum and rejects one more", () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `a${i}` }));
    expect(ok(amenitiesInputSchema, make(AMENITIES_PER_LODGE_MAX))).toBe(true);
    expect(ok(amenitiesInputSchema, make(AMENITIES_PER_LODGE_MAX + 1))).toBe(false);
  });
});

describe("lodgeDetailColumns", () => {
  it("returns ONLY the provided keys, so a partial update never clears the rest", () => {
    expect(lodgeDetailColumns({ freeWifi: true })).toEqual({ freeWifi: true });
    expect(lodgeDetailColumns({})).toEqual({});
  });

  it("trims text and folds blank to null", () => {
    expect(lodgeDetailColumns({ siteUrl: " https://a.example ", bookingPath: "  " })).toEqual({
      siteUrl: "https://a.example",
      bookingPath: null,
    });
  });

  it("keeps false (an explicit 'no') rather than dropping it", () => {
    expect(lodgeDetailColumns({ freeWifi: false })).toEqual({ freeWifi: false });
  });

  it("turns a date string into UTC midnight and a null into null", () => {
    const cols = lodgeDetailColumns({ winterSeasonStart: "2026-06-01", summerSeasonStart: null });
    expect(cols.winterSeasonStart?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(cols.summerSeasonStart).toBeNull();
  });
});

describe("dates never shift by time zone", () => {
  it("round-trips every day of a leap year through parse and format", () => {
    for (let d = 0; d < 366; d += 1) {
      const date = new Date(Date.UTC(2028, 0, 1 + d));
      const text = date.toISOString().slice(0, 10);
      expect(formatLodgeDate(parseLodgeDate(text))).toBe(text);
    }
  });

  it("formats null as null", () => {
    expect(formatLodgeDate(null)).toBeNull();
  });
});

describe("lodgeDetailDiffers", () => {
  it("compares dates by calendar day, not by object identity", () => {
    const a = parseLodgeDate("2026-06-01");
    const b = parseLodgeDate("2026-06-01");
    expect(a === b).toBe(false);
    expect(lodgeDetailDiffers({ winterSeasonStart: a }, { winterSeasonStart: b })).toBe(false);
    expect(
      lodgeDetailDiffers({ winterSeasonStart: a }, { winterSeasonStart: parseLodgeDate("2026-06-02") }),
    ).toBe(true);
  });

  it("treats set vs null date as a difference in both directions", () => {
    expect(lodgeDetailDiffers({ winterSeasonStart: parseLodgeDate("2026-06-01") }, { winterSeasonStart: null })).toBe(true);
    expect(lodgeDetailDiffers({ winterSeasonStart: null }, { winterSeasonStart: parseLodgeDate("2026-06-01") })).toBe(true);
    expect(lodgeDetailDiffers({ winterSeasonStart: null }, { winterSeasonStart: null })).toBe(false);
  });

  it("only looks at the provided keys", () => {
    expect(lodgeDetailDiffers({ freeWifi: true }, { freeWifi: true, quietRoom: true })).toBe(false);
    expect(lodgeDetailDiffers({ freeWifi: true }, { freeWifi: false })).toBe(true);
  });
});

describe("amenitiesDiffer", () => {
  it("is false for the same set in any order, ignoring blank-vs-null descriptions", () => {
    expect(
      amenitiesDiffer(
        [{ name: "A", description: null }, { name: "B", description: "x" }],
        [{ name: "B", description: "x" }, { name: "A", description: "" }],
      ),
    ).toBe(false);
  });

  it("is true when a name, a description, or the size differs", () => {
    expect(amenitiesDiffer([{ name: "A" }], [{ name: "B" }])).toBe(true);
    expect(amenitiesDiffer([{ name: "A", description: "x" }], [{ name: "A", description: "y" }])).toBe(true);
    expect(amenitiesDiffer([{ name: "A" }], [])).toBe(true);
    expect(amenitiesDiffer([], [{ name: "A" }])).toBe(true);
  });
});

describe("serializeOtherLodgeForClient carries the new fields", () => {
  const at = new Date("2026-02-01T00:00:00Z");
  const lodge = {
    id: "l",
    name: "n",
    location: null,
    bookingOfficerName: null,
    bookingOfficerEmail: null,
    // A stored phone number: it must NOT come out in the client shape (#11).
    bookingOfficerPhone: "021 555 0100",
    bedCapacity: 10,
    siteUrl: "https://a.example",
    bookingPath: "/book",
    requiresLodgeCustodian: true,
    freeWifi: true,
    quietRoom: false,
    dryingRoom: true,
    sharedKitchen: false,
    wheelchairAccessible: true,
    breakfastIncluded: false,
    lunchIncluded: true,
    dinnerIncluded: false,
    cancellationPeriod: "14 days",
    winterSeasonStart: parseLodgeDate("2026-06-01"),
    summerSeasonStart: parseLodgeDate("2026-12-01"),
    amenities: [{ name: "Sauna", description: null }],
    updatedAt: at,
  } as unknown as OtherLodgeRecord;

  it("never includes the booking officer's phone number, even when one is stored (#11)", () => {
    const out = serializeOtherLodgeForClient(lodge);
    expect(out).not.toHaveProperty("bookingOfficerPhone");
    expect(JSON.stringify(out)).not.toContain("021 555 0100");
  });

  it("emits dates as YYYY-MM-DD, booleans as booleans and amenities without ids", () => {
    expect(serializeOtherLodgeForClient(lodge)).toEqual({
      id: "l",
      name: "n",
      location: null,
      bookingOfficerName: null,
      bookingOfficerEmail: null,
      bedCapacity: 10,
      siteUrl: "https://a.example",
      bookingPath: "/book",
      requiresLodgeCustodian: true,
      freeWifi: true,
      quietRoom: false,
      dryingRoom: true,
      sharedKitchen: false,
      wheelchairAccessible: true,
      breakfastIncluded: false,
      lunchIncluded: true,
      dinnerIncluded: false,
      cancellationPeriod: "14 days",
      winterSeasonStart: "2026-06-01",
      summerSeasonStart: "2026-12-01",
      amenities: [{ name: "Sauna", description: null }],
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
  });
});
