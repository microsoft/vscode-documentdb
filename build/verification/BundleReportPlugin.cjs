/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

class BundleReportPlugin {
    constructor(name) {
        this.name = name;
    }

    apply(compiler) {
        compiler.hooks.done.tap('BundleReportPlugin', (stats) => {
            const directory = path.resolve(compiler.context, 'build/verification/reports');
            fs.mkdirSync(directory, { recursive: true });
            const report = stats.toJson({
                all: false,
                assets: true,
                chunks: true,
                chunkRelations: true,
                chunkModules: true,
                modules: true,
                nestedModules: true,
                dependentModules: true,
                runtimeModules: true,
                orphanModules: true,
                cachedModules: true,
                entrypoints: true,
                ids: true,
                source: false,
                modulesSpace: Infinity,
                chunkModulesSpace: Infinity,
                nestedModulesSpace: Infinity,
                assetsSpace: Infinity,
                groupModulesByAttributes: false,
                groupModulesByType: false,
                groupModulesByCacheStatus: false,
                groupModulesByLayer: false,
                groupModulesByPath: false,
                groupModulesByExtension: false,
                groupAssetsByChunk: false,
                groupAssetsByEmitStatus: false,
                groupAssetsByPath: false,
                groupAssetsByExtension: false,
            });
            report.assetHashes = Object.fromEntries(
                report.assets
                    .filter((asset) => asset.name?.endsWith('.js'))
                    .map((asset) => [
                        asset.name,
                        createHash('sha256')
                            .update(fs.readFileSync(path.join(compiler.outputPath, asset.name)))
                            .digest('hex'),
                    ]),
            );
            fs.writeFileSync(path.join(directory, `${this.name}.json`), JSON.stringify(report));
        });
    }
}

module.exports = { BundleReportPlugin };
