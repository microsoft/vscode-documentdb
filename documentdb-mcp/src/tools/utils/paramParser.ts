/*---------------------------------------------------------------------------------------------
 *  Generic parameter parsing helpers for MCP tools.
 *  These functions allow accepting loose string inputs and coercing them into the expected
 *  runtime types (object, array, number, boolean) with clear error messages.
 *--------------------------------------------------------------------------------------------*/

export type ExpectedType = 'object' | 'array' | 'number' | 'int' | 'boolean' | 'string' | 'any';

export interface ParseOptions {
    allowEmptyStringAsNull?: boolean; // Treat '' as null -> then apply default
    defaultValue?: any; // Fallback when value is undefined/null/'' (if policy allows)
    fieldName?: string; // For clearer error messages
    nonNegative?: boolean; // For number/int
    integer?: boolean; // Force integer (alias: using 'int' expectedType also sets this)
    maxStringLength?: number; // Optional guard rail
    optional?: boolean; // If true: absence (undefined/null/'') yields undefined (no zero value)
    treatEmptyObjectAsUndefined?: boolean; // After parsing object: {} -> undefined
    treatEmptyArrayAsUndefined?: boolean; // After parsing array: [] -> undefined
}

export interface ParseResult<T = any> {
    value: T;
    errors?: string[]; // Collected errors (if in tolerant mode we could continue; currently we stop on first)
}

/** Core parsing logic. */
export function parseParam<T = any>(raw: any, expected: ExpectedType, options: ParseOptions = {}): ParseResult<T> {
    const {
        allowEmptyStringAsNull = true,
        defaultValue,
        fieldName = 'value',
        nonNegative = false,
        integer = expected === 'int',
        maxStringLength,
        optional = false,
        treatEmptyObjectAsUndefined = false,
        treatEmptyArrayAsUndefined = false,
    } = options;

    // Handle undefined/null/empty
    if (raw === undefined || raw === null || (allowEmptyStringAsNull && raw === '')) {
        if (defaultValue !== undefined) return { value: defaultValue as T };
        if (optional) return { value: undefined as unknown as T };
        // Not optional: use zero value semantics
        switch (expected) {
            case 'object':
                return { value: {} as T };
            case 'array':
                return { value: [] as T };
            case 'number':
            case 'int':
                return { value: 0 as T };
            case 'boolean':
                return { value: false as T };
            case 'string':
                return { value: '' as T };
            case 'any':
            default:
                return { value: raw as T };
        }
    }

    // Early length guard
    if (typeof raw === 'string' && maxStringLength && raw.length > maxStringLength) {
        throw new Error(`${fieldName} exceeds maximum length of ${maxStringLength}`);
    }

    // Dispatch per expected type
    switch (expected) {
        case 'string': {
            if (typeof raw === 'string') return { value: raw as T };
            return { value: String(raw) as T };
        }
        case 'boolean': {
            if (typeof raw === 'boolean') return { value: raw as T };
            if (typeof raw === 'string') {
                const lower = raw.trim().toLowerCase();
                if (['true', '1', 'yes', 'y'].includes(lower)) return { value: true as T };
                if (['false', '0', 'no', 'n'].includes(lower)) return { value: false as T };
                throw new Error(`${fieldName} must be a boolean (true/false/1/0/yes/no)`);
            }
            if (typeof raw === 'number') return { value: (raw !== 0) as T };
            throw new Error(`${fieldName} must be a boolean`);
        }
        case 'number':
        case 'int': {
            let num: number;
            if (typeof raw === 'number') {
                num = raw;
            } else if (typeof raw === 'string') {
                const trimmed = raw.trim();
                if (!trimmed) throw new Error(`${fieldName} must be a number`);
                num = Number(trimmed);
            } else {
                throw new Error(`${fieldName} must be a number`);
            }
            if (!Number.isFinite(num)) throw new Error(`${fieldName} must be a finite number`);
            if (integer && !Number.isInteger(num)) throw new Error(`${fieldName} must be an integer`);
            if (nonNegative && num < 0) throw new Error(`${fieldName} must be non-negative`);
            return { value: num as T };
        }
        case 'object': {
            let obj: any;
            if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
                obj = raw;
            } else if (typeof raw === 'string') {
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                        throw new Error(`${fieldName} must be a JSON object`);
                    }
                    obj = parsed;
                } catch (e) {
                    throw new Error(`${fieldName} invalid JSON object: ${e instanceof Error ? e.message : String(e)}`);
                }
            } else {
                throw new Error(`${fieldName} must be an object`);
            }
            if (treatEmptyObjectAsUndefined && Object.keys(obj).length === 0) {
                return { value: undefined as unknown as T };
            }
            return { value: obj as T };
        }
        case 'array': {
            let arr: any[];
            if (Array.isArray(raw)) {
                arr = raw;
            } else if (typeof raw === 'string') {
                try {
                    const parsed = JSON.parse(raw);
                    if (!Array.isArray(parsed)) throw new Error(`${fieldName} must be a JSON array`);
                    arr = parsed;
                } catch (e) {
                    throw new Error(`${fieldName} invalid JSON array: ${e instanceof Error ? e.message : String(e)}`);
                }
            } else {
                throw new Error(`${fieldName} must be an array`);
            }
            if (treatEmptyArrayAsUndefined && arr.length === 0) {
                return { value: undefined as unknown as T };
            }
            return { value: arr as T };
        }
        case 'any':
        default:
            return { value: raw as T };
    }
}

/** Specialized helper for MongoDB update documents. */
export function parseUpdate(raw: any, options: ParseOptions = {}): ParseResult<Record<string, any>> {
    const fieldName = options.fieldName || 'update';
    const { value: doc } = parseParam<Record<string, any>>(raw, 'object', { fieldName });

    // Determine if it's an operator-style or replacement-style update
    const keys = Object.keys(doc);
    const operatorKeys = keys.filter((k) => k.startsWith('$'));
    const isOperatorStyle = operatorKeys.length > 0;

    if (isOperatorStyle && operatorKeys.length !== keys.length) {
        throw new Error(`${fieldName} mixes operator keys ($...) with regular fields which is not allowed`);
    }

    if (!isOperatorStyle) {
        // Replacement document: must NOT contain _id changes (we allow _id presence but won't deep validate)
        // Basic sanity: object must not be empty
        if (keys.length === 0) throw new Error(`${fieldName} replacement document must not be empty`);
        return { value: doc };
    }

    // Operator style validation
    const allowedTopLevelOperators = new Set([
        '$set',
        '$unset',
        '$inc',
        '$mul',
        '$rename',
        '$min',
        '$max',
        '$currentDate',
        '$addToSet',
        '$pop',
        '$pull',
        '$push',
        '$pullAll',
        '$setOnInsert',
    ]);

    for (const op of operatorKeys) {
        if (!allowedTopLevelOperators.has(op)) {
            throw new Error(`${fieldName} contains unsupported update operator: ${op}`);
        }
        const val = (doc as any)[op];
        if (val === null || typeof val !== 'object' || Array.isArray(val)) {
            throw new Error(`${fieldName} operator ${op} requires an object value`);
        }
        if (Object.keys(val).length === 0) {
            throw new Error(`${fieldName} operator ${op} must not be empty`);
        }
        // Shallow field key checks (no empty strings)
        for (const f of Object.keys(val)) {
            if (!f) throw new Error(`${fieldName} operator ${op} has empty field name`);
        }
    }

    return { value: doc };
}

/** Convenience aggregator for multiple fields. */
export interface ParamSpec {
    raw: any;
    outKey: string;
    expected?: ExpectedType; // Mutually exclusive with custom
    options?: ParseOptions; // Passed to parseParam
    custom?: (raw: any) => any; // Custom parsing (e.g., parseUpdate)
}

export function parseParams(spec: ParamSpec[]): Record<string, any> {
    const result: Record<string, any> = {};
    for (const item of spec) {
        const fieldName = item.options?.fieldName || item.outKey;
        let value: any;
        if (item.custom) {
            value = item.custom(item.raw);
        } else if (item.expected) {
            value = parseParam(item.raw, item.expected, { ...item.options, fieldName }).value;
        } else {
            throw new Error(`Param spec for '${item.outKey}' must provide either 'expected' or 'custom'`);
        }
        if (value === undefined && item.options?.optional) continue;
        result[item.outKey] = value;
    }
    return result;
}
