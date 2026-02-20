# DocumentDB Operator Reference — Overrides

<!-- MANUALLY MAINTAINED -->
<!-- This file provides overrides for operator-reference-scraped.md.            -->
<!-- The generator (scripts/generate-from-reference.ts) merges these on top of -->
<!-- the scraped data. Any field specified here wins over the scraped value. -->
<!--                                                                           -->
<!-- Use cases:                                                                -->
<!--   1. Fill in descriptions/syntax for operators whose doc pages returned   -->
<!--      404 during scraping (empty fields in the dump).                      -->
<!--   2. Replace a scraped description with a better hand-written one.        -->
<!--   3. Add or override snippets for specific operators.                     -->
<!--                                                                           -->
<!-- Format: same as operator-reference-scraped.md                             -->
<!--   ## Category Name         (must match a category in the dump exactly)    -->
<!--   ### $operatorName         (must match an operator in that category)     -->
<!--   - **Description:** ...   (overrides description)                        -->
<!--   - **Snippet:** ...       (overrides the generated snippet)             -->
<!--   - **Doc Link:** ...      (overrides the doc link)                       -->
<!--                                                                           -->
<!-- Only fields you include are overridden; omitted fields keep their         -->
<!-- scraped or generated values.                                              -->

---

## String Expression Operators

### $concat

- **Description:** Concatenates two or more strings and returns the resulting string.

### $indexOfBytes

- **Description:** Returns the byte index of the first occurrence of a substring within a string.

### $indexOfCP

- **Description:** Returns the code point index of the first occurrence of a substring within a string.

### $ltrim

- **Description:** Removes whitespace or specified characters from the beginning of a string.

### $regexFind

- **Description:** Applies a regular expression to a string and returns the first match.

### $regexFindAll

- **Description:** Applies a regular expression to a string and returns all matches as an array.

### $regexMatch

- **Description:** Applies a regular expression to a string and returns a boolean indicating if a match was found.

### $replaceOne

- **Description:** Replaces the first occurrence of a search string with a replacement string.

### $replaceAll

- **Description:** Replaces all occurrences of a search string with a replacement string.

### $rtrim

- **Description:** Removes whitespace or specified characters from the end of a string.

### $split

- **Description:** Splits a string by a delimiter and returns an array of substrings.

### $strLenBytes

- **Description:** Returns the number of UTF-8 encoded bytes in the specified string.

### $strLenCP

- **Description:** Returns the number of UTF-8 code points in the specified string.

### $strcasecmp

- **Description:** Performs a case-insensitive comparison of two strings and returns an integer.

### $substr

- **Description:** Returns a substring of a string, starting at a specified index for a specified length. Deprecated — use $substrBytes or $substrCP.

### $substrBytes

- **Description:** Returns a substring of a string by byte index, starting at a specified index for a specified number of bytes.

### $substrCP

- **Description:** Returns a substring of a string by code point index, starting at a specified index for a specified number of code points.

### $toLower

- **Description:** Converts a string to lowercase and returns the result.

### $toUpper

- **Description:** Converts a string to uppercase and returns the result.

### $trim

- **Description:** Removes whitespace or specified characters from both ends of a string.

## Trigonometry Expression Operators

### $sin

- **Description:** Returns the sine of a value measured in radians.

### $cos

- **Description:** Returns the cosine of a value measured in radians.

### $tan

- **Description:** Returns the tangent of a value measured in radians.

### $asin

- **Description:** Returns the arcsine (inverse sine) of a value in radians.

### $acos

- **Description:** Returns the arccosine (inverse cosine) of a value in radians.

### $atan

- **Description:** Returns the arctangent (inverse tangent) of a value in radians.

### $atan2

- **Description:** Returns the arctangent of the quotient of two values, using the signs to determine the quadrant.

### $asinh

- **Description:** Returns the inverse hyperbolic sine of a value.

### $acosh

- **Description:** Returns the inverse hyperbolic cosine of a value.

### $atanh

- **Description:** Returns the inverse hyperbolic tangent of a value.

### $sinh

- **Description:** Returns the hyperbolic sine of a value.

### $cosh

- **Description:** Returns the hyperbolic cosine of a value.

### $tanh

- **Description:** Returns the hyperbolic tangent of a value.

### $degreesToRadians

- **Description:** Converts a value from degrees to radians.

### $radiansToDegrees

- **Description:** Converts a value from radians to degrees.

## Aggregation Pipeline Stages

### $bucketAuto

- **Description:** Categorizes documents into a specified number of groups based on a given expression, automatically determining bucket boundaries.

### $graphLookup

- **Description:** Performs a recursive search on a collection to return documents connected by a specified field relationship.

### $limit

- **Description:** Restricts the number of documents passed to the next stage in the pipeline.

### $project

- **Description:** Reshapes documents by including, excluding, or computing new fields.

### $replaceRoot

- **Description:** Replaces the input document with a specified embedded document, promoting it to the top level.

### $search

- **Description:** Performs full-text search on string fields using Atlas Search or compatible search indexes.

### $searchMeta

- **Description:** Returns metadata about an Atlas Search query without returning the matching documents.

### $setWindowFields

- **Description:** Adds computed fields to documents using window functions over a specified partition and sort order.

### $unionWith

- **Description:** Combines the results of two collections into a single result set, similar to SQL UNION ALL.

### $currentOp

- **Description:** Returns information on active and queued operations for the database instance.

## Array Update Operators

### $[]

- **Description:** Positional all operator. Acts as a placeholder to update all elements in an array field.

### $[identifier]

- **Description:** Filtered positional operator. Acts as a placeholder to update elements that match an arrayFilters condition.

### $position

- **Description:** Specifies the position in the array at which the $push operator inserts elements. Used with $each.

## Array Expression Operators

### $objectToArray

- **Description:** Converts an object into an array of key-value pair documents.

## Variables in Aggregation Expressions

### $$NOW

- **Description:** Returns the current datetime as a Date object. Constant throughout a single aggregation pipeline.

### $$ROOT

- **Description:** References the root document — the top-level document currently being processed in the pipeline stage.

### $$REMOVE

- **Description:** Removes a field from the output document. Used with $project or $addFields to conditionally exclude fields.

### $$CURRENT

- **Description:** References the current document in the pipeline stage. Equivalent to $$ROOT at the start of the pipeline.

### $$DESCEND

- **Description:** Used with $redact. Returns the document fields at the current level and continues descending into subdocuments.

### $$PRUNE

- **Description:** Used with $redact. Excludes all fields at the current document level and stops descending into subdocuments.

### $$KEEP

- **Description:** Used with $redact. Keeps all fields at the current document level without further descending into subdocuments.
