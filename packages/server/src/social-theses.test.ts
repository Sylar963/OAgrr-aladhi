import { describe, expect, it, vi } from "vitest";

import { SocialThesisFeed } from "./social-theses.js";
import type { SharedThesis } from "./thesis-service.js";

function sharedThesis(
  id: string,
  userId: string,
  overrides: Partial<SharedThesis["thesis"]> = {},
): SharedThesis {
  return {
    thesis: {
      id,
      accountId: `acct_${userId}`,
      underlying: "BTC",
      direction: "bearish",
      horizonExpiry: "2026-10-30",
      level: 90_000,
      confirmSec: 86400,
      reason: "Failed breakout above 88k, expect a retest of 80k.",
      contextAtCreation: {
        capturedAt: 0,
        spotUsd: 86_000,
        dvol: 0.45,
        atmIv: 0.42,
        skew25d: -0.02,
        netGexUsdMillions: 10,
      },
      linkedSnapshotId: null,
      state: "active",
      createdAt: 1_000,
      endedAt: null,
      endNote: null,
      share: { userId, sharedAt: 2_000 },
      ...overrides,
    },
    status: {
      status: "INTACT",
      spotUsd: 85_000,
      roomPct: 0.05,
      atRiskBandUsd: 1_000,
      msToHorizon: 1_000_000,
      firedCandleTs: null,
    },
    spotUsd: 85_000,
  };
}

function feed(shared: SharedThesis[], handles: Record<string, string | null>) {
  const clock = { now: 10_000 };
  const load = vi.fn(async () => shared);
  const instance = new SocialThesisFeed({
    shared: load,
    handleOf: async (userId) => handles[userId] ?? null,
    limit: 50,
    ttlMs: 30_000,
    now: () => clock.now,
  });
  return { instance, load, clock };
}

describe("SocialThesisFeed", () => {
  it("publishes under the username, marks the viewer, and drops authors without one", async () => {
    const { instance } = feed(
      [
        sharedThesis("a0000000-0000-4000-8000-000000000001", "user_1"),
        sharedThesis("a0000000-0000-4000-8000-000000000002", "user_2"),
      ],
      { user_1: "satoshi", user_2: null },
    );
    const result = await instance.get("user_1");
    expect(result.theses).toHaveLength(1);
    expect(result.theses[0]).toMatchObject({
      handle: "satoshi",
      isMe: true,
      status: "INTACT",
      roomPct: 0.05,
      spotAtCreation: 86_000,
      spotUsd: 85_000,
      sharedAt: 2_000,
    });
    expect(result.theses[0]).not.toHaveProperty("userId");
    expect(result.theses[0]).not.toHaveProperty("accountId");
    expect((await instance.get("user_9")).theses[0]?.isMe).toBe(false);
  });

  it("shares one build across viewers until the ttl passes or a write invalidates it", async () => {
    const { instance, load, clock } = feed(
      [sharedThesis("a0000000-0000-4000-8000-000000000001", "user_1")],
      {
        user_1: "satoshi",
      },
    );
    await Promise.all([instance.get("user_1"), instance.get("user_2")]);
    expect(load).toHaveBeenCalledTimes(1);
    clock.now += 29_000;
    await instance.get("user_3");
    expect(load).toHaveBeenCalledTimes(1);
    instance.invalidate();
    await instance.get("user_3");
    expect(load).toHaveBeenCalledTimes(2);
    clock.now += 31_000;
    await instance.get("user_3");
    expect(load).toHaveBeenCalledTimes(3);
  });
});
