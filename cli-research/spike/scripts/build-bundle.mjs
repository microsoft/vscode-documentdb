/**
 * Bundle src/main.ts into a single CommonJS file (dist/bundle.cjs) with esbuild.
 * This is the shared prerequisite for Node SEA (which needs one CJS entry file).
 *
 * Optional native/cloud deps of the mongodb driver are marked external: the driver
 * wraps each of these requires in try/catch and degrades gracefully when absent.
 */
import * as esbuild from 'esbuild';

const OPTIONAL_DRIVER_DEPS = [
    'kerberos',
    '@mongodb-js/zstd',
    '@aws-sdk/credential-providers',
    'mongodb-client-encryption',
    'snappy',
    'socks',
    'gcp-metadata',
    'aws4',
    // Pulled in by @mongosh/* transitively; all optional/lazy at runtime:
    'electron', // @mongodb-js/oidc-plugin optional electron integration
    'ssh2', // devtools-connect SSH tunnels (native addon)
    'cpu-features', // ssh2 optional native addon
    '@babel/preset-typescript', // @babel/core dynamic config probing (unused at runtime)
];

const result = await esbuild.build({
    entryPoints: ['src/main.ts'],
    outfile: 'dist/bundle.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: OPTIONAL_DRIVER_DEPS,
    sourcemap: false,
    logLevel: 'info',
    // Some deps read package.json versions or use import.meta; keep names readable for debugging.
    minify: false,
});

if (result.errors.length > 0) {
    process.exit(1);
}
