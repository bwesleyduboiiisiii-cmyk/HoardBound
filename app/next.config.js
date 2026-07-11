/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // avoid double-subscribing Realtime channels in dev
};
module.exports = nextConfig;
