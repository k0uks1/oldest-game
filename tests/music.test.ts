/**
 * The music after a pause: a hidden tab or another app stalls the scheduler; when it runs again it
 * must continue on the beat just ahead of now – not play every missed note at once.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catchUp, chordAt, TRACKS, trackFor } from "../src/ui/music.ts";

describe("Musik nach einer Pause", () => {
  const s16 = 0.2;

  it("keeps going unchanged while it keeps up", () => {
    assert.deepEqual(catchUp(10, 50, 9.95, s16), { nextTime: 10, step: 50 });
    assert.deepEqual(catchUp(10, 50, 10.03, s16), { nextTime: 10, step: 50 }, "a hair behind is fine");
  });

  it("after a stall it jumps ahead by whole sixteenths – grid and bar position stay right", () => {
    const r = catchUp(10, 50, 73.37, s16);
    assert.ok(r.nextTime >= 73.37 && r.nextTime < 73.37 + s16 + 0.05, `next ${String(r.nextTime)}`);
    const skipped = r.step - 50;
    assert.ok(Math.abs(r.nextTime - (10 + skipped * s16)) < 1e-9, "on the grid");
    assert.equal(skipped, Math.ceil((73.37 + 0.02 - 10) / s16));
  });
});

describe("Musik: drei Stücke", () => {
  it("every duel seed picks one of the pieces, and the seeds spread over all of them", () => {
    const seen = new Set(Array.from({ length: 30 }, (_, i) => trackFor(i * 31 + 7).id));
    assert.deepEqual([...seen].sort(), TRACKS.map((t) => t.id).sort());
    assert.equal(trackFor(-5).id, trackFor(-5).id, "negative seeds work too");
  });

  it("the chord changes by the bar and the progression moves on every eight bars", () => {
    for (const track of TRACKS) {
      assert.equal(chordAt(track, 0), chordAt(track, 15), `${track.title}: one chord per bar`);
      const firstSection = [0, 1, 2, 3].map((b) => chordAt(track, b * 16));
      const later = [0, 1, 2, 3].map((b) => chordAt(track, (16 + b) * 16));
      assert.notDeepEqual(firstSection, later, `${track.title}: the third section differs from the first`);
    }
  });
});
