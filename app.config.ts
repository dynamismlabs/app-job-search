import type { AppConfig } from "@app-builder/core";
export const appConfig: AppConfig = {
  id: "job-search",
  name: "Job Search",
  description: "Opportunities, interviews, correspondence and versioned materials together.",
  port: 4561,
  // Its rules commit with transaction(), which Cloudflare D1 can't run yet.
  platforms: ["node"],
};
