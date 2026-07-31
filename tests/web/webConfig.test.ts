// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeFriendCode, parseWebSettings, serializeWebSettings } from "../../src/web/data/webConfig";
import { defaultConfig } from "../../electron/models";

describe("parseWebSettings", () => {
  it("returns demo defaults for an empty URL", () => {
    const settings = parseWebSettings("");
    expect(settings.demo).toBe(true);
    expect(settings.friendCode).toBe("");
    expect(settings.config.border.effect).toBe(defaultConfig.border.effect);
    expect(settings.config.data.demoMode).toBe(true);
  });

  it("goes live with a friend code shortcut, tolerant of formatting", () => {
    const settings = parseWebSettings("?fc=382252206288&tag=ZPL&poll=10");
    expect(settings.friendCode).toBe("3822-5220-6288");
    expect(settings.demo).toBe(false);
    expect(settings.pollSeconds).toBe(10);
    expect(settings.config.identity.mode).toBe("friendCode");
    expect(settings.config.identity.tag).toBe("ZPL");
    expect(settings.config.data.demoMode).toBe(false);
  });

  it("uses name matching when only ?name= is given", () => {
    const settings = parseWebSettings("?name=Cooper");
    expect(settings.demo).toBe(false);
    expect(settings.friendCode).toBe("");
    expect(settings.config.identity.mode).toBe("manual");
    expect(settings.config.identity.playerName).toBe("Cooper");
  });

  it("round-trips a style patch through the cfg blob", () => {
    const query = serializeWebSettings({
      friendCode: "3822-5220-6288",
      tag: "ZPL",
      configPatch: { border: { effect: "pulse", color1: "#ff0000" }, visibility: { rank: false } }
    });
    const settings = parseWebSettings(`?${query}`);
    expect(settings.config.border.effect).toBe("pulse");
    expect(settings.config.border.color1).toBe("#ff0000");
    expect(settings.config.border.width).toBe(defaultConfig.border.width); // untouched keys keep defaults
    expect(settings.config.visibility.rank).toBe(false);
    expect(settings.friendCode).toBe("3822-5220-6288");
  });

  it("survives a corrupt cfg blob", () => {
    const settings = parseWebSettings("?fc=3822-5220-6288&cfg=%%%not-base64%%%");
    expect(settings.config.border.effect).toBe(defaultConfig.border.effect);
    expect(settings.friendCode).toBe("3822-5220-6288");
  });

  it("only allows http(s)/data background URLs on the web", () => {
    const hostile = serializeWebSettings({
      friendCode: "3822-5220-6288",
      configPatch: { background: { imageUrl: "/user-assets/background.png" } }
    });
    expect(parseWebSettings(`?${hostile}`).config.background.imageUrl).toBe("");

    const remote = serializeWebSettings({
      friendCode: "3822-5220-6288",
      configPatch: { background: { imageUrl: "https://example.com/bg.png" } }
    });
    expect(parseWebSettings(`?${remote}`).config.background.imageUrl).toBe("https://example.com/bg.png");
  });

  it("clamps the poll interval", () => {
    expect(parseWebSettings("?fc=3822-5220-6288&poll=1").pollSeconds).toBe(3);
    expect(parseWebSettings("?fc=3822-5220-6288&poll=500").pollSeconds).toBe(60);
  });

  it("normalizes friend codes strictly", () => {
    expect(normalizeFriendCode("3822-5220-6288")).toBe("3822-5220-6288");
    expect(normalizeFriendCode("382252206288")).toBe("3822-5220-6288");
    expect(normalizeFriendCode("12345")).toBe("");
  });
});
