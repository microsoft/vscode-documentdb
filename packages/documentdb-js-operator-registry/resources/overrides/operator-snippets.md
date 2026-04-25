# Operator Snippets

<!--
  Provides snippet templates for all operator categories.

  Format: Same heading structure as the scraped dump and overrides.

  - H2 (##) headings denote categories, resolved via CATEGORY_TO_META.
  - H3 (###) headings are either operator names (e.g., ### $match) or ### DEFAULT.
  - '- **Snippet:** `template`' lines provide the snippet template (backtick-wrapped).

  The generator resolves snippets in this order:
    1. Snippet override from operator-overrides.md (highest priority)
    2. Per-operator snippet from this file
    3. DEFAULT snippet from this file (with {{VALUE}} replaced by operator name)
    4. No snippet

  {{VALUE}} is replaced by the operator name (e.g., $sum) at generation time.
  Operators not listed here (and with no DEFAULT) receive no snippet.

  Do NOT edit generated src/ files — put corrections here instead.
-->

## Aggregation Pipeline Stages

### DEFAULT

- **Snippet:** `{ {{VALUE}}: { ${1} } }`

### $match

- **Snippet:** `{ $match: { ${1:query} } }`

### $group

- **Snippet:** `{ $group: { _id: "${1:\$field}", ${2:accumulator}: { ${3:\$sum}: 1 } } }`

### $project

- **Snippet:** `{ $project: { ${1:field}: 1 } }`

### $sort

- **Snippet:** `{ $sort: { ${1:field}: ${2:1} } }`

### $limit

- **Snippet:** `{ $limit: ${1:number} }`

### $skip

- **Snippet:** `{ $skip: ${1:number} }`

### $unwind

- **Snippet:** `{ $unwind: "${1:\$arrayField}" }`

### $lookup

- **Snippet:** `{ $lookup: { from: "${1:collection}", localField: "${2:field}", foreignField: "${3:field}", as: "${4:result}" } }`

### $addFields

- **Snippet:** `{ $addFields: { ${1:newField}: ${2:expression} } }`

### $set

- **Snippet:** `{ $set: { ${1:field}: ${2:expression} } }`

### $unset

- **Snippet:** `{ $unset: "${1:field}" }`

### $replaceRoot

- **Snippet:** `{ $replaceRoot: { newRoot: "${1:\$field}" } }`

### $replaceWith

- **Snippet:** `{ $replaceWith: "${1:\$field}" }`

### $count

- **Snippet:** `{ $count: "${1:countField}" }`

### $out

- **Snippet:** `{ $out: "${1:collection}" }`

### $merge

- **Snippet:** `{ $merge: { into: "${1:collection}" } }`

### $bucket

- **Snippet:** `{ $bucket: { groupBy: "${1:\$field}", boundaries: [${2:values}], default: "${3:Other}" } }`

### $bucketAuto

- **Snippet:** `{ $bucketAuto: { groupBy: "${1:\$field}", buckets: ${2:number} } }`

### $facet

- **Snippet:** `{ $facet: { ${1:outputField}: [{ ${2:stage} }] } }`

### $graphLookup

- **Snippet:** `{ $graphLookup: { from: "${1:collection}", startWith: "${2:\$field}", connectFromField: "${3:field}", connectToField: "${4:field}", as: "${5:result}" } }`

### $sample

- **Snippet:** `{ $sample: { size: ${1:number} } }`

### $sortByCount

- **Snippet:** `{ $sortByCount: "${1:\$field}" }`

### $redact

- **Snippet:** `{ $redact: { \$cond: { if: { ${1:expression} }, then: "${2:\$\$DESCEND}", else: "${3:\$\$PRUNE}" } } }`

### $unionWith

- **Snippet:** `{ $unionWith: { coll: "${1:collection}", pipeline: [${2}] } }`

### $setWindowFields

- **Snippet:** `{ $setWindowFields: { partitionBy: "${1:\$field}", sortBy: { ${2:field}: ${3:1} }, output: { ${4:newField}: { ${5:windowFunc} } } } }`

### $densify

- **Snippet:** `{ $densify: { field: "${1:field}", range: { step: ${2:1}, bounds: "full" } } }`

### $fill

- **Snippet:** `{ $fill: { output: { ${1:field}: { method: "${2:linear}" } } } }`

### $documents

- **Snippet:** `{ $documents: [${1:documents}] }`

### $changeStream

- **Snippet:** `{ $changeStream: {} }`

### $collStats

- **Snippet:** `{ $collStats: { storageStats: {} } }`

### $currentOp

- **Snippet:** `{ $currentOp: { allUsers: true } }`

### $indexStats

- **Snippet:** `{ $indexStats: {} }`

### $listLocalSessions

- **Snippet:** `{ $listLocalSessions: { allUsers: true } }`

### $geoNear

- **Snippet:** `{ $geoNear: { near: { type: "Point", coordinates: [${1:lng}, ${2:lat}] }, distanceField: "${3:distance}" } }`

## Comparison Query Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: ${1:value} }`

### $in

- **Snippet:** `{ $in: [${1:value}] }`

### $nin

- **Snippet:** `{ $nin: [${1:value}] }`

## Logical Query Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: [{ ${1:expression} }] }`

### $not

- **Snippet:** `{ $not: { ${1:expression} } }`

## Element Query Operators

### $exists

- **Snippet:** `{ $exists: ${1:true} }`

### $type

- **Snippet:** `{ $type: "${1:type}" }`

## Evaluation Query Operators

### $expr

- **Snippet:** `{ $expr: { ${1:expression} } }`

### $regex

- **Snippet:** `{ $regex: /${1:pattern}/ }`

### $mod

- **Snippet:** `{ $mod: [${1:divisor}, ${2:remainder}] }`

### $text

- **Snippet:** `{ $text: { \$search: "${1:text}" } }`

### $jsonSchema

- **Snippet:** `{ $jsonSchema: { bsonType: "${1:object}" } }`

## Array Query Operators

### $all

- **Snippet:** `{ $all: [${1:value}] }`

### $elemMatch

- **Snippet:** `{ $elemMatch: { ${1:query} } }`

### $size

- **Snippet:** `{ $size: ${1:number} }`

## Bitwise Query Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: ${1:bitmask} }`

## Geospatial Operators

### $near

- **Snippet:** `{ $near: { \$geometry: { type: "Point", coordinates: [${1:lng}, ${2:lat}] }, \$maxDistance: ${3:distance} } }`

### $nearSphere

- **Snippet:** `{ $nearSphere: { \$geometry: { type: "Point", coordinates: [${1:lng}, ${2:lat}] }, \$maxDistance: ${3:distance} } }`

### $geoIntersects

- **Snippet:** `{ $geoIntersects: { \$geometry: { type: "${1:GeoJSON type}", coordinates: ${2:coordinates} } } }`

### $geoWithin

- **Snippet:** `{ $geoWithin: { \$geometry: { type: "${1:GeoJSON type}", coordinates: ${2:coordinates} } } }`

### $box

- **Snippet:** `[[${1:bottomLeftX}, ${2:bottomLeftY}], [${3:upperRightX}, ${4:upperRightY}]]`

### $center

- **Snippet:** `[[${1:x}, ${2:y}], ${3:radius}]`

### $centerSphere

- **Snippet:** `[[${1:x}, ${2:y}], ${3:radiusInRadians}]`

### $geometry

- **Snippet:** `{ type: "${1:Point}", coordinates: [${2:coordinates}] }`

### $maxDistance

- **Snippet:** `${1:distance}`

### $minDistance

- **Snippet:** `${1:distance}`

### $polygon

- **Snippet:** `[[${1:x1}, ${2:y1}], [${3:x2}, ${4:y2}], [${5:x3}, ${6:y3}]]`

## Projection Operators

### $elemMatch

- **Snippet:** `{ $elemMatch: { ${1:query} } }`

### $slice

- **Snippet:** `{ $slice: ${1:number} }`

## Miscellaneous Query Operators

### $comment

- **Snippet:** `{ $comment: "${1:comment}" }`

### $rand

- **Snippet:** `{ $rand: {} }`

### $natural

- **Snippet:** `{ $natural: ${1:1} }`

## Field Update Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: { "${1:field}": ${2:value} } }`

### $rename

- **Snippet:** `{ $rename: { "${1:oldField}": "${2:newField}" } }`

### $currentDate

- **Snippet:** `{ $currentDate: { "${1:field}": true } }`

## Array Update Operators

### $addToSet

- **Snippet:** `{ $addToSet: { "${1:field}": ${2:value} } }`

### $pop

- **Snippet:** `{ $pop: { "${1:field}": ${2:1} } }`

### $pull

- **Snippet:** `{ $pull: { "${1:field}": ${2:condition} } }`

### $push

- **Snippet:** `{ $push: { "${1:field}": ${2:value} } }`

### $pullAll

- **Snippet:** `{ $pullAll: { "${1:field}": [${2:values}] } }`

### $each

- **Snippet:** `{ $each: [${1:values}] }`

### $position

- **Snippet:** `{ $position: ${1:index} }`

### $slice

- **Snippet:** `{ $slice: ${1:number} }`

### $sort

- **Snippet:** `{ $sort: { "${1:field}": ${2:1} } }`

## Bitwise Update Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: { "${1:field}": { "${2:and|or|xor}": ${3:value} } } }`

## Accumulators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: "${1:\$field}" }`

### $count

- **Snippet:** `{ $count: {} }`

### $bottom

- **Snippet:** `{ $bottom: { sortBy: { ${1:field}: ${2:1} }, output: "${3:\$field}" } }`

### $top

- **Snippet:** `{ $top: { sortBy: { ${1:field}: ${2:1} }, output: "${3:\$field}" } }`

### $bottomN

- **Snippet:** `{ $bottomN: { n: ${1:number}, sortBy: { ${2:field}: ${3:1} }, output: "${4:\$field}" } }`

### $topN

- **Snippet:** `{ $topN: { n: ${1:number}, sortBy: { ${2:field}: ${3:1} }, output: "${4:\$field}" } }`

### $firstN

- **Snippet:** `{ $firstN: { input: "${1:\$field}", n: ${2:number} } }`

### $lastN

- **Snippet:** `{ $lastN: { input: "${1:\$field}", n: ${2:number} } }`

### $maxN

- **Snippet:** `{ $maxN: { input: "${1:\$field}", n: ${2:number} } }`

### $minN

- **Snippet:** `{ $minN: { input: "${1:\$field}", n: ${2:number} } }`

### $percentile

- **Snippet:** `{ $percentile: { input: "${1:\$field}", p: [${2:0.5}], method: "approximate" } }`

### $median

- **Snippet:** `{ $median: { input: "${1:\$field}", method: "approximate" } }`

## Window Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: "${1:\$field}" }`

### $shift

- **Snippet:** `{ $shift: { output: "${1:\$field}", by: ${2:1}, default: ${3:null} } }`

### $rank

- **Snippet:** `{ $rank: {} }`

### $denseRank

- **Snippet:** `{ $denseRank: {} }`

### $documentNumber

- **Snippet:** `{ $documentNumber: {} }`

### $expMovingAvg

- **Snippet:** `{ $expMovingAvg: { input: "${1:\$field}", N: ${2:number} } }`

### $derivative

- **Snippet:** `{ $derivative: { input: "${1:\$field}", unit: "${2:hour}" } }`

### $integral

- **Snippet:** `{ $integral: { input: "${1:\$field}", unit: "${2:hour}" } }`

## Arithmetic Expression Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: "${1:\$field}" }`

### $add

- **Snippet:** `{ $add: ["${1:\$field1}", "${2:\$field2}"] }`

### $subtract

- **Snippet:** `{ $subtract: ["${1:\$field1}", "${2:\$field2}"] }`

### $multiply

- **Snippet:** `{ $multiply: ["${1:\$field1}", "${2:\$field2}"] }`

### $divide

- **Snippet:** `{ $divide: ["${1:\$field1}", "${2:\$field2}"] }`

### $mod

- **Snippet:** `{ $mod: ["${1:\$field1}", "${2:\$field2}"] }`

### $pow

- **Snippet:** `{ $pow: ["${1:\$field1}", "${2:\$field2}"] }`

### $log

- **Snippet:** `{ $log: ["${1:\$number}", ${2:base}] }`

### $round

- **Snippet:** `{ $round: ["${1:\$field}", ${2:place}] }`

## Array Expression Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: "${1:\$array}" }`

### $arrayElemAt

- **Snippet:** `{ $arrayElemAt: ["${1:\$array}", ${2:index}] }`

### $concatArrays

- **Snippet:** `{ $concatArrays: ["${1:\$array1}", "${2:\$array2}"] }`

### $filter

- **Snippet:** `{ $filter: { input: "${1:\$array}", as: "${2:item}", cond: { ${3:expression} } } }`

### $in

- **Snippet:** `{ $in: ["${1:\$field}", "${2:\$array}"] }`

### $indexOfArray

- **Snippet:** `{ $indexOfArray: ["${1:\$array}", "${2:value}"] }`

### $isArray

- **Snippet:** `{ $isArray: "${1:\$field}" }`

### $map

- **Snippet:** `{ $map: { input: "${1:\$array}", as: "${2:item}", in: { ${3:expression} } } }`

### $objectToArray

- **Snippet:** `{ $objectToArray: "${1:\$object}" }`

### $range

- **Snippet:** `{ $range: [${1:start}, ${2:end}, ${3:step}] }`

### $reduce

- **Snippet:** `{ $reduce: { input: "${1:\$array}", initialValue: ${2:0}, in: { ${3:expression} } } }`

### $slice

- **Snippet:** `{ $slice: ["${1:\$array}", ${2:n}] }`

### $sortArray

- **Snippet:** `{ $sortArray: { input: "${1:\$array}", sortBy: { ${2:field}: ${3:1} } } }`

### $zip

- **Snippet:** `{ $zip: { inputs: ["${1:\$array1}", "${2:\$array2}"] } }`

### $maxN

- **Snippet:** `{ $maxN: { input: "${1:\$array}", n: ${2:number} } }`

### $minN

- **Snippet:** `{ $minN: { input: "${1:\$array}", n: ${2:number} } }`

### $firstN

- **Snippet:** `{ $firstN: { input: "${1:\$array}", n: ${2:number} } }`

### $lastN

- **Snippet:** `{ $lastN: { input: "${1:\$array}", n: ${2:number} } }`

## Boolean Expression Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: ["${1:expression1}", "${2:expression2}"] }`

### $not

- **Snippet:** `{ $not: ["${1:expression}"] }`

## Comparison Expression Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: ["${1:\$field1}", "${2:\$field2}"] }`

## Conditional Expression Operators

### $cond

- **Snippet:** `{ $cond: { if: { ${1:expression} }, then: ${2:trueValue}, else: ${3:falseValue} } }`

### $ifNull

- **Snippet:** `{ $ifNull: ["${1:\$field}", ${2:replacement}] }`

### $switch

- **Snippet:** `{ $switch: { branches: [{ case: { ${1:expression} }, then: ${2:value} }], default: ${3:defaultValue} } }`

## Date Expression Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: "${1:\$dateField}" }`

### $dateAdd

- **Snippet:** `{ $dateAdd: { startDate: "${1:\$dateField}", unit: "${2:day}", amount: ${3:1} } }`

### $dateSubtract

- **Snippet:** `{ $dateSubtract: { startDate: "${1:\$dateField}", unit: "${2:day}", amount: ${3:1} } }`

### $dateDiff

- **Snippet:** `{ $dateDiff: { startDate: "${1:\$startDate}", endDate: "${2:\$endDate}", unit: "${3:day}" } }`

### $dateFromParts

- **Snippet:** `{ $dateFromParts: { year: ${1:2024}, month: ${2:1}, day: ${3:1} } }`

### $dateToParts

- **Snippet:** `{ $dateToParts: { date: "${1:\$dateField}" } }`

### $dateFromString

- **Snippet:** `{ $dateFromString: { dateString: "${1:dateString}" } }`

### $dateToString

- **Snippet:** `{ $dateToString: { format: "${1:%Y-%m-%d}", date: "${2:\$dateField}" } }`

### $dateTrunc

- **Snippet:** `{ $dateTrunc: { date: "${1:\$dateField}", unit: "${2:day}" } }`

### $toDate

- **Snippet:** `{ $toDate: "${1:\$field}" }`

## Object Expression Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: "${1:\$object}" }`

### $mergeObjects

- **Snippet:** `{ $mergeObjects: ["${1:\$object1}", "${2:\$object2}"] }`

### $setField

- **Snippet:** `{ $setField: { field: "${1:fieldName}", input: "${2:\$object}", value: ${3:value} } }`

## Set Expression Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: ["${1:\$set1}", "${2:\$set2}"] }`

### $anyElementTrue

- **Snippet:** `{ $anyElementTrue: ["${1:\$array}"] }`

### $allElementsTrue

- **Snippet:** `{ $allElementsTrue: ["${1:\$array}"] }`

## String Expression Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: "${1:\$string}" }`

### $concat

- **Snippet:** `{ $concat: ["${1:\$string1}", "${2:\$string2}"] }`

### $indexOfBytes

- **Snippet:** `{ $indexOfBytes: ["${1:\$string}", "${2:substring}"] }`

### $indexOfCP

- **Snippet:** `{ $indexOfCP: ["${1:\$string}", "${2:substring}"] }`

### $regexFind

- **Snippet:** `{ $regexFind: { input: "${1:\$string}", regex: "${2:pattern}" } }`

### $regexFindAll

- **Snippet:** `{ $regexFindAll: { input: "${1:\$string}", regex: "${2:pattern}" } }`

### $regexMatch

- **Snippet:** `{ $regexMatch: { input: "${1:\$string}", regex: "${2:pattern}" } }`

### $replaceOne

- **Snippet:** `{ $replaceOne: { input: "${1:\$string}", find: "${2:find}", replacement: "${3:replacement}" } }`

### $replaceAll

- **Snippet:** `{ $replaceAll: { input: "${1:\$string}", find: "${2:find}", replacement: "${3:replacement}" } }`

### $split

- **Snippet:** `{ $split: ["${1:\$string}", "${2:delimiter}"] }`

### $substr

- **Snippet:** `{ $substr: ["${1:\$string}", ${2:start}, ${3:length}] }`

### $substrBytes

- **Snippet:** `{ $substrBytes: ["${1:\$string}", ${2:start}, ${3:length}] }`

### $substrCP

- **Snippet:** `{ $substrCP: ["${1:\$string}", ${2:start}, ${3:length}] }`

### $strcasecmp

- **Snippet:** `{ $strcasecmp: ["${1:\$string1}", "${2:\$string2}"] }`

### $trim

- **Snippet:** `{ $trim: { input: "${1:\$string}" } }`

### $ltrim

- **Snippet:** `{ $ltrim: { input: "${1:\$string}" } }`

### $rtrim

- **Snippet:** `{ $rtrim: { input: "${1:\$string}" } }`

## Trigonometry Expression Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: "${1:\$value}" }`

### $degreesToRadians

- **Snippet:** `{ $degreesToRadians: "${1:\$angle}" }`

### $radiansToDegrees

- **Snippet:** `{ $radiansToDegrees: "${1:\$angle}" }`

## Type Expression Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: "${1:\$field}" }`

### $convert

- **Snippet:** `{ $convert: { input: "${1:\$field}", to: "${2:type}" } }`

## Data Size Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: "${1:\$field}" }`

## Literal Expression Operator

### DEFAULT

- **Snippet:** `{ {{VALUE}}: ${1:value} }`

## Miscellaneous Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: ${1:value} }`

### $getField

- **Snippet:** `{ $getField: { field: "${1:fieldName}", input: "${2:\$object}" } }`

### $rand

- **Snippet:** `{ $rand: {} }`

### $sampleRate

- **Snippet:** `{ $sampleRate: ${1:0.5} }`

## Bitwise Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: [${1:value1}, ${2:value2}] }`

### $bitNot

- **Snippet:** `{ $bitNot: "${1:\$field}" }`

## Timestamp Expression Operators

### DEFAULT

- **Snippet:** `{ {{VALUE}}: "${1:\$timestampField}" }`

## Variable Expression Operators

### $let

- **Snippet:** `{ $let: { vars: { ${1:var}: ${2:expression} }, in: ${3:expression} } }`
