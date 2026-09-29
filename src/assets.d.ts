/** Images bundled into the single HTML file as data URLs (esbuild `dataurl` loader). */
declare module "*.png" {
  const url: string;
  export default url;
}
