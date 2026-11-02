/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface AwsRegion {
    id: string;
    name: string;
}

/** Suggested commercial regions, not an exhaustive list or a guarantee of DocumentDB availability. */
export const AWS_REGIONS: readonly AwsRegion[] = [
    { id: 'us-east-1', name: 'US East (N. Virginia)' },
    { id: 'us-east-2', name: 'US East (Ohio)' },
    { id: 'us-west-1', name: 'US West (N. California)' },
    { id: 'us-west-2', name: 'US West (Oregon)' },
    { id: 'ca-central-1', name: 'Canada (Central)' },
    { id: 'ca-west-1', name: 'Canada West (Calgary)' },
    { id: 'sa-east-1', name: 'South America (Sao Paulo)' },
    { id: 'eu-west-1', name: 'Europe (Ireland)' },
    { id: 'eu-west-2', name: 'Europe (London)' },
    { id: 'eu-west-3', name: 'Europe (Paris)' },
    { id: 'eu-central-1', name: 'Europe (Frankfurt)' },
    { id: 'eu-central-2', name: 'Europe (Zurich)' },
    { id: 'eu-north-1', name: 'Europe (Stockholm)' },
    { id: 'eu-south-1', name: 'Europe (Milan)' },
    { id: 'eu-south-2', name: 'Europe (Spain)' },
    { id: 'ap-south-1', name: 'Asia Pacific (Mumbai)' },
    { id: 'ap-south-2', name: 'Asia Pacific (Hyderabad)' },
    { id: 'ap-southeast-1', name: 'Asia Pacific (Singapore)' },
    { id: 'ap-southeast-2', name: 'Asia Pacific (Sydney)' },
    { id: 'ap-southeast-3', name: 'Asia Pacific (Jakarta)' },
    { id: 'ap-southeast-4', name: 'Asia Pacific (Melbourne)' },
    { id: 'ap-northeast-1', name: 'Asia Pacific (Tokyo)' },
    { id: 'ap-northeast-2', name: 'Asia Pacific (Seoul)' },
    { id: 'ap-northeast-3', name: 'Asia Pacific (Osaka)' },
    { id: 'ap-east-1', name: 'Asia Pacific (Hong Kong)' },
    { id: 'me-south-1', name: 'Middle East (Bahrain)' },
    { id: 'me-central-1', name: 'Middle East (UAE)' },
    { id: 'af-south-1', name: 'Africa (Cape Town)' },
    { id: 'il-central-1', name: 'Israel (Tel Aviv)' },
];

export const REGIONS = AWS_REGIONS;
