/** Images bundled into the single HTML file as data URLs (esbuild `dataurl` loader). */
declare module "*.png" {
  const url: string;
  export default url;
}

/** Sound effects (CC0, Kenney) bundled the same way. */
declare module "*.mp3" {
  const url: string;
  export default url;
}
