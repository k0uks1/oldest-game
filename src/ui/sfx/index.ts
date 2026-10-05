// The sound effects: CC0 recordings from Kenney (www.kenney.nl – see LICENSE-Kenney-CC0.txt), trimmed,
// normalised and turned into small mono MP3s (every browser decodes MP3). `<group>-<n>` are variations of one sound.
import sfx_bell from "./bell.mp3";
import sfx_boom from "./boom.mp3";
import sfx_chime from "./chime.mp3";
import sfx_discovery from "./discovery.mp3";
import sfx_door from "./door.mp3";
import sfx_hit_1 from "./hit-1.mp3";
import sfx_hit_2 from "./hit-2.mp3";
import sfx_hit_3 from "./hit-3.mp3";
import sfx_hit_4 from "./hit-4.mp3";
import sfx_hit_5 from "./hit-5.mp3";
import sfx_page_1 from "./page-1.mp3";
import sfx_page_2 from "./page-2.mp3";
import sfx_slash_1 from "./slash-1.mp3";
import sfx_slash_2 from "./slash-2.mp3";
import sfx_thud_1 from "./thud-1.mp3";
import sfx_thud_2 from "./thud-2.mp3";
import sfx_thud_3 from "./thud-3.mp3";

export const SFX: Readonly<Record<string, string>> = {
  "bell": sfx_bell,
  "boom": sfx_boom,
  "chime": sfx_chime,
  "discovery": sfx_discovery,
  "door": sfx_door,
  "hit-1": sfx_hit_1,
  "hit-2": sfx_hit_2,
  "hit-3": sfx_hit_3,
  "hit-4": sfx_hit_4,
  "hit-5": sfx_hit_5,
  "page-1": sfx_page_1,
  "page-2": sfx_page_2,
  "slash-1": sfx_slash_1,
  "slash-2": sfx_slash_2,
  "thud-1": sfx_thud_1,
  "thud-2": sfx_thud_2,
  "thud-3": sfx_thud_3,
};
