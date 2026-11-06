/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the site is plain HTML/CSS for now, so Netlify needs no runtime.
  // Remove this when the app needs server rendering.
  output: "export",
  trailingSlash: false,
};

export default nextConfig;
