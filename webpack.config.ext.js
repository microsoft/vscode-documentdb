/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const webpack = require('webpack');
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

const excludeRegion = /<!-- region exclude-from-marketplace -->.*?<!-- endregion exclude-from-marketplace -->/gis;
const supportedLanguages = [];

module.exports = (env, { mode }) => {
    const isDev = mode === 'development';

    return {
        target: 'node',
        mode: mode || 'none',
        node: { __filename: false, __dirname: false },
        entry: {
            main: './main.ts',
            playgroundWorker: './src/documentdb/playground/playgroundWorker.ts',
            playgroundTsPlugin: './src/documentdb/playground/tsPlugin/index.ts',
        },
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: '[name].js',
            chunkFormat: 'commonjs',
            libraryTarget: 'commonjs2',
            devtoolModuleFilenameTemplate: '[resource-path]',
        },
        cache: false,
        optimization: {
            minimize: !isDev,
            minimizer: [
                new TerserPlugin({
                    // TODO: Code should not rely on function names
                    //  https://msdata.visualstudio.com/CosmosDB/_workitems/edit/3594054
                    // minify: TerserPlugin.swcMinify, // SWC minify doesn't have "keep_fnames" option
                    terserOptions: {
                        keep_classnames: true,
                        keep_fnames: true,
                    },
                }),
            ],
        },
        externalsType: 'node-commonjs',
        externals: [
            {
                vs: 'vs',
                vscode: 'commonjs vscode',
                /* Mongodb optional dependencies */
                kerberos: 'commonjs kerberos',
                '@mongodb-js/zstd': 'commonjs @mongodb-js/zstd',
                '@aws-sdk/credential-providers': 'commonjs @aws-sdk/credential-providers',
                'gcp-metadata': 'commonjs gcp-metadata',
                snappy: 'commonjs snappy',
                socks: 'commonjs socks',
                aws4: 'commonjs aws4',
                'mongodb-client-encryption': 'commonjs mongodb-client-encryption',
                /* @mongosh transitive optional dependencies */
                electron: 'commonjs electron',
                'os-dns-native': 'commonjs os-dns-native',
                'cpu-features': 'commonjs cpu-features',
                ssh2: 'commonjs ssh2',
                'win-export-certificate-and-key': 'commonjs win-export-certificate-and-key',
                'macos-export-certificate-and-key': 'commonjs macos-export-certificate-and-key',
                /* PG optional dependencies */
                'pg-native': 'commonjs pg-native',
            },
            // Handle @babel/preset-typescript and its subpath imports (e.g. /package.json)
            ({ request }, callback) => {
                if (request && request.startsWith('@babel/preset-typescript')) {
                    return callback(null, `commonjs ${request}`);
                }
                callback();
            },
        ],
        resolve: {
            roots: [__dirname],
            // conditionNames: ['import', 'require', 'node'], // Uncomment when we will use VSCode what supports modules
            mainFields: ['module', 'main'],
            extensions: ['.js', '.ts'],
        },
        module: {
            rules: [
                {
                    test: /\.(ts)$/iu,
                    use: {
                        loader: 'swc-loader',
                        options: {
                            module: {
                                type: 'commonjs',
                            },
                            isModule: true,
                            sourceMaps: isDev,
                            jsc: {
                                baseUrl: path.resolve(__dirname, './'), // Set absolute path here
                                keepClassNames: true,
                                target: 'es2023',
                                parser: {
                                    syntax: 'typescript',
                                    tsx: true,
                                    functionBind: false,
                                    decorators: true,
                                    dynamicImport: true,
                                },
                            },
                        },
                    },
                },
            ],
        },
        plugins: [
            new webpack.EnvironmentPlugin({
                NODE_ENV: mode,
                IS_BUNDLE: 'true',
                DEVSERVER: isDev ? 'true' : '',
            }),
            // Copy everything what is needed to run the extension
            // - We can't bundle everything into one file because system-dependent binaries in node_modules
            // - We mustn't change source code as it does the old packaging script
            // - The dist folder should be ready to be published to the marketplace and be only one working folder
            new CopyWebpackPlugin({
                patterns: [
                    {
                        from: 'l10n',
                        to: 'l10n',
                        noErrorOnMissing: true,
                        filter: (filepath) =>
                            new RegExp(`bundle.l10n.(${supportedLanguages.join('|')}).json`).test(filepath), // Only supported languages
                    },
                    {
                        from: 'resources',
                        to: 'resources',
                    },
                    {
                        from: 'package.json',
                        to: 'package.json',
                    },
                    {
                        from: 'package.nls.json',
                        to: 'package.nls.json',
                    },
                    {
                        from: 'playground-language-configuration.json',
                        to: 'playground-language-configuration.json',
                    },
                    {
                        from: 'syntaxes',
                        to: 'syntaxes',
                    },
                    {
                        from: 'package.nls.*.json',
                        to: '[name][ext]',
                        noErrorOnMissing: true,
                        filter: (filepath) =>
                            new RegExp(`package.nls.(${supportedLanguages.join('|')}).json`).test(filepath), // Only supported languages
                    },
                    {
                        from: 'CHANGELOG.md',
                        to: 'CHANGELOG.md',
                    },
                    {
                        from: 'LICENSE.md',
                        to: 'LICENSE.md',
                    },
                    {
                        from: 'NOTICE.html',
                        to: 'NOTICE.html',
                    },
                    {
                        from: 'README.md',
                        to: 'README.md',
                        transform: isDev ? undefined : (content) => content.toString().replace(excludeRegion, ''),
                    },
                    {
                        from: 'SECURITY.md',
                        to: 'SECURITY.md',
                    },
                    {
                        from: 'SUPPORT.md',
                        to: 'SUPPORT.md',
                    },
                    {
                        from: '.vscodeignore',
                        to: '.vscodeignore',
                        toType: 'file',
                    },
                    {
                        from: './packages/documentdb-shell-api-types/typeDefs',
                        to: 'typeDefs',
                    },
                    {
                        from: './node_modules/@microsoft/vscode-azext-azureutils/resources/azureSubscription.svg',
                        to: 'resources/from_node_modules/@microsoft/vscode-azext-azureutils/resources/azureSubscription.svg',
                    },
                    {
                        from: './node_modules/@microsoft/vscode-azext-azureutils/resources/azureIcons/MongoClusters.svg',
                        to: 'resources/from_node_modules/@microsoft/vscode-azext-azureutils/resources/azureIcons/MongoClusters.svg',
                    },
                    {
                        from: './node_modules/@microsoft/vscode-azext-azureutils/resources/azureIcons/AzureCosmosDb.svg',
                        to: 'resources/from_node_modules/@microsoft/vscode-azext-azureutils/resources/azureIcons/AzureCosmosDb.svg',
                    },
                ],
            }),
        ].filter(Boolean),
        devtool: isDev ? 'source-map' : false,
        // Filter known warnings from @mongosh transitive dependencies.
        // These are all "Critical dependency" warnings from @babel/core,
        // browserslist, and express that use dynamic require() patterns
        // webpack can't statically analyze. None execute at runtime.
        // See docs/plan/06-scrapbook-rebuild.md §"Webpack Externals" for details (historical reference).
        ignoreWarnings: [
            { module: /node_modules[\\/]@babel[\\/]core/ },
            { module: /node_modules[\\/]browserslist/ },
            { module: /node_modules[\\/]@mongodb-js[\\/]oidc-plugin[\\/]node_modules[\\/]express/ },
        ],
        infrastructureLogging: {
            level: 'log', // enables logging required for problem matchers
        },
    };
};
