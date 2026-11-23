/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  // Migration and rights scripts travel with the server functions (ADR-0009).
  outputFileTracingIncludes: { '/**': ['../../packages/db/migrations/**', '../../infra/postgres/**'] },
  transpilePackages: ['@unoa/config', '@unoa/domain', '@unoa/jobs'],
  // Loaded by Node at run time: its migration files are read from disk, not bundled.
  serverExternalPackages: ['pg'],
};
