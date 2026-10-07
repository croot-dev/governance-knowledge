import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@lancedb/lancedb", "apache-arrow", "pg"],
};
export default config;
