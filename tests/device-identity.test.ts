import { describe, it, expect } from "vitest";
import { devicePlayerId, isValidPlayerCode, parsePlayerCode } from "../src/core/auth/DeviceIdentity";
import { branding } from "../src/config/branding";

const CODE_RE = new RegExp(`^${branding.PLAYER_ID_PREFIX}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$`);

describe("DeviceIdentity player codes", () => {
  it("derives a deterministic ZX-XXXX-XXXX code from a device id", () => {
    const id = "00112233445566778899aabbccddeeff";
    const code = devicePlayerId(id);
    expect(CODE_RE.test(code)).toBe(true);
    expect(devicePlayerId(id)).toBe(code);
  });

  it("produces different codes for different device ids", () => {
    const a = devicePlayerId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const b = devicePlayerId("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(a).not.toBe(b);
  });

  it("uses an unambiguous alphabet (no 0/O/1/I/L)", () => {
    expect(devicePlayerId("ffffffffffffffffffffffffffffffff")).not.toMatch(/[0O1IL]/);
  });

  it("round-trips through the type guard", () => {
    const code = devicePlayerId("11223344556677889900112233445566");
    expect(isValidPlayerCode(code)).toBe(true);
    expect(parsePlayerCode(` ${code.toLowerCase()} `)).toBe(code);
  });
});

describe("PlayerCode type", () => {
  it("accepts only the branded 2-group format", () => {
    const prefix = branding.PLAYER_ID_PREFIX;
    expect(isValidPlayerCode(`${prefix}-ABCD-2345`)).toBe(true);
    expect(isValidPlayerCode("REP-ABCD-2345")).toBe(`${prefix}` === "REP");
    expect(isValidPlayerCode(`${prefix}-ABC-2345`)).toBe(false);
    expect(isValidPlayerCode(`${prefix.toLowerCase()}-abcd-2345`)).toBe(false);
    expect(isValidPlayerCode(`${prefix}-0OIL-2345`)).toBe(false);
  });
});