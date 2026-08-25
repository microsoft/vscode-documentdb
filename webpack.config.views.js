#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-env node */

const path = require('path');
const webpack = require('webpack');
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
// const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

module.exports = (env, { mode }) => {
    const isDev = mode === 'development';

    return {
        // stats: 'detailed',
        target: 'web',
        mode: mode || 'none',
        entry: {
            views: './src/webviews/index.tsx',
        },
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: '[name].js',
            libraryTarget: 'module',
        },
        cache: false,
        experiments: {
            outputModule: true,
        },
        resolve: {
            roots: [__dirname],
            extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
        module: {
            rules: [
                {
                    test: /\.(tsx?)?$/iu,
                    use: {
                        loader: 'swc-loader',
                        options: {
                            module: {
                                type: 'es6',
                            },
                            isModule: true,
                            sourceMaps: isDev,
                            jsc: {
                                keepClassNames: true,
                                target: 'es2023',
                                parser: {
                                    syntax: 'typescript',
                                    tsx: true,
                                },
                            },
                        },
                    },
                    exclude: /node_modules/u,
                },
                {
                    test: /\.css$/i,
                    use: ['style-loader', 'css-loader'],
                },
                {
                    test: /\.s[ac]ss$/i,
                    use: [
                        // Creates `style` nodes from JS strings
                        'style-loader',
                        // Translates CSS into CommonJS
                        'css-loader',
                        // Compiles Sass to CSS
                        'sass-loader',
                    ],
                },
                {
                    test: /\.ttf$/,
                    type: 'asset/resource',
                },
            ],
        },
        devServer: {
            static: {
                directory: path.join(__dirname, 'src/webviews/static'),
                publicPath: '/static',
            },
            // The webview visual harness serves `dist/` from disk, so the watch build has to land there.
            devMiddleware: {
                writeToDisk: true,
            },
            allowedHosts: 'all',
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
                'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
            },
            hot: true,
            host: '127.0.0.1',
            client: {
                overlay: {
                    // Keep the compile error/warning overlays, but disable the
                    // *runtime-error* overlay. We cannot use a `runtimeErrors`
                    // FUNCTION to filter only the benign "ResizeObserver loop …"
                    // warning: the webview's Content Security Policy forbids
                    // `unsafe-eval`, and webpack-dev-server ships any function
                    // filter to its client and rebuilds it with `new Function(...)`
                    // — which the CSP blocks, crashing the dev client and the whole
                    // webview render. A boolean is serialized as-is (no eval).
                    //
                    // Runtime errors (including that benign, self-resolving
                    // ResizeObserver warning from Fluent's popup positioning) still
                    // print to the devtools console, and a *sustained* loop is
                    // flagged by installResizeObserverLoopDetector().
                    runtimeErrors: false,
                },
            },
            compress: true,
            port: 18080,
            webSocketServer: 'ws',
        },
        plugins: [
            //new BundleAnalyzerPlugin(),
            new MonacoWebpackPlugin({ languages: ['sql', 'json'] }),
            new webpack.ProvidePlugin({ React: 'react' }),
            isDev && new webpack.HotModuleReplacementPlugin(),
            isDev && new ReactRefreshWebpackPlugin(),
            new CopyWebpackPlugin({
                patterns: [{ from: 'src/webviews/static', to: 'static', noErrorOnMissing: true }].filter(Boolean),
            }),
            new webpack.optimize.LimitChunkCountPlugin({
                maxChunks: 1,
            }),
        ],
        devtool: isDev ? 'source-map' : false,
        infrastructureLogging: {
            level: 'log', // enables logging required for problem matchers
        },
    };
};
