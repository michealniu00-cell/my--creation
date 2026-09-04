import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@video-agent-studio/shared',
    '@video-agent-studio/db',
    '@video-agent-studio/workflow-engine',
    '@video-agent-studio/agents',
    '@video-agent-studio/review-service',
    '@video-agent-studio/artifact-service',
    '@video-agent-studio/providers',
    '@video-agent-studio/worker',
  ],
};

export default nextConfig;
