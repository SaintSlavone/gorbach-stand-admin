import type { NextConfig } from "next";

const config: NextConfig = {
	experimental: { workerThreads: true, webpackBuildWorker: false, cpus: 1 },
};

export default config;
