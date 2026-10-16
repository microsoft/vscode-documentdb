/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @param {{ devServerOrigin: string }} options
 * @returns {import('vite').Plugin}
 */
export function webviewScenarios({ devServerOrigin }) {
    return {
        name: 'documentdb:webview-scenarios',
        apply: 'serve',
        configureServer(server) {
            server.middlewares.use(async (request, response, next) => {
                const url = request.url ?? '/';
                // Let Vite handle source modules, HMR and assets. Scenario paths are extensionless;
                // the only JS endpoint owned here is the Playwright snippet below /scenarios/.
                if (/^\/(?:@|src\/|packages\/|node_modules\/|build\/)/.test(url)) {
                    next();
                    return;
                }
                try {
                    const { parseScenarioRoute, runnerRoutes, scenarioHtml, scenarioIndex, scenarioRunner } =
                        await server.ssrLoadModule('/build/verification/browser/scenario-server.ts');
                    const route = parseScenarioRoute(url);
                    const routes = runnerRoutes(url);
                    response.setHeader('Cache-Control', 'no-store');
                    if (routes) {
                        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
                        response.end(scenarioRunner(routes));
                    } else {
                        response.setHeader('Content-Type', 'text/html; charset=utf-8');
                        if (url === '/scenarios/' || url === '/scenarios') {
                            response.end(scenarioIndex());
                        } else if (route) {
                            response.end(scenarioHtml(route, devServerOrigin));
                        } else {
                            response.statusCode = 404;
                            response.end(scenarioIndex(`Unknown L2-dev route: ${url}`));
                        }
                    }
                } catch (error) {
                    next(error);
                }
            });
        },
    };
}
