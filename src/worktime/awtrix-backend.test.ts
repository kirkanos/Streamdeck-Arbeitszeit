import { describe, expect, it } from "vitest";
import { readStart } from "./awtrix-backend";

describe("readStart", () => {
  it("reads the AWTRIX NG 1.1 config shape (name + fields)", () => {
    const config = {
      name: "arbeitszeit",
      fields: [
        { key: "start", type: "text", label: "Arbeitsbeginn", default: "", value: "09:03" },
        { key: "soll", type: "number", default: 8, value: 8 },
      ],
    };
    expect(readStart(config)).toBe("09:03");
  });

  it("reads a flat object and a key/value list", () => {
    expect(readStart({ start: "08:30", soll: 8 })).toBe("08:30");
    expect(readStart([{ key: "soll", value: 8 }, { key: "start", value: "07:15" }])).toBe("07:15");
  });

  it("returns undefined when start is missing or not a string", () => {
    expect(readStart({ name: "arbeitszeit", fields: [{ key: "soll", value: 8 }] })).toBeUndefined();
    expect(readStart({ start: 830 })).toBeUndefined();
    expect(readStart(null)).toBeUndefined();
  });
});
