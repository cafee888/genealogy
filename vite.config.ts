import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
  const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];

  return {
    plugins: [react()],
    base: isGitHubActions && repoName ? `/${repoName}/` : "/"
  };
});
