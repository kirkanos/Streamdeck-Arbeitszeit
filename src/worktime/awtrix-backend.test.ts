import { describe, expect, it } from "vitest";
import { readField } from "./awtrix-backend";

describe("readField", () => {
  it("reads the AWTRIX NG 1.1 config shape (name + fields)", () => {
    const config = {
      name: "arbeitszeit",
      fields: [
        { key: "start", type: "text", label: "Arbeitsbeginn", default: "", value: "09:03" },
        { key: "soll", type: "number", default: 8, value: 8 },
      ],
    };
    expect(readField(config, "start")).toBe("09:03");
  });

  it("reads a flat object and a key/value list", () => {
    expect(readField({ start: "08:30", soll: 8 }, "start")).toBe("08:30");
    expect(readField([{ key: "soll", value: 8 }, { key: "start", value: "07:15" }], "start")).toBe("07:15");
  });

  it("returns undefined when start is missing or not a string", () => {
    expect(readField({ name: "arbeitszeit", fields: [{ key: "soll", value: 8 }] }, "start")).toBeUndefined();
    // A number comes back as its string form; parseStartSetting rejects it later.
    expect(readField({ start: 830 }, "start")).toBe("830");
    expect(readField({ fields: [{ key: "pause", value: 35 }] }, "pause")).toBe("35");
    expect(readField(null, "start")).toBeUndefined();
  });
});
