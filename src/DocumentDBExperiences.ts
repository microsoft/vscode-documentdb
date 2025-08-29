/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum API {
    CosmosDBMongoRU = 'mongoRU',
    DocumentDB = 'documentDB',
}

export function getExperienceFromApi(api: API): Experience {
    let info = experiencesMap.get(api);
    if (!info) {
        info = { api: api, shortName: api, longName: api, tag: api };
    }
    return info;
}

export interface Experience {
    /**
     * Programmatic name used internally by us for historical reasons. Doesn't actually affect anything in Azure (maybe UI?)
     */
    api: API;

    longName: string;
    shortName: string;
    description?: string;

    // the string used as a telemetry key for a given experience
    telemetryName?: string;

    // The defaultExperience tag to place into the resource (has no actual effect in Azure, just imitating the portal)
    tag?: string;
}

export const CosmosDBMongoRUExperience: Experience = {
    api: API.CosmosDBMongoRU,
    longName: 'Azure Cosmos DB for MongoDB (RU)',
    shortName: 'MongoDB (RU)',
    telemetryName: 'mongoru',
    tag: 'Azure Cosmos DB for MongoDB (RU)',
} as const;

export const DocumentDBExperience: Experience = {
    api: API.DocumentDB,
    longName: 'DocumentDB',
    shortName: 'DocumentDB',
    telemetryName: 'documentdb',
    tag: 'DocumentDB',
} as const;

const experiencesArray: Experience[] = [DocumentDBExperience, CosmosDBMongoRUExperience];
const experiencesMap = new Map<API, Experience>(
    experiencesArray.map((info: Experience): [API, Experience] => [info.api, info]),
);
