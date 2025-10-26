/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import {
    CommandType,
    detectCommandType,
    optimizeQuery,
    type QueryOptimizationContext,
} from '../../src/commands/llmEnhancedCommands/optimizeCommands';
import { ClustersClient } from '../../src/documentdb/ClustersClient';
import { CredentialCache } from '../../src/documentdb/CredentialCache';
import { type NativeAuthConfig } from '../../src/documentdb/auth/AuthConfig';
import { type IndexSpecification } from '../../src/documentdb/llmEnhancedFeatureApis';
import { type PerformanceMeasurement, type TestCase, type TestConfig, type TestResult } from './types';

/**
 * Progress callback function type
 */
export type ProgressCallback = (message: string) => void;

/**
 * Extracts username and password from a MongoDB connection string
 * Handles both mongodb:// and mongodb+srv:// formats
 * @param connectionString The connection string to parse
 * @returns Object with connectionUser and connectionPassword, or undefined if no credentials found
 */
function parseCredentialsFromConnectionString(connectionString: string): NativeAuthConfig | undefined {
    try {
        // Remove the protocol
        let authPart = connectionString;
        if (authPart.startsWith('mongodb+srv://')) {
            authPart = authPart.substring('mongodb+srv://'.length);
        } else if (authPart.startsWith('mongodb://')) {
            authPart = authPart.substring('mongodb://'.length);
        }

        // Find the @ symbol which separates credentials from host
        const atIndex = authPart.indexOf('@');
        if (atIndex === -1) {
            // No credentials in connection string
            return undefined;
        }

        // Extract the credentials part
        const credentialsPart = authPart.substring(0, atIndex);

        // Split username and password
        const colonIndex = credentialsPart.indexOf(':');
        if (colonIndex === -1) {
            // Only username, no password
            return {
                connectionUser: decodeURIComponent(credentialsPart),
            };
        }

        const username = credentialsPart.substring(0, colonIndex);
        const password = credentialsPart.substring(colonIndex + 1);

        return {
            connectionUser: decodeURIComponent(username),
            connectionPassword: decodeURIComponent(password),
        };
    } catch (error) {
        console.warn('Failed to parse credentials from connection string:', error);
        return undefined;
    }
}

/**
 * Converts MongoDB query syntax to valid JSON by quoting unquoted property names
 * and converting single quotes to double quotes
 * @param mongoStr MongoDB object syntax string (e.g., {age: 25} or {gender: 'F'})
 * @returns Valid JSON string
 */
function mongoToJSON(mongoStr: string): string {
    let result = mongoStr;

    // Step 1: Replace single quotes with double quotes for string values
    // This handles patterns like: 'string', 'value', etc.
    result = result.replace(/'([^']*)'/g, (_match, captured) => {
        return `"${captured}"`;
    });

    // Step 2: Quote unquoted property names: age: 25 -> "age": 25
    // This handles patterns like: {age: or ,age: but not "age": or 'age':
    result = result.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');

    return result;
}

/**
 * Extracts the content within braces from a method call
 * Handles nested braces correctly
 * @param methodCall Method call string (e.g., "find({...})" or ".sort({...})")
 * @returns Content within the outermost braces
 */
function extractBraceContent(methodCall: string): string | null {
    const openParen = methodCall.indexOf('(');
    if (openParen === -1) return null;

    let braceDepth = 0;
    let inString = false;
    let stringChar: string | null = null;
    let start = -1;

    for (let i = openParen; i < methodCall.length; i += 1) {
        const char = methodCall[i];

        // Handle string boundaries
        if ((char === '"' || char === "'" || char === '`') && (i === 0 || methodCall[i - 1] !== '\\')) {
            if (!inString) {
                inString = true;
                stringChar = char;
            } else if (char === stringChar) {
                inString = false;
                stringChar = null;
            }
        }

        if (inString) continue;

        if (char === '{') {
            if (braceDepth === 0) {
                start = i;
            }
            braceDepth += 1;
        } else if (char === '}') {
            braceDepth -= 1;
            if (braceDepth === 0 && start !== -1) {
                return methodCall.substring(start, i + 1);
            }
        }
    }

    return null;
}

/**
 * Parses MongoDB find query string and extracts parameters
 * Handles queries like: db.collection.find({filter}).sort({sort}).limit(10).skip(5)
 * @param queryString The MongoDB query string
 * @returns ExplainOptions object with parsed parameters
 */
function parseFindQueryParameters(queryString: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filter?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sort?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    projection?: any;
    skip?: number;
    limit?: number;
} {
    const result: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        filter?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sort?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        projection?: any;
        skip?: number;
        limit?: number;
    } = {};

    try {
        // Extract filter from find({...})
        const findMatch = queryString.match(/\.find\s*\([^)]*\)/);
        if (findMatch) {
            const filterContent = extractBraceContent(findMatch[0]);
            if (filterContent) {
                const jsonStr = mongoToJSON(filterContent);
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                result.filter = JSON.parse(jsonStr);
            } else {
                result.filter = {};
            }
        } else {
            result.filter = {};
        }

        // Extract sort from .sort({...})
        const sortMatch = queryString.match(/\.sort\s*\([^)]*\)/);
        if (sortMatch) {
            const sortContent = extractBraceContent(sortMatch[0]);
            if (sortContent) {
                const jsonStr = mongoToJSON(sortContent);
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                result.sort = JSON.parse(jsonStr);
            }
        }

        // Extract projection from .project({...}) or .projection({...})
        const projectionMatch = queryString.match(/\.(?:project|projection)\s*\([^)]*\)/);
        if (projectionMatch) {
            const projectionContent = extractBraceContent(projectionMatch[0]);
            if (projectionContent) {
                const jsonStr = mongoToJSON(projectionContent);
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                result.projection = JSON.parse(jsonStr);
            }
        }

        // Extract skip from .skip(number)
        const skipMatch = queryString.match(/\.skip\s*\(\s*(\d+)\s*\)/);
        if (skipMatch) {
            result.skip = parseInt(skipMatch[1], 10);
        }

        // Extract limit from .limit(number)
        const limitMatch = queryString.match(/\.limit\s*\(\s*(\d+)\s*\)/);
        if (limitMatch) {
            result.limit = parseInt(limitMatch[1], 10);
        }

        return result;
    } catch (error) {
        console.warn(`Failed to parse find query parameters from "${queryString}":`, error);
        // Return default empty filter on parse error
        return { filter: {} };
    }
}

/**
 * Gets or creates a cluster ID from the test configuration
 * If clusterId is provided and has credentials, returns it directly
 * If connectionString is provided, registers it and returns a new clusterId
 * @param config Test configuration
 * @returns The cluster ID
 */
async function getOrCreateClusterId(config: TestConfig): Promise<string | undefined> {
    // Try to use clusterId if provided and has credentials
    if (config.clusterId) {
        // Check if credentials exist for this clusterId
        if (CredentialCache.hasCredentials(config.clusterId)) {
            return config.clusterId;
        }

        // If clusterId provided but no credentials, and connectionString available, use connectionString instead
        if (!config.connectionString) {
            throw new Error(
                `No credentials found for cluster ID "${config.clusterId}". ` +
                `Please provide either: 1) pre-registered credentials in VS Code, or 2) a "connectionString" field in the test config.`
            );
        }
    }

    if (config.connectionString) {
        // Create a temporary credential ID for this connection string
        const tempId = `test-cluster-${Date.now()}`;

        // Parse credentials from the connection string
        const nativeAuthConfig = parseCredentialsFromConnectionString(config.connectionString);

        // Register the connection string in the credential cache with native auth method
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        CredentialCache.setAuthCredentials(
            tempId,
            'NativeAuth' as any, // Using NativeAuth as default for test connections
            config.connectionString,
            nativeAuthConfig, // Pass parsed credentials
            undefined, // No emulator configuration
            undefined, // No Entra ID config
        );

        return tempId;
    }

    throw new Error('Either clusterId with registered credentials or connectionString is required in test configuration');
}

/**
 * Executes a single test case
 * @param testCase The test case to execute
 * @param config Test configuration
 * @param context Action context for telemetry
 * @param skipPerformance Whether to skip performance measurements
 * @param progress Optional progress callback
 * @returns Test result
 */
export async function executeTestCase(
    testCase: TestCase,
    config: TestConfig,
    context: IActionContext,
    skipPerformance: boolean = false,
    progress?: ProgressCallback,
): Promise<TestResult> {
    const result: TestResult = {
        collectionName: testCase.collectionName,
        category: testCase.category,
        scenarioDescription: testCase.scenarioDescription,
        query: testCase.query,
        expectedResult: testCase.expectedResult,
        timestamp: new Date().toISOString(),
    };

    try {
        progress?.(`Detecting command type...`);
        // Detect command type
        const commandType = detectCommandType(testCase.query);

        // Get or create cluster client
        const clusterId = await getOrCreateClusterId(config);
        if (!clusterId) {
            throw new Error('clusterId or connectionString is required in configuration');
        }

        progress?.(`Building query context...`);
        // Build query optimization context
        const queryContext: QueryOptimizationContext = {
            clusterId,
            databaseName: config.databaseName,
            collectionName: testCase.collectionName,
            query: testCase.query,
            commandType,
        };

        // Measure initial performance if not skipped
        if (!skipPerformance) {
            progress?.(`Measuring initial query performance...`);
            const initialPerf = await measureQueryPerformance(queryContext, config, progress);
            result.queryPerformance = initialPerf.executionTime;
        }

        // Get client for later use (creating/dropping indexes if needed)
        const client = await ClustersClient.getClient(clusterId);

        progress?.(`Running AI optimization...`);
        // Run optimization
        const optimizationResult = await optimizeQuery(context, queryContext);

        progress?.(`Parsing AI recommendations...`);
        // Parse the optimization recommendations
        try {
            const recommendations = JSON.parse(optimizationResult.recommendations) as {
                metadata?: {
                    executionStats?: unknown;
                    collectionStats?: unknown;
                    indexStats?: unknown;
                };
                analysis?: string;
                improvements?: Array<{
                    mongoShell?: string;
                }>;
            };

            // Extract execution plan, collection stats, and index stats from recommendations
            if (recommendations.metadata?.executionStats) {
                result.executionPlan = JSON.stringify(recommendations.metadata.executionStats);
            }

            if (recommendations.metadata?.collectionStats) {
                result.collectionStats = JSON.stringify(recommendations.metadata.collectionStats);
            }

            if (recommendations.metadata?.indexStats) {
                result.indexStats = JSON.stringify(recommendations.metadata.indexStats);
            }

            // Extract analysis
            result.analysis = recommendations.analysis || '';

            // Extract suggestions (Mongo shell commands)
            if (recommendations.improvements && recommendations.improvements.length > 0) {
                result.suggestions = recommendations.improvements
                    .map((imp) => imp.mongoShell)
                    .filter((cmd) => cmd)
                    .join('\n');

                progress?.(`Comparing with expected results...`);
                // Compare with expected result
                result.matchesExpected = compareWithExpected(result.suggestions, testCase.expectedResult);
            }
        } catch (parseError) {
            // If parsing fails, store raw recommendations
            result.suggestions = optimizationResult.recommendations;
            result.errors = `Failed to parse recommendations: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
        }

        result.modelUsed = optimizationResult.modelUsed;

        progress?.(`Test completed successfully`);
        // Measure performance after applying suggestions (if not skipped and suggestions exist)
        if (!skipPerformance && result.suggestions) {
            try {
                // Detect the action type from suggestions
                const actionType = detectIndexAction(result.suggestions);
                progress?.(`Detected action type: ${actionType}`);

                let actionApplied = false;
                let originalIndexSpec: IndexSpecification | undefined;

                if (actionType === 'create') {
                    progress?.(`Creating suggested index...`);
                    actionApplied = await createIndexFromSuggestion(
                        client,
                        config.databaseName,
                        testCase.collectionName,
                        result.suggestions,
                        progress,
                    );
                } else if (actionType === 'drop') {
                    progress?.(`Dropping index...`);
                    actionApplied = await dropIndexFromSuggestion(
                        client,
                        config.databaseName,
                        testCase.collectionName,
                        result.suggestions,
                        progress,
                    );
                } else if (actionType === 'modify') {
                    progress?.(`Modifying index...`);
                    // For modify operations, we need to drop and recreate
                    originalIndexSpec = parseCreateIndexCommand(result.suggestions);
                    actionApplied = await modifyIndexFromSuggestion(
                        client,
                        config.databaseName,
                        testCase.collectionName,
                        result.suggestions,
                        progress,
                    );
                }

                if (actionApplied) {
                    try {
                        progress?.(`Measuring query performance with modified index...`);
                        const updatedPerf = await measureQueryPerformance(queryContext, config, progress);
                        result.updatedPerformance = updatedPerf.executionTime;
                        result.updatedExecutionPlan = updatedPerf.executionPlan;

                        // Calculate improvement if both measurements exist
                        if (result.queryPerformance && result.updatedPerformance) {
                            result.performanceImprovement =
                                ((result.queryPerformance - result.updatedPerformance) / result.queryPerformance) * 100;

                            progress?.(`Performance improvement: ${result.performanceImprovement.toFixed(2)}%`);
                        }
                    } finally {
                        // Clean up: restore original state
                        progress?.(`Cleaning up: restoring original state...`);

                        // For drop actions, extract the index name that was dropped
                        let indexNameForRestore: string | undefined;
                        if (actionType === 'drop') {
                            indexNameForRestore = extractIndexNameFromDropCommand(result.suggestions);
                        }

                        await restoreOriginalIndexState(
                            client,
                            config.databaseName,
                            testCase.collectionName,
                            actionType,
                            originalIndexSpec,
                            result.suggestions,
                            result.indexStats,
                            indexNameForRestore,
                            progress,
                        );
                    }
                }
            } catch (perfError) {
                // Non-fatal error for performance measurement
                progress?.(`Performance measurement failed: ${perfError instanceof Error ? perfError.message : String(perfError)}`);
                console.warn('Performance measurement after optimization failed:', perfError);
            }
        }
    } catch (error) {
        result.errors = error instanceof Error ? error.message : String(error);
        progress?.(`Test failed: ${result.errors}`);
    }

    return result;
}


/**
 * Measures query performance
 * @param queryContext Query context
 * @param config Test configuration
 * @param progress Optional progress callback
 * @returns Performance measurement
 */
async function measureQueryPerformance(
    queryContext: QueryOptimizationContext,
    config: TestConfig,
    progress?: ProgressCallback,
): Promise<PerformanceMeasurement> {
    // Validate clusterId is provided
    if (!queryContext.clusterId) {
        throw new Error('clusterId is required in query context');
    }

    const client = await ClustersClient.getClient(queryContext.clusterId);

    // Warm up connection by listing collections (simple, non-intrusive operation)
    if (config.warmupQuery) {
        try {
            await client.listCollections(config.databaseName);
        } catch {
            // Ignore warmup errors
        }
    }

    try {
        // Execute the query with explain to get execution stats
        let explainResult;
        let findParams;

        if (queryContext.commandType === CommandType.Find) {
            // Parse the find query to extract parameters
            findParams = parseFindQueryParameters(queryContext.query);
            explainResult = await client.explainFind(
                queryContext.databaseName,
                queryContext.collectionName,
                findParams,
            );
        } else if (queryContext.commandType === CommandType.Aggregate) {
            explainResult = await client.explainAggregate(
                queryContext.databaseName,
                queryContext.collectionName,
                [], // This should be parsed from the query
            );
        } else if (queryContext.commandType === CommandType.Count) {
            explainResult = await client.explainCount(
                queryContext.databaseName,
                queryContext.collectionName,
                {}, // This should be parsed from the query
            );
        }

        // Calculate execution time with 5 tries
        const tries = 5;
        let executionTimes: number[] = [];
        let startTime: number;
        // convert the value of each field in findParams from object to json string (not entire findParams)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let findParamsCopy: any = { };
        for (const key in findParams) {
            if (typeof findParams[key] === 'object') {
                findParamsCopy[key] = JSON.stringify(findParams[key]);
            } else {
                findParamsCopy[key] = findParams[key];
            }
        }

        // Build and print the query command string once (before the loop)
        if (queryContext.commandType === CommandType.Find) {
            const filterStr = findParamsCopy.filter || '{}';
            const commandParts: string[] = [`db.${queryContext.databaseName}.${queryContext.collectionName}.find(${filterStr})`];
            if (findParamsCopy.sort) {
                commandParts.push(`.sort(${findParamsCopy.sort})`);
            }
            if (findParamsCopy.project && findParamsCopy.project !== '{}') {
                commandParts.push(`.projection(${findParamsCopy.project})`);
            }
            if (findParamsCopy.skip && findParamsCopy.skip > 0) {
                commandParts.push(`.skip(${findParamsCopy.skip})`);
            }
            if (findParamsCopy.limit && findParamsCopy.limit > 0) {
                commandParts.push(`.limit(${findParamsCopy.limit})`);
            }
            progress?.(`Executing: ${commandParts.join('')}`);
        } else if (queryContext.commandType === CommandType.Aggregate) {
            progress?.(`Executing: db.${queryContext.databaseName}.${queryContext.collectionName}.aggregate([...])`);
        } else if (queryContext.commandType === CommandType.Count) {
            progress?.(`Executing: db.${queryContext.databaseName}.${queryContext.collectionName}.countDocuments({...})`);
        }

        for (let i = 0; i < tries - 1; i += 1) {
            if (queryContext.commandType === CommandType.Find) {
                startTime = performance.now();
                await client.runFindQuery(
                    queryContext.databaseName,
                    queryContext.collectionName,
                    findParamsCopy,
                );
            } else if (queryContext.commandType === CommandType.Aggregate) {
                startTime = performance.now();
            } else if (queryContext.commandType === CommandType.Count) {
                startTime = performance.now();
            } else {
                startTime = performance.now();
            }
            const endTime = performance.now();
            const executionTime = endTime - startTime;
            executionTimes.push(executionTime);
        }

        const avgExecutionTime = executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length;
        // progress?.(`Average execution time: ${avgExecutionTime.toFixed(2)}ms`);

        return {
            executionTime: avgExecutionTime,
            docsExamined: explainResult?.executionStats?.totalDocsExamined as number | undefined,
            keysExamined: explainResult?.executionStats?.totalKeysExamined as number | undefined,
            executionPlan: explainResult ? JSON.stringify(explainResult) : undefined,
        };
    } catch (error) {
        throw new Error(`Performance measurement failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Compares AI-generated suggestions with expected result
 * @param suggestions AI-generated suggestions
 * @param expected Expected result
 * @returns True if they match
 */
function compareWithExpected(suggestions: string, expected: string): boolean {
    // Normalize both strings for comparison
    const normalizeSuggestion = (str: string) => str.replace(/\s+/g, '').replace(/'/g, '"').toLowerCase();

    const normalizedSuggestions = normalizeSuggestion(suggestions);
    const normalizedExpected = normalizeSuggestion(expected);

    // Check if suggestions contain the expected result
    return normalizedSuggestions.includes(normalizedExpected) || normalizedExpected.includes(normalizedSuggestions);
}

/**
 * Detects the type of index action from the MongoDB shell command
 * @param mongoShellCommand Mongo shell command to analyze
 * @returns 'create', 'drop', or 'modify'
 */
function detectIndexAction(mongoShellCommand: string): 'create' | 'drop' | 'modify' {
    const command = mongoShellCommand.toLowerCase();

    if (command.includes('dropindex')) {
        return 'drop';
    } else if (command.includes('createindex')) {
        return 'create';
    } else {
        // Default to modify for other operations
        return 'modify';
    }
}

/**
 * Parses MongoDB index creation command and extracts index specification
 * Handles commands like: db.collection.createIndex({field: 1})
 * @param mongoShellCommand Mongo shell command to parse
 * @returns IndexSpecification if valid, undefined otherwise
 */
function parseCreateIndexCommand(mongoShellCommand: string): IndexSpecification | undefined {
    try {
        // Match pattern: db.collection.createIndex({...})
        const match = mongoShellCommand.match(/createIndex\s*\(\s*(\{.*?\})\s*(?:,\s*(\{.*?\}))?\s*\)/s);
        if (!match) {
            return undefined;
        }

        const keySpecStr = match[1];
        const optionsStr = match[2];

        // Parse the key specification
        const keySpec = JSON.parse(keySpecStr) as Record<string, number | string>;

        // Build the index specification
        const indexSpec: IndexSpecification = {
            key: keySpec,
        };

        // Parse options if provided
        if (optionsStr) {
            try {
                const options = JSON.parse(optionsStr);
                Object.assign(indexSpec, options);
            } catch {
                // If options parsing fails, just use the key spec
            }
        }

        return indexSpec;
    } catch (error) {
        console.warn('Failed to parse createIndex command:', mongoShellCommand, error);
        return undefined;
    }
}

/**
 * Extracts index name from index key specification
 * Generates a name like "field1_1_field2_-1" from {field1: 1, field2: -1}
 * @param key Index key specification
 * @returns Generated index name
 */
function generateIndexName(key: Record<string, number | string>): string {
    return Object.entries(key)
        .map(([field, direction]) => `${field}_${direction}`)
        .join('_');
}

/**
 * Extracts index name from a dropIndex command
 * @param dropIndexCommand Command like: db.collection.dropIndex("indexName")
 * @returns Index name if found, undefined otherwise
 */
function extractIndexNameFromDropCommand(dropIndexCommand: string): string | undefined {
    const match = dropIndexCommand.match(/dropIndex\s*\(\s*['"](.*?)['"]\s*\)/);
    return match ? match[1] : undefined;
}

/**
 * Creates an index from the AI suggestion command
 * @param client ClustersClient instance
 * @param databaseName Database name
 * @param collectionName Collection name
 * @param suggestions AI suggestions containing the index creation command
 * @param progress Optional progress callback
 * @returns True if index was created, false otherwise
 */
async function createIndexFromSuggestion(
    client: ClustersClient,
    databaseName: string,
    collectionName: string,
    suggestions: string,
    progress?: ProgressCallback,
): Promise<boolean> {
    try {
        // Parse the createIndex command from suggestions
        const indexSpec = parseCreateIndexCommand(suggestions);
        if (!indexSpec) {
            progress?.(`Could not parse index creation command from suggestions`);
            return false;
        }

        // Ensure index has a name
        if (!indexSpec.name) {
            indexSpec.name = generateIndexName(indexSpec.key);
        }

        progress?.(`Creating index: ${indexSpec.name}`);

        // Create the index
        const result = await client.createIndex(databaseName, collectionName, indexSpec);

        if (result.ok === 1) {
            progress?.(`Index created: ${indexSpec.name}`);
            return true;
        } else {
            progress?.(`Failed to create index: ${result.note || 'Unknown error'}`);
            return false;
        }
    } catch (error) {
        progress?.(`Error creating index: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

/**
 * Drops an index from the AI suggestion command
 * Handles both dropIndex and createIndex commands (for restore scenarios)
 * @param client ClustersClient instance
 * @param databaseName Database name
 * @param collectionName Collection name
 * @param suggestions AI suggestions containing the index drop/create command
 * @param progress Optional progress callback
 * @returns True if index was dropped, false otherwise
 */
async function dropIndexFromSuggestion(
    client: ClustersClient,
    databaseName: string,
    collectionName: string,
    suggestions: string,
    progress?: ProgressCallback,
): Promise<boolean> {
    try {
        // Check if this is a dropIndex command or createIndex command
        let indexName: string | undefined;

        if (suggestions.toLowerCase().includes('dropindex')) {
            // Extract index name from dropIndex command
            indexName = extractIndexNameFromDropCommand(suggestions);
        } else {
            // Extract from createIndex command
            const indexSpec = parseCreateIndexCommand(suggestions);
            if (indexSpec && indexSpec.key) {
                indexName = indexSpec.name || generateIndexName(indexSpec.key);
            }
        }

        if (!indexName) {
            progress?.(`Could not extract index name from command`);
            return false;
        }

        progress?.(`Dropping index: ${indexName}`);

        // Drop the index
        const result = await client.dropIndex(databaseName, collectionName, indexName);

        if (result.ok === 1) {
            progress?.(`Index dropped: ${indexName}`);
            return true;
        } else {
            progress?.(`Note when dropping index: ${result.ok}`);
            return false;
        }
    } catch (error) {
        progress?.(`Error dropping index: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

/**
 * Modifies an index from the AI suggestion command
 * For MongoDB, modification typically involves dropping the old index and creating a new one
 * @param client ClustersClient instance
 * @param databaseName Database name
 * @param collectionName Collection name
 * @param suggestions AI suggestions containing the index modification command
 * @param progress Optional progress callback
 * @returns True if index was modified, false otherwise
 */
async function modifyIndexFromSuggestion(
    client: ClustersClient,
    databaseName: string,
    collectionName: string,
    suggestions: string,
    progress?: ProgressCallback,
): Promise<boolean> {
    try {
        const indexSpec = parseCreateIndexCommand(suggestions);
        if (!indexSpec) {
            progress?.(`Could not parse index modification command from suggestions`);
            return false;
        }

        // Ensure index has a name
        if (!indexSpec.name) {
            indexSpec.name = generateIndexName(indexSpec.key);
        }

        progress?.(`Modifying index: ${indexSpec.name}`);

        // For modification, try to create the index (MongoDB will update if exists)
        const result = await client.createIndex(databaseName, collectionName, indexSpec);

        if (result.ok === 1) {
            progress?.(`Index modified: ${indexSpec.name}`);
            return true;
        } else {
            progress?.(`Failed to modify index: ${result.note || 'Unknown error'}`);
            return false;
        }
    } catch (error) {
        progress?.(`Error modifying index: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

/**
 * Restores the original index state after performance testing
 * @param client ClustersClient instance
 * @param databaseName Database name
 * @param collectionName Collection name
 * @param actionType The type of action that was applied
 * @param originalIndexSpec The original index specification (for restore)
 * @param suggestions The AI suggestions that were applied
 * @param indexStats The index statistics JSON (for drop restore)
 * @param indexNameToDrop The name of the dropped index (for drop restore)
 * @param progress Optional progress callback
 */
async function restoreOriginalIndexState(
    client: ClustersClient,
    databaseName: string,
    collectionName: string,
    actionType: 'create' | 'drop' | 'modify',
    _originalIndexSpec: IndexSpecification | undefined,
    suggestions: string,
    indexStats: string | undefined,
    indexNameToDrop: string | undefined,
    progress?: ProgressCallback,
): Promise<void> {
    try {
        if (actionType === 'create') {
            // Restore: drop the created index
            await dropIndexFromSuggestion(client, databaseName, collectionName, suggestions, progress);
        } else if (actionType === 'drop') {
            // Restore: recreate the dropped index from indexStats
            if (indexNameToDrop && indexStats) {
                try {
                    const indexStatsArray = JSON.parse(indexStats) as Array<{
                        name?: string;
                        key?: Record<string, number | string>;
                        [key: string]: unknown;
                    }>;

                    // Find the matching index by name in indexStats
                    const matchedIndex = indexStatsArray.find((idx) => idx.name === indexNameToDrop);

                    if (matchedIndex && matchedIndex.key) {
                        // Build the index specification from indexStats
                        const indexSpecToRestore: IndexSpecification = {
                            key: matchedIndex.key,
                            name: matchedIndex.name,
                            // Copy other index properties if they exist (except metadata)
                            ...Object.fromEntries(
                                Object.entries(matchedIndex).filter(
                                    ([k]) => !['name', 'key', 'accesses', 'v'].includes(k),
                                ),
                            ),
                        };

                        if (indexNameToDrop !== '_id_') {
                            // Don't try to recreate the _id index
                            progress?.(`Recreating dropped index: ${indexNameToDrop}`);

                            try {
                                const recreateResult = await client.createIndex(databaseName, collectionName, indexSpecToRestore);
                                if (recreateResult.ok === 1) {
                                    progress?.(`Index recreated successfully: ${indexNameToDrop}`);
                                } else {
                                    progress?.(`Warning: Failed to recreate index ${indexNameToDrop}: ${recreateResult.note || 'Unknown error'}`);
                                }
                            } catch (recreateError) {
                                progress?.(`Warning: Error recreating index ${indexNameToDrop}: ${recreateError instanceof Error ? recreateError.message : String(recreateError)}`);
                            }
                        }
                    } else {
                        progress?.(`Warning: Could not find index "${indexNameToDrop}" in indexStats for restoration`);
                    }
                } catch (parseError) {
                    progress?.(`Warning: Failed to parse indexStats for restoration: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
                }
            }
        } else if (actionType === 'modify') {
            // Restore: drop the modified index (revert to previous state)
            await dropIndexFromSuggestion(client, databaseName, collectionName, suggestions, progress);
        }
    } catch (error) {
        progress?.(`Warning: Failed to restore original state: ${error instanceof Error ? error.message : String(error)}`);
        console.warn('Failed to restore original index state:', error);
    }
}

/**
 * Runs warm-up to initialize cluster connection
 * @param config Test configuration
 * @param progress Optional progress callback
 */
export async function warmupConnection(config: TestConfig, progress?: ProgressCallback): Promise<void> {
    if (!config.warmupQuery) {
        return;
    }

    try {
        progress?.(`Warming up connection to ${config.databaseName}...`);

        // Get or create cluster ID
        const clusterId = await getOrCreateClusterId(config);
        if (!clusterId) {
            throw new Error('clusterId or connectionString is required in configuration');
        }

        const client = await ClustersClient.getClient(clusterId);
        // Use a simple, non-intrusive operation to warm up the connection
        await client.listCollections(config.databaseName);
        progress?.(`Connection warmed up successfully`);
    } catch (error) {
        progress?.(`Connection warmup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
