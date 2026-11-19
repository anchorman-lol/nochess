import { describe, expect, it } from "vitest";
import { DEFAULTS } from "./settings.ts";
import { audible, LOW_TIME_MS, lowTimeCrossed, soundFor } from "./sound.ts";

describe("which sound a move makes", () => {
  it("tells a quiet move, a capture, a castle and a check apart", () => {
    expect(soundFor("e4")).toBe("move");
    expect(soundFor("Nxe5")).toBe("capture");
    expect(soundFor("O-O")).toBe("castle");
    expect(soundFor("O-O-O")).toBe("castle");
    expect(soundFor("Qh5+")).toBe("check");
    expect(soundFor("exd8=N")).toBe("capture");
  });

  it("lets check win over capture and castling, and mate end the game", () => {
    expect(soundFor("Bxf7+")).toBe("check");
    expect(soundFor("O-O+")).toBe("check");
    expect(soundFor("Qh4#")).toBe("end");
  });
});

describe("when sounds play", () => {
  it("never with sounds off, whatever the volume", () => {
    expect(audible({ ...DEFAULTS, sound: false, volume: 1 })).toBe(false);
    expect(audible({ ...DEFAULTS, sound: true, volume: 0 })).toBe(false);
    expect(audible({ ...DEFAULTS, sound: true, volume: 0.5 })).toBe(true);
  });

  it("ticks for low time once, when the running clock crosses ten seconds", () => {
    expect(lowTimeCrossed(LOW_TIME_MS + 400, LOW_TIME_MS - 100)).toBe(true);
    expect(lowTimeCrossed(LOW_TIME_MS - 100, LOW_TIME_MS - 200)).toBe(false);
    expect(lowTimeCrossed(LOW_TIME_MS + 900, LOW_TIME_MS + 800)).toBe(false);
  });
});
