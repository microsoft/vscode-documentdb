/**
 * Working-directory module-resolution probe (design doc §2.3 #14).
 *
 * Built as a Node SEA and as a Bun binary, then run from (a) a cwd that contains
 * node_modules/probe-pkg, (b) an empty cwd, (c) an empty cwd with node_modules next to the
 * binary. Prints one JSON line saying which load paths found the package and from where.
 */
const out = { cwd: process.cwd(), runtime: process.versions.bun ? 'bun' : 'node' };
try {
    out.require = require('probe-pkg');
} catch (e) {
    out.requireErr = e.code || e.message;
}
(async () => {
    try {
        const m = await eval('import("probe-pkg")'); // the pattern @mongodb-js/oidc-plugin uses
        out.evalImport = m.default ?? m;
    } catch (e) {
        out.evalImportErr = e.code || e.message;
    }
    try {
        const { createRequire } = require('node:module');
        out.createRequireCwd = createRequire(process.cwd() + '/')('probe-pkg');
    } catch (e) {
        out.createRequireCwdErr = e.code || e.message;
    }
    console.log(JSON.stringify(out));
})();
